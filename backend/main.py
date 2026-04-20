import csv
import io
import os
from contextlib import asynccontextmanager
from datetime import date

import psycopg2.extras
from pathlib import Path
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security.api_key import APIKeyHeader
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from backend import pipeline, scheduler, notifier, intelligence
from backend.database import get_cursor
from backend.models import (
    DeleteSignalsRequest,
    NotifyConfig,
    SchedulerConfig,
    SourcesConfig,
)
from backend.notifier import CSV_HEADERS, _format_csv_row
import backend.log_buffer as lb

load_dotenv(Path(__file__).parent.parent / ".env")

# ── Rate Limiting ─────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

# ── Auth ─────────────────────────────────────────────────────────────────

_API_KEY = os.environ.get("API_KEY", "")
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def verify_key(key: str | None = Security(_api_key_header)) -> None:
    if not _API_KEY:
        return  # dev mode — open access
    if key != _API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


# ── Lifespan ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not _API_KEY:
        lb.log("startup", "WARNING: API_KEY is not set — all endpoints are open. Set API_KEY in production.", "warning")

    scheduler.startup()
    yield
    scheduler.shutdown()


app = FastAPI(title="Signal Tracker API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-API-Key"],
)


# ── Health ────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "auth_required": bool(_API_KEY)}


# ── Meta (enum discovery for agents) ─────────────────────────────────────

@app.get("/api/meta")
def get_meta() -> dict:
    """Returns valid enum values for all filter parameters."""
    return {
        "departments": sorted(intelligence.VALID_DEPARTMENTS),
        "seniorities": sorted(intelligence.VALID_SENIORITIES),
        "platforms": ["linkedin", "indeed", "glassdoor", "monster", "naukri"],
        "priorities": ["high", "medium", "low"],
        "data_modes": ["live", "weekly"],
    }


# ── Scraping ──────────────────────────────────────────────────────────────

@app.post("/api/scrape/run", dependencies=[Depends(verify_key)])
@limiter.limit("10/minute")
def scrape_run(request: Request, mode: str = Query("full", pattern="^(live|weekly|full)$")) -> dict:
    ok = pipeline.trigger_run(mode)
    if not ok:
        raise HTTPException(status_code=409, detail="A run is already in progress")
    return {"started": True, "mode": mode}


@app.post("/api/scrape/stop", dependencies=[Depends(verify_key)])
def scrape_stop() -> dict:
    pipeline.stop_run()
    return {"stopped": True}


@app.get("/api/scrape/status", dependencies=[Depends(verify_key)])
def scrape_status() -> dict:
    return pipeline.is_running()


@app.get("/api/scrape/log", dependencies=[Depends(verify_key)])
@limiter.limit("120/minute")
def scrape_log(request: Request, since: int = Query(0)) -> dict:
    lines, total = lb.get_lines(since)
    return {"lines": lines, "total": total}


@app.get("/api/scrape/runs", dependencies=[Depends(verify_key)])
def scrape_runs(limit: int = Query(20, le=100)) -> list:
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT id, platform, mode, started_at, completed_at, status,
                   jobs_found, jobs_added, duplicates_caught, error_message
            FROM signal_scraper_runs
            ORDER BY started_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


# ── Signals ───────────────────────────────────────────────────────────────

def _build_signals_filters(
    platform: str | None,
    department: str | None,
    priority: str | None,
    data_mode: str | None,
    search: str | None,
) -> tuple[str, list]:
    """Build WHERE clause and params for signal queries. Returns (where_clause, params)."""
    filters = ["is_duplicate = FALSE"]
    params = []

    if platform:
        filters.append("platform = %s")
        params.append(platform)
    if department:
        filters.append("department = %s")
        params.append(department)
    if priority:
        filters.append("priority = %s")
        params.append(priority)
    if data_mode:
        filters.append("data_mode = %s")
        params.append(data_mode)
    if search:
        filters.append("(company_name ILIKE %s OR job_title_raw ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    return " AND ".join(filters), params


@app.get("/api/signals", dependencies=[Depends(verify_key)])
def get_signals(
    platform: str | None = Query(None),
    department: str | None = Query(None),
    priority: str | None = Query(None),
    data_mode: str | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    where, params = _build_signals_filters(platform, department, priority, data_mode, search)
    offset = (page - 1) * page_size

    with get_cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS cnt FROM job_signals WHERE {where}", params)
        total = cur.fetchone()["cnt"]

        cur.execute(
            f"""
            SELECT id, job_id, company_name, job_title_raw,
                   department, seniority, intent_signal, priority, confidence,
                   platform, location, job_url, description_snippet,
                   posted_date, scraped_at, data_mode
            FROM job_signals
            WHERE {where}
            ORDER BY scraped_at DESC
            LIMIT %s OFFSET %s
            """,
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "results": [dict(r) for r in rows],
    }


@app.get("/api/signals/stats", dependencies=[Depends(verify_key)])
def signals_stats() -> dict:
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE is_duplicate = FALSE)                     AS total,
              COUNT(*) FILTER (WHERE priority = 'high'
                                AND is_duplicate = FALSE)                       AS high_priority,
              COUNT(*) FILTER (WHERE scraped_at >= date_trunc('day', NOW())
                                AND scraped_at < date_trunc('day', NOW()) + INTERVAL '1 day'
                                AND is_duplicate = FALSE)                       AS new_today,
              (SELECT COUNT(DISTINCT company_name) FROM company_signals)        AS companies_tracked
            FROM job_signals
            """
        )
        row = cur.fetchone()
    return dict(row)


@app.get("/api/signals/export", dependencies=[Depends(verify_key)])
@limiter.limit("5/minute")
def signals_export(
    request: Request,
    platform: str | None = Query(None),
    department: str | None = Query(None),
    priority: str | None = Query(None),
    data_mode: str | None = Query(None),
    search: str | None = Query(None),
) -> StreamingResponse:
    """Stream filtered CSV download. Accepts same filters as GET /api/signals."""
    where, params = _build_signals_filters(platform, department, priority, data_mode, search)

    def _generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(CSV_HEADERS)
        yield buf.getvalue()
        with get_cursor() as cur:
            cur.execute(
                f"""
                SELECT
                  id, job_id, company_name, company_domain,
                  job_title_raw,
                  department, seniority, intent_signal, priority, confidence,
                  platform, location, job_url, description_snippet,
                  posted_date, scraped_at, data_mode, is_duplicate,
                  processing_attempts, created_at
                FROM job_signals
                WHERE {where}
                ORDER BY scraped_at DESC
                """,
                params,
            )
            while True:
                batch = cur.fetchmany(500)
                if not batch:
                    break
                for row in batch:
                    buf = io.StringIO()
                    writer = csv.writer(buf)
                    writer.writerow(_format_csv_row(row))
                    yield buf.getvalue()

    filename = f"hiring-signals-{date.today().isoformat()}.csv"
    return StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/signals", dependencies=[Depends(verify_key)])
def delete_signals(body: DeleteSignalsRequest) -> dict:
    if not body.ids:
        return {"deleted": 0}
    with get_cursor() as cur:
        cur.execute("DELETE FROM job_signals WHERE id = ANY(%s)", ([str(i) for i in body.ids],))
    return {"deleted": len(body.ids)}


# ── Companies ─────────────────────────────────────────────────────────────

@app.get("/api/companies", dependencies=[Depends(verify_key)])
def get_companies(
    priority: str | None = Query(None),
    sort_by: str = Query("score"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
) -> dict:
    filters = []
    params = []

    if priority:
        filters.append("overall_priority = %s")
        params.append(priority)

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    order_map = {
        "score": "signal_strength_score DESC",
        "role_count": "total_open_roles DESC",
        "recent": "last_updated_at DESC",
    }
    order = order_map.get(sort_by, "signal_strength_score DESC")
    offset = (page - 1) * page_size

    with get_cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS cnt FROM company_signals {where}", params)
        total = cur.fetchone()["cnt"]

        cur.execute(
            f"""
            SELECT company_name, company_domain, total_open_roles,
                   department_breakdown, top_intent_signal, overall_priority,
                   signal_strength_score, role_velocity_7d, last_updated_at
            FROM company_signals
            {where}
            ORDER BY {order}
            LIMIT %s OFFSET %s
            """,
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "results": [dict(r) for r in rows],
    }


@app.get("/api/companies/{company_name}", dependencies=[Depends(verify_key)])
def get_company(company_name: str) -> dict:
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT company_name, company_domain, total_open_roles,
                   department_breakdown, top_intent_signal, overall_priority,
                   signal_strength_score, role_velocity_7d, last_updated_at
            FROM company_signals
            WHERE company_name = %s
            """,
            (company_name,),
        )
        company = cur.fetchone()
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")

        cur.execute(
            """
            SELECT id, job_title_raw, department, seniority, intent_signal,
                   priority, platform, location, job_url, posted_date
            FROM job_signals
            WHERE company_name = %s AND is_duplicate = FALSE
            ORDER BY posted_date DESC NULLS LAST
            """,
            (company_name,),
        )
        jobs = cur.fetchall()

    return {**dict(company), "open_roles": [dict(j) for j in jobs]}


# ── Intelligence ──────────────────────────────────────────────────────────

@app.post("/api/intelligence/run", dependencies=[Depends(verify_key)])
@limiter.limit("10/minute")
def intelligence_run(request: Request) -> dict:
    ok = pipeline.trigger_intelligence_only()
    if not ok:
        raise HTTPException(status_code=409, detail="Intelligence already running or pipeline is active")
    return {"started": True}


@app.get("/api/intelligence/status", dependencies=[Depends(verify_key)])
def intelligence_status() -> dict:
    return intelligence.get_intelligence_status()


# ── Config ────────────────────────────────────────────────────────────────

@app.get("/api/sources", dependencies=[Depends(verify_key)])
def get_sources() -> dict:
    with get_cursor() as cur:
        cur.execute("SELECT value FROM app_config WHERE key = 'keywords'")
        kw_row = cur.fetchone()
        cur.execute("SELECT value FROM app_config WHERE key = 'sources'")
        src_row = cur.fetchone()

    keywords = kw_row["value"] if kw_row else {}
    sources = src_row["value"] if src_row else {"linkedin_enabled": True, "indeed_enabled": True}

    return {
        "linkedin_enabled":     sources.get("linkedin_enabled", True),
        "indeed_enabled":       sources.get("indeed_enabled", True),
        "glassdoor_enabled":    sources.get("glassdoor_enabled", False),
        "monster_enabled":      sources.get("monster_enabled", False),
        "naukri_enabled":       sources.get("naukri_enabled", False),
        "results_per_keyword":  sources.get("results_per_keyword", 50),
        "linkedin_keywords":     keywords.get("linkedin", []),
        "indeed_keywords":       keywords.get("indeed", []),
        "glassdoor_keywords":    keywords.get("glassdoor", []),
        "monster_keywords":      keywords.get("monster", []),
        "naukri_keywords":       keywords.get("naukri", []),
    }


@app.post("/api/sources", dependencies=[Depends(verify_key)])
def save_sources(body: SourcesConfig) -> dict:
    sources_val = psycopg2.extras.Json({
        "linkedin_enabled":     body.linkedin_enabled,
        "indeed_enabled":       body.indeed_enabled,
        "glassdoor_enabled":    body.glassdoor_enabled,
        "monster_enabled":      body.monster_enabled,
        "naukri_enabled":       body.naukri_enabled,
        "results_per_keyword":  body.results_per_keyword,
    })
    keywords_val = psycopg2.extras.Json({
        "linkedin":     body.linkedin_keywords,
        "indeed":       body.indeed_keywords,
        "glassdoor":    body.glassdoor_keywords,
        "monster":      body.monster_keywords,
        "naukri":       body.naukri_keywords,
    })

    with get_cursor() as cur:
        cur.execute(
            "INSERT INTO app_config (key, value) VALUES ('sources', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (sources_val,),
        )
        cur.execute(
            "INSERT INTO app_config (key, value) VALUES ('keywords', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (keywords_val,),
        )
    return {"saved": True}


@app.get("/api/scheduler", dependencies=[Depends(verify_key)])
def get_scheduler() -> dict:
    state = scheduler.load_state()
    next_runs = scheduler.get_next_runs()
    return {**state, "next_runs": next_runs}


@app.post("/api/scheduler", dependencies=[Depends(verify_key)])
def update_scheduler(body: SchedulerConfig) -> dict:
    state = {
        "enabled": body.enabled,
        "hour": body.hour,
        "minute": body.minute,
    }
    scheduler.save_state(state)
    scheduler.apply_state(state)
    return {"saved": True, **state}


# ── Notifications ─────────────────────────────────────────────────────────

@app.get("/api/notify/config", dependencies=[Depends(verify_key)])
def get_notify() -> dict:
    return notifier.get_notify_config()


@app.post("/api/notify/config", dependencies=[Depends(verify_key)])
def save_notify(body: NotifyConfig) -> dict:
    notifier.save_notify_config(body.enabled, [str(r) for r in body.recipients])
    return {"saved": True}


@app.post("/api/notify/send", dependencies=[Depends(verify_key)])
def send_notify() -> dict:
    cfg = notifier.get_notify_config()
    recipients = cfg.get("recipients", [])
    if not recipients:
        raise HTTPException(status_code=400, detail="No recipients configured")
    ok = notifier.send_signal_report(recipients)
    if not ok:
        raise HTTPException(status_code=500, detail="Email delivery failed. Check server configuration.")
    return {"sent": True, "recipients": recipients}
