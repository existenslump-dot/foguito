// Regenerates the favicon family from public/images/logo_circular.png.
// Writes PNGs via sharp + a minimal multi-size ICO wrapping the 16/32 PNGs.
// Run: node scripts/regen-favicons.mjs
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src  = path.join(root, 'public', 'images', 'logo_circular.png')
const out  = path.join(root, 'public', 'images')

const sizes = [
  { file: 'icon-16x16.png',       size: 16  },
  { file: 'favicon-32x32.png',    size: 32  },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192x192.png',     size: 192 },
  { file: 'icon-512x512.png',     size: 512 },
]

async function writePng({ file, size }) {
  const buf = await sharp(src).resize(size, size, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } }).png().toBuffer()
  await fs.writeFile(path.join(out, file), buf)
  console.log(`✓ ${file} (${buf.length} bytes)`)
  return buf
}

// Build an ICO that embeds PNG data for 16/32/48 — all modern browsers accept
// PNG-in-ICO (Vista+). 16/32 for address bar, 48 for shortcuts.
async function writeIco(pngBuffers) {
  const dims = [16, 32, 48]
  const images = await Promise.all(
    dims.map(d => sharp(src).resize(d, d, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } }).png().toBuffer())
  )
  void pngBuffers // silence unused
  const headerSize = 6
  const entrySize  = 16
  const dataOffset0 = headerSize + entrySize * images.length

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)              // reserved
  header.writeUInt16LE(1, 2)              // type = ICO
  header.writeUInt16LE(images.length, 4)  // image count

  const entries = []
  let offset = dataOffset0
  for (let i = 0; i < images.length; i++) {
    const size = images[i].length
    const dim  = dims[i]
    const e = Buffer.alloc(entrySize)
    e.writeUInt8(dim === 256 ? 0 : dim, 0)   // width
    e.writeUInt8(dim === 256 ? 0 : dim, 1)   // height
    e.writeUInt8(0, 2)                        // color palette
    e.writeUInt8(0, 3)                        // reserved
    e.writeUInt16LE(1, 4)                     // color planes
    e.writeUInt16LE(32, 6)                    // bits per pixel
    e.writeUInt32LE(size, 8)                  // bytes in resource
    e.writeUInt32LE(offset, 12)               // offset in file
    entries.push(e)
    offset += size
  }

  const ico = Buffer.concat([header, ...entries, ...images])
  await fs.writeFile(path.join(out, 'favicon.ico'), ico)
  console.log(`✓ favicon.ico (${ico.length} bytes, sizes: ${dims.join('/')})`)
}

async function main() {
  await fs.access(src)
  const pngs = []
  for (const s of sizes) pngs.push(await writePng(s))
  await writeIco(pngs)
  console.log('\nDone. Note: browsers cache favicons aggressively — hard-refresh (Ctrl+Shift+R) or open in incognito to see the new icon.')
}

main().catch(e => { console.error(e); process.exit(1) })
