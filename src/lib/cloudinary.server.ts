import 'server-only'
import { v2 as cloudinary } from 'cloudinary'

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD ?? ''

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
})

export function getSignedUrl(publicId: string, expiresInSeconds = 3600): string {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
  return cloudinary.url(publicId, {
    sign_url: true,
    type: 'authenticated',
    expires_at: expiresAt,
    secure: true,
  })
}

/**
 * Extract public_id + resource_type from a Cloudinary secure URL.
 * Example URL: https://res.cloudinary.com/<cloud>/image/upload/v123456/folder/name.jpg
 *              → { publicId: 'folder/name', resourceType: 'image' }
 * Returns null for any URL that isn't on our own cloud so the callers
 * can't be weaponised against arbitrary tenants.
 */
export function parseCloudinaryUrl(
  url: string,
): { publicId: string; resourceType: 'image' | 'video' | 'raw' } | null {
  try {
    const u = new URL(url)
    if (u.hostname !== 'res.cloudinary.com') return null
    const cloudName = CLOUD_NAME
    const parts = u.pathname.split('/').filter(Boolean)
    // parts: [cloud, resource_type, upload, v<version>?, ...pathSegments, filename.ext]
    if (parts[0] !== cloudName) return null
    const resourceType = parts[1] as 'image' | 'video' | 'raw'
    if (!['image', 'video', 'raw'].includes(resourceType)) return null
    // Drop `cloud / resource_type / upload`, then the optional `v123456`.
    let rest = parts.slice(3)
    if (rest[0]?.match(/^v\d+$/)) rest = rest.slice(1)
    if (rest.length === 0) return null
    // Strip the file extension from the last segment.
    const last = rest[rest.length - 1].replace(/\.[^.]+$/, '')
    const publicId = [...rest.slice(0, -1), last].join('/')
    return { publicId, resourceType }
  } catch {
    return null
  }
}

/**
 * Best-effort destruction of a batch of assets. Used by both the public
 * cleanup route (post-upload rollback) and server-only flows like account
 * deletion (which can't bounce through fetch). Failures are collected, not
 * thrown — a single orphan shouldn't abort the wider deletion transaction.
 */
export async function destroyCloudinaryAssets(
  urls: string[],
): Promise<{ deleted: number; failed: string[] }> {
  let deleted = 0
  const failed: string[] = []

  await Promise.all(
    urls.map(async (url) => {
      const parsed = parseCloudinaryUrl(url)
      if (!parsed) {
        failed.push(url)
        return
      }
      try {
        const res = await cloudinary.uploader.destroy(parsed.publicId, {
          resource_type: parsed.resourceType,
          invalidate: true,
        })
        if (res.result === 'ok' || res.result === 'not_found') deleted++
        else failed.push(url)
      } catch (err) {
        console.error('[cloudinary] destroy failed:', url, err)
        failed.push(url)
      }
    }),
  )

  return { deleted, failed }
}

export function getWatermarkedUrl(publicId: string, username: string, expiresInSeconds = 3600): string {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
  return cloudinary.url(publicId, {
    sign_url: true,
    type: 'authenticated',
    expires_at: expiresAt,
    secure: true,
    transformation: [
      {
        overlay: {
          font_family: 'Arial',
          font_size: 24,
          font_weight: 'bold',
          text: `MARKETPLACE+ | ${username}`,
        },
        color: '#FFFFFF',
        opacity: 30,
        gravity: 'south_east',
        x: 20,
        y: 20,
      },
    ],
  })
}
