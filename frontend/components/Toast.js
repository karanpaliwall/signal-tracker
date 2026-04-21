import { useEffect } from 'react'

const isError = msg => /error|fail|failed|invalid|not set|not found|no .* configured|missing|denied|unauthorized/i.test(msg)

export default function Toast({ message, onClose }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [message, onClose])

  if (!message) return null

  const error = isError(message)

  return (
    <div
      className={`toast ${error ? 'toast-error' : 'toast-success'}`}
      onClick={onClose}
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
    >
      <span>{error ? '✕' : '✓'}</span>
      <span>{message}</span>
    </div>
  )
}
