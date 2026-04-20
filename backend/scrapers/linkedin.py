"""
LinkedIn scraper — uses LinkedIn's public guest jobs API.
Free, no Apify credits, no login required.
"""
import hashlib
import re
import time
from typing import Optional
from urllib.parse import quote_plus

import httpx
from backend.scrapers.base import BaseJobScraper
import backend.log_buffer as lb

DEFAULT_KEYWORDS = [
    "Sales Development Representative", "Account Executive", "VP of Sales",
    "Revenue Operations Manager", "Growth Marketing Manager",
    "Software Engineer", "Data Engineer", "Product Manager",
]

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# LinkedIn guest jobs API — public, no auth required
_GUEST_API = (
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    "?keywords={keywords}&location=United+States&sortBy=DD&f_TPR={tpr}&start={start}&count={count}"
)


class LinkedInScraper(BaseJobScraper):
    platform = "linkedin"

    def scrape_live(self, keywords: list[str], mode: str = "live", max_items: int = 50) -> list[dict]:
        # r86400 = last 24h, r604800 = last 7 days
        tpr = "r86400" if mode == "live" else "r604800"

        def scrape_one(keyword):
            if lb.should_stop("live") or lb.should_stop("weekly"):
                return []
            try:
                lb.log("linkedin", f"Scraping: {keyword} (limit: {max_items})")
                items = []
                start = 0
                batch = min(max_items, 25)

                while len(items) < max_items:
                    if lb.should_stop("live") or lb.should_stop("weekly"):
                        break
                    url = _GUEST_API.format(
                        keywords=quote_plus(keyword),
                        tpr=tpr,
                        start=start,
                        count=batch,
                    )
                    resp = httpx.get(url, headers=_HEADERS, timeout=30, follow_redirects=True)
                    if resp.status_code == 429:
                        lb.log("linkedin", "Rate limited, waiting 5s...", "warning")
                        time.sleep(5)
                        continue
                    resp.raise_for_status()

                    page_items = self._parse_html(resp.text)
                    if not page_items:
                        break

                    items.extend(page_items)
                    start += len(page_items)

                    if len(items) < max_items:
                        time.sleep(1)  # polite delay between pages

                lb.log("linkedin", f"  → {len(items)} results for '{keyword}'")
                return items[:max_items]
            except Exception as e:
                lb.log("linkedin", f"Error scraping '{keyword}': {e}", "error")
                return []

        return self._run_keywords_parallel(keywords, scrape_one)

    def _parse_html(self, html: str) -> list[dict]:
        """Extract job cards from LinkedIn guest API HTML response."""
        items = []

        # Extract job IDs from data-entity-urn
        ids = re.findall(r'data-entity-urn="urn:li:jobPosting:(\d+)"', html)

        # Extract titles
        titles = re.findall(
            r'class="base-search-card__title"[^>]*>\s*([^<]+?)\s*</h3>',
            html,
        )

        # Extract company names (inside subtitle anchor)
        companies = re.findall(
            r'class="base-search-card__subtitle"[^>]*>.*?<a[^>]*>\s*([^<]+?)\s*</a>',
            html,
            re.DOTALL,
        )

        # Extract locations
        locations = re.findall(
            r'class="job-search-card__location"[^>]*>\s*([^<]+?)\s*</span>',
            html,
        )

        # Extract job URLs
        urls = re.findall(
            r'<a[^>]+href="(https://www\.linkedin\.com/jobs/view/[^"?]+)[^"]*"',
            html,
        )

        # Extract posted dates (datetime attribute)
        dates = re.findall(
            r'<time[^>]+datetime="([^"]+)"',
            html,
        )

        count = max(len(ids), len(titles))
        for i in range(count):
            items.append({
                "jobId": ids[i] if i < len(ids) else "",
                "title": titles[i] if i < len(titles) else "",
                "company": companies[i] if i < len(companies) else "",
                "location": locations[i] if i < len(locations) else "",
                "url": urls[i] if i < len(urls) else "",
                "postedAt": dates[i] if i < len(dates) else "",
            })

        return [it for it in items if it.get("title") and it.get("company")]

    def _normalize(self, raw: dict) -> Optional[dict]:
        job_title = raw.get("title", "").strip()
        company = raw.get("company", "").strip()
        if not job_title or not company:
            return None

        external_id = raw.get("jobId", "")
        if external_id:
            job_id = f"linkedin:{external_id}"
        else:
            raw_key = f"{company}|{job_title}|{raw.get('url', '')}"
            job_id = f"linkedin:{hashlib.md5(raw_key.encode()).hexdigest()[:16]}"

        return {
            "job_id": job_id,
            "company_name": company,
            "company_domain": None,
            "job_title_raw": job_title,
            "platform": "linkedin",
            "location": raw.get("location", "").strip(),
            "job_url": raw.get("url", ""),
            "description_snippet": "",
            "posted_date": self._safe_date(raw.get("postedAt")),
            "raw_data": raw,
        }
