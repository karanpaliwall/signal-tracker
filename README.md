# Hiring Signal Tracker

A multi-platform hiring signal tracker that monitors 5 job boards to detect buying signals from companies actively hiring. Every job listing is classified by department and intent using Claude Haiku (e.g. *"Needs outbound pipeline"*), companies are scored by signal strength, and results are surfaced in a branded dashboard.

**Phase 1 scope:** Signal detection and display only. No outreach.

---

## How It Works

```
Job Boards → Scrapers → Normalize → Dedup → Claude Haiku → Scoring → Neon DB → Dashboard
```

1. **Scrape** — 5 job boards scraped on demand or on a daily schedule
2. **Classify** — Claude Haiku assigns each role a department + intent signal
3. **Score** — Companies scored by volume, recency, and signal type; priority propagated to all job signals
4. **Display** — Dashboard shows ranked companies and individual job signals

---

## Supported Job Boards

| Platform | Method | Region | Cost |
|----------|--------|--------|------|
| LinkedIn | Free guest API (no Apify) | US | Free |
| Indeed | Apify `misceres/indeed-scraper` | US | ~$0.10/run |
| Glassdoor | Apify `automation-lab/glassdoor-jobs-scraper` | US | ~$3/1K |
| Monster | Apify `memo23/monster-scraper` | US | ~$0.99/1K |
| Naukri | Apify `muhammetakkurtt/naukri-job-scraper` | IN | ~$1/1K |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, APScheduler, slowapi |
| Frontend | Next.js 14, React 18 |
| Database | Neon Postgres (serverless) |
| AI | Claude Haiku (`claude-haiku-4-5-20251001`) |
| Scraping | Apify + LinkedIn free guest API |
| Email | Resend SDK |
| Deploy | Railway (backend) + Vercel (frontend) |

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A [Neon](https://neon.tech) Postgres database
- An [Apify](https://apify.com) account (for Indeed, Glassdoor, Monster, Naukri)
- An [Anthropic](https://console.anthropic.com) API key
- A [Resend](https://resend.com) API key (for email notifications)

### 1. Clone the repo

```bash
git clone https://github.com/karanpaliwall/signal-tracker.git
cd signal-tracker
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Fill in your keys — see table below
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon Postgres connection string (`?sslmode=require`) |
| `ANTHROPIC_API_KEY` | Yes | Claude Haiku for role classification |
| `APIFY_TOKEN` | Yes | Apify for Indeed, Glassdoor, Monster, Naukri |
| `RESEND_API_KEY` | Yes | Email reports with CSV attachment |
| `RESEND_FROM` | No | Sender address (default: `signals@resend.dev`) |
| `API_KEY` | No | Leave empty in dev for open access. Set in Railway for production. |
| `NEXT_PUBLIC_API_KEY` | No | Frontend copy of `API_KEY` — set in Vercel dashboard for production. |
| `ALLOWED_ORIGINS` | No | CORS origin (e.g. `https://your-app.vercel.app`). Leave unset in dev. |

### 3. Set up the database

Open the [Neon SQL editor](https://console.neon.tech) for your project, paste the contents of `schema.sql`, and run it.

Verify:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- Should return: job_signals, company_signals, signal_scraper_runs, app_config
```

### 4. Run the backend

```bash
python -m uvicorn backend.main:app --port 8002
# → http://localhost:8002
```

> **Windows note:** Do not use `--reload`. Use port 8002 (8000/8001 may have orphaned processes).

### 5. Run the frontend

```bash
cd frontend
npm install
node ./node_modules/next/dist/bin/next dev
# → http://localhost:3000
```

> **Windows note:** Use the `node` command above, not `npm run dev` — npm fails when the path contains spaces.

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — stats, pipeline status, recent signals, Run button |
| `/signals` | Paginated job signals feed with filters (platform, dept, priority, search) |
| `/companies` | Company cards grid with search, sorted by signal strength |
| `/company/[name]` | Company drill-down — score, dept breakdown, all open roles |
| `/sources` | Sources & Config — platforms, keywords, scheduler, notifications |
| `/run-log` | Paginated run history — scraper runs and intelligence classification runs |

---

## API Reference

### Scraping

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/scrape/run?mode=live\|weekly` | Trigger a scrape run |
| `POST` | `/api/scrape/stop` | Cancel in-progress run (stops scrapers + classification) |
| `GET` | `/api/scrape/status` | `{live_running, weekly_running, intelligence_running}` |
| `GET` | `/api/scrape/log?since=N` | Real-time log polling (cursor pattern) |
| `GET` | `/api/scrape/runs?limit=50&offset=0` | Paginated run history — returns `{total, results}` |

### Signals

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/signals` | Paginated signals. Filters: `platform`, `department`, `priority`, `data_mode`, `search`, `sort_by`, `page`, `page_size` |
| `GET` | `/api/signals/{id}` | Single signal by UUID |
| `GET` | `/api/signals/stats` | `{total, high_priority, new_today, companies_tracked}` |
| `GET` | `/api/signals/export` | CSV download (streaming) |
| `DELETE` | `/api/signals` | Delete by `ids` array |

### Companies

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/companies` | Paginated companies. Filters: `priority`, `search`, `sort_by` |
| `GET` | `/api/companies/{name}` | Single company with all open roles |
| `DELETE` | `/api/companies/{name}` | Delete a company and its signals |

### Intelligence

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/intelligence/run` | Trigger classification on pending records |
| `GET` | `/api/intelligence/status` | `{pending, processed, failed}` |

### Config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sources` | Platform configs + keyword lists |
| `POST` | `/api/sources` | Save platform configs + keywords |
| `GET` | `/api/scheduler` | Scheduler state |
| `POST` | `/api/scheduler` | Update scheduler (enable/disable, time) |
| `GET` | `/api/notify/config` | `{enabled, recipients}` |
| `POST` | `/api/notify/config` | Save notification settings |
| `POST` | `/api/notify/send` | Manually send email report |
| `GET` | `/api/health` | `{"status": "ok"}` |

> All write endpoints are rate-limited to 20 requests/minute. In production, all endpoints require an `X-API-Key` header matching the `API_KEY` environment variable.

---

## Deployment

### Railway (Backend)
1. Create a new Railway project and connect this repo
2. Set all environment variables in the Railway dashboard
3. Deploy — `render.yaml` configures the web service

### Vercel (Frontend)
1. Import the `frontend/` directory to Vercel
2. Set `RAILWAY_BACKEND_URL` in Vercel dashboard (used by `next.config.js` rewrites)
3. Set `NEXT_PUBLIC_API_KEY` to match the `API_KEY` set in Railway
4. Deploy

### Pre-deploy checklist
- [ ] Rotate `APIFY_TOKEN`
- [ ] Rotate `RESEND_API_KEY`
- [ ] Set `API_KEY` in Railway for endpoint security
- [ ] Set `NEXT_PUBLIC_API_KEY` in Vercel (same value)
- [ ] Set `ALLOWED_ORIGINS` in Railway (e.g. `https://your-app.vercel.app`)
- [ ] Run `schema.sql` in Neon SQL editor

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `job_signals` | Every normalized job listing. Dedup key: `platform:external_id` |
| `company_signals` | Aggregated per-company signal scores, upserted after each run |
| `signal_scraper_runs` | Audit log — one row per platform × mode run, plus intelligence runs |
| `app_config` | Key/value store for scheduler state, keywords, notify config |

---

## Project Structure

```
backend/
  main.py          FastAPI app, all API endpoints
  pipeline.py      Orchestrates scrape → dedup → classify → score
  intelligence.py  Claude Haiku classification (batch UPDATE)
  scoring.py       Company signal aggregation and priority scoring
  dedup.py         Fuzzy deduplication with rapidfuzz
  scheduler.py     APScheduler wrapper (state in Postgres)
  notifier.py      Resend email with streaming CSV attachment
  database.py      Neon Postgres connection pool
  models.py        Pydantic request/response models
  scrapers/
    base.py        BaseJobScraper with parallel keyword runner
    linkedin.py    Free guest API scraper
    indeed.py      Apify actor scraper
    glassdoor.py   Apify actor scraper
    monster.py     Apify actor scraper
    naukri.py      Apify actor scraper

frontend/
  lib/
    apiFetch.js    fetch wrapper — injects X-API-Key header in production
    platforms.js   Shared platform constants (keys, labels, costs)
  pages/           Next.js pages (index, signals, companies, sources, run-log)
  components/      Layout, LiveLog, Toast, PriorityBadge, DeptBar
  styles/          custom.css, reference.css

schema.sql         Full database schema + indexes (run once in Neon)
```

---

## License

MIT
