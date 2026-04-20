import os
import hashlib
from typing import Optional
from apify_client import ApifyClient
from backend.scrapers.base import BaseJobScraper
import backend.log_buffer as lb

ACTOR_ID = "muhammetakkurtt/naukri-job-scraper"

DEFAULT_KEYWORDS = [
    "Sales Development Representative", "Account Executive",
    "Software Engineer", "Data Engineer", "ML Engineer",
    "Marketing Manager", "Growth Manager",
    "Product Manager", "Operations Manager",
]


class NaukriScraper(BaseJobScraper):
    platform = "naukri"

    def scrape_live(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> list[dict]:
        def scrape_one(keyword):
            if lb.should_stop("live") or lb.should_stop("weekly"):
                return []
            client = ApifyClient(os.environ["APIFY_TOKEN"])
            try:
                lb.log("naukri", f"Scraping: {keyword} (limit: {max_items})")
                # Actor minimum is 50 — enforce that floor
                actor_limit = max(max_items, 50)
                run = client.actor(ACTOR_ID).call(run_input={
                    "keyword": keyword,
                    "maxJobs": actor_limit,
                    "fetchDetails": False,
                })
                items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
                items = items[:max_items]
                lb.log("naukri", f"  → {len(items)} results for '{keyword}'")
                return items
            except Exception as e:
                lb.log("naukri", f"Error scraping '{keyword}': {e}", "error")
                return []

        return self._run_keywords_parallel(keywords, scrape_one)

    def _normalize(self, raw: dict) -> Optional[dict]:
        job_title = (raw.get("title") or raw.get("jobTitle") or "").strip()
        company   = (raw.get("companyName") or raw.get("company") or "").strip()
        if not job_title or not company:
            return None

        external_id = str(raw.get("jobId") or raw.get("id") or "")
        if external_id:
            job_id = f"naukri:{external_id}"
        else:
            job_id = f"naukri:{hashlib.md5(f'{company}|{job_title}'.encode()).hexdigest()[:16]}"

        description = raw.get("jobDescription") or ""

        return {
            "job_id": job_id,
            "company_name": company,
            "company_domain": None,
            "job_title_raw": job_title,
            "platform": "naukri",
            "location": (raw.get("location") or "").strip(),
            "job_url": raw.get("jdURL") or raw.get("url") or "",
            "description_snippet": str(description)[:500],
            "posted_date": self._safe_date(raw.get("createdDate") or raw.get("datePosted")),
            "raw_data": {k: v for k, v in raw.items() if k != "jobDescription"},
        }
