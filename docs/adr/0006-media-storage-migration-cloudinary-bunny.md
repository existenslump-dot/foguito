# ADR-0006 · Migración de media Cloudinary → Bunny.net (porteo desde velora)

- **Status:** Accepted (planificado — ejecución diferida; ver Consecuencias)
- **Fecha:** 2026-07-16
- **Relacionado:** `velora-plus` ADR-0005 (decisión madre, ejecutada y verificada en vivo),
  velora #441 / `velora-plus` ADR-0004 (media fuera de `/_next/image`), foguito ADR-0001
  (vendors fail-closed), ADR-0005 (money-in / contenido pago).
- **Runbook + aprendizajes:** `docs/MIGRACION-MEDIA-BUNNY.md` (§5 = receta real de replicación).

## Context

Foguito hereda del engine `marketplace-starter` el mismo plano de media pública que velora:
`posts`/perfiles suben a **Cloudinary** (cloud `y9ldddnr`, preset unsigned) y se sirven por
`next/image` con el **optimizador default de Vercel** (`images.remotePatterns` →
`/_next/image`). Dos problemas de AUP encadenados:

1. **Cloudinary** prohíbe contenido adulto → riesgo de baja de cuenta.
2. **Vercel** prohíbe media sexualmente explícita en su infra → el plano público la
   descarga/cachea en `/_next/image` (la misma exposición que velora cerró con #441).

⚠️ Distinción clave: el **contenido PAGO** de foguito (`content.media_ref`) **ya está fuera de
Cloudinary** — bucket privado Supabase `creator-content` + entrega gateada
(`/api/content/[id]/media`, RLS del fan) + watermark **sharp por-fan**. Esta migración **no lo
toca**; su alcance es el **plano legacy público**.

## Decision

Portar el modelo de velora (ADR-0005), reusando sus artefactos fail-closed:

1. **Registro `media_assets`** (keys opacas, master privado + derivados públicos, estados
   `quarantine→approved|rejected|expired`, procedencia `legacy_url` para reversibilidad).
2. **Cuarentena física:** `foguito-masters` (privada, sin Pull Zone) + `foguito-public` (detrás
   del CDN). Nada se sirve sin `approveAsset`.
3. **Watermark de marca horneado** en el derivado público con sharp (Bunny no hace overlays
   render-time). El watermark **por-fan del contenido pago no cambia** (es in-flight, agnóstico
   del storage).
4. **Host por env** `NEXT_PUBLIC_MEDIA_CDN_HOST=cdn.foguito.com` (config-driven, como el resto de
   la marca).
5. **Dos planos, dos políticas de token:** zona pública **sin** Token Auth (SEO/OG/ISR/loader
   client-side); si el contenido pago migrara a Bunny, zona **con** Token Auth + `signBunnyUrl` +
   mint por request (nunca URLs cachables para lo pago).
6. **Upload fail-closed** (`upload.server.ts` + rutas), inerte sin env de Bunny — compatible con
   ADR-0001. Video por **TUS de Bunny Stream** (bytes fuera de Vercel). **CSAM gate primero**:
   `media_assets.status` se suma a `content.csam_status` (ADR-0003), no lo reemplaza.

**Orden de ejecución (secuencia por PRs, igual que velora):**
- **Paso 0 (independiente, ejecutable YA):** portar el custom loader `image-loader.ts` de velora
  #441 + guard ESLint → cierra la exposición `/_next/image` sin esperar a Bunny.
- **PR-A** fundaciones (registro + resolve + provider + backfill) → **PR-B** upload fail-closed →
  **PR-C** cutover (`--rewrite-urls`, reversible por `legacy_url`) → **cierre** (cancelar
  Cloudinary + drop de columnas legacy tras 48 h).

## Consequences

- **Ejecución diferida a propósito:** conviene esperar a que velora complete su **PR-C (cutover)**
  y absorber los aprendizajes; el runbook de velora se corrige con lo que aparezca en el cutover
  real. El **paso 0 (loader)** no espera — es la mitigación AUP urgente de Vercel.
- `sharp` pasará a dependencia de **producción** (runtime de `approveAsset`).
- Reversibilidad: el cutover reescribe columnas de URL con `legacy_url` guardado → deshacer es un
  UPDATE; Cloudinary se cancela recién en el cierre, con backup previo.
- Las keys/DDL siguen el patrón de foguito: env `Production + Sensitive`, DDL manual con PAT
  temporal que se **revoca**, archivo de migración con la versión exacta del ledger.

## Alternativas descartadas

- **Quedarse en Cloudinary + `/_next/image`:** doble violación de AUP (Cloudinary + Vercel).
- **Migrar también el contenido pago ahora:** innecesario — ya está fuera de Cloudinary; moverlo a
  Bunny es decisión futura de costo/escala, no de compliance.
- **Token Auth en la zona pública:** rompe SEO de imágenes / OG / ISR (ver ADR-0005 §4 de velora).
- **Ejecutar en paralelo a velora sin esperar el cutover:** se pierde el aprendizaje del cutover
  real; solo el paso 0 justifica adelantarse.
