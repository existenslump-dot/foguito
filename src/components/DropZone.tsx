'use client'
import { useState, useRef, DragEvent, ChangeEvent } from 'react'

interface DropZoneProps {
  accept?: string
  multiple?: boolean
  label?: string
  hint?: string
  onFiles: (files: File[]) => void
  preview?: string | null       // URL of current preview (image)
  fileName?: string | null      // name of current file (non-image)
  error?: string
  uploading?: boolean
  onRemove?: () => void
  /** If true, shows image preview; if false, shows filename chip */
  isImage?: boolean
  disabled?: boolean
}

export default function DropZone({
  accept = '*/*',
  multiple = false,
  label,
  hint,
  onFiles,
  preview,
  fileName,
  error,
  uploading,
  onRemove,
  isImage = true,
  disabled = false,
}: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [localError, setLocalError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function validateAndDispatch(files: FileList | null) {
    if (!files || files.length === 0) return
    setLocalError('')

    const arr = Array.from(files)

    // Validate MIME type if accept is specified
    if (accept && accept !== '*/*') {
      const allowed = accept.split(',').map(a => a.trim())
      const invalid = arr.find(f => {
        return !allowed.some(a => {
          if (a.startsWith('.')) return f.name.toLowerCase().endsWith(a)
          if (a.endsWith('/*')) return f.type.startsWith(a.slice(0, -1))
          return f.type === a
        })
      })
      if (invalid) {
        setLocalError(`Tipo de archivo no aceptado: ${invalid.name}`)
        return
      }
    }

    onFiles(multiple ? arr : [arr[0]])
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    validateAndDispatch(e.dataTransfer.files)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    validateAndDispatch(e.target.files)
    e.target.value = ''
  }

  const displayError = error || localError

  const hasContent = preview || fileName || uploading

  return (
    <div style={{ width: '100%' }}>
      {label && (
        <label style={{
          display: 'block',
          fontFamily: "'Montserrat', sans-serif",
          fontSize: '9px', fontWeight: 200, letterSpacing: '.22em',
          textTransform: 'uppercase', color: '#767670', marginBottom: '8px',
        }}>
          {label}
        </label>
      )}

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => { if (!disabled) inputRef.current?.click() }}
        onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click() }}
        style={{
          position: 'relative',
          borderRadius: '2px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          overflow: 'hidden',
          transition: 'all .3s ease',
          // Drag state / content state
          background: dragOver
            ? 'rgba(37, 99, 235,0.06)'
            : hasContent && isImage
            ? 'var(--v-bg-elevated)'
            : 'var(--v-bg-elevated)',
          border: dragOver
            ? '1px solid var(--v-accent)'
            : displayError
            ? '1px solid rgba(224,85,85,0.5)'
            : hasContent && isImage
            ? '1px solid rgba(255,255,255,0.06)'
            : '1px dashed rgba(255,255,255,0.1)',
          minHeight: hasContent && isImage && preview ? 'auto' : '100px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {uploading ? (
          <div style={{ padding: '28px', textAlign: 'center' }}>
            <style>{`@keyframes dz-spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ width: '24px', height: '24px', border: '1px solid rgba(37, 99, 235,0.3)', borderTopColor: 'var(--v-accent)', borderRadius: '50%', animation: 'dz-spin 1s linear infinite', margin: '0 auto 10px' }} />
            <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '9px', fontWeight: 200, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--v-accent)' }}>
              Subiendo...
            </p>
          </div>
        ) : isImage && preview ? (
          // Image preview
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Preview"
            style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', display: 'block' }}
          />
        ) : fileName ? (
          // File chip
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="var(--v-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="14 2 14 8 20 8" stroke="var(--v-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '11px', fontWeight: 300, color: '#E0DAD0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName}
            </span>
          </div>
        ) : (
          // Empty state
          <div style={{ padding: '28px 20px', textAlign: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 12px', display: 'block' }}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke={dragOver ? 'var(--v-accent)' : '#666'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="17 8 12 3 7 8" stroke={dragOver ? 'var(--v-accent)' : '#666'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="3" x2="12" y2="15" stroke={dragOver ? 'var(--v-accent)' : '#666'} strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p style={{
              fontFamily: "'Montserrat',sans-serif",
              fontSize: '9px', fontWeight: 200, letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: dragOver ? 'var(--v-accent)' : 'var(--v-text-tertiary)',
              transition: 'color .3s ease',
              marginBottom: hint ? '6px' : '0',
            }}>
              {label ? 'Arrastrá aquí o hacé clic para seleccionar' : 'Arrastrá archivos aquí o hacé clic'}
            </p>
            {hint && (
              <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '9px', fontWeight: 200, letterSpacing: '.04em', color: '#666', fontStyle: 'italic' }}>
                {hint}
              </p>
            )}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />

      {/* Remove button */}
      {onRemove && (preview || fileName) && !uploading && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onRemove() }}
          style={{
            marginTop: '8px',
            fontFamily: "'Montserrat',sans-serif",
            fontSize: '9px', fontWeight: 200, letterSpacing: '.18em', textTransform: 'uppercase',
            color: 'var(--v-error)', background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0,
            transition: 'opacity .3s ease',
          }}
        >
          Quitar archivo
        </button>
      )}

      {/* Error message */}
      {displayError && (
        <p style={{
          fontFamily: "'Montserrat',sans-serif",
          fontSize: '9px', fontWeight: 200, letterSpacing: '.08em',
          color: 'var(--v-error)', marginTop: '8px',
        }}>
          {displayError}
        </p>
      )}
    </div>
  )
}
