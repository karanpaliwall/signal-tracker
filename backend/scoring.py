from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

import psycopg2.extras

from backend.database import get_cursor
import backend.log_buffer as lb

# Scoring constants
_SCORE_C_SUITE = 50
_SCORE_DIRECTOR = 20
_SCORE_DEPT_CLUSTER_3 = 30
_SCORE_DEPT_CLUSTER_2 = 10
_SCORE_SALES_CLUSTER = 20
_SCORE_RECENCY_TODAY = 15
_THRESHOLD_HIGH = 60.0
_THRESHOLD_MEDIUM = 25.0


def compute_priority(company_jobs: list[dict]) -> tuple[str, float]:
    """
    Deterministic rule-based priority scoring.
    Returns (priority, score) — never calls Claude.
    """
    if not company_jobs:
        return "low", 0.0

    score = 0.0

    # C-suite hire = +50 per hire
    score += sum(_SCORE_C_SUITE for j in company_jobs if j.get("seniority") == "c-suite")

    # Director hire = +20 per hire
    score += sum(_SCORE_DIRECTOR for j in company_jobs if j.get("seniority") == "director")

    # Department clustering
    dept_counts = Counter(j.get("department") for j in company_jobs if j.get("department"))
    for _dept, count in dept_counts.items():
        if count >= 3:
            score += _SCORE_DEPT_CLUSTER_3
        elif count == 2:
            score += _SCORE_DEPT_CLUSTER_2

    # Sales cluster bonus (2+ Sales roles = active outbound buildout)
    sales_count = sum(1 for j in company_jobs if j.get("department") == "Sales")
    if sales_count >= 2:
        score += _SCORE_SALES_CLUSTER

    # Recency bonus — any role posted today (UTC)
    today = datetime.now(timezone.utc).date()
    if any(j.get("posted_date") == today for j in company_jobs):
        score += _SCORE_RECENCY_TODAY

    # Confidence weighting — average confidence across all roles
    confidences = [j.get("confidence") or 0.5 for j in company_jobs]
    avg_conf = sum(confidences) / len(confidences)
    score *= avg_conf

    if score >= _THRESHOLD_HIGH:
        priority = "high"
    elif score >= _THRESHOLD_MEDIUM:
        priority = "medium"
    else:
        priority = "low"

    return priority, round(score, 2)


def _pick_top_intent(company_jobs: list[dict]) -> str:
    """Return the most common intent signal among a company's jobs."""
    signals = [j.get("intent_signal") for j in company_jobs if j.get("intent_signal")]
    if not signals:
        return ""
    return Counter(signals).most_common(1)[0][0]


def rebuild_company_signals() -> int:
    """
    Aggregate classified job_signals → company_signals.
    Upserts all companies in a single batch INSERT ... ON CONFLICT.
    Returns count of companies updated.
    """
    lb.log("scoring", "Rebuilding company signals...")

    # Fetch all classified, non-duplicate job signals
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT
              company_name, department, seniority, intent_signal,
              confidence, posted_date
            FROM job_signals
            WHERE is_duplicate = FALSE
              AND job_title_normalized IS NOT NULL
              AND company_name IS NOT NULL
              AND scraped_at >= NOW() - INTERVAL '90 days'
            """
        )
        rows = cur.fetchall()

    if not rows:
        lb.log("scoring", "No classified records to aggregate")
        return 0

    # Group by company
    companies: dict[str, list] = defaultdict(list)
    for row in rows:
        companies[row["company_name"]].append(dict(row))

    today = datetime.now(timezone.utc).date()
    cutoff = today - timedelta(days=7)

    # Build all upsert rows in Python first (no DB per iteration)
    upsert_rows = []
    for company_name, jobs in companies.items():
        priority, score = compute_priority(jobs)
        dept_breakdown = dict(Counter(j.get("department") for j in jobs if j.get("department")))
        top_intent = _pick_top_intent(jobs)
        total_roles = len(jobs)
        velocity = sum(
            1 for j in jobs
            if j.get("posted_date") and j["posted_date"] >= cutoff
        )
        upsert_rows.append((
            company_name,
            total_roles,
            psycopg2.extras.Json(dept_breakdown),
            top_intent,
            priority,
            score,
            velocity,
            datetime.now(timezone.utc),
        ))

    # Single batch upsert — one DB roundtrip regardless of company count
    with get_cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO company_signals
              (company_name, total_open_roles, department_breakdown,
               top_intent_signal, overall_priority, signal_strength_score,
               role_velocity_7d, last_updated_at)
            VALUES %s
            ON CONFLICT (company_name) DO UPDATE SET
              total_open_roles      = EXCLUDED.total_open_roles,
              department_breakdown  = EXCLUDED.department_breakdown,
              top_intent_signal     = EXCLUDED.top_intent_signal,
              overall_priority      = EXCLUDED.overall_priority,
              signal_strength_score = EXCLUDED.signal_strength_score,
              role_velocity_7d      = EXCLUDED.role_velocity_7d,
              last_updated_at       = NOW(),
              first_seen_at         = COALESCE(company_signals.first_seen_at, NOW())
            """,
            upsert_rows,
        )

        # Propagate company-level priority back to individual job signals
        cur.execute(
            """
            UPDATE job_signals SET priority = cs.overall_priority
            FROM company_signals cs
            WHERE job_signals.company_name = cs.company_name
              AND job_signals.is_duplicate = FALSE
            """
        )

    updated = len(upsert_rows)
    lb.log("scoring", f"Updated {updated} company signals")
    return updated
