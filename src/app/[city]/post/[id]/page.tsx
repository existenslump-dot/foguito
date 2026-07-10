import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import PostDetailView from '@/components/post/PostDetailView'
import { isReservedSlug } from '@/lib/reserved-slugs'

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string; city: string }>
}) {
  const { id, city } = await params

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  if (!isUUID) {
    if (!isReservedSlug(id)) {
      permanentRedirect(`/${id}`)
    }
    return <PostDetailView id={id} countrySlug={city.toLowerCase()} />
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data: post } = await supabase
    .from('posts')
    .select('post_slug')
    .eq('id', id)
    .maybeSingle<{ post_slug: string | null }>()
  if (post?.post_slug && !isReservedSlug(post.post_slug)) {
    permanentRedirect(`/${post.post_slug}`)
  }
  return <PostDetailView id={id} countrySlug={city.toLowerCase()} />
}
