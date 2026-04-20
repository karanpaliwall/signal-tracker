"""
APScheduler — daily "present" run + weekly Monday 9am IST digest.
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

# Single scheduler instance — created once during startup.
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


# ── Job wrappers ──────────────────────────────────────────────────────────

def _run_present() -> None:
    lb.log("scheduler", "Scheduled present run triggered")
    pipeline.trigger_run("live")


def _run_weekly() -> None:
    lb.log("scheduler", "Scheduled weekly run triggered")
    pipeline.trigger_run("weekly")


# ── Public API ────────────────────────────────────────────────────────────

def apply_state(state: dict) -> None:
    """
    Apply scheduler state — add/remove jobs based on enabled flag and config.
    Safe to call multiple times (uses replace_existing=True).
    """
    sched = _get_scheduler()

    # Weekly digest is always scheduled (Monday 9am IST)
    sched.add_job(
        _run_weekly,
        CronTrigger(day_of_week="mon", hour=9, minute=0, timezone=IST),
        id="weekly_digest",
        replace_existing=True,
    )

    if state.get("enabled"):
        hour = int(state.get("hour", 9))
        minute = int(state.get("minute", 0))

        sched.add_job(
            _run_present,
            CronTrigger(hour=hour, minute=minute, timezone=IST),
            id="present_daily",
            replace_existing=True,
        )
        lb.log("scheduler", f"Daily present run scheduled at {hour:02d}:{minute:02d} IST")
    else:
        try:
            sched.remove_job("present_daily")
        except JobLookupError:
            pass  # job doesn't exist — that's fine
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
    """Return next scheduled run times for both jobs."""
    sched = _get_scheduler()
    result = {}
    for job_id in ("present_daily", "weekly_digest"):
        job = sched.get_job(job_id)
        if job and job.next_run_time:
            result[job_id] = job.next_run_time.isoformat()
        else:
            result[job_id] = None
    return result
