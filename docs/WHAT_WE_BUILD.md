# What We Build — Hiring Signal Tracker

## Problem

Sales teams need to pitch at the right moment. Timing is everything — reaching out too early means the company isn't ready to buy; too late and they've already signed with a competitor.

**Hiring is one of the strongest real-time buying signals.** When a company posts 5 SDR/BDR roles, they are actively building an outbound sales team. They need pipeline tools — *right now*. When a company posts 3 data engineering roles, they are scaling their data infrastructure. When a CRO is hired, a full go-to-market rebuild is underway.

The problem: this signal is public and free, but it's scattered across LinkedIn, Indeed, and dozens of job boards. No one has time to manually monitor them all.

## Solution

Hiring Signal Tracker monitors LinkedIn and Indeed continuously, scrapes job listings across 6 role categories, and uses AI to classify every role into a buying signal. It then surfaces the highest-priority companies in a clean dashboard.

**The system answers one question**: *Which companies are actively building right now, and what does their hiring pattern tell us about what they need?*

## The 5 Layers

```
Apify Actors ──► Normalization ──► Dedup ──► Claude Haiku ──► Scoring ──► Postgres
(LinkedIn / Indeed)                          (classify)        (aggregate)

APScheduler: "present" run every 24h + weekly digest every Monday 9am IST
Frontend: Next.js 14 with official Growleads design system
```

1. **Scraping** — Apify actors pull job listings from LinkedIn and Indeed without cookies or login. Broad keyword search across all 6 role categories.

2. **Normalization** — All platform-specific field names get mapped to a single unified schema. Every record gets a `platform:external_id` job_id for deduplication.

3. **Intelligence** — Claude Haiku classifies each job: department, seniority level, and a concise intent signal (max 6 words). Example: `"SDR" → {department: "Sales", seniority: "mid", intent_signal: "Needs outbound pipeline"}`.

4. **Scoring** — Deterministic rule-based priority scoring aggregates signals per company. C-suite hire = high priority. 3+ roles in the same department = clustering signal. Sales SDR/BDR/AE cluster = immediate pipeline buyer.

5. **Display** — Growleads-branded dark-theme dashboard shows signals by priority, allows filtering by platform/department/time window, and exports to CSV.

## Phase 1 Scope (This Build)

- Signal detection and display only
- No outreach integration
- No CRM export
- No watchlist/alerts
- LinkedIn + Indeed platforms only (Glassdoor scrapers are unreliable, 2★)

## Role Categories Tracked

| Category | Example Roles |
|----------|---------------|
| Sales | SDR, BDR, AE, VP Sales, CRO |
| Engineering | SWE, Backend, Data Eng, ML Eng |
| Marketing | Marketing Manager, CMO, VP Marketing, Growth |
| Product | PM, CPO, Head of Product |
| Operations | COO, RevOps, Operations Manager |
| Finance | CFO, Finance Director, Head of Finance |

## Time Windows

- **Present** — Jobs posted in the last 24 hours. Run daily at configurable time (default: 9am IST).
- **Weekly** — Jobs posted in the last 7 days. Run every Monday 9am IST for broader trend analysis.

Both datasets are stored separately (`data_mode = "live"` vs `"weekly"`) and filterable in the UI.

## Priority Scoring

| Signal | Score |
|--------|-------|
| C-suite hire (CRO, CPO, CTO, CFO) | +50 pts |
| Director-level hire | +20 pts |
| 3+ roles in same department | +30 pts |
| 2 roles in same department | +10 pts |
| Sales cluster (2+ SDR/BDR/AE) | +20 pts extra |
| Any role posted in last 24h | +15 pts |

- **High**: ≥ 60 pts
- **Medium**: ≥ 25 pts
- **Low**: < 25 pts

## Intent Signal Taxonomy

Haiku generates free-form signals (not from a fixed list), but common patterns:

| Role Type | Example Intent Signal |
|-----------|----------------------|
| SDR / BDR | "Needs outbound pipeline" |
| Account Executive | "Scaling revenue team" |
| CRO / VP Sales | "Scaling sales organization" |
| Data Engineer | "Building data infrastructure" |
| CMO / VP Marketing | "Formalizing go-to-market" |
| CPO / Product Manager | "Investing in product" |
| CTO | "Scaling engineering org" |
| CFO | "Formalizing financial ops" |

## UI Pages

| Page | Purpose |
|------|---------|
| Dashboard | Stats overview + high-priority signals + pipeline status |
| Signals Feed | Full filterable table of all job signals |
| Companies | Aggregated company view with dept breakdown + priority |
| Sources & Config | Platform toggles, keywords, scheduler, notifications |
| Run Log | Scraper run history with duration and counts |

## Success Metrics (Phase 1)

- System detects at least 500 high-quality job signals per week
- Classification accuracy > 85% (spot-check against manually reviewed sample)
- Dashboard loads in < 2 seconds
- Full pipeline run (scrape + classify + score) completes in < 30 minutes
- Zero data loss on Railway container restart (Postgres state)

## Future Phases

- **Phase 2**: Watchlist — monitor specific companies and alert on new hires
- **Phase 3**: CRM integration — push high-priority signals to HubSpot/Salesforce
- **Phase 4**: Outreach automation — generate personalized cold email from signal context
- **Phase 5**: Signal enrichment — combine hiring signal with LinkedIn employee count, funding stage, tech stack
