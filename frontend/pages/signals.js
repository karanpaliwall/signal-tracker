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
      {/* Page Header */}
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
            <button className="btn btn-secondary" onClick={handleExport}>↓ Export CSV</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Filter Bar */}
        <div className="filter-bar">
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
            className="form-select"
            style={{ width: 'auto' }}
            value={filters.platform}
            onChange={e => handleFilter('platform', e.target.value)}
          >
            <option value="">All Platforms</option>
            {PLATFORMS.map(p => (
              <option key={p} value={p} style={{ textTransform: 'capitalize' }}>{p}</option>
            ))}
          </select>

          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={filters.department}
            onChange={e => handleFilter('department', e.target.value)}
          >
            <option value="">All Departments</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <select
            className="form-select"
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
            <button className="btn btn-ghost" onClick={clearFilters}>Clear</button>
          )}
        </div>

        {/* Table */}
        <div className="card">
          <div className="table-wrap">
            {loading ? (
              <p style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
            ) : signals.length === 0 ? (
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
                  {signals.map((s, idx) => (
                    <React.Fragment key={s.id}>
                      <tr
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
                          <span className={`badge badge-${s.platform}`}>
                            {s.platform}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {s.posted_date ? s.posted_date.slice(0, 10) : '—'}
                        </td>
                      </tr>
                      {expanded === s.id && (
                        <tr>
                          <td colSpan={10} style={{ background: 'var(--bg-hover)', padding: '12px 16px' }}>
                            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                              {s.description_snippet || 'No description available.'}
                            </p>
                            {s.job_url && /^https?:\/\//.test(s.job_url) && (
                              <a
                                href={s.job_url} target="_blank" rel="noreferrer"
                                style={{ color: 'var(--blue-400)', fontSize: 12 }}
                                onClick={e => e.stopPropagation()}
                              >
                                View on {s.platform} →
                              </a>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  )
}
