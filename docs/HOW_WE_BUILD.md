# How We Build It — Hiring Signal Tracker

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Vercel)                    │
│         Next.js 14 + React 18 + Growleads CSS           │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTP (proxied via vercel.json)
┌─────────────────────▼───────────────────────────────────┐
│                    Backend (Railway)                     │
│           FastAPI + APScheduler + Python 3.11            │
│                                                         │
│  pipeline.py ──► scrapers/ ──► intelligence.py          │
│       │               │              │                  │
│       │           Apify Actors    Claude Haiku           │
│       ▼                                                  │
│   scoring.py ──► database.py ──► Neon Postgres          │
└─────────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. Postgres for Scheduler State (not JSON files)
Railway containers are ephemeral — any file written inside the container is lost on redeploy. The `app_config` table stores scheduler state, keyword lists, and notification config. On startup, the lifespan handler seeds defaults with `ON CONFLICT DO NOTHING`.

### 2. Thread-Local Anthropic Clients
`httpx.Client` is not thread-safe on Windows. Sharing one client across `ThreadPoolExecutor` workers causes `WinError 10035 (WSAEWOULDBLOCK)`. Each worker thread creates its own client via `threading.local()`, and on retry (after any exception) `force_new=True` discards the old client.

### 3. Batch INSERT with ON CONFLICT DO NOTHING
Every scraper run returns hundreds of records. Using SELECT + INSERT per record creates N+1 database round-trips (200 queries for 100 records = 4-10 seconds on cloud Postgres). Instead, `execute_values()` sends the entire batch in one query:
```sql
INSERT INTO job_signals (...) VALUES %s ON CONFLICT (job_id) DO NOTHING
```

### 4. Deterministic Scoring (No Second Claude Call)
Verification via a second Claude call is a self-verification loop — same model + same context = closed-loop hallucination amplifier. Priority scoring is 100% deterministic rule-based logic in `scoring.py`. Rules are auditable, reproducible, and free.

### 5. Processing Attempts Cap
Records that fail classification (malformed data, empty titles) should not retry forever. Every intelligence attempt increments `processing_attempts`. The query filter `WHERE processing_attempts < 5` ensures permanently-bad records are skipped after 5 failures.

### 6. Job Guard Lock (TOCTOU-Safe)
Two concurrent POST /api/scrape/run requests would both see `live_running = False` and both fire Apify actors (expensive). The guard acquires a `threading.Lock()`, checks the flag, sets it, THEN queues the background task. The flag is never set inside the background task itself.

## Data Flow

```
1. APScheduler fires (or manual POST /api/scrape/run)
2. pipeline.py acquires threading.Lock → sets live_running = True
3. For each platform (linkedin, indeed):
   a. Scraper calls Apify actor with keyword list from app_config
   b. Apify runs actor, returns dataset
   c. _normalize() maps platform fields to unified schema
   d. save_records() batch-inserts with ON CONFLICT DO NOTHING
   e. Inserts run record into signal_scraper_runs
4. intelligence.py processes unclassified records (processing_attempts < 5):
   a. ThreadPoolExecutor(max_workers=4)
   b. Each worker: thread-local Anthropic client → Haiku call → parse JSON
   c. Strip markdown fences → json.loads() → UPDATE job_signals
5. scoring.py rebuilds company_signals:
   a. GROUP BY company_name
   b. Apply scoring rules → priority + signal_strength_score
   c. UPSERT into company_signals ON CONFLICT (company_name) DO UPDATE
6. If notify_config.enabled: notifier.py sends Resend email with CSV
7. live_running = False
```

## Apify Actor Configuration

### LinkedIn: `bebity/linkedin-jobs-scraper`
- **Rating**: 4.3/5, 29K users
- **Cookies required**: None
- **Cost**: ~$0.50/1K results

```python
run_input = {
    "title": keyword,           # search term
    "location": "United States",
    "rows": 1000,               # max results per keyword
    "publishedAt": "r86400",    # last 24h (present mode)
    # "publishedAt": "r604800", # last 7 days (weekly mode)
    "contractType": "F",        # full-time only
}
```

**Field mapping:**
| Unified | LinkedIn |
|---------|---------|
| company_name | companyName |
| job_title_raw | title |
| location | location |
| job_url | jobUrl |
| description_snippet | description[:500] |
| posted_date | publishedAt |

### Indeed: `misceres/indeed-scraper`
- **Rating**: 4.0/5, 20K users
- **Cookies required**: None
- **Cost**: $3.00/1K results

```python
run_input = {
    "position": keyword,
    "country": "US",
    "location": "United States",
    "maxItems": 1000,
}
```

**Field mapping:**
| Unified | Indeed |
|---------|--------|
| company_name | company |
| job_title_raw | jobTitle |
| location | location |
| job_url | url |
| description_snippet | description[:500] |
| posted_date | postedAt |

## Claude Haiku Classification

### Model
`claude-haiku-4-5-20251001` — fastest and cheapest Claude model, sufficient for single-field classification.

### System Prompt Design
Single combined call — never call twice for the same record (self-verification anti-pattern):

```python
SYSTEM_PROMPT = """You are a job signal classifier for B2B sales intelligence.
Given a job title and optional description snippet, classify it and extract buying intent.

Respond ONLY with valid JSON:
{
  "department": "<Sales|Engineering|Marketing|Operations|Product|Finance|Other>",
  "seniority": "<junior|mid|senior|director|c-suite>",
  "intent_signal": "<concise buying signal, max 6 words>",
  "confidence": <0.0-1.0>
}
No other text."""
```

### Fence Stripping
Claude Haiku wraps JSON in markdown fences even when instructed not to. Always strip before `json.loads()`:
```python
text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()
```

### Rate Limit Backoff
Catch `anthropic.RateLimitError` separately — treating 429 as a generic error causes silent discard:
```python
except anthropic.RateLimitError:
    time.sleep((2 ** attempt) + random.uniform(0, 1))
```

### Cost Estimate
At $0.25/1M input tokens + $1.25/1M output tokens:
- ~150 input tokens per job (title + snippet)
- ~50 output tokens per job
- 1,000 jobs ≈ $0.10 total
- Daily run of 5,000 jobs ≈ $0.50/day

## Deduplication

Two-pass dedup in `dedup.py`:

1. **Exact match on job_id** — `platform:external_id` — handled by `UNIQUE INDEX` + `ON CONFLICT DO NOTHING` in the DB
2. **Fuzzy match on company+title** — `rapidfuzz.fuzz.token_sort_ratio >= 85` — catches reposts with slightly different titles

Records marked `is_duplicate = True` are kept in the DB but excluded from scoring and display queries.

## Scoring Algorithm

All rules in `scoring.py` — no AI involved:

```python
def compute_priority(company_jobs: list[dict]) -> tuple[str, float]:
    score = 0.0
    score += sum(50 for j in company_jobs if j["seniority"] == "c-suite")
    score += sum(20 for j in company_jobs if j["seniority"] == "director")
    
    dept_counts = Counter(j["department"] for j in company_jobs)
    for dept, count in dept_counts.items():
        if count >= 3: score += 30
        elif count == 2: score += 10
    
    if sum(1 for j in company_jobs if j["department"] == "Sales") >= 2:
        score += 20
    
    if any(j.get("posted_date") == date.today() for j in company_jobs):
        score += 15
    
    avg_conf = mean(j.get("confidence", 0.5) for j in company_jobs)
    score *= avg_conf
    
    priority = "high" if score >= 60 else "medium" if score >= 25 else "low"
    return priority, round(score, 2)
```

## Database Schema Rationale

- **UUID primary keys** — globally unique across platforms, safe for future federation
- **UNIQUE INDEX on job_id** — partial index (WHERE job_id IS NOT NULL) keeps it sparse
- **posted_date DESC index** — filtered to `is_duplicate = FALSE` for query performance
- **JSONB raw_data** — stores full Apify response for debugging without additional tables
- **processing_attempts** — integer counter with `< 5` guard prevents poisoned records from looping
- **app_config key/value** — generic, survives container restarts, readable from any endpoint

## API Design

All endpoints under `/api/` prefix. CORS `allow_origins=["*"]` (restrict in production if needed).

Authentication: `X-API-Key` header. Empty `API_KEY` env var = open (dev). Set in Railway for production.

Log streaming uses a cursor pattern (not SSE/WebSockets) to keep it simple and proxy-compatible:
```
GET /api/scrape/log?since=42
→ {"lines": [...new lines since index 42...], "total": 47}
```

Frontend polls every 800ms. The `total` value becomes the next `since` cursor.

## Frontend Design System

**Official Growleads files** (from `frontend/styles/`):
- `tokens.css` — CSS custom properties: colors, spacing, radius, shadows
- `reference.css` — Complete component styles: sidebar, cards, tables, badges, buttons, toasts

**Key design tokens:**
```css
--bg-primary: #0c0e1a;     /* page background */
--bg-secondary: #111426;   /* sidebar, cards */
--bg-card: #161929;        /* elevated cards */
--blue-600: #2563eb;       /* primary actions — differs from sister project */
--text-primary: #e2e4f0;
--text-muted: #5c6080;
```

**Font**: Inter (Google Fonts) — NOT Roboto (sister project uses Roboto, this project uses Inter per official spec)

**Page header**: `linear-gradient(180deg, #161929 0%, #111426 100%)`

**Filter bar**: `linear-gradient(180deg, #111426 0%, #0c0e1a 100%)`

**Tabs**: segmented pill style (not underline tabs)

**Priority badge colors:**
- High: `rgba(239,68,68,0.12)` bg / `#f87171` text
- Medium: `rgba(245,158,11,0.12)` bg / `#fbbf24` text
- Low: `rgba(92,96,128,0.15)` bg / `#a1a1aa` text

## Windows Development Notes

- Dev server: `node ./node_modules/next/dist/bin/next dev` (NOT `npm run dev` — npm fails when path contains spaces)
- Backend: `python -m uvicorn backend.main:app --reload`
- Thread-local Anthropic clients required (WinError 10035 on shared httpx.Client)

## Deployment

| Component | Platform | Config |
|-----------|---------|--------|
| Backend | Railway | render.yaml → web service |
| Frontend | Vercel | vercel.json → rewrites /api/* to Railway URL |
| Database | Neon | Run schema.sql once in Neon SQL editor |

**Environment variables** — set in Railway dashboard:
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `APIFY_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `API_KEY`

**Vercel** — set `NEXT_PUBLIC_API_URL` if calling backend directly (not needed if using rewrites).

## File Structure

```
Signal Tracker/
├── backend/
│   ├── main.py              # FastAPI app + all endpoints
│   ├── database.py          # Neon connection pool (copied from sister project)
│   ├── log_buffer.py        # Real-time log streaming (copied from sister project)
│   ├── scheduler.py         # APScheduler (Postgres state — not JSON files)
│   ├── pipeline.py          # Sequential runner with threading lock
│   ├── intelligence.py      # Claude Haiku classification + intent extraction
│   ├── scoring.py           # Deterministic priority scoring
│   ├── dedup.py             # rapidfuzz deduplication
│   ├── notifier.py          # Resend email with CSV attachment
│   ├── models.py            # Pydantic request/response models
│   └── scrapers/
│       ├── base.py          # BaseJobScraper abstract class
│       ├── linkedin.py      # bebity/linkedin-jobs-scraper (4.3★, no cookies)
│       └── indeed.py        # misceres/indeed-scraper (4.0★, no cookies)
├── frontend/
│   ├── pages/
│   │   ├── _app.js          # Layout wrapper + Inter font
│   │   ├── index.js         # Dashboard
│   │   ├── signals.js       # Signals Feed (filterable table)
│   │   ├── companies.js     # Company aggregates
│   │   ├── sources.js       # Sources & Config + Notifications
│   │   └── run-log.js       # Run history
│   ├── components/
│   │   ├── Layout.js        # Sidebar nav (Growleads SVG logo)
│   │   ├── LiveLog.js       # Real-time pipeline log
│   │   ├── Toast.js         # Bottom-right toast notifications
│   │   ├── PriorityBadge.js # High/Medium/Low badge
│   │   └── DeptBar.js       # Horizontal department breakdown bar
│   ├── styles/
│   │   ├── tokens.css       # Official Growleads design tokens
│   │   └── reference.css    # Official Growleads component styles
│   └── package.json
├── docs/
│   ├── WHAT_WE_BUILD.md
│   └── HOW_WE_BUILD.md
├── CLAUDE.md
├── schema.sql
├── requirements.txt
├── .env.example
├── .gitignore
├── render.yaml
├── vercel.json
└── runtime.txt
```
