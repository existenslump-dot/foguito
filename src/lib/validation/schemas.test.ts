// @vitest-environment node
// Pure Zod schema tests — no DOM, no Supabase. Guards the contract between
// client and server for every mutating API route.

import { describe, it, expect } from 'vitest'
import {
  CryptoPaymentSchema,
  ElitePaymentSchema,
  AdminApprovePostSchema,
  ReportSchema,
  ContactSchema,
  validationError,
} from './schemas'

const VALID_UUID = '8b4c24b5-d284-48d4-b8b3-b1d1b93f5202'

describe('CryptoPaymentSchema', () => {
  it('accepts a well-formed crypto request', () => {
    const result = CryptoPaymentSchema.safeParse({
      package_id: 'tier_premium',
      payer_email: 'alice@example.com',
      currency: 'usdttrc20',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown package_id (prevents arbitrary NOWPayments description)', () => {
    const result = CryptoPaymentSchema.safeParse({
      package_id: 'tier_enterprise',
      payer_email: 'alice@example.com',
    })
    expect(result.success).toBe(false)
  })

  it('requires at least payer_email OR user_id (anonymous flow guard)', () => {
    const result = CryptoPaymentSchema.safeParse({ package_id: 'tier_premium' })
    expect(result.success).toBe(false)
  })

  it('lowercases + trims the email (prevents duplicate user rows)', () => {
    const result = CryptoPaymentSchema.safeParse({
      package_id: 'tier_max',
      payer_email: '  Alice@Example.COM  ',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.payer_email).toBe('alice@example.com')
  })

  it('rejects malformed email', () => {
    const result = CryptoPaymentSchema.safeParse({
      package_id: 'tier_premium',
      payer_email: 'not an email',
    })
    expect(result.success).toBe(false)
  })
})

describe('ElitePaymentSchema', () => {
  it('accepts a valid email', () => {
    const result = ElitePaymentSchema.safeParse({ email: 'user@example.com' })
    expect(result.success).toBe(true)
  })

  it('rejects missing email', () => {
    const result = ElitePaymentSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('normalizes the email (important: Elite row uniqueness relies on casing)', () => {
    const result = ElitePaymentSchema.safeParse({ email: 'USER@example.COM' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('user@example.com')
  })
})

describe('AdminApprovePostSchema', () => {
  it('accepts a valid UUID', () => {
    const result = AdminApprovePostSchema.safeParse({ postId: VALID_UUID })
    expect(result.success).toBe(true)
  })

  it("rejects SQL-injection-shaped strings that aren't UUIDs", () => {
    const result = AdminApprovePostSchema.safeParse({ postId: "'; DROP TABLE posts; --" })
    expect(result.success).toBe(false)
  })

  it('rejects missing postId', () => {
    const result = AdminApprovePostSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('ReportSchema', () => {
  it('accepts all known categories', () => {
    for (const category of ['spam', 'estafa', 'contenido_inapropiado', 'contenido_prohibido', 'otro']) {
      const result = ReportSchema.safeParse({ post_id: VALID_UUID, category })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an unknown category', () => {
    const result = ReportSchema.safeParse({ post_id: VALID_UUID, category: 'lorem' })
    expect(result.success).toBe(false)
  })

  it('enforces UUID on post_id', () => {
    const result = ReportSchema.safeParse({ post_id: 'not-a-uuid', category: 'estafa' })
    expect(result.success).toBe(false)
  })

  it('caps description length at 500 chars (prevents storage abuse)', () => {
    const result = ReportSchema.safeParse({
      post_id: VALID_UUID,
      category: 'estafa',
      description: 'x'.repeat(501),
    })
    expect(result.success).toBe(false)
  })
})

describe('ContactSchema', () => {
  it('accepts a well-formed contact body', () => {
    const result = ContactSchema.safeParse({
      nombre: 'Alice',
      correo: 'alice@example.com',
      mensaje: 'Hola, tengo una consulta.',
    })
    expect(result.success).toBe(true)
  })

  it('accepts either correo OR email (legacy field name flexibility)', () => {
    const a = ContactSchema.safeParse({ nombre: 'A', email: 'a@b.com', mensaje: 'hola cómo están' })
    const b = ContactSchema.safeParse({ nombre: 'A', correo: 'a@b.com', mensaje: 'hola cómo están' })
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
  })

  it('rejects a message under 5 chars (spam filter)', () => {
    const result = ContactSchema.safeParse({
      nombre: 'A', correo: 'a@b.com', mensaje: 'hi',
    })
    expect(result.success).toBe(false)
  })

  it('caps message at 5000 chars (prevents email DoS via massive bodies)', () => {
    const result = ContactSchema.safeParse({
      nombre: 'A', correo: 'a@b.com', mensaje: 'x'.repeat(5001),
    })
    expect(result.success).toBe(false)
  })
})

describe('validationError helper', () => {
  it('returns the first issue message as top-level error', () => {
    const result = CryptoPaymentSchema.safeParse({ package_id: 'bad' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const err = validationError(result.error)
      expect(err.error).toBeTruthy()
      expect(err.issues.length).toBeGreaterThan(0)
      expect(err.issues[0].path).toBeDefined()
    }
  })
})
