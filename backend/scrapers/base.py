import os
import json
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime

import psycopg2
import psycopg2.extras
from dateutil import parser as dp
from backend.database import get_cursor
import backend.log_buffer as lb


class BaseJobScraper(ABC):
    platform: str = ""

    @abstractmethod
    def scrape_live(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> list[dict]:
        """Call Apify actor and return raw results."""
        ...

    @abstractmethod
    def _normalize(self, raw: dict) -> dict | None:
        """Map platform-specific fields to unified schema. Return None to skip record."""
        ...

    def run(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> tuple[int, int]:
        """
        Fetch listings, normalize, and batch-insert.
        max_items: results per keyword (daily). Weekly gets 3× automatically.
        Returns (jobs_found, jobs_added).
        """
        lb.log(self.platform, f"Starting live scrape ({len(keywords)} keywords, {max_items} results/keyword)...")

        raw_records = self.scrape_live(keywords, mode, max_items)
        lb.log(self.platform, f"Apify returned {len(raw_records)} raw records")

        normalized = []
        for r in raw_records:
            try:
                n = self._normalize(r)
                if n:
                    n["data_mode"] = "live"
                    normalized.append(n)
            except Exception as e:
                lb.log(self.platform, f"Normalize error: {e}", "warning")

        jobs_added = self.save_records(normalized)
        lb.log(self.platform, f"Saved {jobs_added} new records ({len(normalized) - jobs_added} duplicates)")
        return len(normalized), jobs_added

    def save_records(self, records: list[dict]) -> int:
        """
        Batch INSERT with ON CONFLICT DO NOTHING.
        Returns count of actually inserted rows.
        """
        if not records:
            return 0

        rows = []
        for r in records:
            job_url = r.get("job_url") or ""
            # Only store http/https URLs — rejects javascript: and data: URIs
            if job_url and not job_url.startswith(("http://", "https://")):
                job_url = ""
            rows.append((
                r.get("job_id"),
                r.get("company_name"),
                r.get("company_domain"),
                r.get("job_title_raw"),
                r.get("platform"),
                r.get("location"),
                job_url,
                r.get("description_snippet"),
                r.get("posted_date"),
                r.get("data_mode", "live"),
                json.dumps(r.get("raw_data")) if r.get("raw_data") else None,
            ))

        # Insert in chunks of 50; retry each chunk once on transient SSL drops
        total_inserted = 0
        for i in range(0, len(rows), 50):
            chunk = rows[i:i + 50]
            for attempt in range(3):
                try:
                    with get_cursor() as cur:
                        result = psycopg2.extras.execute_values(
                            cur,
                            """
                            INSERT INTO job_signals
                              (job_id, company_name, company_domain, job_title_raw,
                               platform, location, job_url, description_snippet,
                               posted_date, data_mode, raw_data)
                            VALUES %s
                            ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING
                            RETURNING id
                            """,
                            chunk,
                            fetch=True,
                        )
                    total_inserted += len(result) if result else 0
                    break
                except (psycopg2.OperationalError, psycopg2.InterfaceError):
                    if attempt == 2:
                        raise
                    time.sleep(0.5 * (attempt + 1))
        return total_inserted

    def _run_keywords_parallel(self, keywords: list[str], scrape_fn, max_workers: int = 1) -> list[dict]:
        """
        Run scrape_fn(keyword) for all keywords in parallel.
        Each worker gets its own Apify client — thread-safe.
        Respects stop flags: skips keywords if stop is requested.
        Returns flat list of raw results.
        """
        results = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(scrape_fn, kw): kw for kw in keywords}
            for future in as_completed(futures):
                try:
                    items = future.result()
                    if items:
                        results.extend(items)
                except Exception as e:
                    lb.log(self.platform, f"Parallel scrape error: {e}", "error")
        return results

    def _safe_date(self, value) -> date | None:
        """Parse various date formats into a date object."""
        if not value:
            return None
        if isinstance(value, date):
            return value
        if isinstance(value, datetime):
            return value.date()
        try:
            return dp.parse(str(value)).date()
        except Exception:
            return None
