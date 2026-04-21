import { useState, useEffect } from 'react'
import Toast from '../components/Toast'

const US_KEYWORDS = [
  'Sales Development Representative',
  'Account Executive',
  'VP of Sales',
  'Head of Sales',
  'Business Development Representative',
  'Revenue Operations Manager',
  'Growth Marketing Manager',
  'Demand Generation Manager',
  'Product Marketing Manager',
  'Marketing Manager',
]

const IN_KEYWORDS = [
  'Sales Development Representative',
  'Business Development Executive',
  'Inside Sales Manager',
  'Account Executive',
  'Growth Marketing Manager',
  'Product Marketing Manager',
  'Revenue Operations',
  'Marketing Manager',
]

const KEYWORD_SUGGESTIONS = [
  'VP of Sales', 'Head of Sales', 'Chief Revenue Officer', 'Sales Manager',
  'Sales Engineer', 'Account Manager', 'Customer Success Manager',
  'Head of Growth', 'VP of Marketing', 'CMO', 'Performance Marketing Manager',
  'Paid Acquisition Manager', 'Content Marketing Manager', 'SEO Manager',
  'Marketing Director', 'Growth Hacker', 'Field Sales Representative',
  'Enterprise Account Executive', 'Mid-Market Account Executive',
  'Inside Sales Representative', 'Revenue Operations', 'Sales Operations Manager',
  'Director of Sales', 'Director of Marketing', 'Head of Revenue',
]

const DEFAULT_CONFIG = {
  linkedin_enabled: true,
  indeed_enabled: true,
  glassdoor_enabled: false,
  monster_enabled: false,
  naukri_enabled: false,
  results_per_keyword: 50,
  linkedin_keywords:  US_KEYWORDS,
  indeed_keywords:    US_KEYWORDS,
  glassdoor_keywords: US_KEYWORDS,
  monster_keywords:   US_KEYWORDS,
  naukri_keywords:    IN_KEYWORDS,
  custom_scrapers:    [],
}

const PLATFORMS = [
  { key: 'linkedin',  label: 'LinkedIn',  flag: 'US', cost: 'Free' },
  { key: 'indeed',    label: 'Indeed',    flag: 'US', cost: '~$3.00/1K' },
  { key: 'glassdoor', label: 'Glassdoor', flag: 'US', cost: '~$3.00/1K' },
  { key: 'monster',   label: 'Monster',   flag: 'US', cost: '~$0.99/1K' },
  { key: 'naukri',    label: 'Naukri',    flag: 'IN', cost: '~$1.00/1K' },
]

const SECTION_INFO = {
  scrapers: (
    <>
      <p>Scrapers are the engines that fetch job listings from job boards. Each scraper searches its platform using the keywords you define below, then the results flow through deduplication, AI classification, and scoring before appearing in your dashboard.</p>
      <p style={{ marginTop: 8 }}>Platform notes:</p>
      <ul style={{ marginTop: 4, paddingLeft: 18, lineHeight: 1.7 }}>
        <li><strong>LinkedIn</strong> — free guest API, no account needed. Fetches jobs posted in the last 24 hours.</li>
        <li><strong>Indeed</strong> — Apify actor, US listings sorted by date. Best general coverage.</li>
        <li><strong>Glassdoor</strong> — Apify actor, returns 60–130 results per keyword regardless of limit setting.</li>
        <li><strong>Monster</strong> — Apify actor, low cost per result. Good US coverage.</li>
        <li><strong>Naukri</strong> — Apify actor, India-focused. Use India-specific keywords (e.g. "Business Development Executive").</li>
      </ul>
    </>
  ),
  schedule: (
    <>
      <p>When enabled, the pipeline runs automatically once per day at the time you set (IST). Each scheduled run scrapes the last 24 hours of job listings, then classifies all new records with AI and updates company scores.</p>
      <p style={{ marginTop: 8 }}>You can also trigger a run manually any time from the Dashboard using the Run button.</p>
    </>
  ),
  notifications: (
    <>
      <p>After each pipeline run completes, a summary email is sent to all recipients listed here. The email includes key stats (new signals found, companies tracked, high-priority alerts) and a full CSV export of every signal from that run.</p>
      <p style={{ marginTop: 8 }}>Use <strong>Send Test Email</strong> to verify delivery before enabling automatic reports.</p>
    </>
  ),
}

const DEFAULT_SCHEDULER = { enabled: false, hour: 9, minute: 0, next_runs: null }

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export default function Sources() {
  const [config, setConfig]             = useState(DEFAULT_CONFIG)
  const [scheduler, setScheduler]       = useState(DEFAULT_SCHEDULER)
  const [notify, setNotify]             = useState({ enabled: false, recipients: [] })
  const [newEmail, setNewEmail]         = useState('')
  const [toast, setToast]               = useState('')
  const [saved, setSaved]               = useState(false)
  const [saving, setSaving]             = useState(false)
  const [loadError, setLoadError]       = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    try {
      const [srcRes, schRes, notifyRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/scheduler'),
        fetch('/api/notify/config'),
      ])
      if (srcRes.ok) {
        const data = await srcRes.json()
        const merged = { ...DEFAULT_CONFIG, ...data }
        PLATFORMS.forEach(p => {
          const k = `${p.key}_keywords`
          if (!data[k] || data[k].length === 0) merged[k] = DEFAULT_CONFIG[k]
        })
        if (!merged.custom_scrapers) merged.custom_scrapers = []
        setConfig(merged)
      }
      if (schRes.ok)    setScheduler(await schRes.json())
      if (notifyRes.ok) setNotify(await notifyRes.json())
    } catch (e) {
      console.error(e)
      setLoadError(true)
    }
  }

  async function saveAll() {
    setSaving(true)
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch('/api/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        }),
        fetch('/api/scheduler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduler),
        }),
        fetch('/api/notify/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notify),
        }),
      ])
      if (!r1.ok || !r2.ok || !r3.ok) throw new Error('Save failed')
      setSaved(true)
      setToast('Configuration saved')
      setTimeout(() => setSaved(false), 2000)
    } catch { setToast('Error saving') }
    setSaving(false)
  }

  async function sendTestEmail() {
    try {
      const r = await fetch('/api/notify/send', { method: 'POST' })
      if (r.ok) setToast('Test email sent')
      else { const d = await r.json(); setToast(d.detail || 'Failed') }
    } catch { setToast('Error') }
  }

  function addEmail() {
    const email = newEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setToast('Enter a valid email address')
      return
    }
    if (notify.recipients.includes(email)) return
    setNotify(n => ({ ...n, recipients: [...n.recipients, email] }))
    setNewEmail('')
  }

  function removeEmail(email) {
    setNotify(n => ({ ...n, recipients: n.recipients.filter(r => r !== email) }))
  }

  function addCustomScraper(scraper) {
    const key = slugify(scraper.name) || `custom_${Date.now()}`
    setConfig(c => ({
      ...c,
      custom_scrapers: [...(c.custom_scrapers || []), { ...scraper, key, custom: true }],
      [`${key}_enabled`]: true,
      [`${key}_keywords`]: US_KEYWORDS,
    }))
    setShowAddModal(false)
    setToast(`Added "${scraper.name}" — click Save Configuration to persist`)
  }

  function removeCustomScraper(key) {
    setConfig(c => {
      const updated = { ...c }
      updated.custom_scrapers = (c.custom_scrapers || []).filter(s => s.key !== key)
      delete updated[`${key}_enabled`]
      delete updated[`${key}_keywords`]
      return updated
    })
  }

  const customPlatforms = (config.custom_scrapers || []).map(s => ({
    key: s.key, label: s.name, flag: s.flag || 'US',
    cost: s.cost || 'Custom', custom: true,
  }))

  const allPlatforms = [...PLATFORMS, ...customPlatforms]

  return (
    <div>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Sources & Config</h1>
            <p className="page-subtitle">Platform settings, scheduler, and notifications</p>
          </div>
          <button
            className={`btn ${saved ? 'btn-success' : 'btn-primary'}`}
            onClick={saveAll}
            disabled={saving}
          >
            {saved ? '✓ Saved' : 'Save Configuration'}
          </button>
        </div>
      </div>

      <div className="page-body">

        {loadError && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', marginBottom: 16,
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 'var(--radius-lg)',
            fontSize: 12, color: 'var(--amber-400)',
          }}>
            <span>⚠</span>
            <span>Backend offline — showing default values. Changes won't save until the backend is running.</span>
          </div>
        )}

        {/* ── Scrapers ─────────────────────────────── */}
        <ConfigSection
          title="Scrapers"
          subtitle="Toggle on/off; active scrapers run on every fetch"
          info={SECTION_INFO.scrapers}
        >
          {/* Platform toggles row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px', marginBottom: 24 }}>
            {allPlatforms.map(p => (
              <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Toggle
                  label=""
                  checked={!!config[`${p.key}_enabled`]}
                  onChange={v => setConfig(c => ({ ...c, [`${p.key}_enabled`]: v }))}
                />
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{p.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.flag} · {p.cost}</span>
                {p.custom && (
                  <button
                    onClick={() => removeCustomScraper(p.key)}
                    title="Remove"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: 13, padding: '0 2px', lineHeight: 1,
                    }}
                  >×</button>
                )}
              </div>
            ))}

            {/* Add scraper button inline */}
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', cursor: 'pointer',
                border: '1px dashed var(--border-color)',
                borderRadius: 6, padding: '4px 12px',
                fontSize: 12, color: 'var(--text-muted)',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--blue-600)'
                e.currentTarget.style.color = 'var(--blue-400)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-color)'
                e.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              Add Scraper
            </button>
          </div>

          {/* Results per keyword */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, minWidth: 160 }}>
              Results per keyword
            </span>
            <input
              type="number" min="10" max="1000" step="10"
              className="form-input"
              style={{ width: 80 }}
              value={config.results_per_keyword ?? 25}
              onChange={e => setConfig(c => ({ ...c, results_per_keyword: Math.min(1000, Math.max(1, +e.target.value || 1)) }))}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>results per keyword per run</span>
          </div>

          {/* Keyword editors */}
          <div className="keyword-grid">
            {allPlatforms.filter(p => config[`${p.key}_enabled`]).map(p => (
              <KeywordEditor
                key={p.key}
                label={`${p.label} Keywords`}
                keywords={config[`${p.key}_keywords`] || []}
                onChange={kw => setConfig(c => ({ ...c, [`${p.key}_keywords`]: kw }))}
              />
            ))}
          </div>
          {allPlatforms.every(p => !config[`${p.key}_enabled`]) && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              Enable at least one platform to configure keywords.
            </p>
          )}
        </ConfigSection>

        {/* ── Schedule ────────────────────────────── */}
        <ConfigSection
          title="Schedule"
          subtitle="Automatic scheduling controls"
          info={SECTION_INFO.schedule}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Toggle
              label="Enable daily scheduled run"
              checked={scheduler.enabled}
              onChange={v => setScheduler(s => ({ ...s, enabled: v }))}
            />
            {scheduler.enabled && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Run at (IST)</span>
                <input
                  type="number" min="0" max="23"
                  className="form-input"
                  style={{ width: 70 }}
                  value={scheduler.hour}
                  onChange={e => setScheduler(s => ({ ...s, hour: +e.target.value }))}
                />
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>:</span>
                <input
                  type="number" min="0" max="59"
                  className="form-input"
                  style={{ width: 70 }}
                  value={scheduler.minute}
                  onChange={e => setScheduler(s => ({ ...s, minute: +e.target.value }))}
                />
              </div>
            )}
            {scheduler.next_runs?.present_daily && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Next run: {new Date(scheduler.next_runs.present_daily).toLocaleString()}
              </p>
            )}
          </div>
        </ConfigSection>

        {/* ── Notifications ───────────────────────── */}
        <ConfigSection
          title="Notifications"
          subtitle="Email reports after each pipeline run"
          info={SECTION_INFO.notifications}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Toggle
              label="Enable email reports after each run"
              checked={notify.enabled}
              onChange={v => setNotify(n => ({ ...n, enabled: v }))}
            />
            <div>
              <div className="form-label">Recipients</div>
              {notify.recipients.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {notify.recipients.map(email => (
                    <span key={email} className="tag">
                      {email}
                      <button className="remove" onClick={() => removeEmail(email)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="form-input"
                  placeholder="Add email address…"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addEmail()}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" onClick={addEmail}>Add</button>
              </div>
            </div>
            <div>
              <button className="btn btn-secondary" onClick={sendTestEmail}>
                Send Test Email
              </button>
            </div>
          </div>
        </ConfigSection>

      </div>

      {showAddModal && (
        <AddScraperModal
          onAdd={addCustomScraper}
          onClose={() => setShowAddModal(false)}
        />
      )}

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  )
}

/* ── Config Section with ⓘ info toggle ───── */
function ConfigSection({ title, subtitle, info, children }) {
  const [showInfo, setShowInfo] = useState(false)

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 className="card-title">{title}</h2>
            {info && (
              <button
                onClick={() => setShowInfo(v => !v)}
                title={showInfo ? 'Hide description' : 'What is this?'}
                style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: showInfo ? 'var(--blue-600)' : 'var(--bg-hover)',
                  border: `1px solid ${showInfo ? 'var(--blue-600)' : 'var(--border-color)'}`,
                  color: showInfo ? '#fff' : 'var(--text-muted)',
                  fontSize: 10, fontWeight: 700, lineHeight: '16px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >i</button>
            )}
          </div>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>}
        </div>
      </div>

      {showInfo && (
        <div style={{
          margin: '0 20px 4px',
          padding: '12px 14px',
          background: 'rgba(37,99,235,0.06)',
          border: '1px solid rgba(37,99,235,0.18)',
          borderRadius: 'var(--radius)',
          fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          {info}
        </div>
      )}

      <div style={{ padding: '20px' }}>
        {children}
      </div>
    </div>
  )
}

/* ── Add Scraper Modal ─────────────────────── */
function AddScraperModal({ onAdd, onClose }) {
  const [form, setForm] = useState({
    name: '', type: 'apify', actorId: '', endpoint: '',
    flag: 'US', cost: '', description: '',
  })
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function submit() {
    if (!form.name.trim()) { setError('Scraper name is required.'); return }
    if (form.type === 'apify' && !form.actorId.trim()) { setError('Actor ID is required for Apify scrapers.'); return }
    if ((form.type === 'api' || form.type === 'webhook') && !form.endpoint.trim()) { setError('Endpoint URL is required.'); return }
    onAdd({ ...form, name: form.name.trim() })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: 480,
        padding: 24,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
            Add Custom Scraper
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18 }}
          >×</button>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Add any job scraper — Apify actor, REST API, or webhook endpoint.
          Custom scrapers are saved to config. Backend pipeline support for custom scrapers is coming soon.
        </p>

        <ModalField label="Scraper Name *">
          <input
            className="form-input" style={{ width: '100%' }}
            placeholder="e.g. AngelList Jobs"
            value={form.name}
            onChange={e => set('name', e.target.value)}
          />
        </ModalField>

        <ModalField label="Type *">
          <select
            className="form-select" style={{ width: '100%' }}
            value={form.type}
            onChange={e => set('type', e.target.value)}
          >
            <option value="apify">Apify Actor</option>
            <option value="api">REST API</option>
            <option value="webhook">Webhook</option>
            <option value="custom">Other / Custom</option>
          </select>
        </ModalField>

        {form.type === 'apify' && (
          <ModalField label="Actor ID *" hint="e.g. username/actor-name">
            <input
              className="form-input" style={{ width: '100%' }}
              placeholder="username/actor-name"
              value={form.actorId}
              onChange={e => set('actorId', e.target.value)}
            />
          </ModalField>
        )}

        {(form.type === 'api' || form.type === 'webhook') && (
          <ModalField label="Endpoint URL *">
            <input
              className="form-input" style={{ width: '100%' }}
              placeholder="https://api.example.com/jobs"
              value={form.endpoint}
              onChange={e => set('endpoint', e.target.value)}
            />
          </ModalField>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ModalField label="Region">
            <select
              className="form-select" style={{ width: '100%' }}
              value={form.flag}
              onChange={e => set('flag', e.target.value)}
            >
              <option value="US">US</option>
              <option value="IN">IN</option>
              <option value="UK">UK</option>
              <option value="Global">Global</option>
            </select>
          </ModalField>
          <ModalField label="Cost Estimate" hint="e.g. ~$1/1K">
            <input
              className="form-input" style={{ width: '100%' }}
              placeholder="~$1/1K"
              value={form.cost}
              onChange={e => set('cost', e.target.value)}
            />
          </ModalField>
        </div>

        <ModalField label="Description">
          <textarea
            className="form-input"
            style={{ width: '100%', minHeight: 72, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="What does this scraper do? What job board does it cover?"
            value={form.description}
            onChange={e => set('description', e.target.value)}
          />
        </ModalField>

        {error && <p style={{ margin: 0, fontSize: 12, color: '#f87171' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Add Scraper</button>
        </div>
      </div>
    </div>
  )
}

/* ── Helpers ───────────────────────────────── */
function ModalField({ label, hint, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>
        {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label
      onClick={() => onChange(!checked)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
    >
      <div style={{
        width: 36, height: 20, borderRadius: 10,
        background: checked ? 'var(--blue-600)' : 'var(--border-color)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: 'white', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      {label && <span style={{ fontSize: 13, color: checked ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>}
    </label>
  )
}

function KeywordEditor({ label, keywords, onChange }) {
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  const suggestions = KEYWORD_SUGGESTIONS.filter(s => !keywords.includes(s))

  function add(kw) {
    const k = (kw || input).trim()
    if (!k || keywords.includes(k)) return
    onChange([...keywords, k])
    setInput('')
  }

  function remove(kw) {
    onChange(keywords.filter(k => k !== kw))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span className="form-label" style={{ marginBottom: 0 }}>{label}</span>
        {suggestions.length > 0 && (
          <button
            onClick={() => setShowSuggestions(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--blue-400)',
              padding: 0, textDecoration: 'underline',
            }}
          >
            {showSuggestions ? 'hide suggestions' : `+ ${suggestions.length} suggestions`}
          </button>
        )}
      </div>

      {showSuggestions && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4,
          marginBottom: 8, padding: '8px 10px',
          background: 'rgba(37,99,235,0.05)',
          border: '1px solid rgba(37,99,235,0.15)',
          borderRadius: 6,
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: '100%', marginBottom: 4 }}>
            Click to add:
          </span>
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => add(s)}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)', cursor: 'pointer',
                transition: 'background 0.1s',
              }}
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, minHeight: 32 }}>
        {keywords.map(kw => (
          <span key={kw} className="tag">
            {kw}
            <button className="remove" onClick={() => remove(kw)}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="form-input"
          placeholder="Add keyword…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          style={{ flex: 1 }}
        />
        <button className="btn btn-secondary" onClick={() => add()}>Add</button>
      </div>
    </div>
  )
}
