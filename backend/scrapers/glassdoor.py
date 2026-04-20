import os
import hashlib
from typing import Optional
from apify_client import ApifyClient
from backend.scrapers.base import BaseJobScraper
import backend.log_buffer as lb

ACTOR_ID = "automation-lab/glassdoor-jobs-scraper"

DEFAULT_KEYWORDS = [
    "Sales Development Representative", "Account Executive", "VP of Sales",
    "Revenue Operations Manager", "Growth Marketing Manager",
    "Software Engineer", "Data Engineer", "Product Manager",
]


class GlassdoorScraper(BaseJobScraper):
    platform = "glassdoor"

    def scrape_live(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> list[dict]:
        def scrape_one(keyword):
            if lb.should_stop("live") or lb.should_stop("weekly"):
                return []
            client = ApifyClient(os.environ["APIFY_TOKEN"])
            try:
                lb.log("glassdoor", f"Scraping: {keyword} (limit: {max_items})")
                run = client.actor(ACTOR_ID).call(run_input={
                    "query": keyword,
                    "location": "United States",
                    "maxItems": max_items,
                    "limit": max_items,
                    "maxResults": max_items,
                })
                items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
                items = items[:max_items]  # cap client-side regardless of actor behavior
                lb.log("glassdoor", f"  → {len(items)} results for '{keyword}'")
                return items
            except Exception as e:
                lb.log("glassdoor", f"Error scraping '{keyword}': {e}", "error")
                return []

        return self._run_keywords_parallel(keywords, scrape_one)

    def _normalize(self, raw: dict) -> Optional[dict]:
        job_title = (raw.get("jobTitle") or raw.get("title") or "").strip()
        company   = (raw.get("employerName") or raw.get("companyName") or raw.get("company") or "").strip()
        if not job_title or not company:
            return None

        external_id = raw.get("jobListingId") or raw.get("id") or raw.get("jobId") or ""
        if external_id:
            job_id = f"glassdoor:{external_id}"
        else:
            raw_key = f"{company}|{job_title}|{raw.get('jobUrl', '')}"
            job_id = f"glassdoor:{hashlib.md5(raw_key.encode()).hexdigest()[:16]}"

        description = raw.get("jobDescription") or raw.get("description") or ""

        return {
            "job_id": job_id,
            "company_name": company,
            "company_domain": None,
            "job_title_raw": job_title,
            "platform": "glassdoor",
            "location": (raw.get("location") or raw.get("city") or "").strip(),
            "job_url": raw.get("jobUrl") or raw.get("url") or "",
            "description_snippet": description[:500],
            "posted_date": self._safe_date(raw.get("postedDate") or raw.get("datePosted") or raw.get("postedAt")),
            "raw_data": {k: v for k, v in raw.items() if k not in ("jobDescription", "description")},
        }
