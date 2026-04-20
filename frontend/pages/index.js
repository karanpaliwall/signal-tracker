import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import PriorityBadge from '../components/PriorityBadge'
import Toast from '../components/Toast'
import { useStatus } from './_app'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [signals, setSignals] = useState([])
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)

  // Status comes from shared context — no duplicate polling
  const status = useStatus()
  const isRunning = status.live_running || status.weekly_running || status.intelligence_running
  const wasRunning = useRef(false)

  useEffect(() => {
    loadData()
    // Idle refresh every 30s
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [])

  // Reload when a run finishes
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      loadData()
    }
    wasRunning.current = isRunning
  }, [isRunning])

  async function loadData() {
    setLoading(true)
    try {
      const [statsRes, signalsRes] = await Promise.all([
        fetch('/api/signals/stats'),
        fetch('/api/signals?page_size=10'),
      ])
      setStats(await statsRes.json())
      const sig = await signalsRes.json()
      setSignals(sig.results || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function handleRun(mode) {
    try {
      const r = await fetch(`/api/scrape/run?mode=${mode}`, { method: 'POST' })
      if (r.ok) {
        setToast(`${mode === 'live' ? 'Live' : 'Weekly'} run started`)
      } else {
        const d = await r.json()
        setToast(d.detail || 'Already running')
      }
    } catch { setToast('Error starting pipeline') }
  }

  async function handleStop() {
    await fetch('/api/scrape/stop', { method: 'POST' })
    setToast('Stop requested')
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Hiring intelligence — real-time buying signals</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isRunning ? (
              <button className="btn btn-danger" onClick={handleStop}>Stop</button>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={() => handleRun('live')}>Run Live</button>
                <button className="btn btn-primary" onClick={() => handleRun('weekly')}>Run Weekly</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Stats Grid */}
        <div className="stat-grid">
          <StatCard label="Total Signals" value={stats?.total ?? '—'} detail="all time" />
          <StatCard label="High Priority" value={stats?.high_priority ?? '—'} detail="needs attention" accent="var(--red-400)" />
          <StatCard label="New Today" value={stats?.new_today ?? '—'} detail="since midnight" accent="var(--green-400)" />
          <StatCard label="Companies" value={stats?.companies_tracked ?? '—'} detail="tracked" />
        </div>

        {/* Pipeline Status */}
        <div className="card" style={{ marginBottom: 24, padding: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Pipeline
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                display: 'inline-block',
                width: 8, height: 8,
                borderRadius: '50%',
                background: isRunning ? 'var(--green-400)' : 'var(--amber-400)',
                animation: isRunning ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
              }} />
              <span style={{ fontSize: 12, color: isRunning ? 'var(--green-400)' : 'var(--amber-400)', fontWeight: 500 }}>
                {status.live_running ? 'Scraping…' : status.weekly_running ? 'Weekly scan…' : status.intelligence_running ? 'Classifying…' : 'Idle'}
              </span>
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {isRunning
              ? 'Scraping job listings and classifying signals…'
              : 'No active run. Click Run Live (24h window) or Run Weekly (7-day window).'}
          </p>
        </div>

        {/* Recent High-Priority Signals */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Recent Signals</h2>
            <Link href="/signals" style={{ fontSize: 12, color: 'var(--blue-400)', fontWeight: 500, textDecoration: 'none' }}>
              View All →
            </Link>
          </div>
          <div className="table-wrap">
            {loading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 16px' }}>Loading…</p>
            ) : signals.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 16px' }}>
                No signals yet. Run the pipeline to start collecting data.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Intent Signal</th>
                    <th>Priority</th>
                    <th>Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.company_name}</td>
                      <td>{s.job_title_raw}</td>
                      <td><span className="badge badge-blue">{s.department || '—'}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{s.intent_signal || '—'}</td>
                      <td><PriorityBadge priority={s.priority} /></td>
                      <td style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{s.platform}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  )
}

function StatCard({ label, value, accent, detail }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : {}}>{value}</div>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  )
}
