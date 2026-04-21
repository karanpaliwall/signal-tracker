import { useState, useEffect } from 'react'

const TABS = [
  { id: 'scrapers',     label: 'Scrapers' },
  { id: 'intelligence', label: 'Intelligence' },
]

export default function RunLog() {
  const [runs, setRuns]     = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState('scrapers')

  useEffect(() => {
    load()
    const iv = setInterval(() => load(false), 5000)
    return () => clearInterval(iv)
  }, [])

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true)
    try {
      const r = await fetch('/api/scrape/runs?limit=50')
      setRuns(await r.json())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '—'
    const diff = Date.now() - new Date(dateStr)
    const mins = Math.floor(diff / 60000)
    if (mins < 1)  return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)  return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7)  return `${days}d ago`
    return new Date(dateStr).toLocaleDateString()
  }

  function duration(run) {
    if (!run.started_at || !run.completed_at) return '—'
    const secs = Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
  }

  function isRunning(run) {
    return run.status === 'running'
  }

  // Scrapers = platform-based runs; Intelligence = classify runs
  const scraperRuns = runs.filter(r => r.mode !== 'intelligence')
  const intelligenceRuns = runs.filter(r => r.mode === 'intelligence')
  const displayRuns = tab === 'scrapers' ? scraperRuns : intelligenceRuns

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Run Log</h1>
            <p className="page-subtitle">History of all pipeline executions</p>
          </div>
          <button className="btn btn-secondary" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div className="tabs-pill" style={{ marginBottom: 16 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-pill${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Table Card */}
        <div className="card">
          <div className="table-wrap">
            {loading ? (
              <p style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
            ) : displayRuns.length === 0 ? (
              <div className="empty-state">
                <p>No {tab} runs yet.</p>
              </div>
            ) : tab === 'scrapers' ? (
              <ScrapersTable runs={displayRuns} duration={duration} isRunning={isRunning} timeAgo={timeAgo} />
            ) : (
              <IntelligenceTable runs={displayRuns} duration={duration} isRunning={isRunning} timeAgo={timeAgo} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScrapersTable({ runs, duration, isRunning, timeAgo }) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Platform</th>
          <th>Mode</th>
          <th>Started</th>
          <th>Completed</th>
          <th>Duration</th>
          <th>Status</th>
          <th>Found</th>
          <th>New</th>
          <th>Dupes</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run, idx) => (
          <tr key={run.id}>
            <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{idx + 1}</td>
            <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{run.platform}</td>
            <td>
              <span className="badge" style={{
                background: run.mode === 'weekly' ? 'rgba(139,92,246,0.12)' : 'rgba(37,99,235,0.12)',
                color: run.mode === 'weekly' ? 'var(--violet-400)' : 'var(--blue-400)',
              }}>
                {run.mode}
              </span>
            </td>
            <td style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{timeAgo(run.started_at)}</span>
              {run.started_at && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 1 }}>
                  {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </td>
            <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {isRunning(run) ? (
                <span style={{ color: 'var(--green-400)' }}>Running…</span>
              ) : run.completed_at ? new Date(run.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </td>
            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {isRunning(run) ? <span className="dot dot-green" /> : duration(run)}
            </td>
            <td><StatusBadge status={run.status} /></td>
            <td style={{ fontSize: 12 }}>{run.jobs_found ?? 0}</td>
            <td style={{ fontSize: 12, color: (run.jobs_added ?? 0) > 0 ? 'var(--green-400)' : 'var(--text-muted)' }}>
              {run.jobs_added ?? 0}
            </td>
            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{run.duplicates_caught ?? 0}</td>
            <td style={{ fontSize: 11, color: 'var(--red-400)', maxWidth: 200 }}>
              {run.error_message ? run.error_message.slice(0, 60) + (run.error_message.length > 60 ? '…' : '') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function IntelligenceTable({ runs, duration, isRunning, timeAgo }) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Started</th>
          <th>Completed</th>
          <th>Duration</th>
          <th>Status</th>
          <th>Processed</th>
          <th>Classified</th>
          <th>Failed</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run, idx) => (
          <tr key={run.id}>
            <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{idx + 1}</td>
            <td style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{timeAgo(run.started_at)}</span>
              {run.started_at && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 1 }}>
                  {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </td>
            <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {isRunning(run) ? (
                <span style={{ color: 'var(--green-400)' }}>Running…</span>
              ) : run.completed_at ? new Date(run.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </td>
            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {isRunning(run) ? <span className="dot dot-green" /> : duration(run)}
            </td>
            <td><StatusBadge status={run.status} /></td>
            <td style={{ fontSize: 12 }}>{run.jobs_found ?? 0}</td>
            <td style={{ fontSize: 12, color: (run.jobs_added ?? 0) > 0 ? 'var(--green-400)' : 'var(--text-muted)' }}>
              {run.jobs_added ?? 0}
            </td>
            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{run.duplicates_caught ?? 0}</td>
            <td style={{ fontSize: 11, color: 'var(--red-400)', maxWidth: 200 }}>
              {run.error_message ? run.error_message.slice(0, 60) + (run.error_message.length > 60 ? '…' : '') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatusBadge({ status }) {
  const map = {
    running:   { bg: 'rgba(37,99,235,0.12)',   color: 'var(--blue-400)' },
    completed: { bg: 'rgba(34,197,94,0.12)',    color: 'var(--green-400)' },
    failed:    { bg: 'rgba(239,68,68,0.12)',    color: 'var(--red-400)' },
  }
  const s = map[status] || map.completed
  return (
    <span className="badge" style={{ background: s.bg, color: s.color }}>
      {status === 'running' && <span className="dot dot-green" style={{ marginRight: 4, width: 6, height: 6 }} />}
      {status}
    </span>
  )
}
