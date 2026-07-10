'use client'
import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import { MARKETPLACE } from '@/config/marketplace.config'
import { CONCIERGE_EMAIL, whatsappUrl, whatsappSupportMessage } from '@/lib/concierge'

// Support affordance only — activation is automatic via webhook, so the page
// no longer asks the user to send a receipt anywhere.
const SUPPORT_EMAIL = MARKETPLACE.integrations.concierge.email || CONCIERGE_EMAIL
const SUPPORT_WHATSAPP_URL = whatsappUrl(whatsappSupportMessage())

export default function PagosSuccessPage() {
  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}
        .d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.4s}
        @keyframes lineExpand{from{transform:scaleX(0)}to{transform:scaleX(1)}}
        .v-line{display:block;height:1px;background:linear-gradient(90deg,transparent,var(--v-accent) 40%,var(--v-accent-light) 60%,transparent);transform-origin:left;animation:lineExpand 1.2s cubic-bezier(.22,1,.36,1) .3s forwards;transform:scaleX(0);}
      `}</style>
      <div style={{ minHeight: '100vh', background: 'var(--v-bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ maxWidth: '440px', width: '100%', textAlign: 'center' }}>
          <div className="v-fadein d1" style={{ marginBottom: '32px' }}>
            <MarketplaceWordmark size={26} />
          </div>
          <span className="v-line v-fadein d1" style={{ marginBottom: '32px' }} />
          <div className="v-fadein d2" style={{ marginBottom: '24px' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(100,180,100,0.08)', border: '1px solid rgba(100,180,100,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--v-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h1 style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: 'clamp(24px,4vw,36px)', fontWeight:400, color: 'var(--v-text-primary)', marginBottom: '12px', lineHeight: 1.2 }}>
              Pago recibido
            </h1>
            <p style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--v-success)', marginBottom: '16px' }}>
              Activación automática
            </p>
            <p style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '11px', fontWeight: 400, letterSpacing: '.04em', color: 'var(--v-text-secondary)', lineHeight: 1.8 }}>
              Tu suscripción se activa <b style={{ color: 'var(--v-accent)' }}>automáticamente</b> en tu cuenta apenas se confirma el pago. No necesitás enviar comprobantes.
            </p>
            <p style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '10px', fontWeight: 400, letterSpacing: '.04em', color: 'var(--v-text-tertiary)', lineHeight: 1.8, marginTop: '12px' }}>
              ¿Algo no anduvo bien? {SUPPORT_WHATSAPP_URL ? (
                <>Escribinos por <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--v-accent)', textDecoration: 'underline' }}>WhatsApp</a></>
              ) : (
                <>Escribinos</>
              )}{SUPPORT_EMAIL ? <> o a <b style={{ color: 'var(--v-accent)' }}>{SUPPORT_EMAIL}</b></> : null}.
            </p>
          </div>
          <div className="v-fadein d3">
            <Link
              href="/dashboard"
              style={{ display: 'inline-flex', alignItems: 'center', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-accent)', border: '1px solid rgba(37, 99, 235,0.3)', padding: '12px 28px', borderRadius: '2px', textDecoration: 'none', transition: 'background .3s ease' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(37, 99, 235,0.06)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              Ir al panel
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
