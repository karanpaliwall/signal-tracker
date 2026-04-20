# Hiring Signal Tracker

A multi-platform hiring signal tracker that monitors 5 job boards to detect buying signals from companies actively hiring. Every job listing is classified by department and intent using Claude Haiku (e.g. *"Needs outbound pipeline"*), companies are scored by signal strength, and results are surfaced in a branded dashboard.

**Phase 1 scope:** Signal detection and display only. No outreach.

---

## How It Works

```
Job Boards → Scrapers → Normalize → Dedup → Claude Haiku → Scoring → Neon DB → Dashboard
```

1. **Scrape** — 5 job boards are scraped on demand or on a schedule
2. **Classify** — Claude Haiku assigns each role a department + intent signal
3. **Score** — Companies are scored by volume, recency, and signal type
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
| AI | Claude Haiku (`claude-haiku-4-5`) |
| Scraping | Apify + LinkedIn free guest API |
| Email | Resend SDK |
| Deploy | Railway (backend) + Vercel (frontend) |

---

## Screenshots

> Dashboard → Signals Feed → Companies → Company Drill-down → Sources & Config

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
| `API_KEY` | No | Leave empty in dev. Set in Railway for production. |

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
| `/` | Dashboard — stats, pipeline status, recent signals, Run buttons |
| `/signals` | Paginated job signals feed with filters |
| `/companies` | Company cards grid sorted by signal strength |
| `/company/[name]` | Company drill-down — score, dept breakdown, all open roles |
| `/sources` | Sources & Config — platforms, keywords, scheduler, notifications |
| `/run-log` | Run history — scraper runs and intelligence classification runs |

---

## API Endpoints

### Scraping
```
POST /api/scrape/run?mode=live|weekly|full   Trigger a scrape run
POST /api/scrape/stop                         Cancel in-progress run
GET  /api/scrape/status                       {live_running, weekly_running, ...}
GET  /api/scrape/log?since=N                  Real-time log polling
GET  /api/scrape/runs?limit=20                Run history
```

### Signals & Companies
```
GET    /api/signals         Paginated signals (filters: platform, dept, priority, search)
GET    /api/signals/stats   {total, high_priority, new_today, companies_tracked}
GET    /api/signals/export  CSV download
DELETE /api/signals         Delete by IDs

GET    /api/companies        Paginated company signals
GET    /api/companies/{name} Single company with all open roles
```

### Config
```
GET  /api/sources     Platform configs + keyword lists
POST /api/sources     Save platform configs + keywords
GET  /api/scheduler   Scheduler state
POST /api/scheduler   Update scheduler
GET  /api/notify/config
POST /api/notify/config
POST /api/notify/send   Manually send email report
```

---

## Deployment

### Railway (Backend)
1. Create a new Railway project and connect this repo
2. Set all environment variables in the Railway dashboard
3. Deploy — `render.yaml` configures the web service

### Vercel (Frontend)
1. Import the `frontend/` directory to Vercel
2. Set `RAILWAY_BACKEND_URL` in Vercel dashboard (used by `next.config.js` rewrites)
3. Deploy

### Pre-deploy checklist
- [ ] Rotate `APIFY_TOKEN`
- [ ] Rotate `RESEND_API_KEY`
- [ ] Set `API_KEY` in Railway for endpoint security
- [ ] Set `ALLOWED_ORIGINS` in Railway (e.g. `https://your-app.vercel.app`)
- [ ] Run `schema.sql` in Neon SQL editor

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `job_signals` | Every normalized job listing. Dedup key: `platform:external_id` |
| `company_signals` | Aggregated per-company signal scores, upserted after each run |
| `signal_scraper_runs` | Audit log — one row per platform × mode run |
| `app_config` | Key/value store for scheduler state, keywords, notify config |

---

## License

MIT
