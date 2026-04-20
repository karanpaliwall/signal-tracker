import { useState, useEffect, useRef } from 'react'

export default function LiveLog({ isRunning }) {
  const [lines, setLines] = useState([])
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef(null)
  const [scrolledUp, setScrolledUp] = useState(false)

  useEffect(() => {
    if (!isRunning) return
    setLines([])
    setExpanded(false)
    setScrolledUp(false)
    let cur = 0

    const poll = async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const r = await fetch(`/api/scrape/log?since=${cur}`, { signal: controller.signal })
        clearTimeout(timeout)
        if (!r.ok) return
        const data = await r.json()
        if (data.lines && data.lines.length > 0) {
          setLines(prev => [...prev, ...data.lines])
          cur = data.total
        }
      } catch {}
    }

    poll()
    const iv = setInterval(poll, 800)
    return () => clearInterval(iv)
  }, [isRunning])

  useEffect(() => {
    if (!expanded || !bodyRef.current || scrolledUp) return
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, expanded])

  useEffect(() => {
    if (!isRunning && lines.length > 0) {
      const t = setTimeout(() => { setLines([]) }, 8000)
      return () => clearTimeout(t)
    }
  }, [isRunning, lines.length])

  function handleScroll() {
    const el = bodyRef.current
    if (!el) return
    setScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight >= 40)
  }

  if (lines.length === 0) return null

  return (
    <div className="live-log-bar">
      <div className="live-log-header" onClick={() => setExpanded(e => !e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isRunning && <span className="dot dot-green" />}
          <span style={{ fontWeight: 600, fontSize: 12 }}>
            {isRunning ? 'Live Output' : 'Run Complete'}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{lines.length} lines</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {scrolledUp && expanded && (
            <span
              onClick={e => { e.stopPropagation(); setScrolledUp(false); bodyRef.current.scrollTop = bodyRef.current.scrollHeight }}
              style={{ color: 'var(--blue-400)', fontSize: 11, cursor: 'pointer' }}
            >↓ scroll to bottom</span>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>
            {expanded ? '▼ collapse' : '▲ expand'}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="live-log-body" ref={bodyRef} onScroll={handleScroll}>
          {lines.map((line, i) => (
            <div key={i} className={`log-line log-line-${line.level}`}>
              <span className="log-ts">{line.ts}</span>
              <span className="log-source">[{line.source}]</span>
              <span className="log-msg">{line.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
