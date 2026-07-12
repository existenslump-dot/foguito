// @vitest-environment node
/**
 * Guard de postura de secretos / CSP (PR-10, criterio de aceptación: "secretos fuera
 * del código/CSP").
 *
 * Lee `next.config.ts` como TEXTO y asegura que:
 *   1. Ningún nombre de env SECRETO aparece interpolado en la config/CSP.
 *   2. Toda referencia `process.env.X` es NEXT_PUBLIC_* o un nombre no-secreto
 *      (nada que matchee SECRET / *_KEY / TOKEN / PASSWORD / SERVICE_ROLE / PRIVATE).
 *   3. Ningún nombre `NEXT_PUBLIC_*` (en config ni en .env.example) contiene
 *      SECRET / SERVICE_ROLE / PRIVATE — esas vars van al bundle del browser.
 *
 * Si este test encuentra un problema real, la corrección es sacar el secreto de la
 * config — NO debilitar el test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONFIG = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8')
const ENV_EXAMPLE = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8')

/** Secretos concretos que NUNCA deben interpolarse en next.config.ts / la CSP. */
const FORBIDDEN_SECRET_NAMES = [
  'SANCTIONS_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'TRAVEL_RULE_API_KEY',
  'BACKUP_ENCRYPTION_KEY',
  'NOWPAYMENTS_IPN_SECRET',
  'PAYOUT_API_KEY',
  'PAYOUT_WEBHOOK_SECRET',
  'DIDIT_API_KEY',
  'DIDIT_WEBHOOK_SECRET',
  'CLOUDINARY_API_SECRET',
  'TURNSTILE_SECRET',
  'UPSTASH_REDIS_REST_TOKEN',
  'RESEND_API_KEY',
  'ADMIN_SECRET',
  'SENTRY_AUTH_TOKEN',
]

/** Un nombre de env "parece secreto" si matchea esto (y no es NEXT_PUBLIC_*). */
const SECRET_LOOKING = /(SECRET|_KEY$|_KEY_|TOKEN|PASSWORD|SERVICE_ROLE|PRIVATE)/

describe('security/no-secrets — next.config.ts', () => {
  it('no interpola ningún secreto conocido', () => {
    for (const name of FORBIDDEN_SECRET_NAMES) {
      expect(CONFIG, `next.config.ts no debe referenciar ${name}`).not.toContain(name)
    }
  })

  it('la CSP vive en next.config.ts (tripwire de cobertura del guard)', () => {
    // Este guard escanea next.config.ts. Si la CSP/headers se mudan a
    // src/middleware.ts (u otro lado), este assert rompe → hay que ampliar el
    // scope del scan antes de que un secreto se cuele fuera del alcance del test.
    expect(CONFIG, 'la CSP debe seguir en next.config.ts o ampliá el scan de este guard').toContain(
      'Content-Security-Policy',
    )
  })

  it('toda referencia process.env.X es pública o no-secreta', () => {
    const refs = [...CONFIG.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])
    // Sanidad: hay al menos una referencia (si no, el regex se rompió).
    expect(refs.length).toBeGreaterThan(0)
    for (const name of new Set(refs)) {
      if (name.startsWith('NEXT_PUBLIC_')) {
        expect(name, `${name} es público — no debe contener SECRET/SERVICE_ROLE/PRIVATE`).not.toMatch(
          /(SECRET|SERVICE_ROLE|PRIVATE)/,
        )
        continue
      }
      expect(name, `${name} en next.config.ts parece un secreto`).not.toMatch(SECRET_LOOKING)
    }
  })
})

describe('security/no-secrets — NEXT_PUBLIC_* naming', () => {
  it('ningún NEXT_PUBLIC_* en .env.example esconde un secreto en el nombre', () => {
    const publicNames = [...ENV_EXAMPLE.matchAll(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
    expect(publicNames.length).toBeGreaterThan(0)
    for (const name of publicNames) {
      expect(name, `${name} es NEXT_PUBLIC (va al browser) — no debe contener SECRET/SERVICE_ROLE/PRIVATE`).not.toMatch(
        /(SECRET|SERVICE_ROLE|PRIVATE)/,
      )
    }
  })
})
