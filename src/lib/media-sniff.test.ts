// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sniffMediaCategory } from './media-sniff'

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
const concat = (...arrs: Uint8Array[]) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}
// ISO-BMFF: 4 bytes de tamaño de box + "ftyp" + marca de 4 chars.
const ftyp = (brand: string) => concat(bytes(0, 0, 0, 0x18), ascii('ftyp'), ascii(brand))

describe('sniffMediaCategory', () => {
  it('detects JPEG as image', () => {
    expect(sniffMediaCategory(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image')
  })
  it('detects PNG as image', () => {
    expect(sniffMediaCategory(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image')
  })
  it('detects GIF as image', () => {
    expect(sniffMediaCategory(ascii('GIF89a'))).toBe('image')
  })
  it('detects WEBP as image (RIFF....WEBP)', () => {
    expect(sniffMediaCategory(concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WEBP')))).toBe('image')
  })
  it('detects HEIC/HEIF/AVIF ftyp brands as image', () => {
    expect(sniffMediaCategory(ftyp('heic'))).toBe('image')
    expect(sniffMediaCategory(ftyp('mif1'))).toBe('image')
    expect(sniffMediaCategory(ftyp('avif'))).toBe('image')
  })
  it('detects mp4/mov/m4v ftyp brands as video', () => {
    expect(sniffMediaCategory(ftyp('isom'))).toBe('video')
    expect(sniffMediaCategory(ftyp('mp42'))).toBe('video')
    expect(sniffMediaCategory(ftyp('qt  '))).toBe('video')
    expect(sniffMediaCategory(ftyp('M4V '))).toBe('video')
  })
  it('detects WebM/Matroska (EBML) as video', () => {
    expect(sniffMediaCategory(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video')
  })
  it('detects RIFF/AVI as video and RIFF/WAVE as audio', () => {
    expect(sniffMediaCategory(concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('AVI ')))).toBe('video')
    expect(sniffMediaCategory(concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVE')))).toBe('audio')
  })
  it('detects mp3/ogg as audio', () => {
    expect(sniffMediaCategory(ascii('ID3'))).toBe('audio')
    expect(sniffMediaCategory(bytes(0xff, 0xfb))).toBe('audio')
    expect(sniffMediaCategory(ascii('OggS'))).toBe('audio')
  })
  it('CRÍTICO: bytes de imagen NO se confunden con video — un JPEG declarado mp4 sniffa image', () => {
    // El vector de bypass: subir un JPEG diciendo Content-Type: video/mp4. El
    // sniff mira los bytes → 'image', el alta rechaza el mismatch.
    expect(sniffMediaCategory(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image')
  })
  it('returns other for unknown/empty signatures (caller fail-closes)', () => {
    expect(sniffMediaCategory(bytes(0x00, 0x01, 0x02, 0x03))).toBe('other')
    expect(sniffMediaCategory(new Uint8Array(0))).toBe('other')
  })
})
