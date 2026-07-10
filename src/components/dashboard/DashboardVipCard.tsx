'use client'

import { TIERS } from '@/lib/categories'
import { whatsappUrl, whatsappRenewalMessage, whatsappSupportMessage } from '@/lib/concierge'
import type { Post } from '@/lib/types/post'
import { PAYMENTS_UI_ENABLED } from '@/config/marketplace.config'

interface Props {
  post: Post
}

const TIER_FEATURES: Record<string, string[]> = {
  elite: [
    '18 fotos y 3 videos por publicación',
    'Historias diarias + video de portada',
    'Garantía entre las Primeras 8 de tu ciudad',
  ],
  gold: [
    '15 fotos y 2 videos por publicación',
    'Historias diarias + video de portada',
    'Soporte dedicado con agente asignado',
  ],
  silver: [
    '12 fotos y 1 video por publicación',
    'Historias diarias + pausas sin costo',
    'Soporte prioritario',
  ],
  bronze: [
    '9 fotos por publicación',
    'Historias diarias en el feed de tu ciudad',
    'Edición de fotos y verificación incluidas',
  ],
  basic: [
    '6 fotos por publicación',
    'Edición de fotos integrada',
    'Verificación de identidad incluida',
  ],
}

const TIER_UPGRADE_NEXT: Record<string, string | null> = {
  elite:    null,
  gold:   'Elite',
  silver:   'Gold',
  bronze:   'Silver',
  basic: 'Bronze',
}

const CTA_PRIMARY =
  'w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 bg-[var(--v-accent)] text-[var(--v-bg-base)] rounded-full font-semibold tracking-[.18em] uppercase text-[11.5px] hover:bg-[var(--v-accent-light)] transition-colors no-underline'
const CTA_SEC =
  'w-full inline-flex items-center justify-center gap-2 py-3 px-4 bg-[var(--v-bg-base)] border border-[rgba(37,99,235,0.30)] text-[var(--v-accent)] rounded-full font-medium tracking-[.06em] text-[12px] hover:border-[rgba(37,99,235,0.55)] transition-colors no-underline'
const CTA_FONT = { fontFamily: "'Montserrat',sans-serif" } as const

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export default function DashboardVipCard({ post }: Props) {
  const tier = post.tier ?? 'basic'
  const tierDef = TIERS.find(t => t.id === tier)
  const tierLabel = tierDef?.label ?? 'Basic'
  const features = TIER_FEATURES[tier] ?? TIER_FEATURES.basic
  const nextTier = TIER_UPGRADE_NEXT[tier]

  const referenceDateIso = post.published_at ?? post.created_at
  const effectiveExpiresAt = post.expires_at
    || (referenceDateIso
      ? new Date(new Date(referenceDateIso).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null)
  const daysLeft = effectiveExpiresAt
    ? Math.max(0, Math.ceil((new Date(effectiveExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : 30
  const progressPct = Math.min(100, Math.max(0, ((30 - daysLeft) / 30) * 100))

  const renewUrl   = whatsappUrl(whatsappRenewalMessage({ postTitle: post.title, postId: post.id }))
  const supportUrl = whatsappUrl(whatsappSupportMessage())
  const upgradeUrl = nextTier
    ? whatsappUrl(`Hola, tengo plan ${tierLabel} y quiero pasar a ${nextTier}. ¿Me indican los pasos?`)
    : null

  return (
    <div
      className="relative overflow-hidden"
      style={{
        padding: '22px',
        borderRadius: '14px',
        border: '1px solid rgba(37, 99, 235,0.18)',
        background: 'linear-gradient(140deg, rgba(37, 99, 235,0.16) 0%, rgba(37, 99, 235,0.04) 50%, var(--v-bg-elevated) 100%)',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(60% 60% at 100% 0%, rgba(37, 99, 235,0.18), transparent 60%)' }}
      />

      <div className="relative z-10">
        <div
          className="flex items-center gap-2 text-[11px] font-medium tracking-[.18em] uppercase text-[var(--v-accent)] mb-2"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 17 L5 8 L9 13 L12 4 L15 13 L19 8 L21 17 Z M3 19 H21 V21 H3 Z" />
          </svg>
          Plan actual · {tierLabel}
        </div>

        <div
          className="text-[32px] font-medium text-[var(--v-text-primary)] leading-none mb-3"
          style={{ fontFamily: "'Cormorant Garamond', serif", letterSpacing: '.02em' }}
        >
          {tierLabel}
        </div>

        <div
          className="flex flex-col gap-2 mb-4 pb-4"
          style={{ borderBottom: '1px solid rgba(37, 99, 235,0.08)' }}
        >
          {features.map(feat => (
            <div
              key={feat}
              className="flex items-center gap-2 text-[12.5px] text-[var(--v-text-primary)]"
              style={{ fontFamily: "'Montserrat',sans-serif" }}
            >
              <span className="text-[var(--v-accent)] shrink-0">{CHECK}</span>
              {feat}
            </div>
          ))}
        </div>

        <div className="flex justify-between text-[10px] font-medium tracking-[.10em] uppercase text-[var(--v-text-tertiary)] mb-[7px]">
          <span>Plan vigente</span>
          <span>
            <b className="text-[var(--v-accent-light)] font-medium">{daysLeft}</b> {daysLeft === 1 ? 'día' : 'días'} restantes
          </span>
        </div>
        <div className="h-1 rounded-full bg-[rgba(37,99,235,0.12)] overflow-hidden mb-[18px]">
          <div
            className="h-full rounded-full"
            style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, var(--v-accent), var(--v-accent-light))' }}
          />
        </div>

        {/* Payments is a paid add-on: hide upgrade/renew CTAs when off. */}
        {PAYMENTS_UI_ENABLED && (
        <div className="flex flex-col gap-2">
          {nextTier && upgradeUrl ? (
            <a href={upgradeUrl} target="_blank" rel="noopener noreferrer" className={CTA_PRIMARY} style={CTA_FONT}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12 12 4l7 8M12 4v16" />
              </svg>
              Subir a {nextTier}
            </a>
          ) : supportUrl ? (
            <a href={supportUrl} target="_blank" rel="noopener noreferrer" className={CTA_PRIMARY} style={CTA_FONT}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Escríbenos
            </a>
          ) : null}
          {renewUrl && (
            <a href={renewUrl} target="_blank" rel="noopener noreferrer" className={CTA_SEC} style={CTA_FONT}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 3v6h-6" />
              </svg>
              Renovar plan
            </a>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
