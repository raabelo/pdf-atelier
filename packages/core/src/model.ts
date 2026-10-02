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

export type Annotation =
  | TextMarkupAnnotation
  | InkAnnotation
  | ShapeAnnotation
  | LineAnnotation
  | FreeTextAnnotation

export type AnnotationType = Annotation['type']

/** Non-destructive edit model: source refs + page list + annotations. Source bytes live outside the state. */
export interface DocumentModel {
  id: string
  title: string
  sources: Record<string, SourceInfo>
  pages: PageModel[]
  annotations: Record<string, Annotation>
}
