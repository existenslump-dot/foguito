export function trackEvent(
  postId: string,
  eventType: 'view' | 'whatsapp_click' | 'telegram_click' | 'photo_click' | 'favorite',
  photoIndex?: number,
  userId?: string
) {
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: postId, event_type: eventType, photo_index: photoIndex, user_id: userId }),
  }).catch(() => {/* fire and forget */})
}
