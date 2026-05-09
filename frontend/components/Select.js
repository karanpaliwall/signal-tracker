import { useState, useRef, useEffect } from 'react'

export default function Select({ value, onChange, options, placeholder = 'All', defaultValue = '', style, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const hasValue = value !== '' && value !== undefined && value !== null && value !== defaultValue

  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    function onMouse(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(val) {
    onChange(val)
    setOpen(false)
  }

  return (
    <div
      ref={ref}
      className={`cs-wrap${hasValue ? ' cs-active' : ''}${open ? ' cs-open' : ''}${className ? ' ' + className : ''}`}
      style={style}
    >
      <button
        type="button"
        className="cs-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={hasValue ? 'cs-val' : 'cs-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="cs-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="cs-dropdown" role="listbox">
          {options.map(opt => {
            const isSelected = value === opt.value
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`cs-option${isSelected ? ' cs-option-selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); pick(opt.value) }}
              >
                <span className="cs-option-check">
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                {opt.label}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
