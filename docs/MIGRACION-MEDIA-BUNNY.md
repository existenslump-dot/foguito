# Porteo del modelo de media Cloudinary → Bunny (desde velora-plus)

- **Estado:** planificación — el modelo se construyó, **ejecutó y verificó en vivo** en
  velora-plus (infra + backfill de 166 assets + PR-A/PR-B mergeados). Los aprendizajes
  reales de esa ejecución están en §5 (receta mecánica de replicación).
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

## 5. Aprendizajes de la ejecución REAL en velora (2026-07-15/16)

La migración se ejecutó de punta a punta en velora (PR-A fundaciones + PR-B upload, ambos
mergeados; infra Bunny viva; 166 assets migrados y verificados). Esto es lo que funcionó y los
gotchas — para que en foguito sea casi mecánico. **Diseño de referencia + runbook detallado:
`velora-plus/docs/media/migracion-cloudinary-bunny.md`; decisión: `velora-plus` ADR-0005.**

### 5.1 Consola de Bunny (Fase 0) — lo que funcionó
- 2 Storage Zones, **misma región** (São Paulo BR para LATAM), **sin réplicas** (el banner que
  las recomienda es upsell — cero tráfico no justifica el costo; **no se pueden quitar después**).
- `masters` **sin Pull Zone conectada** = privacidad (inalcanzable por CDN). `public` es el origen
  de la Pull Zone.
- Pull Zone → **Token Auth OFF** para el plano público (en foguito el plano PAGO sí firma, zona
  aparte). **Optimizer ON** (~$9.5/mes por zona, habilita `?width=&quality=`). Hotlink protection
  por Referer (incluir `*.vercel.app` para previews) — **NO** activar "Block direct URL file
  access" (bloquea Referer vacío = mata OG scrapers + Googlebot Images).
- Hostname custom: CNAME en Cloudflare **DNS only (gris)** → `<zona>.b-cdn.net`, después **Load
  Free Certificate** + Force SSL en Bunny. Verificado: `curl -sI https://cdn.…/test.txt` → 200
  `server: BunnyCDN`.
- **Pricing zones:** habilitar SA + NA + EU (lo barato $0.01 absorbe el ruteo de Googlebot/OG que
  vienen de US/EU; Asia/MEA off). Con solo SA, TODO —incl. crawlers— se factura a $0.045.
- ⚠️ **Trial:** cargar crédito/billing **antes del cutover** o la zona se suspende al vencer.

### 5.2 Env vars — gotchas que costaron tiempo
- `BUNNY_STORAGE_HOST` va **SIN `https://`** (p. ej. `br.storage.bunnycdn.com`) — el provider ya
  antepone el scheme; con `https://` arma `https://https://…` y falla todo.
- La AccessKey de cada zona = **FTP & API Access → Password** (la principal, no la read-only).
- **`BUNNY_API_KEY` (cuenta) ≠ la API key de la Video Library ≠ las passwords de zona.** Son tres
  cosas distintas.
- Sacar cualquier `NODE_TLS_REJECT_UNAUTHORIZED=0` del `.env.local` (desactiva verificación TLS;
  no hace falta — Cloudinary/Bunny/Supabase tienen certs públicos válidos).
- **Nunca** pegar las keys en el chat/PR — van directo al `.env.local` (gitignoreado) y a Vercel
  (Sensitive). En velora una key de zona se expuso y hubo que **resetearla**.

### 5.3 Backfill — cómo se corrió
- Corre **local**, no en Vercel (bytes adultos fuera de Vercel + sharp/ffmpeg a mano).
- El script + `sharp` + `tsx` viven en la **rama del PR**, no en `main` → se corrió con un **git
  worktree** en carpeta aparte fuera de OneDrive (`git worktree add -b … C:\foguito-mig origin/<rama>`),
  con copia propia de `.env.local`. **Dejar el worktree hasta después del cutover** (lo usa
  `--rewrite-urls`).
- Cargar env con el flag nativo **`npx tsx --env-file=.env.local scripts/…`** (NO `dotenv-cli`,
  que no es dep → "could not determine executable to run").
- Orden: **dry-run** (default, no escribe) → `--execute --limit 5` (test real, ahí entra sharp) →
  corrida completa. Idempotente por `sha256`/`legacy_url`; **jamás borra**.
- **Refs muertas (404 de Cloudinary):** en velora aparecieron 22 (originales pre-watermark
  borrados tras re-subir; la URL vieja quedó en el array). El script las reporta y sale con
  error ("no cuadra") — **es esperado**, no un bug. Se limpian por SQL **conservando solo las
  URLs migradas** (`where u in (select legacy_url from media_assets)`), preservando orden. Hacerlo
  ANTES del cutover o el `--rewrite-urls` deja esas filas trabadas.
- Owner de assets sin dueño UUID (p. ej. covers de blog con `user_id` null): `--default-owner
  <uuid-admin>`.

### 5.4 Verificación que se hizo en vivo (checklist replicable)
- `main.webp`/`square.webp` → 200 `image/webp` por el CDN, con watermark horneado.
- `?width=200` devuelve una imagen mucho más chica → **Optimizer activo**.
- El **master** (`original.jpg`) → **404** por el CDN → **cuarentena física OK** (vive solo en la
  zona privada).
- SQL de consistencia: **0** URLs de `res.cloudinary.com` que no estén en `media_assets.legacy_url`
  → el cutover reescribe sin filas trabadas.

### 5.5 Migración `media_assets` aplicada por MCP
- Se aplicó a prod vía MCP `apply_migration`; el ledger le puso su propio timestamp
  (`20260715231620`). **El archivo del repo debe renombrarse a esa versión exacta** para que un
  futuro `db push` no vea drift. En foguito el DDL se aplica manual (PAT temporal que se revoca) —
  mismo criterio: el archivo espejo lleva la versión del ledger.

### 5.6 PR-B (upload) — cómo quedó, prod-safe
- Maquinaria server **fail-closed e inerte**: `derive.server.ts` (sharp: main+watermark, square
  trim+attention), `upload.server.ts` (`uploadMaster`→masters+quarantine idempotente,
  `approveAsset`→hornea derivados→public, `rejectAsset`→conserva master), rutas
  `/api/media/upload` (intake) + `/api/admin/media/[id]` (preview cuarentena). **Sin env de Bunny
  → 503; sin cablear a cliente/moderación → nada lo invoca.** Se mergeó a prod sin romper nada.
- **`sharp` pasa a dependencia de PRODUCCIÓN** (runtime de `approveAsset`).
- Vitest necesita aliasar **`server-only`** a un stub vacío para testear los `*.server.ts`.
- ⚠️ El PNG de watermark en runtime de Vercel: `public/images/…` **no** está garantizado en el
  bundle de la función → al cablear `approveAsset` a prod, forzar con `outputFileTracingIncludes`
  o subir el logo a Bunny. Mientras, `loadBrandWatermark()` es fail-soft (hornea sin marca).

### 5.7 Deltas específicos de foguito (recordatorio)
- El **contenido pago** ya está fuera de Cloudinary (bucket Supabase + watermark sharp por fan) →
  la migración NO lo toca. Lo urgente es el **plano legacy público** (`posts`), que aún pasa por
  `/_next/image` (AUP) → el **paso 0** (portar el custom loader `image-loader.ts` de velora #441)
  es ejecutable YA, sin esperar a Bunny.
- Si algún día el pago se sirve desde Bunny: zona **con Token Auth** + `signBunnyUrl` (ya existe),
  mint por request en `/api/content/[id]/media`. Zona pública aparte, sin token.
- **CSAM gate primero** en toda promoción `quarantine→approved`; `media_assets.status` se **suma**
  a `content.csam_status`, no lo reemplaza.
- Video/upload explícito por **TUS de Bunny Stream** (bytes fuera de Vercel, más estricto que
  velora que aceptó el proxy multipart para imágenes comprimidas).
