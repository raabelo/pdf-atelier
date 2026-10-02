import { current, isDraft, type Draft } from 'immer'
import { translateAnnotation } from './geometry.ts'
import {
  BLANK_SOURCE,
  type Annotation,
  type AnnotationStyle,
  type DocumentModel,
  type ImageAsset,
  type PageModel,
  type Point,
  type Reply,
  type Rotation,
  type SourceInfo,
} from './model.ts'

type D = Draft<DocumentModel>

export const newId = (): string => crypto.randomUUID()

export function createDocument(input: {
  title: string
  source: SourceInfo
  pages: { width: number; height: number; rotation: Rotation }[]
}): DocumentModel {
  return {
    id: newId(),
    title: input.title,
    sources: { [input.source.id]: input.source },
    pages: input.pages.map((p, i) => ({ id: newId(), sourceId: input.source.id, sourceIndex: i, ...p })),
    annotations: {},
    images: {},
    bookmarks: [],
  }
}

export interface Clipboard {
  annotations: Annotation[]
  images: ImageAsset[]
}

/** Snapshot of annotations (and the images they use) for copy/paste. Plain function, not a recipe. */
export function collectClipboard(doc: DocumentModel, ids: string[]): Clipboard {
  const annotations = ids.map((id) => doc.annotations[id]).filter((a): a is Annotation => !!a)
  const imageIds = new Set(annotations.flatMap((a) => (a.type === 'image' ? [a.imageId] : [])))
  const images = [...imageIds].map((id) => doc.images[id]).filter((i): i is ImageAsset => !!i)
  return { annotations: structuredClone(annotations), images }
}

/** Copy of `a` with fresh ids (annotation + replies), moved by `offset`, optionally to another page. */
function cloneAnnotation(a: Annotation, offset: Point, pageId = a.pageId): Annotation {
  const now = Date.now()
  // Drafts are proxies: structuredClone needs the plain current value.
  const copy = translateAnnotation(structuredClone(isDraft(a) ? current(a) : a), offset.x, offset.y)
  delete copy.importedFrom
  return {
    ...copy,
    id: newId(),
    pageId,
    createdAt: now,
    updatedAt: now,
    ...(a.replies ? { replies: a.replies.map((r) => ({ ...r, id: newId() })) } : {}),
  }
}

function addAll(d: D, anns: Annotation[]): string[] {
  for (const a of anns) d.annotations[a.id] = a as Draft<Annotation>
  return anns.map((a) => a.id)
}

/** Immer recipes over DocumentModel. Use with applyChange(h, label, d => docOps.x(d, ...)). */
export const docOps = {
  addAnnotations(d: D, anns: Annotation[]) {
    addAll(d, anns)
  },

  updateAnnotation(d: D, id: string, patch: Partial<Annotation>) {
    const a = d.annotations[id]
    if (a) Object.assign(a, patch, { updatedAt: Date.now() })
  },

  removeAnnotations(d: D, ids: string[]) {
    for (const id of ids) delete d.annotations[id]
  },

  duplicateAnnotations(d: D, ids: string[], offset: Point): string[] {
    const src = ids.map((id) => d.annotations[id]).filter((a) => !!a) as Annotation[]
    return addAll(d, src.map((a) => cloneAnnotation(a, offset)))
  },

  pasteAnnotations(d: D, clip: Clipboard, pageId: string, offset: Point): string[] {
    for (const img of clip.images) d.images[img.id] ??= img as Draft<ImageAsset>
    return addAll(d, clip.annotations.map((a) => cloneAnnotation(a, offset, pageId)))
  },

  setStyle(d: D, ids: string[], style: Partial<AnnotationStyle>) {
    for (const id of ids) {
      const a = d.annotations[id]
      if (a) Object.assign(a, { style: { ...a.style, ...style }, updatedAt: Date.now() })
    }
  },

  addReply(d: D, annId: string, reply: Reply) {
    const a = d.annotations[annId]
    if (a) (a.replies ??= []).push(reply)
  },

  updateReply(d: D, annId: string, replyId: string, text: string) {
    const r = d.annotations[annId]?.replies?.find((r) => r.id === replyId)
    if (r) r.text = text
  },

  removeReply(d: D, annId: string, replyId: string) {
    const a = d.annotations[annId]
    if (a?.replies) a.replies = a.replies.filter((r) => r.id !== replyId)
  },

  addImage(d: D, asset: ImageAsset) {
    d.images[asset.id] ??= asset as Draft<ImageAsset>
  },

  /** Moves pages (keeping their relative order) so they land before the page currently at `toIndex`. */
  movePages(d: D, pageIds: string[], toIndex: number) {
    const ids = new Set(pageIds)
    const moved = d.pages.filter((p) => ids.has(p.id))
    if (moved.length === 0) return
    const before = d.pages.slice(0, toIndex).filter((p) => ids.has(p.id)).length
    const rest = d.pages.filter((p) => !ids.has(p.id))
    const at = Math.max(0, Math.min(rest.length, toIndex - before))
    rest.splice(at, 0, ...moved)
    d.pages = rest
  },

  rotatePages(d: D, pageIds: string[], delta: 90 | -90 | 180) {
    const ids = new Set(pageIds)
    for (const p of d.pages) if (ids.has(p.id)) p.rotation = ((((p.rotation + delta) % 360) + 360) % 360) as Rotation
  },

  removePages(d: D, pageIds: string[]) {
    const ids = new Set(pageIds)
    if (d.pages.every((p) => ids.has(p.id))) throw new Error('Cannot remove every page of a document')
    d.pages = d.pages.filter((p) => !ids.has(p.id))
    for (const [id, a] of Object.entries(d.annotations)) if (ids.has(a.pageId)) delete d.annotations[id]
    d.bookmarks = d.bookmarks.filter((b) => !ids.has(b.pageId))
  },

  insertPages(d: D, index: number, pages: PageModel[]) {
    d.pages.splice(index, 0, ...pages)
  },

  /** Copies go right after the last selected page, in document order, with their annotations. */
  duplicatePages(d: D, pageIds: string[]): string[] {
    const ids = new Set(pageIds)
    const selected = d.pages.filter((p) => ids.has(p.id))
    if (selected.length === 0) return []
    const at = Math.max(...selected.map((p) => d.pages.indexOf(p))) + 1
    const copies = selected.map((p) => ({ ...p, id: newId() }))
    const pageMap = new Map(selected.map((p, i) => [p.id, copies[i]!.id]))
    const anns = Object.values(d.annotations).filter((a) => pageMap.has(a.pageId)) as Annotation[]
    addAll(d, anns.map((a) => cloneAnnotation(a, { x: 0, y: 0 }, pageMap.get(a.pageId))))
    d.pages.splice(at, 0, ...copies)
    return copies.map((p) => p.id)
  },

  insertBlankPages(d: D, index: number, count: number, size: { width: number; height: number }): string[] {
    const pages: PageModel[] = Array.from({ length: count }, () => ({
      id: newId(),
      sourceId: BLANK_SOURCE,
      sourceIndex: 0,
      width: size.width,
      height: size.height,
      rotation: 0,
    }))
    d.pages.splice(index, 0, ...pages)
    return pages.map((p) => p.id)
  },

  /** Merge = addSource + insertPages. */
  addSource(d: D, source: SourceInfo) {
    d.sources[source.id] = source
  },

  addBookmark(d: D, pageId: string, title: string): string {
    const id = newId()
    d.bookmarks.push({ id, pageId, title })
    return id
  },

  renameBookmark(d: D, id: string, title: string) {
    const b = d.bookmarks.find((b) => b.id === id)
    if (b) b.title = title
  },

  removeBookmark(d: D, id: string) {
    d.bookmarks = d.bookmarks.filter((b) => b.id !== id)
  },
}
