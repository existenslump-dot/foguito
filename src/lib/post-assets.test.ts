// @vitest-environment node
// Guards the deletion-cleanup path: if this helper regresses, we stop
// collecting URLs to wipe and Cloudinary accumulates orphans again.

import { describe, it, expect } from 'vitest'
import { collectPostAssetUrls } from './post-assets'

describe('collectPostAssetUrls', () => {
  it('returns an empty array for null/undefined input', () => {
    expect(collectPostAssetUrls(null)).toEqual([])
    expect(collectPostAssetUrls(undefined)).toEqual([])
  })

  it('returns an empty array for a post with no media fields', () => {
    expect(collectPostAssetUrls({})).toEqual([])
  })

  it('collects URLs from every known field', () => {
    const post = {
      image_urls: ['https://cdn/img1', 'https://cdn/img2'],
      video_urls: ['https://cdn/v1'],
      video_url: 'https://cdn/solo-video',
      audio_url: 'https://cdn/audio',
      cover_video_url: 'https://cdn/cover',
      thumbnail_url: 'https://cdn/thumb',
      id_doc_url: 'https://cdn/id-doc',
    }
    const urls = collectPostAssetUrls(post)
    // 8 unique URLs — order-agnostic check because collectPostAssetUrls
    // doesn't guarantee insertion order (Set.has() dedup changes it).
    expect(urls).toHaveLength(8)
    expect(new Set(urls)).toEqual(new Set([
      'https://cdn/img1', 'https://cdn/img2',
      'https://cdn/v1', 'https://cdn/solo-video',
      'https://cdn/audio', 'https://cdn/cover',
      'https://cdn/thumb', 'https://cdn/id-doc',
    ]))
  })

  it('dedupes URLs that appear in multiple fields', () => {
    // cover images often duplicate between image_urls[0] and thumbnail_url —
    // we don't want cleanup POSTing the same URL twice to Cloudinary.
    const post = {
      image_urls: ['https://cdn/cover-img', 'https://cdn/other'],
      thumbnail_url: 'https://cdn/cover-img',
    }
    const urls = collectPostAssetUrls(post)
    expect(urls).toHaveLength(2)
  })

  it('ignores null / empty / non-string values silently', () => {
    const post = {
      image_urls: ['https://cdn/ok', '', null as unknown as string, 'https://cdn/also'],
      audio_url: null,
      video_url: undefined,
      thumbnail_url: 0 as unknown as string,
    }
    const urls = collectPostAssetUrls(post)
    expect(urls).toEqual(['https://cdn/ok', 'https://cdn/also'])
  })

  it('handles posts where image_urls is not actually an array', () => {
    // Legacy rows / bad migrations can leave wrong types — helper should
    // just skip instead of throwing.
    const post = {
      image_urls: 'not-an-array' as unknown as string[],
      video_url: 'https://cdn/ok',
    }
    expect(collectPostAssetUrls(post)).toEqual(['https://cdn/ok'])
  })
})
