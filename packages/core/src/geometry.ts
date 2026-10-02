import type { Annotation, Point, Rect, Rotation } from './model.ts'

interface Size {
  width: number
  height: number
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** Size after rotation (90/270 swap width and height). */
export function rotateSize(width: number, height: number, rotation: Rotation): Size {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width }
}

/** Page coords (unrotated, top-left origin) -> view pixels. Rotation is clockwise, like PDF /Rotate. */
export function pageToView(p: Point, page: Size, rotation: Rotation, scale: number): Point {
  const { width: w, height: h } = page
  const r =
    rotation === 90 ? { x: h - p.y, y: p.x }
    : rotation === 180 ? { x: w - p.x, y: h - p.y }
    : rotation === 270 ? { x: p.y, y: w - p.x }
    : p
  return { x: r.x * scale, y: r.y * scale }
}

export function viewToPage(v: Point, page: Size, rotation: Rotation, scale: number): Point {
  const { width: w, height: h } = page
  const x = v.x / scale
  const y = v.y / scale
  return rotation === 90 ? { x: y, y: h - x }
    : rotation === 180 ? { x: w - x, y: h - y }
    : rotation === 270 ? { x: w - y, y: x }
    : { x, y }
}

export function rectToView(r: Rect, page: Size, rotation: Rotation, scale: number): Rect {
  return normalizeRect(
    pageToView({ x: r.x, y: r.y }, page, rotation, scale),
    pageToView({ x: r.x + r.width, y: r.y + r.height }, page, rotation, scale),
  )
}

export function viewToPageRect(r: Rect, page: Size, rotation: Rotation, scale: number): Rect {
  return normalizeRect(
    viewToPage({ x: r.x, y: r.y }, page, rotation, scale),
    viewToPage({ x: r.x + r.width, y: r.y + r.height }, page, rotation, scale),
  )
}

/** Sticky note icon size in points. */
export const NOTE_SIZE = 20

function boundsOfPoints(points: Point[]): Rect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return normalizeRect({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) })
}

/** Bounding box in page coords (stroke width not included). */
export function annotationBounds(a: Annotation): Rect {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return boundsOfPoints(a.rects.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }]))
    case 'ink':
      return boundsOfPoints(a.paths.flat())
    case 'line':
    case 'arrow':
      return normalizeRect(a.from, a.to)
    case 'note':
      return { ...a.at, width: NOTE_SIZE, height: NOTE_SIZE }
    default:
      return a.rect
  }
}

const move = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy })
const moveRect = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy })

/** Returns a moved copy; pass its geometry to docOps.updateAnnotation. */
export function translateAnnotation<A extends Annotation>(a: A, dx: number, dy: number): A {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { ...a, rects: a.rects.map((r) => moveRect(r, dx, dy)) }
    case 'ink':
      return { ...a, paths: a.paths.map((path) => path.map((p) => move(p, dx, dy))) }
    case 'line':
    case 'arrow':
      return { ...a, from: move(a.from, dx, dy), to: move(a.to, dx, dy) }
    case 'note':
      return { ...a, at: move(a.at, dx, dy) }
    default:
      return { ...a, rect: moveRect(a.rect, dx, dy) }
  }
}

/** Topmost annotation (last in list) whose bounds, grown by `tolerance`, contain `p`. */
export function hitTest(annotations: Annotation[], p: Point, tolerance = 4): Annotation | undefined {
  // ponytail: bounding-box hit test; precise stroke/ellipse hits when selection feels wrong
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]!
    const b = annotationBounds(a)
    const t = tolerance + a.style.strokeWidth / 2
    if (p.x >= b.x - t && p.x <= b.x + b.width + t && p.y >= b.y - t && p.y <= b.y + b.height + t) return a
  }
  return undefined
}
