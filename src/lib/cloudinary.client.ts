// Client-safe Cloudinary configuration helpers.
//
// Cloud name + unsigned upload preset are public by design (they ship in the
// browser bundle for direct-to-Cloudinary uploads), so they read from
// NEXT_PUBLIC_* env vars. Centralising them here keeps every upload form
// pointing at the same deployment without each component re-reading env.

/** Cloudinary cloud name for the active deployment. */
export const CLOUDINARY_CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD ?? ''

/** Unsigned upload preset used by browser uploads. */
export const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_PRESET ?? ''

/**
 * Build the unsigned upload endpoint for a given resource type.
 *
 * Throws when the cloud name is missing so a misconfigured deployment fails
 * loudly at upload time instead of POSTing to a malformed URL.
 */
export function cloudinaryUploadUrl(resourceType: 'image' | 'video' | 'auto' = 'image'): string {
  if (!CLOUDINARY_CLOUD) {
    throw new Error(
      'NEXT_PUBLIC_CLOUDINARY_CLOUD is not set — configure Cloudinary in your environment to enable uploads.',
    )
  }
  return `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/upload`
}
