-- Hiring Signal Tracker — Database Schema
-- Run this in Neon SQL editor once to initialize.
-- All subsequent changes should be additive migrations only.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Job Signals ────────────────────────────────────────────────────────────
-- Every normalized job listing scraped from LinkedIn or Indeed.
-- job_id (platform:external_id) is the dedup key — ON CONFLICT DO NOTHING on insert.

CREATE TABLE IF NOT EXISTS job_signals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               TEXT,                    -- e.g. "linkedin:3842984"
  company_name         TEXT,
  company_domain       TEXT,
  job_title_raw        TEXT,
  job_title_normalized TEXT,                    -- classified by Claude Haiku
  department           TEXT,                    -- Sales/Engineering/Marketing/Operations/Product/Finance/Other
  seniority            TEXT,                    -- junior/mid/senior/director/c-suite
  intent_signal        TEXT,                    -- e.g. "Needs outbound pipeline"
  priority             TEXT DEFAULT 'medium',   -- high/medium/low
  confidence           DOUBLE PRECISION,
  platform             TEXT,                    -- linkedin/indeed
  location             TEXT,
  job_url              TEXT,
  description_snippet  TEXT,                    -- first 500 chars of description
  posted_date          DATE,
  scraped_at           TIMESTAMPTZ DEFAULT NOW(),
  data_mode            TEXT DEFAULT 'live',     -- live/weekly
  is_duplicate         BOOLEAN DEFAULT FALSE,
  processing_attempts  INTEGER DEFAULT 0,       -- cap at 5 — prevents infinite retry
  raw_data             JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Dedup key: one row per job_id (platform + external ID)
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_signals_job_id
  ON job_signals (job_id) WHERE job_id IS NOT NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_js_company      ON job_signals (company_name);
CREATE INDEX IF NOT EXISTS idx_js_department   ON job_signals (department);
CREATE INDEX IF NOT EXISTS idx_js_priority     ON job_signals (priority);
CREATE INDEX IF NOT EXISTS idx_js_platform     ON job_signals (platform);
CREATE INDEX IF NOT EXISTS idx_js_posted_date  ON job_signals (posted_date DESC) WHERE is_duplicate = FALSE;
CREATE INDEX IF NOT EXISTS idx_js_scraped_at   ON job_signals (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_js_data_mode    ON job_signals (data_mode);
CREATE INDEX IF NOT EXISTS idx_js_processing   ON job_signals (processing_attempts) WHERE job_title_normalized IS NULL;


-- ── Company Signals ────────────────────────────────────────────────────────
-- Aggregated company-level signal. Upserted after each intelligence + scoring run.

CREATE TABLE IF NOT EXISTS company_signals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name          TEXT UNIQUE,
  company_domain        TEXT,
  total_open_roles      INTEGER DEFAULT 0,
  department_breakdown  JSONB,                  -- {"Sales": 5, "Engineering": 3}
  top_intent_signal     TEXT,
  overall_priority      TEXT DEFAULT 'medium',
  signal_strength_score DOUBLE PRECISION DEFAULT 0,
  role_velocity_7d      INTEGER DEFAULT 0,      -- new roles posted in last 7 days
  first_seen_at         TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_priority ON company_signals (overall_priority);
CREATE INDEX IF NOT EXISTS idx_cs_score    ON company_signals (signal_strength_score DESC);


-- ── Scraper Run Audit Log ──────────────────────────────────────────────────
-- One row per scraper run (platform × mode). Used by the Run Log page.

CREATE TABLE IF NOT EXISTS signal_scraper_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          TEXT,
  mode              TEXT,                       -- live/weekly
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  status            TEXT DEFAULT 'running',     -- running/completed/failed
  jobs_found        INTEGER DEFAULT 0,
  jobs_added        INTEGER DEFAULT 0,
  duplicates_caught INTEGER DEFAULT 0,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started  ON signal_scraper_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_platform ON signal_scraper_runs (platform);


-- ── App Config ────────────────────────────────────────────────────────────
-- Additional performance indexes for common query patterns.
-- Run these after the base schema if adding to an existing database.

-- Compound partial indexes: is_duplicate=FALSE is the most common filter.
-- These enable index-only scans for the most frequent signal query patterns.
CREATE INDEX IF NOT EXISTS idx_js_dept_nodup     ON job_signals (department, scraped_at DESC)  WHERE is_duplicate = FALSE;
CREATE INDEX IF NOT EXISTS idx_js_platform_nodup ON job_signals (platform, scraped_at DESC)    WHERE is_duplicate = FALSE;
CREATE INDEX IF NOT EXISTS idx_js_priority_nodup ON job_signals (priority, scraped_at DESC)    WHERE is_duplicate = FALSE;

-- Trigram index for ILIKE '%term%' search (leading wildcard can't use B-tree).
-- Requires pg_trgm extension (available on Neon).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_js_search_trgm ON job_signals
  USING GIN ((company_name || ' ' || COALESCE(job_title_raw, '')) gin_trgm_ops)
  WHERE is_duplicate = FALSE;

-- Intelligence status query index (used by get_intelligence_status full-table scan).
CREATE INDEX IF NOT EXISTS idx_js_intel_processed ON job_signals (id) WHERE job_title_normalized IS NOT NULL;

-- Pending intelligence records — optimises the main classification query.
CREATE INDEX IF NOT EXISTS idx_js_pending ON job_signals (scraped_at DESC)
  WHERE job_title_normalized IS NULL AND processing_attempts < 5;


-- Key/value store for scheduler state, keyword lists, notification settings.
-- Using Postgres instead of JSON files so state survives Railway container restarts.

CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Seed defaults — idempotent, safe to re-run
INSERT INTO app_config (key, value) VALUES
  ('scheduler',     '{"enabled": false, "frequency": "daily", "hour": 9, "minute": 0}'),
  ('keywords',      '{
    "linkedin": [
      "Sales Development Representative", "SDR", "BDR", "Business Development Representative",
      "Account Executive", "Account Manager", "VP Sales", "Chief Revenue Officer",
      "Software Engineer", "Backend Engineer", "Data Engineer", "ML Engineer",
      "Marketing Manager", "Growth Manager", "CMO", "VP Marketing",
      "Product Manager", "CPO", "Head of Product",
      "Operations Manager", "COO", "Revenue Operations",
      "CFO", "Finance Director", "Head of Finance"
    ],
    "indeed": [
      "Sales Development Representative", "SDR", "BDR",
      "Account Executive", "Account Manager", "VP Sales",
      "Software Engineer", "Data Engineer", "ML Engineer",
      "Marketing Manager", "Growth Manager", "CMO",
      "Product Manager", "CPO",
      "Operations Manager", "COO",
      "CFO", "Finance Director"
    ]
  }'),
  ('notify_config', '{"enabled": false, "recipients": []}'),
  ('sources',       '{"linkedin_enabled": true, "indeed_enabled": true, "glassdoor_enabled": false, "ziprecruiter_enabled": false, "monster_enabled": false, "naukri_enabled": false, "results_per_keyword": 50}')
ON CONFLICT (key) DO NOTHING;
