// Session auth resolves on the server — the client only forwards post_id.
// Previously the signatures accepted userId and embedded it in the body,
// which let any caller impersonate another user by choosing the id.

export async function toggleFavorite(
  postId: string,
): Promise<{ favorited: boolean; count: number }> {
  const res = await fetch('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: postId }),
  })
  return res.json()
}

export async function getFavoriteState(
  postId: string,
): Promise<{ count: number; favorited: boolean }> {
  const res = await fetch(`/api/favorites?post_id=${encodeURIComponent(postId)}`)
  return res.json()
}
