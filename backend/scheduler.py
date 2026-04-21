"""
APScheduler — daily live run, scheduled time configurable via Sources & Config.
State persisted in Postgres app_config table (not JSON files — Railway-safe).
"""
import psycopg2.extras
import pytz

from apscheduler.jobstores.base import JobLookupError
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from backend.database import get_cursor
from backend import pipeline
import backend.log_buffer as lb

IST = pytz.timezone("Asia/Kolkata")

_scheduler: BackgroundScheduler | None = None


def _get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone=IST)
        _scheduler.start()
    return _scheduler


# ── State ──────────────────────────────────────────────────────────────────

def load_state() -> dict:
    """Load scheduler config from app_config table."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT value FROM app_config WHERE key = 'scheduler'")
            row = cur.fetchone()
        if row and row["value"]:
            return row["value"]
    except Exception as e:
        lb.log("scheduler", f"Failed to load scheduler config, using defaults: {e}", "warning")
    return {"enabled": False, "hour": 9, "minute": 0}


def save_state(state: dict) -> None:
    """Persist scheduler config to app_config table."""
    with get_cursor() as cur:
        cur.execute(
            """
            INSERT INTO app_config (key, value)
            VALUES ('scheduler', %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (psycopg2.extras.Json(state),),
        )


# ── Job wrapper ───────────────────────────────────────────────────────────

def _run_live() -> None:
    lb.log("scheduler", "Scheduled live run triggered")
    pipeline.trigger_run("live")


# ── Public API ────────────────────────────────────────────────────────────

def apply_state(state: dict) -> None:
    """
    Apply scheduler state — add/remove the daily live run job.
    Safe to call multiple times (uses replace_existing=True).
    """
    sched = _get_scheduler()

    if state.get("enabled"):
        hour = int(state.get("hour", 9))
        minute = int(state.get("minute", 0))
        sched.add_job(
            _run_live,
            CronTrigger(hour=hour, minute=minute, timezone=IST),
            id="live_daily",
            replace_existing=True,
        )
        lb.log("scheduler", f"Daily live run scheduled at {hour:02d}:{minute:02d} IST")
    else:
        try:
            sched.remove_job("live_daily")
        except JobLookupError:
            pass
        lb.log("scheduler", "Scheduler disabled — daily run removed")


def startup() -> None:
    """Load persisted state and apply it. Called from FastAPI lifespan."""
    state = load_state()
    apply_state(state)


def shutdown() -> None:
    """Gracefully shut down the scheduler. Called from FastAPI lifespan."""
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None


def get_next_runs() -> dict:
    """Return next scheduled run time for the daily live job."""
    sched = _get_scheduler()
    job = sched.get_job("live_daily")
    return {
        "live_daily": job.next_run_time.isoformat() if job and job.next_run_time else None
    }
