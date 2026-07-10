import { describe, expect, it } from 'vitest'

// The cloudinary module captures NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID into
// a module-scoped `const` on first import, so we have to set it BEFORE
// the dynamic import below runs. `vi.stubEnv` inside `beforeAll` would
// fire after the import (top-level await ordering), which leaves the
// module seeing `undefined` and the watermark branch untestable.
const WM_ID = 'marketplace-logo'
const CLOUD = 'test-cloud'
process.env.NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID = WM_ID
// The watermark helpers only transform URLs that live on the configured
// Cloudinary cloud, so the test fixtures below must use the same cloud the
// module reads from MARKETPLACE config (which is env-driven).
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD = CLOUD

const { getCloudinaryUrl, getWatermarkedImageUrl, getWatermarkedVideoUrl } =
  await import('./cloudinary')

const CLOUDINARY = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/posts/abc-123`
const CLOUDINARY_VIDEO = `https://res.cloudinary.com/${CLOUD}/video/upload/v1/posts/abc-123.mp4`

describe('getCloudinaryUrl', () => {
  it('applies unified sizing by default for unknown tiers', () => {
    const url = getCloudinaryUrl(CLOUDINARY, 'totally-bogus-tier')
    expect(url).toContain('w_600,h_970,c_fill,q_85,f_webp')
  })

  it('applies the same crop + quality to every known tier (unified policy)', () => {
    // Resolution differentiation was retired so the brand watermark
    // reads crisp on every card regardless of tier. Tier differentiation
    // now lives in card ordering, badges, and grid size.
    for (const tier of ['elite', 'gold', 'silver', 'bronze', 'basic']) {
      expect(getCloudinaryUrl(CLOUDINARY, tier), `tier=${tier}`).toContain('w_600,h_970,c_fill,q_85')
    }
  })

  it('burns the watermark overlay into every tier (uniform render-time policy)', () => {
    // After the upload-time watermark was retired, render-time is the
    // sole source of branding — every tier's thumbnail carries the mark.
    for (const tier of ['elite', 'gold', 'silver', 'bronze', 'basic']) {
      const url = getCloudinaryUrl(CLOUDINARY, tier)
      expect(url, `tier=${tier}`).toContain(`l_${WM_ID}`)
      expect(url, `tier=${tier}`).toContain('fl_layer_apply')
    }
  })

  it('places the size transform BEFORE the watermark overlay', () => {
    // Order matters — `fl_relative` sizes the overlay against the
    // current base. If the overlay runs first Cloudinary sizes it
    // against the original asset (often 4000×6000), making the
    // watermark comically huge on a 600×970 card.
    const url = getCloudinaryUrl(CLOUDINARY, 'gold')
    const sizeIdx = url.indexOf('w_600,h_970')
    const wmIdx   = url.indexOf(`l_${WM_ID}`)
    expect(sizeIdx).toBeGreaterThan(-1)
    expect(wmIdx).toBeGreaterThan(-1)
    expect(sizeIdx).toBeLessThan(wmIdx)
  })

  it('returns the original URL unchanged when publicId cannot be extracted', () => {
    const foreign = 'https://example.com/not-cloudinary.jpg'
    expect(getCloudinaryUrl(foreign, 'gold')).toBe(foreign)
  })

  it('returns empty string unchanged', () => {
    expect(getCloudinaryUrl('', 'gold')).toBe('')
  })
})

describe('getWatermarkedImageUrl', () => {
  it('injects the overlay into an image URL', () => {
    const out = getWatermarkedImageUrl(CLOUDINARY)
    expect(out).toContain(`l_${WM_ID}`)
    expect(out).toContain('fl_layer_apply')
  })

  it('returns foreign URLs untouched', () => {
    const foreign = 'https://example.com/photo.png'
    expect(getWatermarkedImageUrl(foreign)).toBe(foreign)
  })
})

describe('getWatermarkedVideoUrl', () => {
  it('injects the overlay into a video URL', () => {
    const out = getWatermarkedVideoUrl(CLOUDINARY_VIDEO)
    expect(out).toContain(`l_${WM_ID}`)
    expect(out).toContain('fl_layer_apply')
  })

  it('returns foreign video URLs untouched', () => {
    const foreign = 'https://example.com/clip.mp4'
    expect(getWatermarkedVideoUrl(foreign)).toBe(foreign)
  })
})
