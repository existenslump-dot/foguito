// @vitest-environment node
/**
 * Marca de agua por-fan (PR-5).
 *   - buildFanLabel: seudónima, SIN PII (nada de '@'), con prefijos de ids.
 *   - buildFanWatermarkSvg: SVG válido-ish que contiene la etiqueta.
 *   - watermarkImageBuffer: sobre un PNG chico real devuelve bytes que `sharp`
 *     puede volver a leer (prueba que es una imagen de verdad).
 */
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { buildFanLabel, buildFanWatermarkSvg, watermarkImageBuffer } from './content-watermark.server'

const FAN = '11111111-2222-3333-4444-555555555555'
const CONTENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('buildFanLabel', () => {
  it('is pseudonymous — no email / no "@", includes the id prefixes', () => {
    const label = buildFanLabel(FAN, CONTENT)
    expect(label).not.toContain('@')
    expect(label).toContain(FAN.slice(0, 8))
    expect(label).toContain(CONTENT.slice(0, 8))
    // no leak of a full id
    expect(label).not.toContain(FAN)
    expect(label).not.toContain(CONTENT)
    // fecha YYYY-MM-DD presente
    expect(label).toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('buildFanWatermarkSvg', () => {
  it('renders a tiled diagonal SVG that carries the label text', () => {
    const label = buildFanLabel(FAN, CONTENT)
    const svg = buildFanWatermarkSvg(800, 600, label)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain(label)
    // teselado en diagonal (rotación) + patrón que rellena todo el lienzo
    expect(svg).toContain('patternTransform="rotate(-30)"')
    expect(svg).toContain('width="800"')
    expect(svg).toContain('height="600"')
  })

  it('escapes XML-significant chars in the label', () => {
    const svg = buildFanWatermarkSvg(100, 100, 'a<b>&"c')
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c')
    expect(svg).not.toContain('a<b>')
  })
})

describe('watermarkImageBuffer', () => {
  async function tinyPng(width = 64, height = 96): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: { r: 20, g: 40, b: 80 } },
    })
      .png()
      .toBuffer()
  }

  it('returns a real, non-empty image that sharp can re-read (PNG preserved)', async () => {
    const src = await tinyPng(64, 96)
    const out = await watermarkImageBuffer(src, buildFanLabel(FAN, CONTENT))
    expect(out.data.length).toBeGreaterThan(0)
    expect(out.contentType).toBe('image/png')

    const meta = await sharp(out.data).metadata()
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(96)
    expect(meta.format).toBe('png')
  })

  it('flattens a JPEG source back to JPEG', async () => {
    const src = await sharp({
      create: { width: 80, height: 80, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer()
    const out = await watermarkImageBuffer(src, 'x')
    expect(out.contentType).toBe('image/jpeg')
    const meta = await sharp(out.data).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(80)
  })
})
