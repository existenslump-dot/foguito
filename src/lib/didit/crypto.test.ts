// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { encryptString, decryptString, encryptJson, decryptJson } from './crypto'

// 32 bytes in hex (openssl rand -hex 32)
const HEX_KEY = '0'.repeat(64)
// The same key in base64 (32 zero bytes → 'AAAA…' = 44 chars)
const B64_KEY = Buffer.alloc(32).toString('base64')

describe('didit/crypto', () => {
  beforeEach(() => {
    vi.stubEnv('DIDIT_PAYLOAD_KEY', HEX_KEY)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round-trips a string', () => {
    const plain = 'document: 12.345.678 — María Pérez'
    const env = encryptString(plain)
    expect(env).not.toContain(plain)
    expect(env.startsWith('v1.')).toBe(true)
    expect(decryptString(env)).toBe(plain)
  })

  it('round-trips JSON', () => {
    const obj = { status: 'Approved', score: 97.3, nested: { dni: 'X' } }
    const env = encryptJson(obj)
    expect(decryptJson(env)).toEqual(obj)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const a = encryptString('same text')
    const b = encryptString('same text')
    expect(a).not.toBe(b)
    expect(decryptString(a)).toBe('same text')
    expect(decryptString(b)).toBe('same text')
  })

  it('accepts a base64 key', () => {
    vi.stubEnv('DIDIT_PAYLOAD_KEY', B64_KEY)
    const env = encryptString('hello')
    expect(decryptString(env)).toBe('hello')
  })

  it('fails to decrypt if the tag was tampered with (GCM integrity)', () => {
    const env = encryptString('intact')
    const parts = env.split('.')
    // Corrupt the ciphertext
    const corrupted = [parts[0], parts[1], parts[2], Buffer.from('xxxxxxxx').toString('base64')].join('.')
    expect(() => decryptString(corrupted)).toThrow()
  })

  it('rejects an envelope with an unknown version', () => {
    expect(() => decryptString('v9.a.b.c')).toThrow(/version|malformed/)
  })

  it('rejects a malformed envelope', () => {
    expect(() => decryptString('not-an-envelope')).toThrow(/malformed/)
  })

  it('throws if DIDIT_PAYLOAD_KEY is missing', () => {
    vi.stubEnv('DIDIT_PAYLOAD_KEY', '')
    expect(() => encryptString('x')).toThrow(/DIDIT_PAYLOAD_KEY/)
  })

  it('throws if the key does not decode to 32 bytes', () => {
    vi.stubEnv('DIDIT_PAYLOAD_KEY', 'abcd')
    expect(() => encryptString('x')).toThrow(/32 bytes/)
  })
})
