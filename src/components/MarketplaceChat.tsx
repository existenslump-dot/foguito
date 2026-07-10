'use client'
import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { CATEGORY_PLURAL_SET } from '@/lib/post-url'

function isPostDetailPath(pathname: string): boolean {
  if (pathname.includes('/post/')) return true
  const segs = pathname.split('/').filter(Boolean)
  return segs.length >= 2 && CATEGORY_PLURAL_SET.has(segs[segs.length - 2])
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const INITIAL: Message = {
  role: 'assistant',
  content: 'Hola, soy el asistente de Marketplace. ¿En qué puedo ayudarte hoy?',
}

const label: React.CSSProperties = {
  fontFamily: "'Montserrat',sans-serif", fontWeight: 200,
  letterSpacing: '.18em', textTransform: 'uppercase',
}

export default function MarketplaceChat() {
  const pathname = usePathname()
  const [open,     setOpen]     = useState(false)
  const [messages, setMessages] = useState<Message[]>([INITIAL])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try { localStorage.removeItem('marketplace-chat-pos') } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  if (pathname === '/' || isPostDetailPath(pathname)) return null

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setLoading(true)

    setMessages(m => [...m, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      const contentType = res.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        // FAQ hit — set answer immediately
        const data = await res.json()
        setMessages(m => {
          const copy = [...m]
          copy[copy.length - 1] = { role: 'assistant', content: data.answer || data.error || '' }
          return copy
        })
      } else {
        // Streaming response from Anthropic
        if (!res.body) throw new Error('No response body')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let acc = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          acc += decoder.decode(value, { stream: true })
          const final = acc
          setMessages(m => {
            const copy = [...m]
            copy[copy.length - 1] = { role: 'assistant', content: final }
            return copy
          })
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages(m => {
        const copy = [...m]
        copy[copy.length - 1] = { role: 'assistant', content: `__error__${msg}` }
        return copy
      })
    }

    setLoading(false)
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      <style>{`
        @keyframes vc-dot { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
        .vc-dot { width:6px;height:6px;border-radius:50%;background:var(--v-accent);display:inline-block;animation:vc-dot 1.2s ease-in-out infinite; }
        .vc-dot:nth-child(2){animation-delay:.2s}
        .vc-dot:nth-child(3){animation-delay:.4s}
        .vc-msg { white-space:pre-wrap; word-break:break-word; }
        .vc-input { resize:none; outline:none; border:none; background:transparent; color:var(--v-text-primary); width:100%; }
        .vc-input::placeholder { color:var(--v-text-tertiary); }
        .vc-send-btn:hover { border-color:rgba(var(--brand-primary-rgb),0.8) !important; }
        .vc-fab:hover { box-shadow:0 0 0 3px rgba(37, 99, 235,0.2) !important; }
      `}</style>

      <div
        style={{
          position: 'fixed',
          bottom: '24px', right: '24px',
          zIndex: 60, userSelect: 'none',
        }}
      >
        <button
          className="vc-fab"
          onClick={() => setOpen(o => !o)}
          style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'var(--v-bg-card)', border: '1px solid rgba(var(--brand-primary-rgb),0.6)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 0 2px rgba(var(--brand-primary-rgb),0.1)',
            transition: 'box-shadow .25s ease',
            padding: 0,
          }}
          aria-label="Abrir chat"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--v-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      </div>

      {open && (
        <div style={{
          position: 'fixed', bottom: '90px', right: '24px', zIndex: 50,
          width: '340px', height: '480px',
          background: 'var(--v-bg-card)', border: '1px solid rgba(var(--brand-primary-rgb),0.2)',
          borderRadius: '2px', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--v-shadow-elevated)',
        }}>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderBottom: '1px solid var(--v-border)',
            flexShrink: 0,
          }}>
            <span style={{ ...label, fontSize: '10px', color: 'var(--v-accent-strong)' }}>
              MARKETPLACE ASISTENTE
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--v-text-tertiary)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px' }}
            >
              ✕
            </button>
          </div>

          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px', display: 'flex',
            flexDirection: 'column', gap: '12px',
          }}>
            {messages.map((m, i) => {
              const isError = m.content.startsWith('__error__')
              const text    = isError ? m.content.slice(9) : m.content
              return (
                <div
                  key={i}
                  style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}
                >
                  <div
                    className="vc-msg"
                    style={{
                      maxWidth: '82%', padding: '10px 14px', borderRadius: '2px',
                      fontFamily: "'Montserrat',sans-serif", fontSize: '11px', fontWeight: 200, lineHeight: 1.7,
                      ...(isError
                        ? { background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: 'var(--v-error)' }
                        : m.role === 'user'
                        ? { background: 'var(--v-accent)', border: '1px solid var(--v-accent)', color: 'var(--v-text-inverse)' }
                        : { background: 'var(--v-bg-elevated)', border: '1px solid var(--v-border)', color: 'var(--v-text-secondary)' }),
                    }}
                  >
                    {text || (loading && i === messages.length - 1 ? null : '')}
                    {m.content === '' && loading && i === messages.length - 1 && (
                      <span style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '16px' }}>
                        <span className="vc-dot" />
                        <span className="vc-dot" />
                        <span className="vc-dot" />
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <div style={{
            borderTop: '1px solid var(--v-border)',
            padding: '10px 12px',
            display: 'flex', alignItems: 'flex-end', gap: '8px',
            flexShrink: 0,
          }}>
            <textarea
              ref={textareaRef}
              className="vc-input"
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Escribe un mensaje…"
              style={{
                fontFamily: "'Montserrat',sans-serif", fontSize: '11px', fontWeight: 200,
                lineHeight: 1.5, maxHeight: '88px', overflowY: 'auto',
              }}
            />
            <button
              className="vc-send-btn"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                flexShrink: 0, width: '32px', height: '32px', borderRadius: '2px',
                background: 'transparent',
                border: `1px solid ${loading || !input.trim() ? 'var(--v-border)' : 'rgba(var(--brand-primary-rgb),0.4)'}`,
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color .2s ease', padding: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2 8L14 2L8 14L7 9L2 8Z"
                  fill={loading || !input.trim() ? 'var(--v-text-disabled)' : 'var(--v-accent)'} />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
