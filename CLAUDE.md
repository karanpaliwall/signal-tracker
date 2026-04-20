# CLAUDE.md — Hiring Signal Tracker (Single Source of Truth)

## What This Is

A multi-platform hiring signal tracker that monitors 6 job boards to detect buying signals from companies actively hiring. Claude Haiku classifies every role into a department + intent signal (e.g., "Needs outbound pipeline"). Companies are scored by signal strength and surfaced in a Growleads-branded dashboard.

**Phase 1 scope**: Signal detection and display only. No outreach.

---

## Quick Start (Local Development)

### Prerequisites
- Python 3.11
- Node.js 18+
- A `.env` file (copy `.env.example` and fill in your keys)

### Backend
```python
# Run from project root — DO NOT use --reload (breaks on Windows, throws WinError 10035)
import subprocess, sys
proc = subprocess.Popen(
    [sys.executable, '-m', 'uvicorn', 'backend.main:app', '--port', '8002'],
    stdout=open('backend_8002.log', 'w'), stderr=subprocess.STDOUT,
    cwd='C:/Code Shit/Signal Tracker',
    creationflags=0x00000008,  # DETACHED_PROCESS
)
# → http://localhost:8002
```

Or from a shell (if no spaces issue):
```bash
python -m uvicorn backend.main:app --port 8002
```

**Ports 8000 and 8001 are orphaned on this machine — always use 8002.**

### Frontend
```bash
cd "C:\Code Shit\Signal Tracker\frontend"
npm install
node ./node_modules/next/dist/bin/next dev
# → http://localhost:3000
# NOTE: Use the node command above, NOT "npm run dev"
# npm fails when the path contains spaces (C:\Code Shit\...)
```

### Kill existing backend process (bash)
```bash
netstat -ano | grep ":8002" | grep LISTENING   # find PID
taskkill //F //PID <PID>                        # double-slash required in bash
```

### Database Setup
1. Open the Neon SQL editor for your project
2. Paste the contents of `schema.sql` and run it
3. Verify: `SELECT table_name FROM information_schema.tables WHERE table_schema='public';`
   Should show: `job_signals`, `company_signals`, `signal_scraper_runs`, `app_config`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon Postgres connection string with `?sslmode=require` |
| `ANTHROPIC_API_KEY` | Yes | Claude Haiku for role classification + intent extraction |
| `APIFY_TOKEN` | Yes | Apify for job scraping (Indeed, Glassdoor, Monster, Naukri) |
| `RESEND_API_KEY` | Yes | Resend for email notifications with CSV attachment — set in `.env` (rotate before production deploy) |
| `RESEND_FROM` | No | Sender address (default: `signals@resend.dev`) |
| `API_KEY` | No | Leave empty in dev for open access. Set in Railway for production. |

**Rotate before use**: Generate fresh keys before deploying to production.

---

## Architecture

```
Job Boards ──► Scrapers ──► Normalization ──► Dedup ──► Claude Haiku ──► Scoring ──► DB
(5 platforms)   (Apify +                                 (classify)       (aggregate)
                 free APIs)
```

- **Backend**: Python 3.11 + FastAPI + APScheduler + slowapi on Railway
- **Frontend**: Next.js 14 + React 18 on Vercel
- **Database**: Neon Postgres (4 tables)
- **Scheduler**: APScheduler — state in Postgres `app_config` (not JSON files)
- **AI**: Claude Haiku (`claude-haiku-4-5-20251001`) — thread-local clients (Windows-safe)
- **Email**: Resend SDK — CSV attachment to configurable recipients

---

## Scraper Implementations

| Platform | Actor / Method | Input Fields | Output Fields | Cost | Status |
|----------|---------------|-------------|--------------|------|--------|
| LinkedIn | Guest API (free, no Apify) | URL params | `title`, `company`, `url`, `jobId`, `postedAt` | FREE | ✅ |
| Indeed | `misceres/indeed-scraper` via `startUrls` | `startUrls`, `maxItems` | `positionName`, `company`, `url`, `id`, `postedAt`, `externalApplyLink` | ~$0.10/run | ✅ |
| Glassdoor | `automation-lab/glassdoor-jobs-scraper` | `query`, `location`, `maxItems` | `title`, `company`, `jobUrl`, `postedDate`, `description` | ~$3/1K | ✅ |
| Monster | `memo23/monster-scraper` via `startUrls` | `startUrls`, `maxItems` | nested: `jobPosting.title`, `jobPosting.hiringOrganization.name`, `enrichments.localizedMonsterUrls[0].url`, `dateRecency` | ~$0.99/1K | ✅ |
| Naukri | `muhammetakkurtt/naukri-job-scraper` | `keyword`, `maxJobs` (min 50), `fetchDetails` | `title`, `companyName`, `jdURL`, `jobId`, `location`, `createdDate` | pay-per-event | ✅ Confirmed (2026-04-17) |

### Scraper-specific notes

**LinkedIn**: Free guest API — `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` — parses HTML job cards via regex. No Apify needed.

**Indeed**: Must use `startUrls` format — construct `https://www.indeed.com/jobs?q={keyword}&l=United+States&sort=date` and pass as `startUrls: [{url: ...}]`. Using `keyword` field directly returns `{"error": "Scraper didn't find any jobs"}`.

**Glassdoor**: Uses `query` field (NOT `keyword` — returns "Field input.query is required" error). Actor ignores `maxItems`/`limit`/`maxResults` — returns 60-130 results per keyword regardless. Always slice client-side: `items = items[:max_items]` after `iterate_items()`.

**Monster**: Uses `startUrls` with `https://www.monster.com/jobs/search?q={keyword}&where=United+States`. Job data nested in `jobPosting` dict. **Job URL** comes from `enrichments.localizedMonsterUrls[0].url` (direct monster.com link) — do NOT use `apply.applyUrl` (points to third-party ATS/CareerBuilder). **Description** is raw HTML — strip with `re.sub(r'<[^>]+>', ' ', desc)` before saving.

**ZipRecruiter**: REMOVED. Actor `orgupdate/ziprecruiter-jobs-scraper` returns Google Jobs search URLs (not direct ZipRecruiter links) — unusable. Removed from all backend, frontend, and DB on 2026-04-18.

**Naukri**: Old actor `epicscrapers/naukri-scraper` returned 0 results. New actor `muhammetakkurtt/naukri-job-scraper` (952 MAU, 4.0/5). Enforces 50-result minimum — use `max(max_items, 50)` for `maxJobs`. India-specific keywords: "Business Development Executive", "Inside Sales Executive".

---

## API Endpoints

### Scraping
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scrape/run` | Trigger scrape. `?mode=live\|weekly\|full` (full = live then weekly back-to-back) |
| POST | `/api/scrape/stop` | Set stop flags to cancel in-progress run |
| GET | `/api/scrape/status` | `{live_running, weekly_running, intelligence_running}` |
| GET | `/api/scrape/log?since=N` | Real-time log polling (cursor pattern) |
| GET | `/api/scrape/runs?limit=20` | Run history from `signal_scraper_runs` |

### Signals
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/signals` | Paginated job signals. Filters: `platform`, `department`, `priority`, `data_mode`, `search`, `page`, `page_size` |
| GET | `/api/signals/stats` | `{total, high_priority, new_today, companies_tracked}` |
| GET | `/api/signals/export` | CSV download (streaming, Content-Disposition: attachment) |
| DELETE | `/api/signals` | Delete by `ids` array |

### Companies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/companies` | Paginated company signals. Filters: `priority`, `sort_by` |
| GET | `/api/companies/{name}` | Single company with all open roles |

### Intelligence
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/intelligence/run` | Trigger classification on pending records |
| GET | `/api/intelligence/status` | Progress: `{pending, processed, failed}` |

### Config
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sources` | Platform configs + keyword lists |
| POST | `/api/sources` | Save platform configs + keywords |
| GET | `/api/scheduler` | Scheduler state |
| POST | `/api/scheduler` | Update scheduler (enable/disable, frequency) |

### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notify/config` | `{enabled, recipients}` |
| POST | `/api/notify/config` | Save notification settings |
| POST | `/api/notify/send` | Manually trigger email with CSV |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{"status": "ok"}` |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `job_signals` | Every normalized job listing. Dedup key: `job_id` (platform:external_id). |
| `company_signals` | Aggregated per-company signal. Upserted after each scoring run. |
| `signal_scraper_runs` | Audit log — one row per platform × mode run, plus one row per intelligence run (`platform='intelligence'`, `mode='intelligence'`). |
| `app_config` | Key/value: scheduler state, keywords, notify config. Postgres-based (Railway-safe). |

---

## Key Implementation Rules (Critical)

1. **Scheduler state → Postgres** — `app_config` table, not JSON files. Railway containers are ephemeral.
2. **Job guard lock** — acquire `threading.Lock()`, check flag, set flag, THEN queue task. Never set flag inside the task.
3. **Thread-local Anthropic clients** — never share `httpx.Client` across threads. Causes WinError 10035 on Windows.
4. **RateLimitError backoff** — catch `anthropic.RateLimitError` specifically. Use `2**attempt + random` jitter.
5. **Strip markdown fences** — `re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()` before `json.loads()`.
6. **Batch INSERT in chunks of 50** — `execute_values()` with `ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING`. Split into 50-row chunks with 3-retry on `psycopg2.OperationalError` to avoid Neon SSL connection drops on large batches.
7. **processing_attempts cap** — filter `WHERE processing_attempts < 5` in intelligence queries.
8. **Log separator** — `lb.log("pipeline", "=== Run started ===")` not `lb.clear()`.
9. **No second Claude call** — scoring is deterministic rule-based only.
10. **Windows dev server** — `node ./node_modules/next/dist/bin/next dev` (not npm). Never use `--reload` with uvicorn on Windows.
11. **Clear BOTH stop flags on trigger** — `trigger_run()` must call `lb.clear_stop("live")` AND `lb.clear_stop("weekly")` for any mode. `stop_run()` sets both flags; if only one is cleared, scrapers check `should_stop("weekly")` and silently return [] — entire run completes in 5 seconds with 0 records, no error.
12. **ON CONFLICT needs partial index predicate** — `ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING` (not just `ON CONFLICT (job_id)`).
13. **scoring.py upsert tuple must have 8 values** — the `company_signals` INSERT targets 8 columns including `last_updated_at`. Add `datetime.now(timezone.utc)` as the 8th element.
14. **`load_dotenv()` must use absolute path** — `load_dotenv(Path(__file__).parent.parent / ".env")` in both `main.py` and `database.py`.
15. **`results_per_keyword` minimum is `ge=1`** — validation in `backend/models.py`. Was `ge=10`, changed to allow testing with small values.
16. **Intelligence runs once per phase** — `_run_full_pipeline()` calls `_run_pipeline("live")` then `_run_pipeline("weekly")`. Each phase has its own scrape → dedup → intelligence → scoring cycle. Records added by the weekly scrape are classified by the weekly phase's intelligence run. If weekly intelligence fails, those records stay unclassified until the next run. Manually trigger `POST /api/intelligence/run` to classify any leftovers.
17. **LinkedIn live = 24h window, weekly = 7-day window** — uses `tpr=r86400` for live, `tpr=r604800` for weekly. Live mode legitimately returns fewer results than weekly because it only fetches jobs posted in the last 24 hours. This is expected behaviour, not a bug. Live log lines from LinkedIn may scroll off the LiveLog viewport during a full run since the live phase runs 6 scrapers and generates many log lines before weekly starts.
18. **Intelligence runs must log to `signal_scraper_runs`** — both `_run_pipeline()` (step 3) and `trigger_intelligence_only()._run()` must call `_create_run_record("intelligence", "intelligence")` before running and `_finish_run_record(...)` after. Column mapping: `jobs_found=pending` (total to classify), `jobs_added=processed` (classified OK), `duplicates=failed` (errored records). The Run Log "Intelligence" tab filters on `mode === 'intelligence'`. Without this, the tab shows "No intelligence runs yet" even after successful runs.

---

## Frontend Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `pages/index.js` | Dashboard — stats cards, pipeline status, 10 most recent signals (any priority), Run Live + Run Weekly buttons, auto-refreshes every 30s |
| `/signals` | `pages/signals.js` | Paginated job signals feed with filters (platform, dept, priority, search) |
| `/companies` | `pages/companies.js` | Company cards grid — clickable, navigates to drill-down |
| `/company/[name]` | `pages/company/[name].js` | Company drill-down — score, role count, dept breakdown, full roles table with job URLs |
| `/sources` | `pages/sources.js` | Sources & Config — toggle platforms, keywords, scheduler, notifications |
| `/run-log` | `pages/run-log.js` | Run history from `signal_scraper_runs` table |

### UI Rules
- **Two Run buttons** — `Run Live` (btn-secondary, `mode=live`) and `Run Weekly` (btn-primary, `mode=weekly`). Both collapse to a single `Stop` button while any run is active. No "Run Full" combined button.
- **Dashboard recent signals** — shows 10 most recent signals of any priority (`/api/signals?page_size=10`). NOT filtered to high-priority only.
- **Dashboard auto-refresh** — `index.js` polls `loadData()` every 30 seconds (idle interval) AND immediately when `isRunning` transitions from `true→false` (run just completed). Uses `useRef(wasRunning)` to detect the transition.
- **LiveLog** — fixed-bottom global panel in `Layout.js`, starts collapsed. Never add to individual pages.
- **Company cards** — clickable via `router.push('/company/' + encodeURIComponent(name))`.
- **Pipeline status** — shared via React Context in `_app.js`, one poll per app. Never poll in multiple components.
- **Sources & Config defaults** — when API returns empty keyword arrays (fresh DB), keep `DEFAULT_CONFIG` values. Merge API data but only override keyword arrays when `data[key].length > 0`.

### Responsive Design Patterns
- **Tables** — all tables sit inside `.table-wrap` (has `overflow-x: auto`). Company detail roles table additionally has an inner `<div style={{ overflowX: 'auto' }}>` wrapper since its parent card has `overflow: hidden`.
- **Roles table hover** — uses CSS class `.roles-table` (defined in `custom.css`). Do NOT use inline `onMouseEnter`/`onMouseLeave` — causes re-renders on every hover event.
- **Role title links** — use CSS class `.role-link` (defined in `custom.css`). Do NOT use inline hover handlers.
- **Keyword grid** (Sources page) — use CSS class `keyword-grid` (`grid-template-columns: 1fr 1fr`). Collapses to single column on mobile via `custom.css` media query.
- **Company cards grid** — `minmax(min(360px, 100%), 1fr)` so cards go full-width on phones.
- **Search debounce** — `signals.js` uses `searchInput` state + `searchTimer` ref (300ms). The raw input value is `searchInput`; the debounced filter value is `filters.search`. `clearFilters()` resets both.
- **LiveLog fetch** — uses `AbortController` with 3s timeout to cancel hung requests.
- **Mobile breakpoint** at 768px: filter bar stacks vertically, keyword grid goes 1 column, content bottom-padding is 160px (room for LiveLog bar).

---

## Deployment

### Railway (Backend)
1. Create new Railway project
2. Connect this repo
3. Set all environment variables in Railway dashboard
4. Deploy — `render.yaml` configures the web service

### Vercel (Frontend)
1. Import the `frontend/` directory to Vercel
2. Set `RAILWAY_BACKEND_URL` env var in Vercel dashboard (frontend rewrites via `next.config.js`)
3. Deploy

### Neon (Database)
1. Create a new Neon project
2. Run `schema.sql` in the Neon SQL editor
3. Copy the connection string (pooled) to `DATABASE_URL`

### Pre-deploy checklist
- Rotate Apify token (current token in `.env` is for dev)
- Rotate `RESEND_API_KEY` (dev key is in `.env`, generate a new one for prod)
- Set `API_KEY` in Railway for endpoint security
- Set `ALLOWED_ORIGINS` in Railway (e.g. `https://your-app.vercel.app`)

---

## Sister Project

`C:\Code Shit\Funding Announcement - Signal & Intent Automation\`

Reuse patterns from:
- `backend/database.py` — copied verbatim (Neon pool, keepalives, ping-on-reuse)
- `backend/log_buffer.py` — copied verbatim (deque, cursor polling, stop flags)
- `backend/verifier.py` — thread-local client pattern adapted for `intelligence.py`
- `frontend/components/Layout.js` — nav structure adapted (updated icons + routes)
- `frontend/components/LiveLog.js` — copied, API path updated to `/api/scrape/log`
- `frontend/components/Toast.js` — copied verbatim

**Design system differs** from sister project:
- Font: **Inter** (not Roboto)
- Brand blue: **#2563eb** (not #0A66C2)
- Page header: gradient background
- Tabs: segmented pill style (not underline)
- CSS classes: `sidebar-brand`, `sidebar-section-label`, `sidebar-item`, `stat-grid`, `tabs-pill`, `tab-pill`, `form-select`, `form-input`, `page-header-top`, `page-body`
