import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import PriorityBadge from '../components/PriorityBadge'
import DeptBar from '../components/DeptBar'
import apiFetch from '../lib/apiFetch'

export default function Companies() {
  const [companies, setCompanies] = useState([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(true)
  const [priority, setPriority]   = useState('')
  const [sortBy, setSortBy]       = useState('score')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]       = useState('')
  const searchTimer               = useRef(null)
  const pageMounted               = useRef(false)

  const PAGE_SIZE = 30

  const load = useCallback(async (pg = 1) => {
    setLoading(true)
    const p = new URLSearchParams({ page: pg, page_size: PAGE_SIZE, sort_by: sortBy })
    if (priority) p.set('priority', priority)
    if (search)   p.set('search', search)
    try {
      const r = await apiFetch(`/api/companies?${p}`)
      const d = await r.json()
      setCompanies(d.results || [])
      setTotal(d.total || 0)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [priority, sortBy, search])

  // When filters change, reset to page 1 and load in one shot (avoids double-fire with stale page)
  useEffect(() => { setPage(1); load(1) }, [load])
  // When page changes via pagination — skip on mount (the [load] effect handles initial load)
  useEffect(() => {
    if (!pageMounted.current) { pageMounted.current = true; return }
    load(page)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Companies</h1>
            <p className="page-subtitle">{total} companies with active hiring signals</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Filter Bar */}
        <div className="filter-bar">
          <span className="filter-bar-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            Filter
          </span>
          <select
            className={`form-select${priority ? ' has-value' : ''}`}
            style={{ width: 'auto' }}
            value={priority}
            onChange={e => setPriority(e.target.value)}
          >
            <option value="">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>

          <div className="filter-divider" />

          <span className="filter-bar-label">Sort</span>
          <select
            className={`form-select${sortBy !== 'score' ? ' has-value' : ''}`}
            style={{ width: 'auto' }}
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            <option value="score">Signal Score</option>
            <option value="role_count">Role Count</option>
            <option value="recent">Most Recent</option>
          </select>

          <div className="filter-divider" />

          <input
            className="form-input"
            placeholder="Search company…"
            value={searchInput}
            onChange={e => {
              const val = e.target.value
              setSearchInput(val)
              clearTimeout(searchTimer.current)
              searchTimer.current = setTimeout(() => setSearch(val), 300)
            }}
            style={{ flex: 1, minWidth: 160 }}
          />

          {(priority || search) && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setPriority('')
                setSearchInput('')
                clearTimeout(searchTimer.current)
                setSearch('')
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Clear
            </button>
          )}
        </div>

        {/* Company Cards */}
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
        ) : companies.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <p>No companies yet. Run the pipeline to collect hiring signals.</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 16 }}>
            {companies.map(c => (
              <CompanyCard key={c.company_name} company={c} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24, alignItems: 'center' }}>
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}

function CompanyCard({ company: c }) {
  return (
    <Link href={`/company/${encodeURIComponent(c.company_name)}`} style={{ textDecoration: 'none' }}>
      <div
        className="card company-card"
        style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{c.company_name}</div>
            {c.company_domain && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{c.company_domain}</div>
            )}
          </div>
          <PriorityBadge priority={c.overall_priority} />
        </div>

        {/* Top intent signal */}
        {c.top_intent_signal && (
          <div style={{
            background: 'rgba(37,99,235,0.10)',
            color: 'var(--blue-400)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 500,
            display: 'inline-block',
            alignSelf: 'flex-start',
          }}>
            {c.top_intent_signal}
          </div>
        )}

        {/* Department breakdown bar */}
        {c.department_breakdown && <DeptBar breakdown={c.department_breakdown} />}

        {/* Footer row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
          <span>{c.total_open_roles} open role{c.total_open_roles !== 1 ? 's' : ''}</span>
          {c.role_velocity_7d > 0 && (
            <span style={{ color: 'var(--green-400)' }}>+{c.role_velocity_7d} this week</span>
          )}
          <span>Score: {Math.round(c.signal_strength_score)}</span>
        </div>
      </div>
    </Link>
  )
}
