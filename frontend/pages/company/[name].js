import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import PriorityBadge from '../../components/PriorityBadge'
import DeptBar from '../../components/DeptBar'
import apiFetch from '../../lib/apiFetch'
import { PLATFORM_LABEL } from '../../lib/platforms'

const SENIORITY_COLOR = {
  'c-suite':  '#f59e0b',
  'director': '#a78bfa',
  'senior':   '#60a5fa',
  'mid':      '#94a3b8',
  'junior':   '#6b7280',
}

export default function CompanyDetail() {
  const router = useRouter()
  const { name } = router.query

  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!name) return
    setLoading(true)
    apiFetch(`/api/companies/${encodeURIComponent(name)}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then(d => { setCompany(d); setLoading(false) })
      .catch(() => { setError('Company not found'); setLoading(false) })
  }, [name])

  if (loading) return (
    <div className="page-body" style={{ paddingTop: 40 }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
    </div>
  )

  if (error || !company) return (
    <div className="page-body" style={{ paddingTop: 40 }}>
      <button className="btn btn-secondary" onClick={() => router.back()} style={{ marginBottom: 16 }}>← Back</button>
      <p style={{ color: 'var(--text-muted)' }}>{error || 'Company not found'}</p>
    </div>
  )

  const roles = company.open_roles || []

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-secondary"
              onClick={() => router.back()}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              ← Back
            </button>
            <div>
              <h1 className="page-title">{company.company_name}</h1>
              <p className="page-subtitle">{roles.length} open role{roles.length !== 1 ? 's' : ''} tracked</p>
            </div>
          </div>
          <PriorityBadge priority={company.overall_priority} />
        </div>
      </div>

      <div className="page-body">
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Signal Score</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
              {Math.round(company.signal_strength_score)}
            </div>
          </div>
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Open Roles</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
              {company.total_open_roles}
            </div>
          </div>
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>New This Week</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: company.role_velocity_7d > 0 ? 'var(--green-400)' : 'var(--text-primary)', marginTop: 4 }}>
              +{company.role_velocity_7d}
            </div>
          </div>
          {company.top_intent_signal && (
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Top Signal</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue-400)', marginTop: 6, lineHeight: 1.4 }}>
                {company.top_intent_signal}
              </div>
            </div>
          )}
        </div>

        {/* Department breakdown */}
        {company.department_breakdown && Object.keys(company.department_breakdown).length > 0 && (
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Department Breakdown
            </div>
            <DeptBar breakdown={company.department_breakdown} />
          </div>
        )}

        {/* Roles table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            All Open Roles
          </div>
          {roles.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>No roles found.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
            <table className="roles-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-card)' }}>
                  {['Job Title', 'Department', 'Seniority', 'Intent Signal', 'Platform', 'Location', 'Posted'].map(h => (
                    <th key={h} scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role, i) => (
                  <tr
                    key={role.id || i}
                    style={{ borderBottom: '1px solid var(--border-color)' }}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 500, maxWidth: 280 }}>
                      {role.job_url ? (
                        <a
                          href={role.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="role-link"
                        >
                          {role.job_title_raw}
                        </a>
                      ) : role.job_title_raw}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{role.department || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                        background: 'rgba(255,255,255,0.06)',
                        color: SENIORITY_COLOR[role.seniority] || 'var(--text-muted)',
                        textTransform: 'capitalize',
                        whiteSpace: 'nowrap',
                      }}>
                        {role.seniority || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--blue-400)', fontStyle: role.intent_signal ? 'normal' : 'italic', fontSize: 12 }}>
                      {role.intent_signal || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {PLATFORM_LABEL[role.platform] || role.platform}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }}>{role.location || '—'}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {(role.posted_date || role.scraped_at)
                        ? new Date(role.posted_date || role.scraped_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
