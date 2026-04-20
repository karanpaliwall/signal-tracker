import os
import hashlib
from typing import Optional
from apify_client import ApifyClient
from backend.scrapers.base import BaseJobScraper
import backend.log_buffer as lb

ACTOR_ID = "orgupdate/ziprecruiter-jobs-scraper"

DEFAULT_KEYWORDS = [
    "Sales Development Representative", "Account Executive", "VP Sales",
    "Software Engineer", "Data Engineer",
    "Marketing Manager", "Growth Manager",
    "Product Manager", "Operations Manager",
]


class ZipRecruiterScraper(BaseJobScraper):
    platform = "ziprecruiter"

    def scrape_live(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> list[dict]:
        def scrape_one(keyword):
            if lb.should_stop("live") or lb.should_stop("weekly"):
                return []
            client = ApifyClient(os.environ["APIFY_TOKEN"])
            try:
                lb.log("ziprecruiter", f"Scraping: {keyword} (limit: {max_items})")
                run = client.actor(ACTOR_ID).call(run_input={
                    "includeKeyword": keyword,
                    "locationName": "United States",
                    "pagesToFetch": 1,
                })
                items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
                items = items[:max_items]
                lb.log("ziprecruiter", f"  → {len(items)} results for '{keyword}'")
                return items
            except Exception as e:
                lb.log("ziprecruiter", f"Error scraping '{keyword}': {e}", "error")
                return []

        return self._run_keywords_parallel(keywords, scrape_one)

    def _normalize(self, raw: dict) -> Optional[dict]:
        job_title = (raw.get("job_title") or raw.get("title") or raw.get("jobTitle") or "").strip()
        company   = (raw.get("company_name") or raw.get("company") or raw.get("companyName") or "").strip()
        if not job_title or not company:
            return None

        external_id = str(raw.get("id") or raw.get("jobId") or "")
        if external_id:
            job_id = f"ziprecruiter:{external_id}"
        else:
            raw_key = f"{company}|{job_title}|{raw.get('URL', '')}"
            job_id = f"ziprecruiter:{hashlib.md5(raw_key.encode()).hexdigest()[:16]}"

        raw_url = raw.get("URL") or raw.get("url") or raw.get("jobUrl") or ""
        # Actor returns Google Jobs search URLs — discard them, no direct ZipRecruiter URL available
        job_url = "" if "google.com/search" in raw_url else raw_url

        return {
            "job_id": job_id,
            "company_name": company,
            "company_domain": None,
            "job_title_raw": job_title,
            "platform": "ziprecruiter",
            "location": (raw.get("location") or "").strip(),
            "job_url": job_url,
            "description_snippet": "",
            "posted_date": self._safe_date(raw.get("date") or raw.get("datePosted") or raw.get("postedAt")),
            "raw_data": raw,
        }
