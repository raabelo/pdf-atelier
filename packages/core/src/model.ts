/**
 * Domain model. Pure data (serializable, Immer-friendly). No DOM, React or PDF engine types.
 *
 * Coordinates: PDF points (1/72in), origin at the TOP-LEFT of the page's unrotated crop box, y grows down.
 * The view layer applies zoom/rotation; the writer converts to PDF user space (bottom-left origin).
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Rotation = 0 | 90 | 180 | 270

/** A page of the edited document. Annotations reference pages by `id`, so reordering never breaks them. */
export interface PageModel {
  id: string
  /** Which loaded source PDF and page this page comes from. */
  sourceId: string
  sourceIndex: number
  /** Unrotated size in points. */
  width: number
  height: number
  /** Total rotation shown/exported (source /Rotate + user rotation). */
  rotation: Rotation
}

export interface SourceInfo {
  id: string
  name: string
}

export interface AnnotationStyle {
  /** CSS hex color, e.g. "#ffd400". */
  color: string
  /** Fill color for shapes, null = no fill. */
  fill: string | null
  /** Stroke width in points. */
  strokeWidth: number
  /** 0..1 */
  opacity: number
}

interface AnnotationBase {
  id: string
  pageId: string
  style: AnnotationStyle
  createdAt: number
  updatedAt: number
  author?: string
  /** Comment attached to the annotation (PDF /Contents). */
  note?: string
  /** Replies thread (exported as /Text annotations with /IRT pointing to this one). */
  replies?: Reply[]
  /** Set when imported from the PDF file; the writer replaces the original object on save. */
  importedFrom?: { objectId: string }
}

export interface TextMarkupAnnotation extends AnnotationBase {
  type: 'highlight' | 'underline' | 'strikeout'
  /** One rect per covered text line. */
  rects: Rect[]
  /** Covered text, shown in the annotations panel. */
  text: string
}

export interface InkAnnotation extends AnnotationBase {
  type: 'ink'
  paths: Point[][]
}

export interface ShapeAnnotation extends AnnotationBase {
  type: 'rect' | 'ellipse'
  rect: Rect
}

export interface LineAnnotation extends AnnotationBase {
  type: 'line' | 'arrow'
  from: Point
  to: Point
}

export interface FreeTextAnnotation extends AnnotationBase {
  type: 'freetext'
  rect: Rect
  text: string
  fontSize: number
}

export interface Reply {
  id: string
  author?: string
  text: string
  createdAt: number
}

/** Sticky note (PDF /Text). `at` is the icon's top-left; `note` holds the text. */
export interface NoteAnnotation extends AnnotationBase {
  type: 'note'
  at: Point
}

/** Raster placed on the page: inserted image, drawn signature or stamp (exported as /Stamp with image /AP). */
export interface ImageAnnotation extends AnnotationBase {
  type: 'image'
  kind: 'image' | 'signature' | 'stamp'
  rect: Rect
  /** Key into DocumentModel.images. */
  imageId: string
}

export type Annotation =
  | TextMarkupAnnotation
  | InkAnnotation
  | ShapeAnnotation
  | LineAnnotation
  | FreeTextAnnotation
  | NoteAnnotation
  | ImageAnnotation

export type AnnotationType = Annotation['type']

/** Non-destructive edit model: source refs + page list + annotations. Source bytes live outside the state. */
export interface DocumentModel {
  id: string
  title: string
  sources: Record<string, SourceInfo>
  pages: PageModel[]
  annotations: Record<string, Annotation>
  /** Image bytes shared by image annotations (deduped by id). */
  images: Record<string, ImageAsset>
  /** User page bookmarks (exported as PDF outline entries). */
  bookmarks: Bookmark[]
}

export interface ImageAsset {
  id: string
  mime: 'image/png' | 'image/jpeg'
  /** Not drafted/frozen by Immer (typed arrays aren't draftable). Never mutate in place. */
  data: Uint8Array
  width: number
  height: number
}

export interface Bookmark {
  id: string
  pageId: string
  title: string
}

/** PageModel.sourceId of pages that have no source PDF (inserted blank pages). */
export const BLANK_SOURCE = '__blank__'
