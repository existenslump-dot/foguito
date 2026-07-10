# 🔥 Foguito

Plataforma de suscripción de contenido adulto (modelo tipo OnlyFans, no idéntico) del
ecosistema **NihilVision**. La plataforma **le paga a las creadoras** un revenue-share y es
el merchant of record: el fan compra un servicio a la plataforma, nunca le paga directo a la
creadora. Cara pop de fuego adelante; verificación 18+, 2257, CSAM y AML invisibles atrás.

> **Estado:** bootstrap / planificación. Este repo arranca **clonando Velora+** como base de
> infraestructura (auth, KYC, moderación, 2FA, auditoría, backups, CSP) y le agrega la capa de
> plataforma-de-contenido-con-pago (entitlements, ledger, entrega firmada, age-gate real,
> 2257, CSAM, riel de pagos MoR + payout).

## Documentos

| Doc | Contenido |
|-----|-----------|
| [`docs/PLAN-DE-TRABAJO.md`](docs/PLAN-DE-TRABAJO.md) | Plan de construcción: reuse map Velora+, roadmap por PRs (0→10), datos, servicios a contratar, DoD |
| [`docs/BRAND.md`](docs/BRAND.md) | Design tokens (color, tipografía, reglas de logo, voz, tiers=temperatura) |
| [`docs/ASSETS.md`](docs/ASSETS.md) | Manifiesto de archivos a cargar (logos, favicons, PWA, OG, fuentes) |
| [`.env.example`](.env.example) | Variables de entorno completas, agrupadas por PR |
| `public/brand/*.svg` | Logos master (Foguito primario, app-icon, favicon mono, NihilVision) |

## Pilares NO negociables (requisito #0: seguridad de menores)

1. Verificación 18+ de cada creadora (Didit) — sin verificación no hay publicación.
2. Registros 2257 inmutables por cada performer, vinculados al contenido.
3. Detección de CSAM (vendor establecido) bloqueante **antes** de publicar.
4. Señal "posible menor" → bloqueo + preservación + reporte obligatorio (NCMEC).
5. Age-gate del consumidor por jurisdicción del viewer, verificación real (no checkbox).

Ver el detalle y el orden de construcción en [`docs/PLAN-DE-TRABAJO.md`](docs/PLAN-DE-TRABAJO.md).

## Stack

Next.js 16 (App Router) · React 19 (React Compiler) · Tailwind v4 · Supabase · Vitest ·
deploy en Vercel. Idéntico a Velora+ para reusar su infra probada.

---
*Una propiedad de NihilVision.*
