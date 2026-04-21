import os
import hashlib
from typing import Optional
from apify_client import ApifyClient
from backend.scrapers.base import BaseJobScraper
import backend.log_buffer as lb

ACTOR_ID = "misceres/indeed-scraper"

DEFAULT_KEYWORDS = [
    "Sales Development Representative", "Account Executive", "VP of Sales",
    "Revenue Operations Manager", "Growth Marketing Manager",
    "Software Engineer", "Data Engineer", "Product Manager",
]


class IndeedScraper(BaseJobScraper):
    platform = "indeed"

    def scrape_live(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> list[dict]:
        def scrape_one(keyword):
            if lb.should_stop("live"):
                return []
            client = ApifyClient(os.environ["APIFY_TOKEN"])
            try:
                lb.log("indeed", f"Scraping: {keyword} (limit: {max_items})")
                from urllib.parse import quote_plus
                search_url = f"https://www.indeed.com/jobs?q={quote_plus(keyword)}&l=United+States&sort=date"
                run = client.actor(ACTOR_ID).call(run_input={
                    "startUrls": [{"url": search_url}],
                    "maxItems": max_items,
                })
                items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
                lb.log("indeed", f"  → {len(items)} results for '{keyword}'")
                return items
            except Exception as e:
                lb.log("indeed", f"Error scraping '{keyword}': {e}", "error")
                return []

        return self._run_keywords_parallel(keywords, scrape_one)

    def _normalize(self, raw: dict) -> Optional[dict]:
        job_title = (raw.get("positionName") or raw.get("title") or raw.get("jobTitle") or "").strip()
        company   = (raw.get("company") or raw.get("companyName") or "").strip()
        if not job_title or not company:
            return None

        external_id = raw.get("id") or raw.get("jobId") or ""
        if external_id:
            job_id = f"indeed:{external_id}"
        else:
            raw_key = f"{company}|{job_title}|{raw.get('url', '')}"
            job_id = f"indeed:{hashlib.md5(raw_key.encode()).hexdigest()[:16]}"

        description = raw.get("description") or raw.get("jobDescription") or ""
        if isinstance(description, str) and description.startswith("<"):
            # strip basic HTML tags from description snippet
            import re
            description = re.sub(r"<[^>]+>", " ", description).strip()

        return {
            "job_id": job_id,
            "company_name": company,
            "company_domain": None,
            "job_title_raw": job_title,
            "platform": "indeed",
            "location": (raw.get("location") or raw.get("city") or "").strip(),
            "job_url": raw.get("url") or raw.get("jobUrl") or raw.get("externalApplyLink") or "",
            "description_snippet": description[:500],
            "posted_date": self._safe_date(raw.get("datePosted") or raw.get("postedAt") or raw.get("date")),
            "raw_data": {k: v for k, v in raw.items() if k not in ("description", "jobDescription")},
        }
