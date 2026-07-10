'use client'
import { supabase } from '@/lib/supabase/client'
import { useState, useEffect, useRef } from 'react'

interface Message {
  id: string
  message: string
  sender: 'user' | 'admin'
  read: boolean
  created_at: string
}

interface SupportChatProps {
  /** Kept in the API for parity with earlier call sites that scoped chat to
   *  a specific post. The current implementation is global to the user, so
   *  the prop is ignored — leaving it here means re-introducing per-post
   *  scoping later won't break any existing caller. */
  postId?: string
  onClose: () => void
}

export default function SupportChat({ onClose }: SupportChatProps) {
  const [userId, setUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setUserId(user.id)
    }
    init()
  }, [])

  // Fetch messages + poll every 10s
  useEffect(() => {
    if (!userId) return
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('support_chats')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
      if (data) {
        setMessages(data)
        const unreadIds = data.filter(m => m.sender === 'admin' && !m.read).map(m => m.id)
        if (unreadIds.length > 0) {
          await supabase.from('support_chats').update({ read: true }).in('id', unreadIds)
        }
      }
    }
    fetchMessages()
    const interval = setInterval(fetchMessages, 10000)
    return () => clearInterval(interval)
  }, [userId])

  // Auto-scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || !userId || sending) return
    setSending(true)
    const { data } = await supabase.from('support_chats').insert({
      user_id: userId,
      message: input.trim(),
      sender: 'user',
    }).select().single()
    if (data) setMessages(prev => [...prev, data])
    setInput('')
    setSending(false)
  }

  /* Group consecutive messages by same sender */
  const groupedMessages = messages.reduce<{ sender: string; msgs: Message[] }[]>((acc, msg) => {
    const last = acc[acc.length - 1]
    if (last && last.sender === msg.sender) {
      last.msgs.push(msg)
    } else {
      acc.push({ sender: msg.sender, msgs: [msg] })
    }
    return acc
  }, [])

  /* Format time */
  const fmtTime = (d: string) => new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })

  /* Format date separator */
  const fmtDate = (d: string) => {
    const date = new Date(d)
    const today = new Date()
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
    if (date.toDateString() === today.toDateString()) return 'Hoy'
    if (date.toDateString() === yesterday.toDateString()) return 'Ayer'
    return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
  }

  /* Check if we need a date separator */
  const needsDateSep = (curr: Message, prev?: Message) => {
    if (!prev) return true
    return new Date(curr.created_at).toDateString() !== new Date(prev.created_at).toDateString()
  }

  // Support chat is hidden per product request while the WhatsApp flow
  // handles all inbound support. The component still mounts so polling
  // state stays intact for when this flips back on. Wrapper div uses the
  // shared `.support-chat-hidden` utility (declared in <style>) to enforce
  // the visibility off-switch at the DOM level.
  return (
    <>
      <style>{`
        .support-chat-hidden {
          display: none !important;
          visibility: hidden !important;
        }
        .sc-container {
          position: fixed; bottom: 24px; right: 24px; z-index: 500;
          width: 380px; height: 560px;
          background: var(--v-bg-elevated);
          border: 1px solid rgba(37, 99, 235,0.2);
          border-radius: 12px;
          display: flex; flex-direction: column;
          box-shadow: 0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(37, 99, 235,0.05);
          overflow: hidden;
        }
        @media(max-width:480px) {
          .sc-container {
            width: 100vw; height: 100dvh;
            bottom: 0; right: 0; left: 0; top: 0;
            border-radius: 0; border: none;
            max-height: none;
          }
        }

        .sc-header {
          padding: 16px 20px;
          background: linear-gradient(180deg, var(--v-bg-card) 0%, var(--v-bg-elevated) 100%);
          border-bottom: 1px solid rgba(37, 99, 235,0.12);
          display: flex; align-items: center; gap: 12px;
        }
        .sc-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, var(--v-accent) 0%, #8B7A3C 100%);
          display: flex; align-items: center; justify-content: center;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 16px; font-weight: 600; color: var(--v-bg-base);
          flex-shrink: 0;
        }
        .sc-header-info { flex: 1; min-width: 0; }
        .sc-header-name {
          font-family: 'Montserrat', sans-serif; font-size: 12px; font-weight: 500;
          color: #E0DAD0; letter-spacing: 0.04em;
        }
        .sc-header-status {
          font-family: 'Montserrat', sans-serif; font-size: 9px; font-weight:400;
          color: rgba(37, 99, 235,0.7); margin-top: 2px;
          display: flex; align-items: center; gap: 4px;
        }
        .sc-online-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--v-success); display: inline-block;
        }
        .sc-close {
          background: none; border: none; cursor: pointer;
          width: 28px; height: 28px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          color: var(--v-text-tertiary); font-size: 14px;
          transition: background .2s ease, color .2s ease;
        }
        .sc-close:hover { background: rgba(255,255,255,0.06); color: #E0DAD0; }

        .sc-messages {
          flex: 1; overflow-y: auto; padding: 16px 16px 8px;
          display: flex; flex-direction: column; gap: 2px;
        }
        .sc-messages::-webkit-scrollbar { width: 4px; }
        .sc-messages::-webkit-scrollbar-track { background: transparent; }
        .sc-messages::-webkit-scrollbar-thumb { background: rgba(37, 99, 235,0.15); border-radius: 2px; }

        .sc-date-sep {
          text-align: center; padding: 12px 0 8px;
          font-family: 'Montserrat', sans-serif; font-size: 9px; font-weight:400;
          color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase;
        }

        .sc-msg-group { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
        .sc-msg-group.user { align-items: flex-end; }
        .sc-msg-group.admin { align-items: flex-start; }

        .sc-bubble {
          max-width: 75%; padding: 10px 14px;
          font-family: 'Montserrat', sans-serif; font-size: 12px; font-weight:400;
          line-height: 1.5; word-break: break-word;
        }
        .sc-bubble.user {
          background: linear-gradient(135deg, rgba(37, 99, 235,0.18) 0%, rgba(37, 99, 235,0.1) 100%);
          color: #E8DFC8;
          border-radius: 18px 18px 4px 18px;
        }
        .sc-bubble.user.first { border-radius: 18px 18px 4px 18px; }
        .sc-bubble.user.mid   { border-radius: 18px 4px 4px 18px; }
        .sc-bubble.user.last  { border-radius: 18px 4px 18px 18px; }
        .sc-bubble.user.only  { border-radius: 18px 18px 4px 18px; }

        .sc-bubble.admin {
          background: rgba(255,255,255,0.04);
          color: #C8C0B0;
          border-radius: 18px 18px 18px 4px;
        }
        .sc-bubble.admin.first { border-radius: 18px 18px 18px 4px; }
        .sc-bubble.admin.mid   { border-radius: 4px 18px 18px 4px; }
        .sc-bubble.admin.last  { border-radius: 4px 18px 18px 18px; }
        .sc-bubble.admin.only  { border-radius: 18px 18px 18px 4px; }

        .sc-time {
          font-family: 'Montserrat', sans-serif; font-size: 8px; font-weight:400;
          color: rgba(255,255,255,0.2); padding: 2px 6px;
        }

        .sc-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          padding: 40px 32px; text-align: center;
        }
        .sc-empty-icon {
          width: 48px; height: 48px; border-radius: 50%;
          background: rgba(37, 99, 235,0.08);
          border: 1px solid rgba(37, 99, 235,0.15);
          display: flex; align-items: center; justify-content: center;
          font-size: 20px;
        }
        .sc-empty-text {
          font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight:400;
          color: rgba(255,255,255,0.3); line-height: 1.6;
        }

        .sc-input-wrap {
          padding: 12px 16px 14px;
          border-top: 1px solid rgba(255,255,255,0.04);
          background: var(--v-bg-card);
          display: flex; align-items: flex-end; gap: 8px;
        }
        .sc-input {
          flex: 1; background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          padding: 10px 14px; border-radius: 20px; outline: none;
          font-family: 'Montserrat', sans-serif; font-size: 12px; font-weight:400;
          color: #E0DAD0; resize: none; max-height: 100px; min-height: 20px;
          line-height: 1.4;
          transition: border-color .2s ease;
        }
        .sc-input::placeholder { color: rgba(255,255,255,0.15); }
        .sc-input:focus { border-color: rgba(37, 99, 235,0.25); }
        .sc-send {
          width: 36px; height: 36px; border-radius: 50%;
          background: var(--v-accent); color: var(--v-bg-base); border: none;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
          transition: opacity .2s ease, transform .15s ease;
        }
        .sc-send:disabled { opacity: 0.3; cursor: default; }
        .sc-send:not(:disabled):hover { transform: scale(1.05); }
        .sc-send:not(:disabled):active { transform: scale(0.95); }
      `}</style>

      <div className="support-chat-hidden" aria-hidden="true">
      <div className="sc-container">
        {/* Header */}
        <div className="sc-header">
          <div className="sc-avatar">V</div>
          <div className="sc-header-info">
            <div className="sc-header-name">Soporte Marketplace</div>
            <div className="sc-header-status">
              <span className="sc-online-dot" />
              Disponible
            </div>
          </div>
          <button className="sc-close" onClick={onClose}>✕</button>
        </div>

        {/* Messages */}
        <div className="sc-messages">
          {messages.length === 0 ? (
            <div className="sc-empty">
              <div className="sc-empty-icon">💬</div>
              <p className="sc-empty-text">
                Bienvenido al soporte Marketplace.<br />
                Escribe tu mensaje y te responderemos a la brevedad.
              </p>
            </div>
          ) : (
            <>
              {groupedMessages.map((group, gi) => {
                const firstMsg = group.msgs[0]
                const prevMsg = gi > 0 ? groupedMessages[gi - 1].msgs[groupedMessages[gi - 1].msgs.length - 1] : undefined
                const showDate = needsDateSep(firstMsg, prevMsg)
                const lastMsg = group.msgs[group.msgs.length - 1]

                return (
                  <div key={firstMsg.id}>
                    {showDate && (
                      <div className="sc-date-sep">{fmtDate(firstMsg.created_at)}</div>
                    )}
                    <div className={`sc-msg-group ${group.sender}`}>
                      {group.msgs.map((m, mi) => {
                        const pos = group.msgs.length === 1
                          ? 'only'
                          : mi === 0 ? 'first' : mi === group.msgs.length - 1 ? 'last' : 'mid'
                        return (
                          <div key={m.id} className={`sc-bubble ${m.sender} ${pos}`}>
                            {m.message}
                          </div>
                        )
                      })}
                      <div className={`sc-time`} style={{ textAlign: group.sender === 'user' ? 'right' : 'left' }}>
                        {fmtTime(lastMsg.created_at)}
                        {group.sender === 'user' && lastMsg.read && (
                          <span style={{ marginLeft: 4, color: 'rgba(37, 99, 235,0.4)' }}>✓</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
          <div ref={messagesEnd} />
        </div>

        {/* Input */}
        <div className="sc-input-wrap">
          <input
            className="sc-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Escribe un mensaje..."
          />
          <button className="sc-send" onClick={send} disabled={sending || !input.trim()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      </div>
    </>
  )
}
