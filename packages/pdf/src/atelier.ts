/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted JSON / pdf-lib literal dicts, validated at runtime */
import {
  decodePDFRawStream,
  degrees,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib'
import fontkit from '@cantoo/fontkit'
import { BLANK_SOURCE, NOTE_SIZE, type Annotation, type DocumentModel, type ImageAsset, type Point, type Rect, type Reply } from '@pdf-atelier/core'
import { loadNotoSans, pdfFontkit } from './fonts.ts'
import { readOutline, writeOutline, type OutlineNode } from './outline.ts'

/** Private key holding the domain annotation JSON, so our annotations round-trip without loss. */
const ATELIER_KEY = 'PDFAtelier'
/** Private key on our image /Stamp: stream with the original image bytes (byte-exact round-trip). */
const IMAGE_KEY = 'PDFAtelierImage'

const SUBTYPES: Record<Annotation['type'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  ink: 'Ink',
  rect: 'Square',
  ellipse: 'Circle',
  line: 'Line',
  arrow: 'Line',
  freetext: 'FreeText',
  note: 'Text',
  image: 'Stamp',
}
// Foreign /Stamp annotations are not ours to edit: only Stamps carrying our JSON are owned.
const SUPPORTED = new Set(Object.values(SUBTYPES).filter((s) => s !== 'Stamp'))

/** Annotation subtypes the app imports into its model (foreign ones, when visible). */
export function isSupportedSubtype(subtype: unknown): boolean {
  return typeof subtype === 'string' && SUPPORTED.has(subtype)
}

/** /F bits that make an annotation invisible to the user: Invisible | Hidden | NoView. Such foreign ones are kept as-is. */
export const HIDDEN_FLAGS = 1 | 2 | 32

const refKey = (ref: PDFRef) => (ref.generationNumber === 0 ? `${ref.objectNumber}R` : `${ref.objectNumber}R${ref.generationNumber}`)

export interface AtelierData {
  /** Our annotations keyed by pdf.js-style object id ("12R"). */
  annotations: Map<string, Annotation>
  images: ImageAsset[]
  /** Our bookmarks group, as page indices of this file. */
  bookmarks: { pageIndex: number; title: string }[]
  /** Top-level outline index of our bookmarks group (hidden from getOutline), or null. */
  bookmarkGroup: number | null
}

/**
 * Reads PDF Atelier's private data: /PDFAtelier JSON of every annotation, original image bytes and the
 * bookmarks outline group. pdf.js does not expose custom keys, hence the second parser.
 * Everything comes from an untrusted file and is validated.
 */
export async function readAtelierData(bytes: Uint8Array, password?: string): Promise<AtelierData> {
  // Without the password, encrypted strings stay ciphertext, fail JSON.parse and fall back to the standard fields.
  const doc = await PDFDocument.load(bytes, { ...(password ? { password } : { ignoreEncryption: true }), updateMetadata: false })
  const annotations = new Map<string, Annotation>()
  const images = new Map<string, ImageAsset>()
  for (const page of doc.getPages()) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      if (!(ref instanceof PDFRef)) continue
      const dict = doc.context.lookup(ref)
      if (!(dict instanceof PDFDict)) continue
      const raw = dict.get(PDFName.of(ATELIER_KEY))
      if (!(raw instanceof PDFHexString || raw instanceof PDFString)) continue
      try {
        const ann: unknown = JSON.parse(raw.decodeText())
        if (!isValidAnnotation(ann)) continue
        if (ann.type === 'image' && !images.has(ann.imageId)) {
          const img = readImage(doc, dict.get(PDFName.of(IMAGE_KEY)), ann.imageId)
          if (!img) continue // an image annotation without its bytes cannot be drawn
          images.set(img.id, img)
        }
        annotations.set(refKey(ref), ann)
      } catch {
        // Malformed JSON / stream: fall back to the standard PDF fields.
      }
    }
  }
  const outline = readOutline(doc)
  const group = outline.findIndex((n) => n.marker)
  const bookmarks = (outline[group]?.children ?? []).flatMap((n) =>
    n.pageIndex !== null ? [{ pageIndex: n.pageIndex, title: n.title }] : [],
  )
  return { annotations, images: [...images.values()], bookmarks, bookmarkGroup: group === -1 ? null : group }
}

/** Kept for callers that only need the annotations. */
export async function readAtelierAnnotations(bytes: Uint8Array, password?: string): Promise<Map<string, Annotation>> {
  return (await readAtelierData(bytes, password)).annotations
}

function readImage(doc: PDFDocument, ref: unknown, id: string): ImageAsset | null {
  const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : null
  if (!(stream instanceof PDFRawStream)) return null
  const meta = (k: string) => stream.dict.get(PDFName.of(k))
  const mime = meta('PDFAtelierMime')
  const [w, h] = [meta('PDFAtelierWidth'), meta('PDFAtelierHeight')]
  if (!(mime instanceof PDFName) || !(w instanceof PDFNumber) || !(h instanceof PDFNumber)) return null
  const data = decodePDFRawStream(stream).decode()
  const type = mime.decodeText()
  const png = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  const jpg = data[0] === 0xff && data[1] === 0xd8
  if (type === 'image/png' && png) return { id, mime: type, data: new Uint8Array(data), width: w.asNumber(), height: h.asNumber() }
  if (type === 'image/jpeg' && jpg) return { id, mime: type, data: new Uint8Array(data), width: w.asNumber(), height: h.asNumber() }
  return null
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string'
const isPoint = (p: any): p is Point => p && num(p.x) && num(p.y)
const isRect = (r: any): r is Rect => isPoint(r) && num((r as any).width) && num((r as any).height)
const isReply = (r: any): r is Reply =>
  r && str(r.id) && str(r.text) && num(r.createdAt) && (r.author === undefined || str(r.author))

function isValidAnnotation(a: any): a is Annotation {
  if (!a || typeof a !== 'object' || !str(a.id) || !str(a.type) || !(a.type in SUBTYPES)) return false
  const s = a.style
  if (!s || !str(s.color) || !num(s.strokeWidth) || !num(s.opacity)) return false
  if (s.fill !== null && !str(s.fill)) return false
  if (!num(a.createdAt) || !num(a.updatedAt)) return false
  if (a.note !== undefined && !str(a.note)) return false
  if (a.replies !== undefined && !(Array.isArray(a.replies) && a.replies.every(isReply))) return false
  switch (a.type as Annotation['type']) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return Array.isArray(a.rects) && a.rects.every(isRect) && str(a.text)
    case 'ink':
      return Array.isArray(a.paths) && a.paths.every((p: unknown) => Array.isArray(p) && p.every(isPoint))
    case 'rect':
    case 'ellipse':
      return isRect(a.rect)
    case 'line':
    case 'arrow':
      return isPoint(a.from) && isPoint(a.to)
    case 'freetext':
      return isRect(a.rect) && str(a.text) && num(a.fontSize)
    case 'note':
      return isPoint(a.at)
    case 'image':
      return isRect(a.rect) && str(a.imageId) && ['image', 'signature', 'stamp'].includes(a.kind)
  }
}

/**
 * Builds the output PDF from the model: pages copied in order with their rotation, then annotations.
 * The model is the source of truth for owned annotations (see ownsAnnot): those already in the sources are
 * dropped and the model's annotations are written (standard /Annot + /AP + /PDFAtelier JSON). Annotations we
 * don't own (links, foreign stamps, hidden ones...) are copied untouched. Outlines are rebuilt (see below).
 * `pageIds` exports only those pages (extract/split), keeping document order.
 */
export async function exportPdf(
  doc: DocumentModel,
  sources: ReadonlyMap<string, { bytes: Uint8Array; password?: string }>,
  opts: { pageIds?: string[]; bookmarksTitle?: string } = {},
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  out.registerFontkit(pdfFontkit)
  let password: string | undefined
  const only = opts.pageIds && new Set(opts.pageIds)
  const pages = only ? doc.pages.filter((p) => only.has(p.id)) : doc.pages
  if (!pages.length) throw new Error('Nothing to export: no pages selected')

  // One copyPages call per source so shared resources (fonts, images) are copied once.
  const wanted = new Map<string, number[]>()
  for (const p of pages) {
    if (p.sourceId !== BLANK_SOURCE) (wanted.get(p.sourceId) ?? wanted.set(p.sourceId, []).get(p.sourceId)!).push(p.sourceIndex)
  }
  const copied = new Map<string, PDFPage[]>()
  const srcDocs = new Map<string, PDFDocument>()
  for (const [sourceId, indices] of wanted) {
    const source = sources.get(sourceId)
    if (!source) throw new Error(`Missing bytes for source ${sourceId}`)
    const src = await PDFDocument.load(source.bytes, { updateMetadata: false, ...(source.password && { password: source.password }) })
    password ??= source.password
    for (const i of new Set(indices)) dropOwnedAnnots(src, src.getPage(i))
    copied.set(sourceId, await out.copyPages(src, indices))
    srcDocs.set(sourceId, src)
  }

  const byPage = new Map<string, Annotation[]>()
  for (const a of Object.values(doc.annotations)) (byPage.get(a.pageId) ?? byPage.set(a.pageId, []).get(a.pageId)!).push(a)

  const fontsFor = textFonts(out)
  const imagesFor = imageXObjects(out, doc)
  const firstOut = new Map<string, number>() // `${sourceId}:${sourceIndex}` -> first output page index
  const outIndex = new Map<string, number>() // pageId -> output page index
  for (const [i, p] of pages.entries()) {
    const page = p.sourceId === BLANK_SOURCE ? out.addPage([p.width, p.height]) : out.addPage(copied.get(p.sourceId)!.shift()!)
    page.setRotation(degrees(p.rotation))
    outIndex.set(p.id, i)
    if (!firstOut.has(`${p.sourceId}:${p.sourceIndex}`)) firstOut.set(`${p.sourceId}:${p.sourceIndex}`, i)
    for (const a of byPage.get(p.id) ?? []) {
      if (a.type === 'ink' && !a.paths.some((path) => path.length)) continue
      const image = a.type === 'image' ? await imagesFor(a.imageId) : undefined
      if (a.type === 'image' && !image) continue // image bytes missing from the model: nothing to draw
      const fonts = a.type === 'freetext' ? await fontsFor(a.text) : []
      const { dict, rect } = buildAnnot(out, page, a, fonts, image)
      const ref = out.context.register(dict)
      page.node.addAnnot(ref)
      for (const r of a.replies ?? []) page.node.addAnnot(out.context.register(buildReply(out, ref, rect, r)))
    }
  }

  // copyPages drops /Outlines: rebuild each source's outline remapped to the output pages (items whose page is
  // gone are dropped unless they still have children), then our bookmarks group.
  const remap = (sourceId: string, list: OutlineNode[]): OutlineNode[] =>
    list.flatMap((n) => {
      const children = remap(sourceId, n.children)
      const pageIndex = n.pageIndex === null ? null : (firstOut.get(`${sourceId}:${n.pageIndex}`) ?? null)
      return pageIndex !== null || children.length ? [{ ...n, pageIndex, children }] : []
    })
  const nodes = [...srcDocs].flatMap(([sourceId, src]) => remap(sourceId, readOutline(src).filter((n) => !n.marker)))
  const marks = doc.bookmarks.filter((b) => outIndex.has(b.pageId))
  if (marks.length) {
    nodes.push({
      title: opts.bookmarksTitle ?? 'Favoritos',
      pageIndex: null,
      view: [],
      marker: true,
      children: marks.map((b) => ({ title: b.title, pageIndex: outIndex.get(b.pageId)!, view: [], children: [] })),
    })
  }
  writeOutline(out, nodes)

  // Saving must never silently strip protection: when a source was password-protected, the output is encrypted
  // with that password as both user and owner password (AES-256, the library default). With several protected
  // sources, the first one's password is used.
  if (password) out.encrypt({ userPassword: password, ownerPassword: password })
  return out.save()
}

interface ImageRefs {
  xobject: PDFRef
  raw: PDFRef
}

/** Embeds each image once per export: drawable XObject + raw original bytes for round-trip. */
function imageXObjects(out: PDFDocument, doc: DocumentModel) {
  const cache = new Map<string, Promise<ImageRefs | undefined>>()
  return (id: string) => {
    let hit = cache.get(id)
    if (!hit) {
      const asset = doc.images[id]
      hit = !asset
        ? Promise.resolve(undefined)
        : (asset.mime === 'image/png' ? out.embedPng(asset.data) : out.embedJpg(asset.data)).then((img) => ({
            xobject: img.ref,
            // ponytail: original bytes stored next to the drawable copy (~2x image size) for byte-exact round-trip.
            raw: out.context.register(
              out.context.stream(asset.data, {
                PDFAtelierMime: PDFName.of(asset.mime),
                PDFAtelierWidth: asset.width,
                PDFAtelierHeight: asset.height,
              }),
            ),
          }))
      cache.set(id, hit)
    }
    return hit
  }
}

interface TextFont {
  key: string
  font: PDFFont
  has: (ch: string) => boolean
}

/**
 * Fonts for a FreeText: Helvetica when it encodes every character (WinAnsi), else the Noto Sans subsets the
 * text needs (latin always, it provides the "?" fallback). Each font is embedded once per export, subset.
 */
function textFonts(out: PDFDocument) {
  let helv: Promise<TextFont> | undefined
  let noto: Promise<{ bytes: Uint8Array; covers: (ch: string) => boolean }[]> | undefined
  const embedded = new Map<number, Promise<TextFont>>()

  return async (text: string): Promise<TextFont[]> => {
    helv ??= out.embedFont(StandardFonts.Helvetica).then((font) => {
      const charset = new Set(font.getCharacterSet())
      return { key: 'Helv', font, has: (ch: string) => charset.has(ch.codePointAt(0)!) }
    })
    const h = await helv
    const chars = [...text].filter((ch) => ch !== '\n')
    if (chars.every(h.has)) return [h]

    noto ??= loadNotoSans().then((all) =>
      all.map((bytes) => {
        const fk = fontkit.create(bytes) as import('@cantoo/fontkit').Font // single-font woff, never a collection
        return { bytes, covers: (ch: string) => fk.hasGlyphForCodePoint(ch.codePointAt(0)!) }
      }),
    )
    const subsets = await noto
    const needed = new Set([0])
    for (const ch of chars) {
      if ([...needed].some((n) => subsets[n]!.covers(ch))) continue
      const i = subsets.findIndex((s) => s.covers(ch))
      if (i > 0) needed.add(i)
    }
    return Promise.all(
      [...needed]
        .sort((x, y) => x - y)
        .map((i) => {
          let font = embedded.get(i)
          if (!font) {
            const s = subsets[i]!
            font = out.embedFont(s.bytes, { subset: true }).then((pf) => ({ key: `Noto${i}`, font: pf, has: s.covers }))
            embedded.set(i, font)
          }
          return font
        }),
    )
  }
}

/**
 * Whether the app owns this annotation (imports it, hides it from the canvas, rewrites it on export):
 * - anything carrying our JSON;
 * - a reply (/Text with /IRT) whose parent on the same page is owned;
 * - otherwise a supported subtype that is visible (hidden foreign annotations are kept untouched).
 * engine.ts applies the same rule to pdf.js data; keep both in sync.
 */
function ownsAnnot(dict: PDFDict, onPage: Map<string, PDFDict>, depth = 0): boolean {
  if (dict.has(PDFName.of(ATELIER_KEY))) return true
  const subtype = dict.get(PDFName.of('Subtype'))
  const name = subtype instanceof PDFName ? subtype.decodeText() : null
  const irt = dict.get(PDFName.of('IRT'))
  if (name === 'Text' && irt instanceof PDFRef) {
    const parent = onPage.get(refKey(irt))
    return !!parent && depth < 8 && ownsAnnot(parent, onPage, depth + 1)
  }
  const flags = dict.get(PDFName.of('F'))
  return isSupportedSubtype(name) && !((flags instanceof PDFNumber ? flags.asNumber() : 0) & HIDDEN_FLAGS)
}

function dropOwnedAnnots(src: PDFDocument, page: PDFPage) {
  const annots = page.node.Annots()
  if (!annots) return
  const entries = annots.asArray().flatMap((ref) => {
    const dict = ref instanceof PDFRef ? src.context.lookup(ref) : ref
    return ref instanceof PDFRef && dict instanceof PDFDict ? [{ ref, dict }] : []
  })
  const onPage = new Map(entries.map((e) => [refKey(e.ref), e.dict]))
  const removed = new Set(entries.filter((e) => ownsAnnot(e.dict, onPage)).map((e) => refKey(e.ref)))
  const keep = entries.filter(({ ref, dict }) => {
    if (removed.has(refKey(ref))) return false
    // Popups belong to the markup annotation they annotate.
    const parent = dict.get(PDFName.of('Parent'))
    return !(parent instanceof PDFRef && removed.has(refKey(parent)))
  })
  page.node.set(PDFName.of('Annots'), src.context.obj(keep.map((e) => e.ref)))
}

// ---------------------------------------------------------------------------------------------------------
// Annotation dictionaries + appearance streams. Geometry is written in PDF user space; /AP uses an identity
// matrix with BBox = Rect, so the stream contents are in the same absolute coordinates.

type Box = [number, number, number, number]
const f = (n: number) => (Math.round(n * 1000) / 1000).toString()

function rgb(color: string | null): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color ?? '')
  const v = m ? parseInt(m[1]!, 16) : 0
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** Reply as Acrobat writes it: /Text in reply to the parent, not drawn (NoView), listed in comment panes. */
function buildReply(out: PDFDocument, parent: PDFRef, rect: Box, r: Reply): PDFDict {
  return out.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: rect,
    F: 32, // NoView
    IRT: parent,
    RT: 'R',
    Name: 'Comment',
    Open: false,
    NM: PDFHexString.fromText(r.id),
    M: PDFString.fromDate(new Date(r.createdAt)),
    Contents: PDFHexString.fromText(r.text),
    ...(r.author && { T: PDFHexString.fromText(r.author) }),
  } as Record<string, any>) as PDFDict
}

function buildAnnot(out: PDFDocument, page: PDFPage, a: Annotation, fonts: TextFont[], image?: ImageRefs): { dict: PDFDict; rect: Box } {
  const cb = page.getCropBox()
  const pt = (p: Point): [number, number] => [cb.x + p.x, cb.y + cb.height - p.y]
  const box = (r: Rect): Box => {
    const x = cb.x + r.x
    const y = cb.y + cb.height - r.y - r.height
    return [x, y, x + r.width, y + r.height]
  }
  const union = (boxes: Box[], pad = 0): Box => [
    Math.min(...boxes.map((b) => b[0])) - pad,
    Math.min(...boxes.map((b) => b[1])) - pad,
    Math.max(...boxes.map((b) => b[2])) + pad,
    Math.max(...boxes.map((b) => b[3])) + pad,
  ]

  const { color, fill, strokeWidth: w, opacity } = a.style
  const [r, g, b] = rgb(color)
  const stroke = `${f(r)} ${f(g)} ${f(b)} RG ${f(r)} ${f(g)} ${f(b)} rg ${f(w)} w 1 J 1 j`
  const extra: Record<string, any> = {}
  const resources: Record<string, any> = {
    ExtGState: { G0: { CA: opacity, ca: opacity, ...(a.type === 'highlight' && { BM: 'Multiply' }) } },
  }
  let rect: Box
  let body: string

  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout': {
      const boxes = a.rects.map(box)
      rect = union(boxes)
      extra.QuadPoints = boxes.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1])
      body = boxes
        .map(([x1, y1, x2, y2]) => {
          if (a.type === 'highlight') return `${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(y2 - y1)} re f`
          const t = Math.max(0.5, (y2 - y1) * 0.07)
          const y = a.type === 'underline' ? y1 + t : (y1 + y2) / 2
          return `${f(t)} w ${f(x1)} ${f(y)} m ${f(x2)} ${f(y)} l S`
        })
        .join('\n')
      body = `${f(r)} ${f(g)} ${f(b)} RG ${f(r)} ${f(g)} ${f(b)} rg\n${body}`
      break
    }
    case 'ink': {
      const paths = a.paths.map((path) => path.map(pt))
      const xs = paths.flat()
      rect = union([[Math.min(...xs.map((p) => p[0])), Math.min(...xs.map((p) => p[1])), Math.max(...xs.map((p) => p[0])), Math.max(...xs.map((p) => p[1]))]], w)
      extra.InkList = paths.map((path) => path.flat())
      extra.BS = { W: w }
      body = `${stroke}\n${paths
        .map((path) => path.map(([x, y], i) => `${f(x)} ${f(y)} ${i ? 'l' : 'm'}`).join(' ') + ' S')
        .join('\n')}`
      break
    }
    case 'rect':
    case 'ellipse': {
      rect = box(a.rect)
      extra.BS = { W: w }
      if (fill) extra.IC = rgb(fill)
      const [x1, y1, x2, y2] = [rect[0] + w / 2, rect[1] + w / 2, rect[2] - w / 2, rect[3] - w / 2]
      const fillOp = fill ? `${rgb(fill).map(f).join(' ')} rg ` : ''
      const paint = fill ? 'B' : 'S'
      if (a.type === 'rect') body = `${stroke} ${fillOp}${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(y2 - y1)} re ${paint}`
      else {
        const [cx, cy, rx, ry] = [(x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2]
        const k = 0.5523
        body = [
          `${stroke} ${fillOp}${f(cx + rx)} ${f(cy)} m`,
          `${f(cx + rx)} ${f(cy + k * ry)} ${f(cx + k * rx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
          `${f(cx - k * rx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + k * ry)} ${f(cx - rx)} ${f(cy)} c`,
          `${f(cx - rx)} ${f(cy - k * ry)} ${f(cx - k * rx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
          `${f(cx + k * rx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - k * ry)} ${f(cx + rx)} ${f(cy)} c ${paint}`,
        ].join('\n')
      }
      break
    }
    case 'line':
    case 'arrow': {
      const [x1, y1] = pt(a.from)
      const [x2, y2] = pt(a.to)
      const head = Math.max(6, w * 3)
      rect = union([[Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]], head + w)
      extra.L = [x1, y1, x2, y2]
      extra.BS = { W: w }
      extra.LE = [PDFName.of('None'), PDFName.of(a.type === 'arrow' ? 'OpenArrow' : 'None')]
      body = `${stroke} ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S`
      if (a.type === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1)
        const wing = (d: number) => [x2 - head * Math.cos(ang + d), y2 - head * Math.sin(ang + d)] as const
        const [ax, ay] = wing(Math.PI / 6)
        const [bx, by] = wing(-Math.PI / 6)
        body += `\n${f(ax)} ${f(ay)} m ${f(x2)} ${f(y2)} l ${f(bx)} ${f(by)} l S`
      }
      break
    }
    case 'freetext': {
      rect = box(a.rect)
      const size = a.fontSize
      extra.DA = PDFString.of(`/${fonts[0]!.key} ${f(size)} Tf ${f(r)} ${f(g)} ${f(b)} rg`)
      resources.Font = Object.fromEntries(fonts.map((t) => [t.key, t.font.ref]))
      const lines = wrap(a.text, fonts, size, rect[2] - rect[0] - 4)
      const lead = size * 1.2
      body = [
        `${f(rect[0])} ${f(rect[1])} ${f(rect[2] - rect[0])} ${f(rect[3] - rect[1])} re W n`,
        `BT ${f(r)} ${f(g)} ${f(b)} rg ${f(lead)} TL ${f(rect[0] + 2)} ${f(rect[3] - 2 - size)} Td`,
        ...lines.map(
          (l, i) =>
            (i ? 'T* ' : '') +
            runs(l, fonts)
              .map((run) => `/${run.font.key} ${f(size)} Tf ${run.font.font.encodeText(run.text).toString()} Tj`)
              .join(' '),
        ),
        'ET',
      ].join('\n')
      break
    }
    case 'note': {
      // Sticky note icon: filled square with a dark border and three text lines.
      rect = box({ ...a.at, width: NOTE_SIZE, height: NOTE_SIZE })
      extra.Name = PDFName.of('Comment')
      extra.Open = false
      const [x, y, s] = [rect[0], rect[1], NOTE_SIZE]
      body = [
        `${f(r)} ${f(g)} ${f(b)} rg 0.2 0.2 0.2 RG 0.8 w ${f(x + 0.5)} ${f(y + 0.5)} ${f(s - 1)} ${f(s - 1)} re B`,
        ...[0.7, 0.5, 0.3].map((k) => `0.6 w ${f(x + 4)} ${f(y + s * k)} m ${f(x + s - 4)} ${f(y + s * k)} l S`),
      ].join('\n')
      break
    }
    case 'image': {
      rect = box(a.rect)
      extra.Name = PDFName.of(a.kind === 'stamp' ? 'Draft' : 'Image')
      extra[IMAGE_KEY] = image!.raw
      resources.XObject = { Im0: image!.xobject }
      body = `q ${f(rect[2] - rect[0])} 0 0 ${f(rect[3] - rect[1])} ${f(rect[0])} ${f(rect[1])} cm /Im0 Do Q`
      break
    }
  }

  const ap = out.context.stream(`/G0 gs\n${body}`, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: resources,
  })
  const contents = a.type === 'freetext' ? a.text : a.note
  const dict = out.context.obj({
    Type: 'Annot',
    Subtype: SUBTYPES[a.type],
    Rect: rect,
    F: 4, // Print
    C: rgb(color),
    CA: opacity,
    NM: PDFHexString.fromText(a.id),
    M: PDFString.fromDate(new Date(a.updatedAt)),
    ...(contents && { Contents: PDFHexString.fromText(contents) }),
    ...(a.author && { T: PDFHexString.fromText(a.author) }),
    ...extra,
    AP: { N: out.context.register(ap) },
    [ATELIER_KEY]: PDFHexString.fromText(JSON.stringify(stripImport(a))),
  } as Record<string, any>) as PDFDict
  return { dict, rect }
}

function stripImport(a: Annotation): Annotation {
  const copy = { ...a }
  delete copy.importedFrom
  return copy
}

/** Splits text into same-font runs; characters no font has become "?" in the first font. */
function runs(text: string, fonts: TextFont[]): { font: TextFont; text: string }[] {
  const out: { font: TextFont; text: string }[] = []
  for (const ch of text) {
    const hit = fonts.find((t) => t.has(ch))
    const [font, c] = hit ? [hit, ch] : [fonts[0]!, '?']
    const last = out.at(-1)
    if (last?.font === font) last.text += c
    else out.push({ font, text: c })
  }
  return out
}

/** Greedy word wrap using the fonts' metrics. */
function wrap(text: string, fonts: TextFont[], size: number, maxWidth: number): string[] {
  const width = (s: string) => runs(s, fonts).reduce((w, r) => w + r.font.font.widthOfTextAtSize(r.text, size), 0)
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && width(next) > maxWidth) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}
