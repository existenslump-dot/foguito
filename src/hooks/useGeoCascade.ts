'use client'

/**
 * Cascading geo selector state — country → provincia → comuna → barrio.
 *
 * Replaces the hardcoded `ARGENTINA_CIUDADES / PROVINCIAS / LOCALIDADES`
 * arrays from `src/lib/locations.ts`. Lists come from the DB tables seeded
 * in the geo schema migrations; setting a level auto-fetches children and
 * clears deeper selections.
 *
 * Usage:
 *   const geo = useGeoCascade({
 *     countrySlug: 'argentina',
 *     initial: { provinciaId, comunaId, barrioId },
 *   })
 *   geo.provincias  // loaded list
 *   geo.setProvinciaId(id)  // clears comuna + barrio, triggers comuna fetch
 *   geo.labels.comuna       // name for legacy `posts.localidad` concat
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Provincia, Comuna, Barrio } from '@/lib/geo'
import { fetchProvincias, fetchComunas, fetchBarrios } from '@/lib/geo'
import { COUNTRY_SLUG } from '@/config/marketplace.config'

type Initial = {
  provinciaId?: string | null
  comunaId?:    string | null
  barrioId?:    string | null
}

/**
 * Wrap a geo fetch in a single retry with a 200 ms backoff and log both
 * failures. In v14 QA the edit page's province/comuna dropdowns landed
 * empty after 3+ consecutive direct-PATCH saves — the SDK's in-memory
 * JWT had aged past expiry, the first `.select()` returned 0 rows, and
 * the picker sat permanently blank until a hard refresh. 200 ms gives
 * refreshSession() (fired from handleUpdate) time to land a fresh
 * access_token before we retry. Bounded to one attempt so a genuinely-
 * down network surfaces instead of turning into a retry storm, and so
 * the user's first meaningful interaction isn't delayed more than half
 * a second.
 */
async function retryOnce<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try { return await fn() } catch (err) {
    console.warn(`[useGeoCascade] ${label} failed, retrying in 200ms:`, err)
    await new Promise(r => setTimeout(r, 200))
    try { return await fn() } catch (err2) {
      console.error(`[useGeoCascade] ${label} retry also failed:`, err2)
      return null
    }
  }
}

export function useGeoCascade({
  countrySlug = COUNTRY_SLUG,
  initial,
}: {
  countrySlug?: string
  initial?: Initial
}) {
  const [countryId,    setCountryId]    = useState<string | null>(null)
  const [provincias,   setProvincias]   = useState<Provincia[]>([])
  const [comunas,      setComunas]      = useState<Comuna[]>([])
  const [barrios,      setBarrios]      = useState<Barrio[]>([])
  const [provinciaId,  setProvinciaIdRaw] = useState<string | null>(initial?.provinciaId ?? null)
  const [comunaId,     setComunaIdRaw]    = useState<string | null>(initial?.comunaId ?? null)
  const [barrioId,     setBarrioIdRaw]    = useState<string | null>(initial?.barrioId ?? null)

  // Fetch countryId + provincias when countrySlug changes (usually once).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const country = await retryOnce(
        async () => (await supabase
          .from('countries').select('id').eq('slug', countrySlug).eq('active', true).maybeSingle()
        ).data,
        'fetch country',
      )
      if (cancelled || !country?.id) return
      setCountryId(country.id)
      const list = await retryOnce(() => fetchProvincias(supabase, country.id), 'fetchProvincias')
      if (!cancelled) setProvincias(list ?? [])
    })()
    return () => { cancelled = true }
  }, [countrySlug])

  // Fetch comunas when provinciaId changes. Clearing the list when the
  // parent goes null is a legitimate external-state sync — the Compiler
  // can't tell the difference from a cascade loop so we silence it.
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!provinciaId) { setComunas([]); return }
    ;(async () => {
      const list = await retryOnce(() => fetchComunas(supabase, provinciaId), 'fetchComunas')
      if (!cancelled) setComunas(list ?? [])
    })()
    return () => { cancelled = true }
  }, [provinciaId])

  // Fetch barrios when comunaId changes. Same reset-on-null pattern.
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!comunaId) { setBarrios([]); return }
    ;(async () => {
      const list = await retryOnce(() => fetchBarrios(supabase, comunaId), 'fetchBarrios')
      if (!cancelled) setBarrios(list ?? [])
    })()
    return () => { cancelled = true }
  }, [comunaId])

  // Setters that cascade-reset deeper levels.
  const setProvinciaId = (id: string | null) => {
    setProvinciaIdRaw(id)
    setComunaIdRaw(null)
    setBarrioIdRaw(null)
  }
  const setComunaId = (id: string | null) => {
    setComunaIdRaw(id)
    setBarrioIdRaw(null)
  }
  const setBarrioId = (id: string | null) => {
    setBarrioIdRaw(id)
  }

  /** Set all three FK IDs at once (no cascade reset) — used when
   *  prefilling from an async-loaded record like a post edit form. */
  const prefill = (p?: Initial) => {
    setProvinciaIdRaw(p?.provinciaId ?? null)
    setComunaIdRaw(p?.comunaId ?? null)
    setBarrioIdRaw(p?.barrioId ?? null)
  }

  // Human-readable labels for legacy `posts.localidad` concat.
  const labels = {
    provincia: provincias.find(p => p.id === provinciaId)?.name,
    comuna:    comunas.find(c => c.id === comunaId)?.name,
    barrio:    barrios.find(b => b.id === barrioId)?.name,
  }

  return {
    countryId,
    provincias, comunas, barrios,
    provinciaId, comunaId, barrioId,
    setProvinciaId, setComunaId, setBarrioId,
    prefill,
    labels,
  }
}
