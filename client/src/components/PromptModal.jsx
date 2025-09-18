import React, { useEffect, useState } from 'react'

export default function PromptModal({
  open,
  title = 'Rename',
  label = 'Title',
  defaultValue = '',
  placeholder = 'Untitled',
  confirmText = 'Save',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  max = 80,
}) {
  const [val, setVal] = useState(defaultValue)

  useEffect(() => { setVal(defaultValue) }, [defaultValue])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.()
      if (e.key === 'Enter') onConfirm?.(val.trim())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, val, onCancel, onConfirm])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <label className="modal-label">{label}</label>
        <input
          className="modal-input"
          value={val}
          maxLength={max}
          placeholder={placeholder}
          onChange={e=>setVal(e.target.value)}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>{cancelText}</button>
          <button className="btn primary" onClick={()=>onConfirm?.(val.trim())}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}
