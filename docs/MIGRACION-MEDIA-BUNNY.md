# Porteo del modelo de media Cloudinary → Bunny (desde velora-plus)

- **Estado:** planificación — el modelo se construyó y validó primero en velora-plus.
- **Fuente de verdad del diseño:** `velora-plus/docs/media/migracion-cloudinary-bunny.md`
  (plan revisado + runbook + registro de decisiones). Este doc solo mapea los **deltas**
  de foguito. Leé aquel primero.
- **Artefactos porteables tal cual** (PR-A de velora, 2026-07-14):
  `src/lib/media/resolve.ts` (+tests), `src/lib/media/resolve.server.ts` (firma token),
  `src/lib/media/providers/bunny.ts` (+tests), la migración `media_assets_registry` y
  el guard de ESLint. Todo fail-closed sin env vars — compatible con la política de
  vendors inertes de foguito (ADR-0001).

---

## 1. Hallazgo clave de la auditoría (2026-07-14): dos planos, urgencias distintas

| Plano | Estado hoy | ¿Bloqueado por Cloudinary? |
|---|---|---|
| **Contenido pago** (`content.media_ref`) | **YA está fuera de Cloudinary**: bucket privado Supabase `creator-content` (deny-all), entrega gateada por `/api/content/[id]/media` (RLS del fan + re-check), imagen con watermark **sharp por-fan** streameada `no-store`, video/audio por signed URL de 60 s | **No.** La migración no lo toca. Mover masters/entrega a Bunny es una decisión de **costo/escala futura**, no de compliance |
| **Plano legacy del engine** (`posts.image_urls` etc., fotos de perfil, feed público) | Cloudinary unsigned (cloud `y9ldddnr`) + render-time watermark + **`next/image` con el optimizador DEFAULT de Vercel** (`remotePatterns: res.cloudinary.com` en `next.config.ts`) | **Sí, doble**: AUP de Cloudinary (almacenamiento) **y** AUP de Vercel (los píxeles adultos públicos pasan y se cachean en `/_next/image` — el problema que velora cerró con su ADR-0004/#441) |

⚠️ **Lo más urgente de foguito NO es Bunny: es que el plano público sigue pasando por
`/_next/image`.** Eso se arregla portando el custom loader de velora (paso 0), sin
esperar a la migración de storage.

## 2. Orden de porteo propuesto

### Paso 0 — cortar `/_next/image` (independiente de Bunny, portable YA)
Port del #441 de velora: `src/lib/media/image-loader.ts` + `images.loader:'custom'` +
eliminación de `images.remotePatterns` + guard de ESLint. Los helpers de
`src/lib/cloudinary.ts` ya son idénticos a los de velora (mismo engine) — mover a
`src/lib/media/` como allá.

### Paso 1 — fundaciones Bunny (copiar PR-A de velora)
- Migración `media_assets` (idéntica; en foguito conviven con `content` — son planos
  distintos: `media_assets` cubre el plano legacy/público y cualquier master propio).
- `resolve.ts` / `resolve.server.ts` / `providers/bunny.ts` — copiar; cambiar solo el
  default del host (`NEXT_PUBLIC_MEDIA_CDN_HOST=cdn.foguito.com`) vía
  `marketplace.config.ts` (config-driven, como el resto del branding).
- Backfill `scripts/migrate-cloudinary.ts` — las columnas fuente del engine son las
  mismas (`image_urls`/`video_urls`/`video_url`/`audio_url`/`cover_video_url`/
  `thumbnail_url` — ver `src/lib/post-assets.ts`).

### Paso 2 — deltas propios de foguito

1. **Token auth ON** en una Pull Zone SEPARADA si algún día el contenido pago se sirve
   desde Bunny: `signBunnyUrl` (ya implementado) + TTL corto, mintado por request en
   `/api/content/[id]/media` — el mismo gate actual, cambiando `createSignedUrl` de
   Supabase por la firma Bunny. El plano público usa otra zona SIN token (mismas
   razones que velora: OG/SEO/caching).
2. **El modelo puro keys-en-DB aplica al contenido pago** (ya es así: `media_ref` es
   un path, no una URL). El plano público puede usar el híbrido de velora
   (URL canónica reescrita + registro) — o directamente keys, dado que foguito tiene
   menos superficie SEO que velora.
3. **Watermark:** el per-fan de contenido pago (sharp, `content-watermark.server.ts`)
   **no cambia** — es in-flight, agnóstico del storage. El watermark de MARCA del
   plano público se hornea en derivados como en velora (el render-time de Cloudinary
   muere con la migración).
4. **Video:** Bunny Stream con watermark a nivel de library + **TUS presigned**
   (`streamTusUploadAuth`, ya en el provider) — en foguito los bytes explícitos NO
   deben transitar Vercel ni siquiera en el upload (a diferencia de velora, donde el
   proxy multipart por API route se aceptó para imágenes comprimidas). Para
   imágenes pagas el upload ya va por `POST /api/content` (server-authoritative,
   validación + sniffing) — evaluar si su volumen justifica moverlo a un camino
   direct-to-storage con intent firmado.
5. **CSAM gate primero, siempre:** en cualquier promoción `quarantine → approved` del
   plano Bunny, el orden es el del PR-4: hash-match ANTES de que nada llegue a la zona
   pública. `media_assets.status` no reemplaza `content.csam_status` — se suman
   (el trigger `content_publish_guard` sigue siendo la autoridad del plano pago).
6. **Retirar `/api/media/signed-url`** (Cloudinary firmado por tier): está muerto —
   nadie lo llama; opera sobre `posts` con `getSignedUrl`/`getWatermarkedUrl` de
   `cloudinary.server.ts`. Eliminarlo en el cutover en vez de portarlo.
7. **Env vars:** mismas `BUNNY_*` que velora (ver su `.env.example`), en la matriz de
   foguito: todas **Production + Sensitive** salvo `NEXT_PUBLIC_MEDIA_CDN_HOST`
   (Prod+Preview+Dev, no secreta). `BUNNY_CDN_TOKEN_KEY` solo si se activa la zona
   firmada del contenido pago.

## 3. Qué NO portar

- El cron/backup de velora clasifica `media_assets` en SU manifest — foguito tiene su
  propio esquema de backups (no portado, ver CLAUDE.md de velora vs foguito).
- La decisión "token OFF" es del plano PÚBLICO. No relajar jamás la entrega del
  contenido pago a URLs sin firmar/cachables.
- El `--rewrite-urls` del backfill solo tiene sentido para el plano legacy público.

## 4. Secuencia recomendada (cuando se ejecute)

1. Paso 0 (loader — cierra la exposición AUP de Vercel hoy mismo).
2. Esperar a que velora complete su cutover (PR-C/PR-D) y absorber los aprendizajes
   (el runbook de velora se corrige con lo que aparezca en la ejecución real).
3. Pasos 1–2 con la misma estructura de PRs (fundaciones → upload → cutover → cierre),
   reusando la cuenta de Bunny con zonas propias (`foguito-masters`/`foguito-public`,
   pull zone `cdn.foguito.com`).
