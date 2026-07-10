'use client'

import Link from 'next/link'
import type { Post } from '@/lib/types/post'
import { kycEnabled } from '@/lib/kyc'
import { STORIES_ENABLED } from '@/config/marketplace.config'

interface Props {
  post: Post
  storiesCount?: number
  pausing: boolean
  onStories: () => void
  onPromo: () => void
  onPause: () => void
  onDelete: () => void
}

interface QuickAction {
  id: string
  label: string
  sub: string
  subVariant?: 'gold' | 'warn' | 'mute' | 'danger'
  icon: React.ReactNode
  onClick?: () => void
  href?: string
  danger?: boolean
  disabled?: boolean
  disabledHint?: string
}

const ICON_HISTORIAS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="9" strokeDasharray="3 2.5" />
    <circle cx="12" cy="12" r="4.5" />
  </svg>
)
const ICON_PROMO = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12 12 4l7 8M12 4v16" />
  </svg>
)
const ICON_VERIFY = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
    <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const ICON_STATS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-7" />
  </svg>
)
const ICON_DATOS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2" />
  </svg>
)
const ICON_PAUSE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" />
    <rect x="14" y="5" width="4" height="14" />
  </svg>
)
const ICON_PLAY = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)
const ICON_TRASH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

export default function DashboardQuickActions({ post, storiesCount, pausing, onStories, onPromo, onPause, onDelete }: Props) {
  const isPublished = !!post.is_approved && post.status === 'published'
  const canPause = isPublished && ['silver', 'gold', 'elite'].includes(post.tier ?? '')
  const verifiedState = post.identity_verified
    ? { sub: 'Verificado', variant: 'gold' as const }
    : post.id_document_url
      ? { sub: 'En revisión', variant: 'warn' as const }
      : { sub: 'Pendiente', variant: 'warn' as const }

  const items: QuickAction[] = [
    ...(STORIES_ENABLED
      ? [{
          id: 'stories',
          label: 'Historias',
          sub: storiesCount && storiesCount > 0 ? `${storiesCount} activas` : 'Subir nueva',
          subVariant: storiesCount && storiesCount > 0 ? 'gold' : 'mute',
          icon: ICON_HISTORIAS,
          onClick: onStories,
        } as QuickAction]
      : []),
    {
      id: 'promo',
      label: 'Promoción',
      sub: post.is_promoted ? 'Activa' : 'Destacar',
      subVariant: post.is_promoted ? 'gold' : 'mute',
      icon: ICON_PROMO,
      onClick: onPromo,
      disabled: !isPublished,
      disabledHint: 'Disponible para publicaciones aprobadas',
    },
    ...(kycEnabled()
      ? [{
          id: 'verify',
          label: 'Verificar',
          sub: verifiedState.sub,
          subVariant: verifiedState.variant,
          icon: ICON_VERIFY,
          href: '/dashboard/verify',
        } as QuickAction]
      : []),
    {
      id: 'datos',
      label: 'Datos',
      sub: 'Tu cuenta',
      subVariant: 'mute',
      icon: ICON_DATOS,
      href: '/dashboard/profile',
    },
    {
      id: 'stats',
      label: 'Estadísticas',
      sub: 'Ver detalle',
      subVariant: 'mute',
      icon: ICON_STATS,
      href: `/dashboard/analytics?post_id=${post.id}`,
    },
  ]
  if (canPause) {
    items.push({
      id: 'pause',
      label: post.is_paused ? 'Reanudar' : 'Pausar',
      sub: post.is_paused ? 'Volver al feed' : 'Sin descontar días',
      subVariant: post.is_paused ? 'gold' : 'mute',
      icon: post.is_paused ? ICON_PLAY : ICON_PAUSE,
      onClick: onPause,
      disabled: pausing,
    })
  }
  items.push({
    id: 'delete',
    label: 'Eliminar',
    sub: 'Permanente',
    subVariant: 'danger',
    icon: ICON_TRASH,
    onClick: onDelete,
    danger: true,
  })

  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map(item => {
        const subClass =
          item.subVariant === 'warn'
            ? 'text-[#d4954c]'
            : item.subVariant === 'gold'
              ? 'text-[var(--v-accent)]'
              : item.subVariant === 'danger'
                ? 'text-[var(--v-error)]'
                : 'text-[var(--v-text-tertiary)]'

        const baseCls = `bg-[var(--v-bg-elevated)] border rounded-[10px] pt-3.5 px-2.5 pb-3 flex flex-col items-center gap-2 text-center transition-colors no-underline ${
          item.danger
            ? 'border-[rgba(199,90,90,0.18)] hover:border-[rgba(199,90,90,0.35)] hover:bg-[rgba(199,90,90,0.04)]'
            : 'border-[rgba(37,99,235,0.08)] hover:border-[rgba(37,99,235,0.30)] hover:bg-[rgba(37,99,235,0.04)]'
        } ${item.disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}`

        const iconCls = `w-[38px] h-[38px] rounded-[10px] border flex items-center justify-center ${
          item.danger
            ? 'bg-[rgba(199,90,90,0.08)] border-[rgba(199,90,90,0.22)] text-[var(--v-error)]'
            : 'bg-[rgba(37,99,235,0.08)] border-[rgba(37,99,235,0.18)] text-[var(--v-accent)]'
        }`

        const content = (
          <>
            <span className={iconCls}>{item.icon}</span>
            <div className="leading-tight">
              <div
                className={`text-[12.5px] font-medium ${
                  item.danger ? 'text-[var(--v-error)]' : 'text-[var(--v-text-primary)]'
                }`}
                style={{ fontFamily: "'Cormorant Garamond', serif" }}
              >
                {item.label}
              </div>
              <div
                className={`text-[9.5px] mt-1 ${subClass}`}
                style={{ fontFamily: "'Montserrat',sans-serif" }}
              >
                {item.sub}
              </div>
            </div>
          </>
        )

        return item.href ? (
          <Link key={item.id} href={item.href} className={baseCls} title={item.disabledHint}>
            {content}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.disabledHint}
            className={baseCls}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
