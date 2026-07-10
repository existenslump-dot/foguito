'use client'
import type { Post } from '@/lib/types/post'
import { postCanonicalPath } from '@/lib/post-url'

interface Props {
  post: Post
  onCopied: () => void
}

const PROD_ORIGIN = 'https://example.com'

const SHARE_TEXT = 'Mirá mi anuncio en Marketplace'

const IconCopy = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
)
const IconWhatsApp = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20Zm4.4-5.6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.6.1l-.7.9c-.1.1-.2.1-.4 0a6.5 6.5 0 0 1-1.9-1.2 7.2 7.2 0 0 1-1.3-1.7c-.1-.2 0-.3.1-.4l.4-.4.2-.4v-.4l-.7-1.7c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11 11 0 0 0 4.3 3.8c2 .8 2 .5 2.4.5a2.5 2.5 0 0 0 1.6-1.1 2 2 0 0 0 .1-1.1c0-.1-.2-.2-.4-.3Z" />
  </svg>
)
const IconTelegram = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M21.9 4.3 2.9 11.6c-.8.3-.8 1.4 0 1.7l4.8 1.6 1.8 5.6c.2.6.9.8 1.4.3l2.6-2.4 4.9 3.6c.5.4 1.3.1 1.4-.5L23 5.1c.2-.7-.4-1.2-1.1-.8ZM9.8 14.2l-.4 4 1.4-2-1-2Zm.9-1.2 7-5.3-9.5 5.5-.1.1.2 1.2 2.4 1.7 8-7.8-7.9 6.6Z" />
  </svg>
)
const IconX = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.9 3H22l-7.6 8.7L23 21h-6.8l-5.3-7-6.1 7H2l8.1-9.3L2 3h7l4.8 6.4L18.9 3Zm-1.2 16h1.7L7.4 4.8H5.6L17.7 19Z" />
  </svg>
)
const IconShare = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
    <path d="M12 3v13M8 7l4-4 4 4" />
  </svg>
)

export default function ShareProfileCard({ post, onCopied }: Props) {
  const origin    = PROD_ORIGIN
  const path      = postCanonicalPath(post)
  const fullUrl   = `${origin}${path}`
  const prettyUrl = `${origin.replace(/^https?:\/\//, '')}${path}`

  const waHref = `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${fullUrl}`)}`
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(fullUrl)}&text=${encodeURIComponent(SHARE_TEXT)}`
  const xHref  = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(fullUrl)}`

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl)
      } else {
        const ta = document.createElement('textarea')
        ta.value = fullUrl
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
    } catch {
    }
    onCopied()
  }

  const nativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Marketplace', text: SHARE_TEXT, url: fullUrl })
      } catch {
      }
    } else {
      copy()
    }
  }

  return (
    <div className="vsp-card">
      <style>{`
        .vsp-card {
          background: var(--v-bg-elevated);
          border: 1px solid rgba(37, 99, 235,0.18);
          border-radius: 10px; padding: 16px 18px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .vsp-lead {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11.5px; color: var(--v-text-tertiary);
          line-height: 1.55; margin: 0;
        }
        .vsp-lead b { color: var(--v-accent-light); font-weight: 600; }
        .vsp-url-row {
          display: flex; align-items: center; gap: 8px;
          background: var(--v-bg-base);
          border: 1px solid rgba(37, 99, 235,0.12);
          border-radius: 8px; padding: 4px 4px 4px 12px;
        }
        .vsp-url {
          flex: 1; min-width: 0;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 12.5px; font-weight: 500; letter-spacing: .01em;
          color: var(--v-accent-light);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .vsp-copy {
          flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 13px; border-radius: 6px;
          border: 1px solid rgba(37, 99, 235,0.30); background: transparent;
          color: var(--v-accent); cursor: pointer;
          font-family: 'Montserrat',sans-serif; font-size: 9px; font-weight: 500;
          letter-spacing: .14em; text-transform: uppercase;
          transition: background .3s ease, border-color .3s ease;
        }
        .vsp-copy:hover { background: rgba(37, 99, 235,0.08); border-color: rgba(37, 99, 235,0.5); }
        .vsp-share-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .vsp-btn {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 11px 4px 9px; border-radius: 8px;
          border: 1px solid rgba(37, 99, 235,0.12); background: transparent;
          color: var(--v-accent); cursor: pointer; text-decoration: none;
          transition: background .3s ease, border-color .3s ease;
        }
        .vsp-btn:hover { background: rgba(37, 99, 235,0.06); border-color: rgba(37, 99, 235,0.30); }
        .vsp-btn span {
          font-family: 'Montserrat',sans-serif; font-size: 8.5px; font-weight: 500;
          letter-spacing: .1em; text-transform: uppercase; color: var(--v-text-tertiary);
        }
      `}</style>

      <p className="vsp-lead">
        Pegá este link en tu bio de <b>Instagram</b>, <b>Telegram</b> y <b>X</b>.
        Cada vez que alguien entra a tu perfil desde tus redes, sumás visibilidad —
        en MARKETPLACE y en los buscadores.
      </p>

      <div className="vsp-url-row">
        <span className="vsp-url" title={fullUrl}>{prettyUrl}</span>
        <button className="vsp-copy" type="button" onClick={copy}>
          {IconCopy} Copiar
        </button>
      </div>

      <div className="vsp-share-row">
        <a className="vsp-btn" href={waHref} target="_blank" rel="noopener noreferrer">
          {IconWhatsApp}<span>WhatsApp</span>
        </a>
        <a className="vsp-btn" href={tgHref} target="_blank" rel="noopener noreferrer">
          {IconTelegram}<span>Telegram</span>
        </a>
        <a className="vsp-btn" href={xHref} target="_blank" rel="noopener noreferrer">
          {IconX}<span>X</span>
        </a>
        <button className="vsp-btn" type="button" onClick={nativeShare}>
          {IconShare}<span>Compartir</span>
        </button>
      </div>
    </div>
  )
}
