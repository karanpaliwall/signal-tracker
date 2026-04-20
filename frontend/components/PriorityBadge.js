const PRIORITY_STYLES = {
  high: {
    background: 'rgba(239,68,68,0.12)',
    color: 'var(--red-400)',
  },
  medium: {
    background: 'rgba(245,158,11,0.12)',
    color: 'var(--amber-400)',
  },
  low: {
    background: 'rgba(92,96,128,0.15)',
    color: 'var(--zinc-400)',
  },
}

export default function PriorityBadge({ priority }) {
  const p = (priority || 'low').toLowerCase()
  const style = PRIORITY_STYLES[p] || PRIORITY_STYLES.low
  return (
    <span className="badge" style={{
      ...style,
      fontSize: 11,
      fontWeight: 500,
      padding: '2px 8px',
      borderRadius: 'var(--radius-full)',
      textTransform: 'capitalize',
      display: 'inline-block',
    }}>
      {p}
    </span>
  )
}
