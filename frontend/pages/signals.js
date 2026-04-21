import React, { useState, useEffect, useCallback, useRef } from 'react'
import PriorityBadge from '../components/PriorityBadge'
import Toast from '../components/Toast'

const DEPARTMENTS = ['Sales', 'Engineering', 'Marketing', 'Operations', 'Product', 'Finance', 'Other']
const PLATFORMS   = ['linkedin', 'indeed', 'glassdoor', 'monster', 'naukri']
const PRIORITIES  = ['high', 'medium', 'low']

export default function Signals() {
  const [signals, setSignals]   = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [toast, setToast]       = useState('')

  const [filters, setFilters] = useState({
    platform:  '',
    department:'',
    priority:  '',
    data_mode: '',
    search:    '',
  })
  const [searchInput, setSearchInput] = useState('')
  const searchTimer = useRef(null)

  const PAGE_SIZE = 50

  const load = useCallback(async (pg = 1) => {
    setLoading(true)
    const p = new URLSearchParams()
    p.set('page', pg)
    p.set('page_size', PAGE_SIZE)
    if (filters.platform)   p.set('platform',   filters.platform)
    if (filters.department) p.set('department',  filters.department)
    if (filters.priority)   p.set('priority',    filters.priority)
    if (filters.data_mode)  p.set('data_mode',   filters.data_mode)
    if (filters.search)     p.set('search',      filters.search)
    try {
      const r = await fetch(`/api/signals?${p}`)
      const d = await r.json()
      setSignals(d.results || [])
      setTotal(d.total || 0)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [filters])

  useEffect(() => { setPage(1); load(1) }, [filters])
  // intentional: filter changes are handled by the [filters] effect above; this only fires on explicit page navigation
  useEffect(() => { load(page) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilter(key, val) {
    setFilters(f => ({ ...f, [key]: val }))
  }

  function clearFilters() {
    setSearchInput('')
    clearTimeout(searchTimer.current)
    setFilters({ platform: '', department: '', priority: '', data_mode: '', search: '' })
  }

  async function handleExport() {
    try {
      const params = new URLSearchParams()
      if (filters.platform)   params.set('platform',   filters.platform)
      if (filters.department) params.set('department',  filters.department)
      if (filters.priority)   params.set('priority',    filters.priority)
      if (filters.data_mode)  params.set('data_mode',   filters.data_mode)
      if (filters.search)     params.set('search',      filters.search)
      const r = await fetch(`/api/signals/export?${params}`)
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `hiring-signals-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setToast('CSV downloaded')
    } catch { setToast('Export failed') }
  }

  async function handleDeleteSelected() {
    if (!selected.size) return
    try {
      await fetch('/api/signals', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      })
      setSelected(new Set())
      setToast(`Deleted ${selected.size} signal${selected.size > 1 ? 's' : ''}`)
      load(page)
    } catch { setToast('Delete failed') }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === signals.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(signals.map(s => s.id)))
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const anyActive  = Object.values(filters).some(Boolean)

  return (
    <div>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Signals Feed</h1>
            <p className="page-subtitle">{total.toLocaleString()} job signals tracked</p>
          </div>
          <div className="btn-group">
            {selected.size > 0 && (
              <button className="btn btn-danger" onClick={handleDeleteSelected}>
                Delete {selected.size}
              </button>
            )}
            <button className="btn btn-secondary" onClick={handleExport}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export CSV
            </button>
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
            Filters
          </span>

          <div className="filter-divider" />

          <div className="tabs-pill">
            {[['', 'All'], ['live', 'Present'], ['weekly', 'Weekly']].map(([val, label]) => (
              <button
                key={val}
                className={`tab-pill${filters.data_mode === val ? ' active' : ''}`}
                onClick={() => handleFilter('data_mode', val)}
              >{label}</button>
            ))}
          </div>

          <select
            className={`form-select${filters.platform ? ' has-value' : ''}`}
            style={{ width: 'auto' }}
            value={filters.platform}
            onChange={e => handleFilter('platform', e.target.value)}
          >
            <option value="">All Platforms</option>
            {PLATFORMS.map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>

          <select
            className={`form-select${filters.department ? ' has-value' : ''}`}
            style={{ width: 'auto' }}
            value={filters.department}
            onChange={e => handleFilter('department', e.target.value)}
          >
            <option value="">All Departments</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <select
            className={`form-select${filters.priority ? ' has-value' : ''}`}
            style={{ width: 'auto' }}
            value={filters.priority}
            onChange={e => handleFilter('priority', e.target.value)}
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>

          <input
            className="form-input"
            placeholder="Search company or role…"
            value={searchInput}
            onChange={e => {
              const val = e.target.value
              setSearchInput(val)
              clearTimeout(searchTimer.current)
              searchTimer.current = setTimeout(() => handleFilter('search', val), 300)
            }}
            style={{ flex: 1, minWidth: 180 }}
          />

          {anyActive && (
            <button className="btn btn-ghost" onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="card">
          <div className="table-wrap">
            {signals.length === 0 && !loading ? (
              <div className="empty-state">
                <p>No signals found. {anyActive ? 'Try clearing your filters.' : 'Run the pipeline to start collecting data.'}</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={selected.size === signals.length && signals.length > 0}
                        onChange={toggleSelectAll}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    <th>#</th>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Seniority</th>
                    <th>Intent Signal</th>
                    <th>Priority</th>
                    <th>Platform</th>
                    <th>Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? [...Array(8)].map((_, i) => (
                        <tr key={i}>
                          <td><span className="skeleton" style={{ width: 14, height: 14 }} /></td>
                          <td><span className="skeleton" style={{ width: 20 }} /></td>
                          <td><span className="skeleton" style={{ width: 110 }} /></td>
                          <td><span className="skeleton" style={{ width: 165 }} /></td>
                          <td><span className="skeleton" style={{ width: 70, height: 20, borderRadius: 9999 }} /></td>
                          <td><span className="skeleton" style={{ width: 55 }} /></td>
                          <td><span className="skeleton" style={{ width: 140 }} /></td>
                          <td><span className="skeleton" style={{ width: 58, height: 20, borderRadius: 9999 }} /></td>
                          <td><span className="skeleton" style={{ width: 68, height: 20, borderRadius: 9999 }} /></td>
                          <td><span className="skeleton" style={{ width: 60 }} /></td>
                        </tr>
                      ))
                    : signals.map((s, idx) => (
                        <React.Fragment key={s.id}>
                          <tr
                            className={selected.has(s.id) ? 'row-selected' : ''}
                            style={{ cursor: 'pointer' }}
                            onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                          >
                            <td onClick={e => { e.stopPropagation(); toggleSelect(s.id) }}>
                              <input
                                type="checkbox"
                                checked={selected.has(s.id)}
                                onChange={() => toggleSelect(s.id)}
                                style={{ cursor: 'pointer' }}
                              />
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                              {(page - 1) * PAGE_SIZE + idx + 1}
                            </td>
                            <td style={{ fontWeight: 600 }}>{s.company_name}</td>
                            <td style={{ maxWidth: 220 }}>{s.job_title_raw}</td>
                            <td>
                              {s.department && (
                                <span className="badge badge-blue" style={{ fontSize: 11 }}>{s.department}</span>
                              )}
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.seniority || '—'}</td>
                            <td style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 200 }}>
                              {s.intent_signal || '—'}
                            </td>
                            <td><PriorityBadge priority={s.priority} /></td>
                            <td>
                              <span className={`badge badge-${s.platform}`}>{s.platform}</span>
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                              {s.posted_date ? s.posted_date.slice(0, 10) : '—'}
                            </td>
                          </tr>
                          {expanded === s.id && (
                            <tr>
                              <td colSpan={10} style={{ padding: 0 }}>
                                <div className="signal-detail-inner">
                                  <p className="signal-detail-desc">
                                    {s.description_snippet || 'No description available.'}
                                  </p>
                                  {s.job_url && /^https?:\/\//.test(s.job_url) && (
                                    <a
                                      href={s.job_url} target="_blank" rel="noreferrer"
                                      className="btn btn-secondary"
                                      style={{ fontSize: 12, textDecoration: 'none', height: 30, padding: '0 12px', flexShrink: 0 }}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      View on {s.platform} →
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                  }
                </tbody>
              </table>
            )}
          </div>
        </div>

        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPage={setPage} />}
      </div>

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  )
}

function Pagination({ page, totalPages, onPage }) {
  const items = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) items.push(i)
  } else {
    const near = new Set([1, totalPages, page - 1, page, page + 1].filter(p => p >= 1 && p <= totalPages))
    const sorted = [...near].sort((a, b) => a - b)
    let prev = 0
    for (const p of sorted) {
      if (p - prev > 1) items.push('…')
      items.push(p)
      prev = p
    }
  }
  return (
    <div className="pagination">
      <button className="page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>←</button>
      {items.map((p, i) =>
        p === '…'
          ? <span key={`d${i}`} className="page-dots">…</span>
          : <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => onPage(p)}>{p}</button>
      )}
      <button className="page-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>→</button>
    </div>
  )
}
