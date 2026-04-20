const DEPT_COLORS = {
  Sales: 'var(--blue-400)',
  Engineering: 'var(--green-400)',
  Marketing: 'var(--violet-400)',
  Product: 'var(--amber-400)',
  Operations: 'var(--cyan-400, #22d3ee)',
  Finance: 'var(--orange-400, #fb923c)',
  Other: 'var(--zinc-400)',
}

export default function DeptBar({ breakdown }) {
  if (!breakdown || Object.keys(breakdown).length === 0) return null

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0)
  if (total === 0) return null

  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {entries.map(([dept, count]) => {
        const pct = Math.round((count / total) * 100)
        const color = DEPT_COLORS[dept] || DEPT_COLORS.Other
        return (
          <div key={dept} className="hbar-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>
              {dept}
            </span>
            <div className="hbar-track" style={{
              flex: 1,
              height: 4,
              background: 'var(--bg-hover)',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div className="hbar-fill" style={{
                width: `${pct}%`,
                height: '100%',
                background: color,
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 20, textAlign: 'right', flexShrink: 0 }}>
              {count}
            </span>
          </div>
        )
      })}
    </div>
  )
}
