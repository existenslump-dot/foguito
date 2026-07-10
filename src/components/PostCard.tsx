'use client'

import { memo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Post } from '@/lib/types/post'
import { postCanonicalPath } from '@/lib/post-url'
import { DISPLAY_LOCALE } from '@/config/marketplace.config'
import { getCloudinaryUrl, getWatermarkedVideoUrl } from '@/lib/cloudinary'
import { isWithinSchedule } from '@/lib/schedule'
import LazyCoverVideo from '@/components/LazyCoverVideo'
import { kycEnabled } from '@/lib/kyc'

const KYC_ON = kycEnabled()

interface Props {
  post: Post
  idx: number
  /** Hide tier/elite badges in the "General" (uncategorized) section. */
  showTierBadge?: boolean
}

function PostCard({ post, idx, showTierBadge = true }: Props) {
  const [mountedAt] = useState(() => Date.now())

  const promoPriceStr = post.is_promoted && post.promo_price
    ? `${Math.round(post.promo_price).toLocaleString('en-US')} USD`
    : null
  const originalPriceStr = post.price_usd
    ? `${Math.round(post.price_usd).toLocaleString('en-US')} USD`
    : `$${post.price?.toLocaleString(DISPLAY_LOCALE) ?? ''}`
  const promoDaysLeft = post.is_promoted && post.promo_ends_at
    ? Math.max(0, Math.ceil((new Date(post.promo_ends_at).getTime() - mountedAt) / 86400000))
    : 0

  const scheduleStatus = isWithinSchedule(post)
  const available = scheduleStatus !== null ? scheduleStatus : true

  const tierLabel = post.tier
    ? post.tier === 'elite'
      ? 'Elite'
      : post.tier.charAt(0).toUpperCase() + post.tier.slice(1)
    : null
  const tierKind = post.tier === 'elite'
    ? 'elite'
    : post.tier === 'silver' || post.tier === 'gold'
      ? post.tier
      : 'bronze'
  const hasVideo = !!(post.video_urls && post.video_urls.length > 0)

  return (
    <Link
      href={postCanonicalPath(post)}
      className={`v-card v-fadein${post.tier === 'elite' ? ' v-elite' : ''}`}
      style={{ animationDelay: `${0.1 + idx * 0.04}s` }}
    >
      <div className="v-card-ph">
        {post.cover_video_url ? (
          <LazyCoverVideo
            src={getWatermarkedVideoUrl(post.cover_video_url)}
            poster={post.image_urls?.[0] ? getCloudinaryUrl(post.image_urls[0], post.tier ?? 'basic') : null}
            className="v-card-media"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : post.image_urls && post.image_urls.length > 0 ? (
          <Image
            src={getCloudinaryUrl(post.image_urls[0], post.tier ?? 'basic')}
            alt={post.title || 'Anuncio VIP'}
            fill
            sizes="(max-width: 768px) 50vw, 33vw"
            className="v-card-media"
          />
        ) : (
          <div className="v-card-placeholder">Private Asset</div>
        )}

        <div className="v-card-gradient" />

        <div className="v-card-ovl-top">
          {promoPriceStr ? <span className="v-card-promo">Promo</span> : <span />}
          {showTierBadge && tierLabel && (
            <span className={`v-card-tier v-card-tier-${tierKind}`}>{tierLabel}</span>
          )}
        </div>

        {hasVideo && (
          <span className="v-card-video">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Video
          </span>
        )}

        <div className="v-card-ovl-bottom">
          <div className="v-card-nm-row">
            <span
              aria-label={available ? 'Disponible' : 'No disponible'}
              className={`v-card-dot ${available ? 'on' : 'off'}`}
            />
            <span className="v-card-nm">{post.title}</span>
            {KYC_ON && post.identity_verified && (
              <span className="v-card-verif" aria-label="Verificado">
                <Image
                  src="/images/verificado.png"
                  alt=""
                  width={14}
                  height={14}
                  className="block"
                />
              </span>
            )}
          </div>
          {post.localidad && (
            <div className="v-card-loc">
              {post.localidad.split(',')[0].trim()}
            </div>
          )}
          <div className="v-card-px-wrap">
            {promoPriceStr ? (
              <>
                <span className="v-card-px">{promoPriceStr}</span>
                <span className="v-card-px-old">{originalPriceStr}</span>
                {promoDaysLeft > 0 && (
                  <span className="v-card-px-days">× {promoDaysLeft}d</span>
                )}
              </>
            ) : (
              <span className="v-card-px">{originalPriceStr}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

export default memo(PostCard)
