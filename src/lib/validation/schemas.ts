import { z } from 'zod'

/**
 * Zod schemas for API route input validation.
 *
 * Every POST/PATCH route that accepts a JSON body should parse the body
 * through one of these before trusting it. The pattern:
 *
 *   const parsed = SomeSchema.safeParse(await req.json())
 *   if (!parsed.success) {
 *     return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
 *   }
 *   const body = parsed.data
 *
 * Keep schemas narrow — only the fields we actually read. Extra fields the
 * client sends are stripped (default zod behavior with .strict() disabled).
 *
 * Import types via `z.infer<typeof Schema>` to stay in sync when schemas
 * evolve — avoids drift between validator and route handler.
 */

// ── Shared primitives ──────────────────────────────────────────────────

/** UUID — Supabase row ids. Accepts the v4 format Supabase generates. */
export const Uuid = z.string().uuid('Invalid UUID')

/** Email — trimmed + lowercased so downstream compares don't need to care. */
export const Email = z.string().trim().toLowerCase().email('Email inválido')

/** Free-form short text (rejection reason, report description, etc.). */
export const ShortText = z.string().trim().min(1, 'Texto requerido').max(500)

// ── /api/pagos/crypto ──────────────────────────────────────────────────

/**
 * Known tier package_ids. Rejecting anything else prevents attackers from
 * crafting NOWPayments orders with arbitrary descriptions or non-existent
 * tiers that would confuse our bookkeeping.
 */
export const PackageId = z.enum([
  'tier_premium',
  'tier_plus',
  'tier_pro',
  'tier_max',
  // 15-day variants (same tiers, shorter subscription — see src/lib/packages.ts)
  'tier_premium_15d',
  'tier_plus_15d',
  'tier_pro_15d',
  'tier_max_15d',
])

/** Currencies NOWPayments supports + we accept. */
export const CryptoCurrency = z.enum([
  'usdttrc20', 'usdterc20', 'btc', 'eth', 'ltc',
]).default('usdttrc20')

export const CryptoPaymentSchema = z.object({
  package_id:   PackageId,
  payer_email:  Email.optional(),
  user_id:      Uuid.optional(),
  currency:     CryptoCurrency.optional(),
  // Self-serve renewal: post to extend when this payment activates. The
  // route verifies session ownership; activation re-checks it atomically.
  renew_post_id: Uuid.optional(),
}).refine(
  data => data.payer_email || data.user_id,
  { message: 'Se requiere payer_email o user_id' },
)

// ── /api/pagos/mp/crear-preferencia ────────────────────────────────────

/**
 * MP preference creation only needs the package_id (server looks up
 * pricing from src/lib/packages.ts) and optional payer_email. Any other
 * amount-y fields the old client used to send are ignored — see
 * /api/pagos/mp/crear-preferencia for the fraud context.
 *
 * Elite runs through a different endpoint (elite-nowpayments) so we allow
 * all 5 package ids here for tolerance, but in practice MP only sees
 * the four non-Elite tiers today.
 */
export const MpPreferencePackageId = z.enum([
  'tier_premium',
  'tier_plus',
  'tier_pro',
  'tier_max',
  'tier_elite',
  // 15-day variants (same tiers, shorter subscription)
  'tier_premium_15d',
  'tier_plus_15d',
  'tier_pro_15d',
  'tier_max_15d',
  'tier_elite_15d',
  // Smoke-test SKU. The crear-preferencia route admin-gates this id
  // separately so a regular user can't actually generate the
  // preference even though Zod accepts it. Keep the schema and the
  // catalogue in src/lib/packages.ts in sync.
  'tier_test',
])

export const MpPreferenceSchema = z.object({
  package_id:  MpPreferencePackageId,
  payer_email: Email.optional().nullable(),
  // Self-serve renewal target (see CryptoPaymentSchema).
  renew_post_id: Uuid.optional(),
})

// ── /api/posts/boost ───────────────────────────────────────────────────

/**
 * Boost purchase: post to boost + a client-generated idempotency key (one
 * per modal open). Cost/duration are NOT accepted from the body — the route
 * prices from MARKETPLACE.billing.boost, and the buyer comes from the
 * session (requireUser), mirroring the package-checkout fraud posture.
 */
export const BoostPurchaseSchema = z.object({
  post_id: Uuid,
  idempotency_key: Uuid,
})

// ── /api/payments/elite-nowpayments ────────────────────────────────────

export const ElitePaymentSchema = z.object({
  email: Email,
  // Which Elite package is being bought (monthly vs 15-day). Optional for
  // backwards compatibility — the route defaults to the monthly package.
  package_id: z.enum(['tier_elite', 'tier_elite_15d']).optional(),
  // Self-serve renewal target (see CryptoPaymentSchema).
  renew_post_id: Uuid.optional(),
})

// ── /api/admin/approve-post ────────────────────────────────────────────

export const AdminApprovePostSchema = z.object({
  postId: Uuid,
})

// ── /api/admin/renew-post ──────────────────────────────────────────────

/**
 * Admin post renewal: adds `days` to expires_at (strict — does not forgive
 * already-expired days). The accepted values (7/15/30) match the admin UI
 * presets.
 */
export const AdminRenewPostSchema = z.object({
  postId: Uuid,
  days:   z.union([z.literal(7), z.literal(15), z.literal(30)]),
})

// ── /api/admin/tier-settings ───────────────────────────────────────────

/**
 * Known tier slugs — mirrors TIERS in src/lib/categories.ts. Hardcoded here
 * so the API rejects typos without a round-trip to the DB.
 */
export const TierSlug = z.enum(['elite', 'gold', 'silver', 'bronze', 'basic'])

export const AdminTierSettingsSchema = z.object({
  tier_slug: TierSlug,
  is_active: z.boolean(),
})

// ── /api/pagos/mp/procesar-pago ────────────────────────────────────────

export const MpProcessPaymentSchema = z.object({
  package_id:          PackageId,
  payer_email:         Email.optional(),
  user_id:             Uuid.optional(),
  // MP Brick's card token — 32+ char string in practice.
  token:               z.string().min(20, 'Token MP inválido'),
  payment_method_id:   z.string().min(1, 'payment_method_id requerido'),
  issuer_id:           z.string().optional(),
  transaction_amount:  z.number().positive(),
  installments:        z.number().int().positive(),
  payer: z.object({
    email:          Email.optional(),
    identification: z.object({
      type:   z.string(),
      number: z.string(),
    }).optional(),
  }).optional(),
}).refine(
  data => data.payer_email || data.user_id || data.payer?.email,
  { message: 'Se requiere un email de pagador' },
)

// ── /api/report ────────────────────────────────────────────────────────

export const ReportCategory = z.enum([
  'spam',
  'estafa',
  'contenido_inapropiado',
  'contenido_prohibido',
  'otro',
])

export const ReportSchema = z.object({
  post_id:     Uuid,
  category:    ReportCategory,
  description: ShortText.optional(),
})

// ── /api/content/[id]/report ───────────────────────────────────────────

/**
 * Complaint intake sobre una pieza de contenido de creadora (PR-9). El
 * `content_id` NO viene del body — sale del path param (validado como UUID en la
 * ruta). Idem el reporter (id/IP): salen de la sesión/headers server-side, nunca
 * del cliente. Sólo la categoría + una descripción opcional acotada.
 */
export const ContentReportCategory = z.enum([
  'illegal',
  'dmca',
  'nonconsensual',
  'csam_suspected',
  'spam',
  'other',
])

export const ContentReportSchema = z.object({
  category:    ContentReportCategory,
  description: z.string().trim().max(2000).optional(),
})

// ── /api/auth/gate ─────────────────────────────────────────────────────

/**
 * Pre-flight brute-force gate for login/registro. The client posts the
 * intended action + the normalized email; the route applies a per-IP+email
 * rate limit so a single account can't be hammered past our threshold even
 * from rotating IPs. See src/app/api/auth/gate/route.ts.
 */
export const AuthGateSchema = z.object({
  action: z.enum(['login', 'register']),
  email:  Email,
})

// ── /api/auth/check-availability ───────────────────────────────────────

/**
 * Pre-signup availability check. Called by /registro before Supabase
 * signUp to tell the user (before the captcha dance) whether the email
 * or phone is already taken. The server returns a unified `available`
 * boolean — never which field collided — so the endpoint can't be used
 * to enumerate registered emails or phones separately.
 *
 * Phone accepts E.164-ish shape (+ plus, digits) and a bounded length
 * so malformed inputs bounce at validation rather than hitting the DB.
 */
export const AuthCheckAvailabilitySchema = z.object({
  email: Email,
  phone: z.string().trim().regex(/^\+[1-9]\d{6,19}$/, 'Teléfono inválido'),
})

// ── /api/auth/finalize-signup ──────────────────────────────────────────

/**
 * Persist explicit consent declarations + IP audit trail post-signup
 * (PR-C). Called by /registro after successful Supabase signUp, and by
 * /dashboard/verify before KYC upload.
 *
 * The route extracts the IP server-side from the request headers — the
 * client never sees or sends its own IP, so the field can't be spoofed.
 * Booleans here are explicit user clicks; absence (false) is recorded as
 * "no timestamp", presence (true) writes `NOW()`.
 *
 * `context` lets the same endpoint serve two flows: `signup` writes the
 * missing universal timestamps (idempotent — first time only), `verify`
 * records the KYC submission IP.
 */
export const FinalizeSignupSchema = z.object({
  context: z.enum(['signup', 'verify']),
  terms_accepted:   z.boolean(),
  privacy_accepted: z.boolean(),
})

// ── /api/contact ───────────────────────────────────────────────────────

export const ContactSchema = z.object({
  nombre:       z.string().trim().min(1).max(100),
  correo:       Email.optional(),
  email:        Email.optional(),
  asunto:       z.string().trim().max(200).optional(),
  mensaje:      z.string().trim().min(5).max(5000),
  captchaToken: z.string().min(1).optional(),
}).refine(
  data => data.correo || data.email,
  { message: 'Se requiere un email de contacto' },
)

// ── Helper: turn a ZodError into a single-message 400 payload ──────────

/**
 * Standard validation error response. Surfaces the first issue so the
 * client shows a specific message instead of a generic "invalid request".
 */
export function validationError(
  error: z.ZodError,
): { error: string; issues: Array<{ path: string; message: string }> } {
  return {
    error: error.issues[0]?.message ?? 'Datos inválidos',
    issues: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  }
}
