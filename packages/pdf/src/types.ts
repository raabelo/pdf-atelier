import type { Annotation, ImageAsset, Rect, Rotation } from '@pdf-atelier/core'

/** A parsed PDF file. Wraps PDF.js; no PDF.js types leak out of this package. */
export interface PdfSource {
  readonly id: string
  readonly pageCount: number
  /** Unrotated size in points + intrinsic /Rotate, per page. */
  readonly pages: ReadonlyArray<{ width: number; height: number; rotation: Rotation }>
  renderPage(index: number, canvas: HTMLCanvasElement, opts: RenderOptions): Promise<void>
  /** Renders selectable text into `container` (sized by the caller). Returns cleanup. */
  renderTextLayer(index: number, container: HTMLElement, opts: RenderOptions): Promise<() => void>
  /** Link areas in page coords; the UI renders and opens them safely. */
  getLinks(index: number): Promise<PdfLink[]>
  getPageText(index: number): Promise<string>
  /** Rects in page coords (top-left origin, unrotated). */
  search(query: string, opts?: { caseSensitive?: boolean; signal?: AbortSignal }): AsyncIterable<SearchHit>
  /** Existing annotations converted to the domain model (unsupported types skipped). */
  getAnnotations(index: number, pageId: string): Promise<Annotation[]>
  /**
   * PDF Atelier data that is not per page: image bytes used by imported image annotations (add them to
   * DocumentModel.images) and our bookmarks (pageIndex of this source; map to page ids).
   */
  getAtelierExtras(): Promise<{ images: ImageAsset[]; bookmarks: { pageIndex: number; title: string }[] }>
  /** The file's own outline (our bookmarks group excluded). */
  getOutline(): Promise<OutlineItem[]>
  destroy(): Promise<void>
}

export interface RenderOptions {
  /** CSS pixels per point (zoom). Device pixel ratio is applied internally. */
  scale: number
  rotation: Rotation
  signal?: AbortSignal
}

export type PdfLink = { rect: Rect } & (
  | { kind: 'internal'; pageIndex: number }
  | { kind: 'external'; url: string }
)

export interface SearchHit {
  pageIndex: number
  rects: Rect[]
  snippet: string
}

export interface OutlineItem {
  title: string
  pageIndex: number | null
  children: OutlineItem[]
}
