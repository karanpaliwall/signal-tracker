"""
Deduplication for job signals.

Two passes:
1. Exact match on job_id — handled by UNIQUE INDEX in DB (ON CONFLICT DO NOTHING).
2. Fuzzy match on company_name + job_title_raw — rapidfuzz token_sort_ratio >= 85.
   Marks soft duplicates as is_duplicate = TRUE.

Performance: records are pre-bucketed by company name before fuzzy comparison,
reducing complexity from O(n²) to O(n × avg_roles_per_company²).
"""
from collections import defaultdict

from rapidfuzz import fuzz
from backend.database import get_cursor
import backend.log_buffer as lb


def run_dedup() -> int:
    """
    Find fuzzy duplicates among job signals and mark them.
    Returns count of records marked as duplicate.
    """
    lb.log("dedup", "Running fuzzy dedup...")

    with get_cursor() as cur:
        cur.execute(
            """
            SELECT id, company_name, job_title_raw, job_url
            FROM job_signals
            WHERE is_duplicate = FALSE
              AND company_name IS NOT NULL
              AND scraped_at >= NOW() - INTERVAL '30 days'
            ORDER BY scraped_at ASC
            """
        )
        records = cur.fetchall()

    # Pre-bucket by company name: only compare within the same company.
    # Two jobs at different companies are never duplicates.
    buckets: defaultdict[str, list[dict]] = defaultdict(list)
    dup_ids: list = []

    for rec in records:
        company = (rec["company_name"] or "").lower().strip()
        title = (rec["job_title_raw"] or "").lower().strip()
        url = (rec["job_url"] or "").strip()
        key = f"{company}|{title}"

        bucket = buckets[company]
        is_dup = any(
            (url and url == s["url"]) or fuzz.token_sort_ratio(key, s["key"]) >= 85
            for s in bucket
        )

        if is_dup:
            dup_ids.append(rec["id"])
        else:
            bucket.append({"key": key, "url": url})

    if dup_ids:
        with get_cursor() as cur:
            cur.execute(
                "UPDATE job_signals SET is_duplicate = TRUE WHERE id = ANY(%s)",
                (dup_ids,),
            )
        lb.log("dedup", f"Marked {len(dup_ids)} duplicates")
    else:
        lb.log("dedup", "No duplicates found")

    return len(dup_ids)
