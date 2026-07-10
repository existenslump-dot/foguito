'use client'

import Link from 'next/link'
import Image from 'next/image'
import { TIERS } from '@/lib/categories'
import { getCloudinaryUrl } from '@/lib/cloudinary'
import { postCanonicalPath } from '@/lib/post-url'
import type { Post } from '@/lib/types/post'
import { kycEnabled } from '@/lib/kyc'
import { STORIES_ENABLED, DISPLAY_LOCALE } from '@/config/marketplace.config'

const KYC_ON = kycEnabled()

interface Props {
  post: Post
  onRenew: () => void
  onSubmitDraft: () => void
  onStories: () => void
}

function daysUntil(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

function statusInfo(post: Post, expired: boolean): {
  label: string; color: string; bg: string; border: string
} {
  if (post.status === 'pending')  return { label: 'Pendiente',   color: 'var(--v-accent)',  bg: 'rgba(37, 99, 235,0.12)', border: 'rgba(37, 99, 235,0.32)' }
  if (post.status === 'revision') return { label: 'En revisión', color: 'var(--v-accent)',  bg: 'rgba(37, 99, 235,0.12)', border: 'rgba(37, 99, 235,0.32)' }
  if (post.status === 'draft')    return { label: 'Borrador',    color: 'var(--v-accent)',  bg: 'rgba(37, 99, 235,0.12)', border: 'rgba(37, 99, 235,0.32)' }
  if (post.status === 'rejected') return { label: 'Rechazada',   color: 'var(--v-error)', bg: 'rgba(199,90,90,0.12)',  border: 'rgba(199,90,90,0.32)' }
  if (expired)                    return { label: 'Expirada',    color: 'var(--v-error)', bg: 'rgba(199,90,90,0.12)',  border: 'rgba(199,90,90,0.32)' }
  return { label: 'Publicada', color: 'var(--v-success)', bg: 'rgba(106,176,106,0.12)', border: 'rgba(106,176,106,0.32)' }
}

const QA_BASE =
  'inline-flex items-center justify-center gap-2 py-3.5 px-3 text-[11.5px] font-medium tracking-[.08em] uppercase no-underline bg-[var(--v-bg-card)] hover:bg-[rgba(37,99,235,0.05)] transition-colors'

export default function DashboardHeroCard({ post, onRenew, onSubmitDraft, onStories }: Props) {
  const isPublished = !!post.is_approved && post.status === 'published'
  const isDraft     = post.status === 'draft'
  const isRejected  = post.status === 'rejected'
  const isPending   = post.status === 'pending' || post.status === 'revision'

  const tierDef = TIERS.find(t => t.id === post.tier)
  const tierLabel = tierDef?.label ?? 'Standard'

  const referenceDateIso = post.published_at ?? post.created_at
  const effectiveExpiresAt = post.expires_at
    || (referenceDateIso
      ? new Date(new Date(referenceDateIso).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null)
  const expired = effectiveExpiresAt ? new Date(effectiveExpiresAt).getTime() < Date.now() : false
  const daysLeft = effectiveExpiresAt ? daysUntil(effectiveExpiresAt) : null

  const status = statusInfo(post, expired)

  const profileRaw = post.profile_photo_url ?? post.image_urls?.[0] ?? null
  const coverRaw   = post.image_urls?.[0] ?? post.profile_photo_url ?? null
  const profilePhotoUrl = profileRaw ? getCloudinaryUrl(profileRaw, post.tier ?? 'basic') : null
  const coverPhotoUrl   = coverRaw   ? getCloudinaryUrl(coverRaw,   post.tier ?? 'basic') : null

  const locationParts = (post.localidad || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)

  const publicPath = postCanonicalPath(post)

  const priceText = post.price_usd
    ? `USD ${Number(post.price_usd).toLocaleString('en-US')}`
    : `$${Number(post.price || 0).toLocaleString(DISPLAY_LOCALE)} ${post.currency || ''}`.trim()

  const showRenew = (isPublished && (expired || (daysLeft !== null && daysLeft < 7))) || expired

  return (
    <div
      className="overflow-hidden"
      style={{
        background: 'var(--v-bg-card)',
        border: '1px solid rgba(37, 99, 235,0.18)',
        borderRadius: '14px',
      }}
    >
      <div className="flex items-center gap-3" style={{ padding: '14px 16px 12px' }}>
        {STORIES_ENABLED ? (
          <button
            type="button"
            onClick={onStories}
            title="Gestionar historias"
            aria-label="Gestionar historias"
            className="shrink-0 cursor-pointer"
            style={{
              width: '56px', height: '56px', borderRadius: '50%', padding: '2px', border: 'none',
              background: 'linear-gradient(135deg, var(--v-accent) 0%, var(--v-accent-light) 50%, var(--v-accent) 100%)',
            }}
          >
            <span
              className="block w-full h-full"
              style={{
                borderRadius: '50%',
                border: '2px solid var(--v-bg-card)',
                backgroundColor: 'var(--v-bg-base)',
                backgroundImage: profilePhotoUrl ? `url(${profilePhotoUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center 22%',
              }}
            />
          </button>
        ) : (
          <span
            className="shrink-0 block"
            style={{ width: '56px', height: '56px', borderRadius: '50%', padding: '2px' }}
          >
            <span
              className="block w-full h-full"
              style={{
                borderRadius: '50%',
                border: '2px solid var(--v-bg-card)',
                backgroundColor: 'var(--v-bg-base)',
                backgroundImage: profilePhotoUrl ? `url(${profilePhotoUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center 22%',
              }}
            />
          </span>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate text-[22px] font-medium text-white leading-none"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}
            >
              {post.title}
            </span>
            {KYC_ON && post.identity_verified && (
              <span aria-label="Verificado" title="Perfil verificado" className="inline-flex shrink-0">
                <Image src="/images/verificado.png" alt="" width={15} height={15} className="block" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full text-[9.5px] font-medium tracking-[.14em] uppercase"
              style={{
                background: status.bg,
                border: `1px solid ${status.border}`,
                color: status.color,
                padding: '4px 10px 3px',
                fontFamily: "'Montserrat',sans-serif",
              }}
            >
              <span
                className="rounded-full"
                style={{ width: '5px', height: '5px', background: status.color, boxShadow: `0 0 0 2.5px ${status.bg}` }}
              />
              {status.label}
            </span>
            {daysLeft !== null && !expired && isPublished && (
              <span
                className="text-[10px]"
                style={{
                  fontFamily: "'Montserrat',sans-serif",
                  color: daysLeft < 7 ? 'var(--v-warn, #d4954c)' : 'var(--v-text-tertiary)',
                }}
              >
                Vence en {daysLeft} día{daysLeft !== 1 ? 's' : ''}
              </span>
            )}
            {expired && (
              <span className="text-[10px] text-[var(--v-error)]" style={{ fontFamily: "'Montserrat',sans-serif" }}>
                Expirada hace {Math.abs(daysLeft ?? 0)} día{Math.abs(daysLeft ?? 0) !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="relative w-full" style={{ aspectRatio: '16 / 10' }}>
        {coverPhotoUrl ? (
          <Image
            src={coverPhotoUrl}
            alt={post.title ?? 'Tu publicación'}
            fill
            sizes="(max-width: 768px) 100vw, 800px"
            style={{ objectFit: 'cover', objectPosition: 'center 22%' }}
            priority
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--v-bg-base)' }}>
            <span
              className="text-[10px] tracking-[.24em] uppercase text-[var(--v-text-tertiary)]"
              style={{ fontFamily: "'Montserrat',sans-serif" }}
            >
              Sin foto
            </span>
          </div>
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(8,8,8,0) 55%, rgba(8,8,8,0.62) 100%)' }}
        />
        <span
          className="absolute z-10 uppercase"
          style={{
            top: '12px', right: '12px',
            background: 'var(--v-accent)', color: 'var(--v-bg-base)',
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: '10px', fontWeight: 500, letterSpacing: '.20em',
            padding: '4px 10px 3px', borderRadius: '3px',
          }}
        >
          {tierLabel}
        </span>
        <span
          className="absolute z-10 text-white"
          style={{
            bottom: '12px', left: '14px',
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: '22px', fontWeight: 500,
            textShadow: '0 1px 10px rgba(0,0,0,0.75)',
          }}
        >
          {priceText}
        </span>
      </div>

      {(locationParts.length > 0 || post.category) && (
        <div
          className="flex flex-wrap gap-1.5"
          style={{ padding: '12px 16px', borderBottom: '1px solid rgba(37, 99, 235,0.08)' }}
        >
          {locationParts.map(part => (
            <span
              key={part}
              className="text-[10.5px] text-[var(--v-text-primary)] rounded-full"
              style={{
                background: 'rgba(184,178,168,0.04)',
                border: '1px solid rgba(37, 99, 235,0.08)',
                padding: '4px 10px 3px',
                fontFamily: "'Montserrat',sans-serif",
              }}
            >
              {part}
            </span>
          ))}
          {post.category && (
            <span
              className="text-[10.5px] text-[var(--v-text-primary)] rounded-full capitalize"
              style={{
                background: 'rgba(184,178,168,0.04)',
                border: '1px solid rgba(37, 99, 235,0.08)',
                padding: '4px 10px 3px',
                fontFamily: "'Montserrat',sans-serif",
              }}
            >
              {post.category}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2" style={{ gap: '1px', background: 'rgba(37, 99, 235,0.08)' }}>
        <Link
          href={`/dashboard/edit/${post.id}`}
          className={`${QA_BASE} text-[var(--v-text-primary)] hover:text-[var(--v-accent)]`}
          style={{ fontFamily: "'Montserrat',sans-serif" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M11 4H4v16h16v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Editar
        </Link>
        <Link
          href={publicPath}
          target="_blank"
          rel="noopener noreferrer"
          className={`${QA_BASE} text-[var(--v-accent)] hover:text-[var(--v-accent-light)]`}
          style={{ fontFamily: "'Montserrat',sans-serif" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Vista pública
        </Link>
      </div>

      {showRenew ? (
        <button
          type="button"
          onClick={onRenew}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 bg-[var(--v-accent)] text-[var(--v-bg-base)] font-semibold uppercase tracking-[.14em] text-[12px] hover:bg-[var(--v-accent-light)] transition-colors"
          style={{ fontFamily: "'Montserrat',sans-serif", border: 'none', cursor: 'pointer' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v6h-6" />
          </svg>
          Renovar publicación
        </button>
      ) : isDraft ? (
        <button
          type="button"
          onClick={onSubmitDraft}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 bg-[var(--v-accent)] text-[var(--v-bg-base)] font-semibold uppercase tracking-[.14em] text-[12px] hover:bg-[var(--v-accent-light)] transition-colors"
          style={{ fontFamily: "'Montserrat',sans-serif", border: 'none', cursor: 'pointer' }}
        >
          Enviar a revisión
        </button>
      ) : isRejected ? (
        <Link
          href={`/dashboard/edit/${post.id}`}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 bg-[var(--v-accent)] text-[var(--v-bg-base)] font-semibold uppercase tracking-[.14em] text-[12px] hover:bg-[var(--v-accent-light)] transition-colors no-underline"
          style={{ fontFamily: "'Montserrat',sans-serif" }}
        >
          Corregir y reenviar
        </Link>
      ) : isPending ? (
        <div
          className="w-full text-center py-3.5 text-[10px] tracking-[.18em] uppercase text-[var(--v-text-tertiary)]"
          style={{ fontFamily: "'Montserrat',sans-serif", borderTop: '1px solid rgba(37, 99, 235,0.08)' }}
        >
          Esperando aprobación del equipo
        </div>
      ) : null}

      {isRejected && post.rejection_reason && (
        <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(199,90,90,0.12)', background: 'rgba(199,90,90,0.04)' }}>
          <p
            className="text-[8px] tracking-[.2em] uppercase text-[var(--v-error)] mb-1.5"
            style={{ fontFamily: "'Montserrat',sans-serif" }}
          >
            Motivo del rechazo
          </p>
          <p className="text-[12px] text-[var(--v-text-secondary)] leading-relaxed">
            &ldquo;{post.rejection_reason}&rdquo;
          </p>
        </div>
      )}
    </div>
  )
}
