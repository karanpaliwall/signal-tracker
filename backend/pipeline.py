"""
Pipeline orchestrator — runs the full scrape → classify → score cycle.
Threading lock prevents two concurrent runs (TOCTOU-safe).
"""
import threading
from datetime import datetime

from backend.database import get_cursor
from backend.scrapers.linkedin import LinkedInScraper
from backend.scrapers.indeed import IndeedScraper
from backend.scrapers.glassdoor import GlassdoorScraper
from backend.scrapers.monster import MonsterScraper
from backend.scrapers.naukri import NaukriScraper
from backend import intelligence, scoring, dedup, notifier
import backend.log_buffer as lb

_lock = threading.Lock()

# Running state — protected by _lock
_state = {
    "live_running": False,
    "intelligence_running": False,
}


def is_running() -> dict:
    with _lock:
        return dict(_state)


def _load_keywords(platform: str) -> list[str]:
    """Load keyword list from app_config. Falls back to scraper defaults."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT value FROM app_config WHERE key = 'keywords'")
            row = cur.fetchone()
        if row and row["value"]:
            kw = row["value"].get(platform, [])
            if kw:
                return kw
    except Exception as e:
        lb.log("pipeline", f"Failed to load keywords for {platform}, using defaults: {e}", "warning")
    # Fallback to scraper defaults
    import importlib
    defaults = {
        "linkedin":  "backend.scrapers.linkedin",
        "indeed":    "backend.scrapers.indeed",
        "glassdoor": "backend.scrapers.glassdoor",
        "monster":   "backend.scrapers.monster",
        "naukri":    "backend.scrapers.naukri",
    }
    module_path = defaults.get(platform, "backend.scrapers.linkedin")
    mod = importlib.import_module(module_path)
    return mod.DEFAULT_KEYWORDS


def _load_results_per_keyword() -> int:
    """Load results_per_keyword from app_config. Defaults to 25."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT value FROM app_config WHERE key = 'sources'")
            row = cur.fetchone()
        if row and row["value"]:
            return int(row["value"].get("results_per_keyword", 25))
    except Exception:
        pass
    return 25


def _load_enabled_platforms() -> dict:
    """Return which platforms are enabled from app_config."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT value FROM app_config WHERE key = 'sources'")
            row = cur.fetchone()
        if row and row["value"]:
            return row["value"]
    except Exception as e:
        lb.log("pipeline", f"Failed to load platform config: {e}", "warning")
    return {
        "linkedin_enabled": True, "indeed_enabled": True,
        "glassdoor_enabled": False, "monster_enabled": False, "naukri_enabled": False,
    }


def _create_run_record(platform: str, mode: str):
    """Insert a new run record and return its id."""
    with get_cursor() as cur:
        cur.execute(
            """
            INSERT INTO signal_scraper_runs (platform, mode, status)
            VALUES (%s, %s, 'running')
            RETURNING id
            """,
            (platform, mode),
        )
        return cur.fetchone()["id"]


def _finish_run_record(
    run_id,
    status: str,
    error: str | None = None,
    duplicates: int = 0,
    jobs_found: int = 0,
    jobs_added: int = 0,
) -> None:
    with get_cursor() as cur:
        cur.execute(
            """
            UPDATE signal_scraper_runs
            SET status = %s, completed_at = NOW(), error_message = %s,
                duplicates_caught = duplicates_caught + %s,
                jobs_found = jobs_found + %s,
                jobs_added = jobs_added + %s
            WHERE id = %s
            """,
            (status, error, duplicates, jobs_found, jobs_added, run_id),
        )


def _run_pipeline() -> None:
    """
    Full pipeline: scrape all enabled platforms → dedup → classify → score → notify.
    Runs in a background thread. Always uses live mode (24h window).
    """
    lb.log("pipeline", "=== Live run started ===")

    total_added = 0
    platforms = _load_enabled_platforms()
    max_items = _load_results_per_keyword()

    lb.log("pipeline", f"Results per keyword: {max_items}")

    ALL_PLATFORMS = [
        ("linkedin_enabled",  "linkedin",  LinkedInScraper),
        ("indeed_enabled",    "indeed",    IndeedScraper),
        ("glassdoor_enabled", "glassdoor", GlassdoorScraper),
        ("monster_enabled",   "monster",   MonsterScraper),
        ("naukri_enabled",    "naukri",    NaukriScraper),
    ]
    DEFAULTS = {"linkedin_enabled": True, "indeed_enabled": True}

    try:
        # ── Step 1: Scraping ────────────────────────────────────────────
        for config_key, platform_name, ScraperClass in ALL_PLATFORMS:
            if lb.should_stop("live"):
                lb.log("pipeline", f"Stopped before {platform_name}")
                return
            default = DEFAULTS.get(config_key, False)
            if platforms.get(config_key, default):
                keywords = _load_keywords(platform_name)
                run_id = None
                try:
                    run_id = _create_run_record(platform_name, "live")
                    found, added = ScraperClass().run(keywords, "live", max_items)
                    _finish_run_record(run_id, "completed", jobs_found=found, jobs_added=added)
                    total_added += added
                except Exception as e:
                    if run_id:
                        _finish_run_record(run_id, "failed", str(e)[:200])
                    lb.log("pipeline", f"{platform_name} scrape failed: {e}", "error")

        # ── Step 2: Dedup ───────────────────────────────────────────────
        lb.log("pipeline", "Running deduplication...")
        dups_caught = dedup.run_dedup()
        lb.log("pipeline", f"Dedup complete — {dups_caught} duplicates marked")

        # ── Step 3: Intelligence (classify) ────────────────────────────
        lb.log("pipeline", "Running Claude Haiku classification...")
        with _lock:
            _state["intelligence_running"] = True
        intel_run_id = _create_run_record("intelligence", "intelligence")
        try:
            intel_result = intelligence.run_intelligence()
            _finish_run_record(
                intel_run_id, "completed",
                jobs_found=intel_result.get("pending", 0),
                jobs_added=intel_result.get("processed", 0),
                duplicates=intel_result.get("failed", 0),
            )
        except Exception as e:
            _finish_run_record(intel_run_id, "failed", str(e)[:200])
            raise

        if lb.should_stop("live"):
            lb.log("pipeline", "Stopped after intelligence")
            return

        # ── Step 4: Scoring + company aggregation ──────────────────────
        lb.log("pipeline", "Rebuilding company signals...")
        scoring.rebuild_company_signals()

        # ── Step 5: Email notification ──────────────────────────────────
        notify_cfg = notifier.get_notify_config()
        if notify_cfg.get("enabled") and notify_cfg.get("recipients"):
            try:
                with get_cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) AS cnt FROM company_signals WHERE overall_priority = 'high'"
                    )
                    hp_row = cur.fetchone()
                high_priority = hp_row["cnt"] if hp_row else 0
            except Exception:
                high_priority = 0

            notifier.send_signal_report(
                notify_cfg["recipients"],
                run_summary={"jobs_added": total_added, "high_priority": high_priority},
            )

        lb.log("pipeline", f"=== Run complete — {total_added} new signals added ===")

    except Exception as e:
        lb.log("pipeline", f"Pipeline error: {e}", "error")
    finally:
        with _lock:
            _state["live_running"] = False
            _state["intelligence_running"] = False
        lb.clear_stop("live")


def trigger_run(mode: str = "live") -> bool:
    """
    Trigger a live pipeline run in a background thread.
    Returns False if a run is already in progress.
    TOCTOU-safe: acquire lock, check flag, set flag, THEN start thread.
    """
    with _lock:
        if _state["live_running"]:
            return False
        _state["live_running"] = True

    lb.clear_stop("live")
    lb.clear_stop("intelligence")
    t = threading.Thread(target=_run_pipeline, daemon=True)
    t.start()
    return True


def stop_run() -> None:
    """Request stop for any in-progress pipeline run."""
    lb.request_stop("live")
    lb.request_stop("intelligence")
    lb.log("pipeline", "Stop requested")


def trigger_intelligence_only() -> bool:
    """
    Run only the classification step (no scraping). Returns False if already running.
    """
    with _lock:
        if _state["live_running"] or _state["intelligence_running"]:
            return False
        _state["intelligence_running"] = True

    def _run() -> None:
        lb.log("intelligence", "=== Intelligence run started ===")
        run_id = _create_run_record("intelligence", "intelligence")
        try:
            result = intelligence.run_intelligence()
            scoring.rebuild_company_signals()
            _finish_run_record(
                run_id, "completed",
                jobs_found=result.get("pending", 0),
                jobs_added=result.get("processed", 0),
                duplicates=result.get("failed", 0),
            )
            lb.log("intelligence", "=== Intelligence run complete ===")
        except Exception as e:
            _finish_run_record(run_id, "failed", str(e)[:200])
            lb.log("intelligence", f"Intelligence run error: {e}", "error")
        finally:
            with _lock:
                _state["intelligence_running"] = False
            lb.clear_stop("intelligence")

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return True
