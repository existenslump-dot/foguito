'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'

type DialogType = 'alert' | 'confirm' | 'prompt'

type DialogVariant = 'default' | 'danger'

type DialogState = {
  type: DialogType
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  placeholder?: string
  defaultValue?: string
  variant?: DialogVariant
}

type DialogInternal = DialogState & {
  resolve: (value: unknown) => void
}

const FONT = "'Switzer','Inter','Helvetica Neue',Arial,sans-serif"
const LABEL_FONT = "'Montserrat',sans-serif"
const ACCENT = 'var(--v-accent)'
const ACCENT_HOVER = '#3B82F6'
const DANGER = 'var(--v-error)'
const DANGER_HOVER = '#d14545'

export function useMarketplaceDialog(): {
  alert: (message: string, opts?: Partial<DialogState>) => Promise<void>
  confirm: (message: string, opts?: Partial<DialogState>) => Promise<boolean>
  prompt: (message: string, opts?: Partial<DialogState>) => Promise<string | null>
  dialog: ReactNode
} {
  const [state, setState] = useState<DialogInternal | null>(null)
  const [inputValue, setInputValue] = useState('')
  const resolveRef = useRef<((v: unknown) => void) | null>(null)

  const open = useCallback(
    <T,>(type: DialogType, message: string, opts: Partial<DialogState> = {}): Promise<T> =>
      new Promise<T>((resolve) => {
        resolveRef.current = resolve as (v: unknown) => void
        setInputValue(opts.defaultValue ?? '')
        setState({
          type,
          message,
          title: opts.title,
          confirmLabel: opts.confirmLabel,
          cancelLabel: opts.cancelLabel,
          placeholder: opts.placeholder,
          defaultValue: opts.defaultValue,
          variant: opts.variant,
          resolve: resolve as (v: unknown) => void,
        })
      }),
    [],
  )

  const close = useCallback((value: unknown) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setState(null)
    setInputValue('')
  }, [])

  const api = {
    alert: (m: string, o?: Partial<DialogState>) => open<void>('alert', m, o),
    confirm: (m: string, o?: Partial<DialogState>) => open<boolean>('confirm', m, o),
    prompt: (m: string, o?: Partial<DialogState>) => open<string | null>('prompt', m, o),
  }

  const onPrimary = () => {
    if (!state) return
    if (state.type === 'confirm') close(true)
    else if (state.type === 'prompt') close(inputValue.trim() ? inputValue : null)
    else close(undefined)
  }

  const onCancel = () => {
    if (!state) return
    if (state.type === 'confirm') close(false)
    else if (state.type === 'prompt') close(null)
    else close(undefined)
  }

  const dialog: ReactNode = state ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="marketplace-dialog-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(8,8,8,0.78)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        style={{
          background: '#0c0c0c',
          border: '1px solid rgba(37, 99, 235,0.25)',
          borderRadius: '2px',
          maxWidth: '440px', width: '100%',
          padding: '28px 28px 24px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
        }}
      >
        {state.title && (
          <h2
            id="marketplace-dialog-title"
            style={{
              fontFamily: LABEL_FONT, fontSize: '10px', fontWeight: 600,
              letterSpacing: '.28em', textTransform: 'uppercase',
              color: state.variant === 'danger' ? DANGER : ACCENT, marginBottom: '16px',
            }}
          >
            {state.title}
          </h2>
        )}
        <p
          style={{
            fontFamily: FONT, fontSize: '15px', fontWeight: 400,
            color: '#e8e0d0', lineHeight: 1.5, marginBottom: '20px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {state.message}
        </p>

        {state.type === 'prompt' && (
          <input
            autoFocus
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onPrimary()
              if (e.key === 'Escape') onCancel()
            }}
            placeholder={state.placeholder ?? ''}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--v-bg-base)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '2px', padding: '12px 14px', marginBottom: '20px',
              fontFamily: FONT, fontSize: '14px', color: '#e8e0d0',
              outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = ACCENT }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          {state.type !== 'alert' && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                fontFamily: LABEL_FONT, fontSize: '9px', fontWeight: 500,
                letterSpacing: '.22em', textTransform: 'uppercase',
                padding: '10px 22px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '2px',
                color: '#a8a096',
                cursor: 'pointer',
                transition: 'color .2s, border-color .2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#e8e0d0'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#a8a096'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
            >
              {state.cancelLabel ?? 'Cancelar'}
            </button>
          )}
          <button
            type="button"
            autoFocus={state.type !== 'prompt'}
            onClick={onPrimary}
            style={{
              fontFamily: LABEL_FONT, fontSize: '9px', fontWeight: 600,
              letterSpacing: '.22em', textTransform: 'uppercase',
              padding: '10px 22px',
              background: state.variant === 'danger' ? DANGER : ACCENT,
              border: `1px solid ${state.variant === 'danger' ? DANGER : ACCENT}`,
              borderRadius: '2px',
              color: state.variant === 'danger' ? '#fff' : 'var(--v-bg-base)',
              cursor: 'pointer',
              transition: 'background .2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = state.variant === 'danger' ? DANGER_HOVER : ACCENT_HOVER }}
            onMouseLeave={(e) => { e.currentTarget.style.background = state.variant === 'danger' ? DANGER : ACCENT }}
          >
            {state.confirmLabel ?? (state.type === 'alert' ? 'Entendido' : 'Confirmar')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { ...api, dialog }
}
