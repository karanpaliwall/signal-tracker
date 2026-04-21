import base64
import csv
import html
import io
import os
from datetime import date

import psycopg2.extras
import resend

from backend.database import get_cursor
import backend.log_buffer as lb

# Initialize Resend API key once at module load time (thread-safe).
resend.api_key = os.environ.get("RESEND_API_KEY", "")

CSV_HEADERS = [
    "id", "job_id", "company_name", "company_domain",
    "job_title_raw",
    "department", "seniority", "intent_signal", "priority", "confidence",
    "platform", "location", "job_url", "description_snippet",
    "posted_date", "scraped_at", "data_mode", "is_duplicate",
    "processing_attempts", "created_at",
]


def _csv_safe(value: str | None) -> str | None:
    """Prevent CSV formula injection by prefixing formula-starting characters."""
    if isinstance(value, str) and value and value[0] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return value


def _format_csv_row(row: dict) -> list:
    """Format a job_signals row for CSV output."""
    return [
        row.get("id"),
        row.get("job_id"),
        _csv_safe(row.get("company_name")),
        row.get("company_domain"),
        _csv_safe(row.get("job_title_raw")),
        row.get("department"),
        row.get("seniority"),
        _csv_safe(row.get("intent_signal")),
        row.get("priority"),
        row.get("confidence"),
        row.get("platform"),
        row.get("location"),
        row.get("job_url"),
        _csv_safe(row.get("description_snippet")),
        str(row["posted_date"]) if row.get("posted_date") else "",
        row["scraped_at"].strftime("%Y-%m-%d %H:%M:%S UTC") if row.get("scraped_at") else "",
        row.get("data_mode"),
        str(row.get("is_duplicate", "")).lower(),
        row.get("processing_attempts"),
        row["created_at"].strftime("%Y-%m-%d %H:%M:%S UTC") if row.get("created_at") else "",
    ]


def _build_csv_bytes() -> bytes:
    """Build CSV as bytes (UTF-8 with BOM for Excel). Streams in batches to minimize peak memory."""
    buf = io.BytesIO()
    wrapper = io.TextIOWrapper(buf, encoding="utf-8-sig", newline="")
    writer = csv.writer(wrapper)
    writer.writerow(CSV_HEADERS)
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT
              id, job_id, company_name, company_domain,
              job_title_raw,
              department, seniority, intent_signal, priority, confidence,
              platform, location, job_url, description_snippet,
              posted_date, scraped_at, data_mode, is_duplicate,
              processing_attempts, created_at
            FROM job_signals
            WHERE is_duplicate = FALSE
            ORDER BY scraped_at DESC
            LIMIT 5000
            """
        )
        while True:
            batch = cur.fetchmany(500)
            if not batch:
                break
            for row in batch:
                writer.writerow(_format_csv_row(row))
    wrapper.flush()
    return buf.getvalue()


def send_signal_report(recipients: list[str], run_summary: dict | None = None) -> bool:
    """
    Build CSV from current job_signals and email to all recipients via Resend.
    Returns True on success.
    """
    if not recipients:
        lb.log("notifier", "No recipients configured — skipping email")
        return False

    if not resend.api_key:
        lb.log("notifier", "RESEND_API_KEY not set — skipping email", "warning")
        return False

    try:
        csv_bytes = _build_csv_bytes()
        csv_b64 = base64.b64encode(csv_bytes).decode()
        filename = f"hiring-signals-{date.today().isoformat()}.csv"

        summary = run_summary or {}
        jobs_added = html.escape(str(summary.get("jobs_added", "N/A")))
        high_priority = html.escape(str(summary.get("high_priority", "N/A")))

        from_addr = os.environ.get("RESEND_FROM", "Signals <signals@resend.dev>")

        resend.Emails.send({
            "from": from_addr,
            "to": recipients,
            "subject": f"Hiring Signal Report — {jobs_added} new signals ({date.today().strftime('%b %d, %Y')})",
            "html": f"""
              <h2>Hiring Signal Tracker Report</h2>
              <p><strong>{jobs_added}</strong> new signals added in this run.</p>
              <p><strong>{high_priority}</strong> high-priority companies detected.</p>
              <p>Full dataset attached as CSV.</p>
              <hr>
              <p style="color:#888;font-size:12px;">
                Sent by Hiring Signal Tracker &middot; Powered by Growleads
              </p>
            """,
            "attachments": [{"filename": filename, "content": csv_b64}],
        })
        lb.log("notifier", f"Email sent to {len(recipients)} recipient(s)")
        return True
    except Exception as e:
        lb.log("notifier", f"Email failed: {e}", "error")
        return False


def get_notify_config() -> dict:
    """Load notification config from app_config table."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT value FROM app_config WHERE key = 'notify_config'")
            row = cur.fetchone()
        if row:
            return row["value"]
    except Exception as e:
        lb.log("notifier", f"Failed to load notify config: {e}", "warning")
    return {"enabled": False, "recipients": []}


def save_notify_config(enabled: bool, recipients: list[str]) -> None:
    """Persist notification config to app_config."""
    with get_cursor() as cur:
        cur.execute(
            """
            INSERT INTO app_config (key, value)
            VALUES ('notify_config', %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (psycopg2.extras.Json({"enabled": enabled, "recipients": recipients}),),
        )
