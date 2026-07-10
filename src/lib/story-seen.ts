const KEY = 'marketplace:seen-story-ids'
const MAX_IDS = 500
const EMPTY = new Set<string>()

let cached: Set<string> | null = null

function readFromStorage(): Set<string> {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

export function subscribeSeenStories(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { cached = readFromStorage(); notify() }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export function getSeenStoryIdsSnapshot(): Set<string> {
  if (typeof window === 'undefined') return EMPTY
  if (cached === null) cached = readFromStorage()
  return cached
}

// Stable server snapshot (useSyncExternalStore requires identity stability).
export function getSeenStoryIdsServerSnapshot(): Set<string> {
  return EMPTY
}

export function markStoriesSeen(ids: string[]): void {
  if (typeof window === 'undefined') return
  const current = getSeenStoryIdsSnapshot()
  const next = new Set(current)
  let changed = false
  for (const id of ids) {
    if (id && !next.has(id)) { next.add(id); changed = true }
  }
  if (!changed) return
  try {
    const arr = [...next]
    const trimmed = arr.length > MAX_IDS ? arr.slice(arr.length - MAX_IDS) : arr
    window.localStorage.setItem(KEY, JSON.stringify(trimmed))
    cached = new Set(trimmed)
    notify()
  } catch {
    cached = next
    notify()
  }
}

export function areAllSeen(ids: string[], seen: Set<string>): boolean {
  if (ids.length === 0) return false
  return ids.every(id => seen.has(id))
}
