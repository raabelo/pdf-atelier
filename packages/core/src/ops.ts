import type { Draft } from 'immer'
import type { Annotation, DocumentModel, PageModel, Rotation, SourceInfo } from './model.ts'

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
  }
}

/** Immer recipes over DocumentModel. Use with applyChange(h, label, d => docOps.x(d, ...)). */
export const docOps = {
  addAnnotations(d: D, anns: Annotation[]) {
    for (const a of anns) d.annotations[a.id] = a as Draft<Annotation>
  },

  updateAnnotation(d: D, id: string, patch: Partial<Annotation>) {
    const a = d.annotations[id]
    if (a) Object.assign(a, patch, { updatedAt: Date.now() })
  },

  removeAnnotations(d: D, ids: string[]) {
    for (const id of ids) delete d.annotations[id]
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
  },

  insertPages(d: D, index: number, pages: PageModel[]) {
    d.pages.splice(index, 0, ...pages)
  },
}
