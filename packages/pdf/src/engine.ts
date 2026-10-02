import {
  AbortException,
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Annotation, Point, Rect, Rotation } from '@pdf-atelier/core'
import { HIDDEN_FLAGS, isSupportedSubtype, readAtelierData, type AtelierData } from './atelier.ts'
import type { OutlineItem, PdfLink, PdfSource, RenderOptions, SearchHit } from './types.ts'
import { bindTextSelection } from './text-selection.ts'

let assetsBaseUrl: string | null = null
let workerReady = false

/** Where the host serves pdfjs-dist's cmaps/, standard_fonts/, wasm/ and iccs/ (with trailing slash). */
export function configurePdf(opts: { assetsBaseUrl: string }): void {
  assetsBaseUrl = opts.assetsBaseUrl.endsWith('/') ? opts.assetsBaseUrl : `${opts.assetsBaseUrl}/`
}

function ensureWorker() {
  if (workerReady) return
  workerReady = true
  // Node (tests) has no Worker: pdf.js falls back to its in-process fake worker via workerSrc.
  if (typeof Worker === 'undefined') return
  GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdf.js annotation data is untyped
type PdfJsAnnotation = Record<string, any>

/**
 * Parses a PDF. The bytes are copied (pdf.js detaches its buffer); the caller keeps the original for export.
 *
 * Annotations of supported types are NOT drawn on the canvas: the app imports them with getAnnotations()
 * and draws them from its own model (which is also what exportPdf writes back). Import every page's
 * annotations before exporting, or they are dropped.
 */
export async function loadPdf(
  bytes: Uint8Array,
  opts: { id?: string; password?: string } = {},
): Promise<PdfSource> {
  ensureWorker()
  const doc = await getDocument({
    data: bytes.slice(),
    password: opts.password,
    ...(assetsBaseUrl && {
      cMapUrl: `${assetsBaseUrl}cmaps/`,
      standardFontDataUrl: `${assetsBaseUrl}standard_fonts/`,
      wasmUrl: `${assetsBaseUrl}wasm/`,
      iccUrl: `${assetsBaseUrl}iccs/`,
    }),
  }).promise

  const pages: { width: number; height: number; rotation: Rotation }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const [x1, y1, x2, y2] = page.view as [number, number, number, number]
    pages.push({ width: x2 - x1, height: y2 - y1, rotation: (((page.rotate % 360) + 360) % 360) as Rotation })
  }
  return new PdfJsSource(opts.id ?? crypto.randomUUID(), doc, pages, bytes, opts.password)
}

class PdfJsSource implements PdfSource {
  readonly pageCount: number
  #hidden = new Map<number, Promise<void>>()
  #atelier: Promise<AtelierData> | null = null

  constructor(
    readonly id: string,
    private doc: PDFDocumentProxy,
    readonly pages: { width: number; height: number; rotation: Rotation }[],
    private bytes: Uint8Array,
    private password?: string,
  ) {
    this.pageCount = doc.numPages
  }

  #page(index: number) {
    return this.doc.getPage(index + 1)
  }

  #data() {
    this.#atelier ??= readAtelierData(this.bytes, this.password).catch(
      (): AtelierData => ({ annotations: new Map(), images: [], bookmarks: [], bookmarkGroup: null }),
    )
    return this.#atelier
  }

  /**
   * Page annotations (all intents, so NoView replies are included) and the ids the app owns.
   * Same rule as ownsAnnot in atelier.ts: our JSON; a reply whose same-page parent is owned; else a visible
   * supported subtype.
   */
  async #classify(index: number) {
    const page = await this.#page(index)
    const list = (await page.getAnnotations({ intent: 'any' })) as PdfJsAnnotation[]
    const { annotations: ours } = await this.#data()
    const byId = new Map(list.map((a) => [String(a.id), a]))
    const owns = (a: PdfJsAnnotation, depth = 0): boolean => {
      if (ours.has(String(a.id))) return true
      if (a.subtype === 'Text' && a.inReplyTo) {
        const parent = byId.get(a.inReplyTo)
        return !!parent && depth < 8 && owns(parent, depth + 1)
      }
      return isSupportedSubtype(a.subtype) && !((a.annotationFlags ?? 0) & HIDDEN_FLAGS)
    }
    return { page, list, byId, ours, owned: new Set(list.filter((a) => owns(a)).map((a) => String(a.id))) }
  }

  /** Hides annotations the app draws itself (see loadPdf). */
  #hideSupported(index: number) {
    let p = this.#hidden.get(index)
    if (!p) {
      p = this.#classify(index).then(({ owned }) => {
        for (const id of owned) this.doc.annotationStorage.setValue(id, { noView: true })
      })
      this.#hidden.set(index, p)
    }
    return p
  }

  async renderPage(index: number, canvas: HTMLCanvasElement, opts: RenderOptions) {
    await this.#hideSupported(index)
    const page = await this.#page(index)
    const dpr = globalThis.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: opts.scale * dpr, rotation: opts.rotation })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${viewport.width / dpr}px`
    canvas.style.height = `${viewport.height / dpr}px`
    const task = page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE_STORAGE })
    const cancel = () => task.cancel()
    opts.signal?.addEventListener('abort', cancel, { once: true })
    try {
      await task.promise
    } catch (e) {
      if (e instanceof RenderingCancelledException) throw new DOMException('Render cancelled', 'AbortError')
      throw e
    } finally {
      opts.signal?.removeEventListener('abort', cancel)
    }
  }

  /**
   * Each call renders into its own `.textLayer` child of `container` and its cleanup removes only that child, so a
   * stale render (zoom changed while it ran) can never wipe the layer of a newer render.
   */
  async renderTextLayer(index: number, container: HTMLElement, opts: RenderOptions) {
    const aborted = () => new DOMException('Text layer cancelled', 'AbortError')
    const page = await this.#page(index)
    if (opts.signal?.aborted) throw aborted() // the abort may land while the page loads
    const div = document.createElement('div')
    div.className = 'textLayer'
    div.style.setProperty('--scale-factor', String(opts.scale))
    div.style.setProperty('--total-scale-factor', String(opts.scale))
    div.style.setProperty('--scale-round-x', '1px')
    div.style.setProperty('--scale-round-y', '1px')
    container.append(div)
    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: div,
      viewport: page.getViewport({ scale: opts.scale, rotation: opts.rotation }),
    })
    const cancel = () => layer.cancel()
    opts.signal?.addEventListener('abort', cancel, { once: true })
    try {
      await layer.render()
      if (opts.signal?.aborted) throw aborted()
    } catch (e) {
      div.remove()
      throw e instanceof AbortException ? aborted() : e
    } finally {
      opts.signal?.removeEventListener('abort', cancel)
    }
    const unbind = bindTextSelection(div)
    return () => {
      unbind()
      layer.cancel()
      div.remove()
    }
  }

  async getLinks(index: number): Promise<PdfLink[]> {
    const page = await this.#page(index)
    const links: PdfLink[] = []
    for (const a of (await page.getAnnotations()) as PdfJsAnnotation[]) {
      if (a.subtype !== 'Link') continue
      const rect = toRect(page, a.rect)
      if (typeof a.url === 'string') links.push({ kind: 'external', url: a.url, rect })
      else if (a.dest) {
        const pageIndex = await this.#resolveDest(a.dest)
        if (pageIndex !== null) links.push({ kind: 'internal', pageIndex, rect })
      }
    }
    return links
  }

  async #resolveDest(dest: unknown): Promise<number | null> {
    try {
      const explicit = typeof dest === 'string' ? await this.doc.getDestination(dest) : dest
      if (!Array.isArray(explicit)) return null
      const target = explicit[0]
      if (Number.isInteger(target)) return target as number
      if (target && typeof target === 'object') return await this.doc.getPageIndex(target)
    } catch {
      // Broken destination in an untrusted file: treat as no link.
    }
    return null
  }

  async getPageText(index: number) {
    return (await this.#textItems(index)).text
  }

  async #textItems(index: number) {
    const page = await this.#page(index)
    const content = await page.getTextContent()
    let text = ''
    const items: { start: number; str: string; transform: number[]; width: number; height: number }[] = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      items.push({ start: text.length, str: item.str, transform: item.transform, width: item.width, height: item.height })
      text += item.str + (item.hasEOL ? '\n' : '')
    }
    return { page, text, items }
  }

  async *search(query: string, opts: { caseSensitive?: boolean; signal?: AbortSignal } = {}): AsyncIterable<SearchHit> {
    if (!query) return
    const needle = opts.caseSensitive ? query : query.toLowerCase()
    for (let i = 0; i < this.pageCount; i++) {
      if (opts.signal?.aborted) return
      const { page, text, items } = await this.#textItems(i)
      const hay = opts.caseSensitive ? text : text.toLowerCase()
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
        const end = at + needle.length
        const rects: Rect[] = []
        for (const it of items) {
          const itEnd = it.start + it.str.length
          if (itEnd <= at || it.start >= end || !it.str.length) continue
          // ponytail: assumes uniform glyph width inside an item; good enough for highlights.
          const charW = it.width / it.str.length
          const from = Math.max(at, it.start) - it.start
          const to = Math.min(end, itEnd) - it.start
          // Rotated text: walk along the baseline direction, then take the axis-aligned bounds of the glyph box.
          const [a, b, c, d, e, f] = it.transform as [number, number, number, number, number, number]
          const len = Math.hypot(a, b) || 1
          const [cos, sin] = [a / len, b / len]
          const h = it.height || Math.hypot(c, d)
          const corners = [from * charW, to * charW].flatMap((dist) =>
            [-0.2, 0.8].map((up) => [e + dist * cos - up * h * sin, f + dist * sin + up * h * cos] as const),
          )
          const xs = corners.map((p) => p[0])
          const ys = corners.map((p) => p[1])
          rects.push(toRect(page, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]))
        }
        yield { pageIndex: i, rects, snippet: text.slice(Math.max(0, at - 30), end + 30).replace(/\s+/g, ' ') }
      }
    }
  }

  async getAnnotations(index: number, pageId: string): Promise<Annotation[]> {
    const { page, list, byId, ours, owned } = await this.#classify(index)
    const result = new Map<string, Annotation>() // by pdf.js object id
    const replies: PdfJsAnnotation[] = []
    for (const a of list) {
      const objectId = String(a.id)
      if (!owned.has(objectId)) continue
      if (a.subtype === 'Text' && a.inReplyTo && !ours.has(objectId)) {
        replies.push(a)
        continue
      }
      const importedFrom = { objectId }
      const mine = ours.get(objectId)
      const ann = mine ? { ...mine, pageId, importedFrom } : fromPdfJs(page, a, pageId, importedFrom)
      if (ann) result.set(objectId, ann)
    }
    // Foreign reply threads: attach to the root annotation. Our own annotations carry replies in their JSON.
    for (const r of replies) {
      let root = r
      for (let i = 0; i < 8 && root.subtype === 'Text' && root.inReplyTo && byId.has(root.inReplyTo); i++) root = byId.get(root.inReplyTo)!
      const parent = result.get(String(root.id))
      if (!parent || ours.has(String(root.id))) continue
      ;(parent.replies ??= []).push({
        id: crypto.randomUUID(),
        text: String(r.contentsObj?.str ?? ''),
        createdAt: Date.now(),
        ...(r.titleObj?.str && { author: String(r.titleObj.str) }),
      })
    }
    return [...result.values()]
  }

  async getAtelierExtras() {
    const { images, bookmarks } = await this.#data()
    return { images, bookmarks }
  }

  async getOutline(): Promise<OutlineItem[]> {
    const convert = async (items: { title: string; dest: unknown; items: unknown[] }[]): Promise<OutlineItem[]> =>
      Promise.all(
        items.map(async (it) => ({
          title: it.title,
          pageIndex: it.dest ? await this.#resolveDest(it.dest) : null,
          children: await convert(it.items as typeof items),
        })),
      )
    const items = (await this.doc.getOutline()) ?? []
    // Our bookmarks group is exposed via getAtelierExtras(), not as outline.
    const { bookmarkGroup } = await this.#data()
    return convert(bookmarkGroup === null ? items : items.filter((_, i) => i !== bookmarkGroup))
  }

  async destroy() {
    await this.doc.loadingTask.destroy()
  }
}

/** PDF user-space [x1,y1,x2,y2] -> domain rect (top-left of the unrotated crop box). */
function toRect(page: PDFPageProxy, r: ArrayLike<number>): Rect {
  const [vx, , , vy2] = page.view as [number, number, number, number]
  const x1 = Math.min(r[0]!, r[2]!), x2 = Math.max(r[0]!, r[2]!)
  const y1 = Math.min(r[1]!, r[3]!), y2 = Math.max(r[1]!, r[3]!)
  return { x: x1 - vx, y: vy2 - y2, width: x2 - x1, height: y2 - y1 }
}

function toPoint(page: PDFPageProxy, x: number, y: number): Point {
  const [vx, , , vy2] = page.view as [number, number, number, number]
  return { x: x - vx, y: vy2 - y }
}

function hex(color: ArrayLike<number> | null | undefined, fallback = '#000000') {
  if (!color || color.length < 3) return fallback
  return `#${Array.from(color).slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

/** Converts a foreign annotation (not written by PDF Atelier) to the domain model. */
function fromPdfJs(
  page: PDFPageProxy,
  a: PdfJsAnnotation,
  pageId: string,
  importedFrom: { objectId: string },
): Annotation | null {
  const now = Date.now()
  const base = {
    id: crypto.randomUUID(),
    pageId,
    importedFrom,
    createdAt: now,
    updatedAt: now,
    style: {
      color: hex(a.color),
      fill: null,
      strokeWidth: a.borderStyle?.width || 1,
      opacity: typeof a.opacity === 'number' ? a.opacity : 1,
    },
    ...(a.contentsObj?.str && { note: String(a.contentsObj.str) }),
    ...(a.titleObj?.str && { author: String(a.titleObj.str) }),
  }
  switch (a.subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut': {
      const q: ArrayLike<number> | null = a.quadPoints
      const rects: Rect[] = []
      if (q) for (let i = 0; i + 7 < q.length; i += 8) rects.push(toRect(page, [q[i + 4]!, q[i + 5]!, q[i + 2]!, q[i + 3]!]))
      else rects.push(toRect(page, a.rect))
      const type = a.subtype === 'StrikeOut' ? 'strikeout' : (a.subtype.toLowerCase() as 'highlight' | 'underline')
      return { ...base, type, rects, text: '' }
    }
    case 'Ink':
      return {
        ...base,
        type: 'ink',
        paths: (a.inkLists as ArrayLike<number>[]).map((l) => {
          const pts: Point[] = []
          for (let i = 0; i + 1 < l.length; i += 2) pts.push(toPoint(page, l[i]!, l[i + 1]!))
          return pts
        }),
      }
    case 'Square':
    case 'Circle':
      return { ...base, type: a.subtype === 'Square' ? 'rect' : 'ellipse', rect: toRect(page, a.rect) }
    case 'Line': {
      // ponytail: pdf.js normalizes /L, so direction of foreign lines is lost; our own lines round-trip via JSON.
      const [x1, y1, x2, y2] = a.lineCoordinates as number[]
      const arrow = (a.lineEndings as string[] | undefined)?.some((e) => e && e !== 'None')
      return { ...base, type: arrow ? 'arrow' : 'line', from: toPoint(page, x1!, y1!), to: toPoint(page, x2!, y2!) }
    }
    case 'Text': {
      const r = toRect(page, a.rect)
      return { ...base, type: 'note', at: { x: r.x, y: r.y } }
    }
    case 'FreeText': {
      // For FreeText, /Contents is the text itself, not a note.
      const rest: Partial<typeof base> = { ...base }
      delete rest.note
      return {
        ...(rest as typeof base),
        style: { ...base.style, color: hex(a.defaultAppearanceData?.fontColor, base.style.color) },
        type: 'freetext',
        rect: toRect(page, a.rect),
        text: String(a.contentsObj?.str ?? ''),
        fontSize: a.defaultAppearanceData?.fontSize || 12,
      }
    }
  }
  return null
}
