import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState, useEffect } from 'react'
import { useStatus } from '../pages/_app'
import LiveLog from './LiveLog'

const NAV = [
  {
    section: 'OVERVIEW',
    items: [
      { href: '/', label: 'Dashboard', icon: <IconDashboard /> },
      { href: '/signals', label: 'Signals Feed', icon: <IconSignal /> },
      { href: '/companies', label: 'Companies', icon: <IconBuilding /> },
    ],
  },
  {
    section: 'MANAGE',
    items: [
      { href: '/sources', label: 'Sources & Config', icon: <IconSources /> },
      { href: '/run-log', label: 'Run Log', icon: <IconLog /> },
    ],
  },
]

export default function Layout({ children }) {
  const router = useRouter()
  const status = useStatus()
  const isRunning = status.live_running || status.weekly_running || status.intelligence_running
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => { setNavOpen(false) }, [router.pathname])

  return (
    <div className="app-layout">
      <div className="mobile-header">
        <button className="hamburger-btn" onClick={() => setNavOpen(v => !v)} aria-label="Toggle navigation">
          <span /><span /><span />
        </button>
        <GrowleadsLogo />
      </div>

      {navOpen && <div className="nav-overlay" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar${navOpen ? ' nav-open' : ''}`}>
        <div className="sidebar-brand">
          <GrowleadsLogo />
          <button className="sidebar-close-btn" onClick={() => setNavOpen(false)} aria-label="Close">×</button>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(group => (
            <div key={group.section}>
              <div className="sidebar-section-label">{group.section}</div>
              {group.items.map(item => {
                const active = router.pathname === item.href
                return (
                  <Link key={item.href} href={item.href} className={`sidebar-item${active ? ' active' : ''}`}>
                    {item.icon}
                    {item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {isRunning && (
          <div className="sidebar-status">
            <span className="dot dot-green" style={{ flexShrink: 0 }} />
            <span className="sidebar-status-text">Pipeline running…</span>
          </div>
        )}
      </aside>

      <main className="main-content">
        {children}
      </main>

      <LiveLog isRunning={isRunning} />
    </div>
  )
}

function GrowleadsLogo() {
  return (
    <img src="/growleads-logo.png" alt="Growleads" style={{ height: 28, objectFit: 'contain' }} />
  )
}

function IconDashboard() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )
}

function IconSignal() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 9h1M14 9h1M9 14h1M14 14h1M12 19v-5"/>
    </svg>
  )
}

function IconSources() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07M8.46 8.46a5 5 0 0 0 0 7.07"/>
    </svg>
  )
}

function IconLog() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}
