import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib'
import { unzlibSync, zlibSync } from 'fflate'

const FILTER = PDFName.of('Filter')
const FLATE = PDFName.of('FlateDecode')

/**
 * Lossless size reduction, applied to the output document before encryption/save. Never touches pixels or
 * drawing operators: every page renders identically.
 * - streams without a filter get Flate (except XMP /Metadata, which the spec wants readable);
 * - Flate streams are re-deflated at max level (kept only if smaller; predictors stay valid);
 * - byte-identical streams (fonts/images repeated after merges) are merged into one object;
 * - page thumbnails (/Thumb, viewers regenerate them) and private app data (/PieceInfo) are removed;
 * - unreachable objects are dropped. Object streams are used at save (pdf-lib default).
 * DCT/JPX/JBIG2/CCITT images are left as-is: recompressing them would lose quality or gain nothing.
 */
export function compressDocument(doc: PDFDocument): void {
  const ctx = doc.context
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of('Thumb'))
    page.node.delete(PDFName.of('PieceInfo'))
  }
  doc.catalog.delete(PDFName.of('PieceInfo'))

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const better = recompress(obj)
    if (better) ctx.assign(ref, better)
  }
  // Repeat: merging e.g. two /SMask streams makes the images that point to them identical too.
  for (let i = 0; i < 5 && dedupeStreams(doc); i++);
  dropUnreachable(doc)
}

function recompress(stream: PDFRawStream): PDFRawStream | null {
  const filter = stream.dict.get(FILTER)
  const single = filter instanceof PDFArray && filter.size() === 1 ? filter.get(0) : filter
  let raw: Uint8Array
  if (single === undefined) {
    if (stream.dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) return null
    if (stream.dict.has(PDFName.of('DecodeParms'))) return null
    raw = stream.contents
  } else if (single === FLATE) {
    try {
      raw = unzlibSync(stream.contents)
    } catch {
      return null // corrupt/truncated data: leave it exactly as it was
    }
  } else return null

  const packed = zlibSync(raw, { level: 9 })
  if (packed.length >= stream.contents.length) return null
  const dict = stream.dict.clone()
  dict.set(FILTER, FLATE)
  return PDFRawStream.of(dict, packed)
}

/** Returns whether anything was merged. */
function dedupeStreams(doc: PDFDocument): boolean {
  const ctx = doc.context
  const seen = new Map<string, { ref: PDFRef; stream: PDFStream }[]>()
  const replace = new Map<PDFRef, PDFRef>()
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue
    const bytes = obj.getContents()
    const dict = obj.dict.clone()
    dict.delete(PDFName.of('Length'))
    const key = `${dict.toString()}|${bytes.length}|${fnv1a(bytes)}`
    const bucket = seen.get(key) ?? seen.set(key, []).get(key)!
    const twin = bucket.find((b) => sameBytes(b.stream.getContents(), bytes))
    if (twin) replace.set(ref, twin.ref)
    else bucket.push({ ref, stream: obj })
  }
  if (!replace.size) return false
  const swap = (o: PDFObject | undefined): PDFObject | undefined =>
    o instanceof PDFRef ? (replace.get(o) ?? o) : (visit(o), o)
  const visit = (o: PDFObject | undefined): void => {
    if (o instanceof PDFDict) for (const [k, v] of o.entries()) o.set(k, swap(v)!)
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) o.set(i, swap(o.get(i))!)
    else if (o instanceof PDFStream) visit(o.dict)
  }
  for (const [, obj] of ctx.enumerateIndirectObjects()) visit(obj)
  for (const ref of replace.keys()) ctx.delete(ref)
  return true
}

function dropUnreachable(doc: PDFDocument): void {
  const ctx = doc.context
  const reached = new Set<PDFRef>()
  const walk = (o: PDFObject | undefined): void => {
    if (o instanceof PDFRef) {
      if (reached.has(o)) return
      reached.add(o)
      walk(ctx.lookup(o))
    } else if (o instanceof PDFDict) for (const [, v] of o.entries()) walk(v)
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) walk(o.get(i))
    else if (o instanceof PDFStream) walk(o.dict)
  }
  const { Root, Info, Encrypt } = ctx.trailerInfo
  for (const o of [Root, Info, Encrypt]) walk(o as PDFObject | undefined)
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!reached.has(ref)) ctx.delete(ref)
}

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193)
  return h >>> 0
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
