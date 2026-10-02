// Generates build/icon.png and build/icon.ico (256x256) with Node built-ins only.
// Run: node scripts/icon.mjs  (outputs are committed; rerun only to change the mark)
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const S = 256
const SS = 4 // supersampling for anti-aliasing

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// Mark: indigo tile, white page with folded corner, text lines, one yellow highlight.
function colorAt(x, y) {
  let c = null
  if (inRoundRect(x, y, 8, 8, 248, 248, 52)) c = [79, 70, 229, 255]
  const [px0, py0, px1, py1, fold] = [64, 40, 192, 216, 40]
  const inPage = x >= px0 && x <= px1 && y >= py0 && y <= py1 && !(x > px1 - fold && y < py0 + fold && x - (px1 - fold) > y - py0)
  if (inPage) {
    c = [255, 255, 255, 255]
    if (x > px1 - fold && y < py0 + fold && x - (px1 - fold) <= y - py0) c = [199, 210, 254, 255] // fold
    const lines = [96, 124, 152, 180]
    for (const ly of lines) if (y >= ly && y <= ly + 10 && x >= 84 && x <= (ly === 180 ? 140 : 172)) c = [148, 163, 184, 255]
    if (y >= 118 && y <= 136 && x >= 80 && x <= 176) c = mix(c, [250, 204, 21, 255], 0.55) // highlight
  }
  return c ?? [0, 0, 0, 0]
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t))

const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter: none
  for (let x = 0; x < S; x++) {
    const acc = [0, 0, 0, 0]
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
        acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3]
      }
    const o = y * (S * 4 + 1) + 1 + x * 4
    const a = acc[3] / (SS * SS)
    for (let i = 0; i < 3; i++) raw[o + i] = acc[3] ? Math.round(acc[i] / acc[3]) : 0
    raw[o + 3] = Math.round(a)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

// ICO with one embedded PNG entry (width/height 0 = 256).
const ico = Buffer.alloc(22)
ico.writeUInt16LE(0, 0)
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(1, 4)
ico.set([0, 0, 0, 0], 6)
ico.writeUInt16LE(1, 10)
ico.writeUInt16LE(32, 12)
ico.writeUInt32LE(png.length, 14)
ico.writeUInt32LE(22, 18)

const dir = new URL('../build/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('icon.png', dir), png)
writeFileSync(new URL('icon.ico', dir), Buffer.concat([ico, png]))
console.log('build/icon.png + build/icon.ico written')
