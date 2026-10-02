/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted JSON / pdf-lib literal dicts, validated at runtime */
import {
  degrees,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib'
import fontkit from '@cantoo/fontkit'
import type { Annotation, DocumentModel, Point, Rect } from '@pdf-atelier/core'
import { loadNotoSans, pdfFontkit } from './fonts.ts'

/** Private key holding the domain annotation JSON, so our annotations round-trip without loss. */
const ATELIER_KEY = 'PDFAtelier'

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
}
const SUPPORTED = new Set(Object.values(SUBTYPES))

/** Annotation subtypes the app owns: imported into the model, hidden from the canvas, rewritten on export. */
export function isSupportedSubtype(subtype: unknown): boolean {
  return typeof subtype === 'string' && SUPPORTED.has(subtype)
}

const refKey = (ref: PDFRef) => (ref.generationNumber === 0 ? `${ref.objectNumber}R` : `${ref.objectNumber}R${ref.generationNumber}`)

/**
 * Reads /PDFAtelier JSON from every annotation, keyed by pdf.js-style object id ("12R").
 * pdf.js does not expose custom keys, hence the second parser. The JSON comes from an untrusted file: validated.
 */
export async function readAtelierAnnotations(bytes: Uint8Array, password?: string): Promise<Map<string, Annotation>> {
  // Without the password, encrypted strings stay ciphertext, fail JSON.parse and fall back to the standard fields.
  const doc = await PDFDocument.load(bytes, { ...(password ? { password } : { ignoreEncryption: true }), updateMetadata: false })
  const out = new Map<string, Annotation>()
  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      if (!(ref instanceof PDFRef)) continue
      const raw = doc.context.lookup(ref, PDFDict).get(PDFName.of(ATELIER_KEY))
      if (!(raw instanceof PDFHexString || raw instanceof PDFString)) continue
      try {
        const ann: unknown = JSON.parse(raw.decodeText())
        if (isValidAnnotation(ann)) out.set(refKey(ref), ann)
      } catch {
        // Malformed JSON: fall back to the standard PDF fields.
      }
    }
  }
  return out
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isPoint = (p: any): p is Point => p && num(p.x) && num(p.y)
const isRect = (r: any): r is Rect => isPoint(r) && num((r as any).width) && num((r as any).height)

function isValidAnnotation(a: any): a is Annotation {
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !(a.type in SUBTYPES)) return false
  const s = a.style
  if (!s || typeof s.color !== 'string' || !num(s.strokeWidth) || !num(s.opacity)) return false
  if (s.fill !== null && typeof s.fill !== 'string') return false
  if (!num(a.createdAt) || !num(a.updatedAt)) return false
  if (a.note !== undefined && typeof a.note !== 'string') return false
  switch (a.type as Annotation['type']) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return Array.isArray(a.rects) && a.rects.every(isRect) && typeof a.text === 'string'
    case 'ink':
      return Array.isArray(a.paths) && a.paths.every((p: unknown) => Array.isArray(p) && p.every(isPoint))
    case 'rect':
    case 'ellipse':
      return isRect(a.rect)
    case 'line':
    case 'arrow':
      return isPoint(a.from) && isPoint(a.to)
    case 'freetext':
      return isRect(a.rect) && typeof a.text === 'string' && num(a.fontSize)
  }
}

/**
 * Builds the output PDF from the model: pages copied in order with their rotation, then annotations.
 * The model is the source of truth for supported annotation types: every such annotation already in the
 * sources is dropped and the model's annotations are written (standard /Annot + /AP + /PDFAtelier JSON).
 */
export async function exportPdf(
  doc: DocumentModel,
  sources: ReadonlyMap<string, { bytes: Uint8Array; password?: string }>,
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  out.registerFontkit(pdfFontkit)
  let password: string | undefined

  // One copyPages call per source so shared resources (fonts, images) are copied once.
  const wanted = new Map<string, number[]>()
  for (const p of doc.pages) (wanted.get(p.sourceId) ?? wanted.set(p.sourceId, []).get(p.sourceId)!).push(p.sourceIndex)
  const copied = new Map<string, PDFPage[]>()
  for (const [sourceId, indices] of wanted) {
    const source = sources.get(sourceId)
    if (!source) throw new Error(`Missing bytes for source ${sourceId}`)
    const src = await PDFDocument.load(source.bytes, { updateMetadata: false, ...(source.password && { password: source.password }) })
    password ??= source.password
    for (const i of new Set(indices)) dropOwnedAnnots(src, src.getPage(i))
    copied.set(sourceId, await out.copyPages(src, indices))
  }

  const byPage = new Map<string, Annotation[]>()
  for (const a of Object.values(doc.annotations)) (byPage.get(a.pageId) ?? byPage.set(a.pageId, []).get(a.pageId)!).push(a)

  const fontsFor = textFonts(out)
  for (const p of doc.pages) {
    const page = copied.get(p.sourceId)!.shift()!
    out.addPage(page)
    page.setRotation(degrees(p.rotation))
    for (const a of byPage.get(p.id) ?? []) {
      if (a.type === 'ink' && !a.paths.some((path) => path.length)) continue
      const fonts = a.type === 'freetext' ? await fontsFor(a.text) : []
      page.node.addAnnot(out.context.register(buildAnnot(out, page, a, fonts)))
    }
  }
  // Saving must never silently strip protection: when a source was password-protected, the output is encrypted
  // with that password as both user and owner password (AES-256, the library default). With several protected
  // sources, the first one's password is used.
  if (password) out.encrypt({ userPassword: password, ownerPassword: password })
  return out.save()
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

function dropOwnedAnnots(src: PDFDocument, page: PDFPage) {
  const annots = page.node.Annots()
  if (!annots) return
  const removed = new Set<string>()
  const keep: PDFRef[] = []
  const entries = annots.asArray().map((ref) => ({ ref, dict: src.context.lookupMaybe(ref, PDFDict) }))
  for (const { ref, dict } of entries) {
    const subtype = dict?.get(PDFName.of('Subtype'))
    if (isSupportedSubtype(subtype instanceof PDFName ? subtype.decodeText() : null)) {
      if (ref instanceof PDFRef) removed.add(refKey(ref))
    }
  }
  for (const { ref, dict } of entries) {
    if (!(ref instanceof PDFRef) || removed.has(refKey(ref))) continue
    // Popups belong to the markup annotation they annotate.
    const parent = dict?.get(PDFName.of('Parent'))
    if (parent instanceof PDFRef && removed.has(refKey(parent))) continue
    keep.push(ref)
  }
  page.node.set(PDFName.of('Annots'), src.context.obj(keep))
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

function buildAnnot(out: PDFDocument, page: PDFPage, a: Annotation, fonts: TextFont[]): PDFDict {
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
  }

  const ap = out.context.stream(`/G0 gs\n${body}`, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: resources,
  })
  const contents = a.type === 'freetext' ? a.text : a.note
  return out.context.obj({
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
