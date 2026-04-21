import os
import re
import hashlib
from typing import Optional
from apify_client import ApifyClient
from backend.scrapers.base import BaseJobScraper
import backend.log_buffer as lb

_HTML_TAG_RE = re.compile(r'<[^>]+>')

ACTOR_ID = "memo23/monster-scraper"

DEFAULT_KEYWORDS = [
    "Sales Development Representative", "Account Executive", "VP Sales",
    "Software Engineer", "Data Engineer",
    "Marketing Manager", "Growth Manager",
    "Product Manager", "Operations Manager",
]


class MonsterScraper(BaseJobScraper):
    platform = "monster"

    def scrape_live(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> list[dict]:
        def scrape_one(keyword):
            if lb.should_stop("live"):
                return []
            client = ApifyClient(os.environ["APIFY_TOKEN"])
            try:
                lb.log("monster", f"Scraping: {keyword} (limit: {max_items})")
                from urllib.parse import quote_plus
                search_url = f"https://www.monster.com/jobs/search?q={quote_plus(keyword)}&where=United+States"
                run = client.actor(ACTOR_ID).call(run_input={
                    "startUrls": [{"url": search_url}],
                    "maxItems": max_items,
                })
                items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
                lb.log("monster", f"  → {len(items)} results for '{keyword}'")
                return items
            except Exception as e:
                lb.log("monster", f"Error scraping '{keyword}': {e}", "error")
                return []

        return self._run_keywords_parallel(keywords, scrape_one)

    def _normalize(self, raw: dict) -> Optional[dict]:
        posting = raw.get("jobPosting") or {}

        job_title = (
            posting.get("title") or
            raw.get("title") or raw.get("jobTitle") or ""
        ).strip()

        org = posting.get("hiringOrganization") or {}
        company = (
            (org.get("name") if isinstance(org, dict) else "") or
            raw.get("company") or raw.get("companyName") or ""
        ).strip()

        if not job_title or not company:
            return None

        external_id = str(raw.get("jobId") or raw.get("id") or "")
        if external_id:
            job_id = f"monster:{external_id}"
        else:
            job_id = f"monster:{hashlib.md5(f'{company}|{job_title}'.encode()).hexdigest()[:16]}"

        # Use the direct Monster.com listing URL from enrichments (not the ATS apply URL)
        enrichments = raw.get("enrichments") or {}
        monster_urls = enrichments.get("localizedMonsterUrls") or []
        if monster_urls and isinstance(monster_urls, list):
            job_url = (monster_urls[0].get("url") or "") if isinstance(monster_urls[0], dict) else ""
        else:
            job_url = ""

        # Location from enrichments (more reliable than jobPosting.jobLocation)
        norm_locations = enrichments.get("normalizedJobLocations") or []
        location = ""
        if norm_locations and isinstance(norm_locations[0], dict):
            addr = (norm_locations[0].get("postalAddress") or {}).get("address") or {}
            city = addr.get("addressLocality") or ""
            state = addr.get("addressRegion") or ""
            location = f"{city}, {state}".strip(", ")
        if not location:
            loc_info = posting.get("jobLocation") or {}
            if isinstance(loc_info, dict):
                addr = loc_info.get("address") or {}
                if isinstance(addr, dict):
                    location = (addr.get("addressLocality") or addr.get("addressRegion") or "").strip()

        desc = posting.get("description") or ""
        if isinstance(desc, dict):
            desc = desc.get("text") or desc.get("html") or ""
        # Strip HTML tags from description
        desc = _HTML_TAG_RE.sub(" ", str(desc))
        desc = re.sub(r"\s+", " ", desc).strip()

        return {
            "job_id": job_id,
            "company_name": company,
            "company_domain": None,
            "job_title_raw": job_title,
            "platform": "monster",
            "location": location,
            "job_url": job_url,
            "description_snippet": desc[:500],
            "posted_date": self._safe_date(
                raw.get("dateRecency") or
                posting.get("datePosted") or
                raw.get("formattedDate")
            ),
            "raw_data": {k: v for k, v in raw.items() if k != "jobPosting"},
        }
