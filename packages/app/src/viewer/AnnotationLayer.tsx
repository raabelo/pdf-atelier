import {
  NOTE_SIZE,
  annotationBounds,
  docOps,
  newId,
  normalizeRect,
  translateAnnotation,
  viewToPage,
  type Annotation,
  type PageModel,
  type Point,
  type Rect,
  type Rotation,
} from '@pdf-atelier/core'
import { GAP_MARGIN, type PdfLink } from '@pdf-atelier/pdf'
import { cn } from 'cn'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { t } from '../i18n/index.ts'
import { usePlatform } from '../platform.ts'
import { useDocuments, type OpenDoc } from '../stores/documents.ts'
import { askConfirm, goToPage, useUi, type Tool } from '../stores/ui.ts'
import { idsInRect, nextSelection } from '../annotations/actions.ts'
import { Shape } from './shapes.tsx'

/** SVG transform from page coords (unrotated, top-left origin) to view pixels. Mirrors core pageToView. */
function pageMatrix(w: number, h: number, rotation: Rotation, s: number) {
  switch (rotation) {
    case 90:
      return `matrix(0 ${s} ${-s} 0 ${h * s} 0)`
    case 180:
      return `matrix(${-s} 0 0 ${-s} ${w * s} ${h * s})`
    case 270:
      return `matrix(0 ${-s} ${s} 0 0 ${w * s})`
    default:
      return `matrix(${s} 0 0 ${s} 0 0)`
  }
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Drag =
  | { kind: 'move'; start: Point; at: Point }
  | { kind: 'resize'; id: string; fixed: Point; at: Point; keepAspect: boolean }
  | { kind: 'draw'; points: Point[] }

const DRAW_TOOLS = new Set<Tool>(['ink', 'rect', 'ellipse', 'line', 'arrow', 'freetext'])
const MARKUP_TOOLS = new Set<Tool>(['highlight', 'underline', 'strikeout'])

function corners(r: Rect): Record<Corner, Point> {
  return {
    nw: { x: r.x, y: r.y },
    ne: { x: r.x + r.width, y: r.y },
    sw: { x: r.x, y: r.y + r.height },
    se: { x: r.x + r.width, y: r.y + r.height },
  }
}
const opposite: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }

/** Dragged corner constrained to the rect's aspect ratio (Shift while resizing). */
function keepRatio(fixed: Point, at: Point, ratio: number): Point {
  const dx = at.x - fixed.x
  const dy = at.y - fixed.y
  let w = Math.abs(dx)
  let h = Math.abs(dy)
  if (w / h > ratio) w = h * ratio
  else h = w / ratio
  return { x: fixed.x + Math.sign(dx || 1) * w, y: fixed.y + Math.sign(dy || 1) * h }
}

/** Applies an in-progress drag to an annotation (preview and commit share this). */
function dragged(a: Annotation, drag: Drag | null, selection: string[]): Annotation {
  if (drag?.kind === 'move' && selection.includes(a.id))
    return translateAnnotation(a, drag.at.x - drag.start.x, drag.at.y - drag.start.y)
  if (drag?.kind === 'resize' && drag.id === a.id && 'rect' in a) {
    const at =
      drag.keepAspect && a.rect.height > 0
        ? keepRatio(drag.fixed, drag.at, a.rect.width / a.rect.height)
        : drag.at
    return { ...a, rect: normalizeRect(drag.fixed, at) }
  }
  return a
}

/** Sticky note centered on the click. */
function newNote(pageId: string, p: Point): Annotation {
  const now = Date.now()
  return {
    id: newId(),
    type: 'note',
    pageId,
    at: { x: p.x - NOTE_SIZE / 2, y: p.y - NOTE_SIZE / 2 },
    style: { ...useUi.getState().styles.note },
    createdAt: now,
    updatedAt: now,
  }
}

/** Builds the annotation for a finished drawing gesture. */
function fromGesture(tool: Tool, points: Point[], pageId: string): Annotation | null {
  const style = useUi.getState().styles[tool as Annotation['type']]
  const base = { id: newId(), pageId, style, createdAt: Date.now(), updatedAt: Date.now() }
  const first = points[0]!
  const last = points.at(-1)!
  const tiny = Math.hypot(last.x - first.x, last.y - first.y) < 3
  switch (tool) {
    case 'ink':
      return points.length > 1 ? { ...base, type: 'ink', paths: [points] } : null
    case 'rect':
    case 'ellipse':
      return tiny ? null : { ...base, type: tool, rect: normalizeRect(first, last) }
    case 'line':
    case 'arrow':
      return tiny ? null : { ...base, type: tool, from: first, to: last }
    case 'freetext': {
      const rect = tiny
        ? { x: first.x, y: first.y, width: 180, height: 32 }
        : normalizeRect(first, last)
      return { ...base, type: 'freetext', rect, text: '', fontSize: useUi.getState().fontSize }
    }
    default:
      return null
  }
}

interface Props {
  doc: OpenDoc
  page: PageModel
  rotation: Rotation
  scale: number
  annotations: Annotation[]
}

export function AnnotationLayer({ doc, page, rotation, scale, annotations }: Props) {
  const platform = usePlatform()
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const editing = useUi((s) => s.editing)
  const hits = useUi((s) => s.search.hits)
  const activeHit = useUi((s) => s.search.hits[s.search.active])
  const [drag, setDrag] = useState<Drag | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [links, setLinks] = useState<PdfLink[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const source = doc.sources.get(page.sourceId)

  useEffect(() => {
    let alive = true
    source?.pdf.getLinks(page.sourceIndex).then(
      (l) => alive && setLinks(l),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [source, page.sourceIndex])

  const toPage = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect()
    return viewToPage({ x: e.clientX - r.left, y: e.clientY - r.top }, page, rotation, scale)
  }

  const change = useDocuments((s) => s.change)

  function startDrag(e: PointerEvent, d: Drag) {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).closest('svg')?.setPointerCapture(e.pointerId)
    setDrag(d)
  }

  function onAnnotationDown(e: PointerEvent, a: Annotation) {
    if (tool !== 'select' || e.button !== 0) return
    const sel = nextSelection(selection, a.id, e.shiftKey || e.ctrlKey || e.metaKey)
    useUi.setState({ selection: sel })
    if (!sel.includes(a.id)) return e.stopPropagation() // toggled off: nothing to drag
    const p = toPage(e)
    startDrag(e, { kind: 'move', start: p, at: p })
  }

  function onBackgroundDown(e: PointerEvent) {
    if (e.button !== 0) return
    if (tool === 'note') {
      e.preventDefault()
      const note = newNote(page.id, toPage(e))
      change('add note', (d) => docOps.addAnnotations(d, [note]))
      useUi.setState({ tool: 'select', selection: [note.id], editing: note.id })
      return
    }
    if (!DRAW_TOOLS.has(tool)) return
    startDrag(e, { kind: 'draw', points: [toPage(e)] })
  }

  // Marquee: select tool, drag that starts on the page away from text, annotations and editors.
  // Drags starting next to/between words belong to native text selection; Alt forces the marquee anywhere.
  useEffect(() => {
    const host = svgRef.current?.parentElement
    if (!host || tool !== 'select') return
    const onDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element
      if (e.button !== 0 || target.closest('svg g, .textLayer span, textarea, foreignObject')) return
      if (!e.altKey && nearText(host, e.clientX, e.clientY)) return
      e.preventDefault() // no text selection while dragging the marquee
      ;(document.activeElement as HTMLElement | null)?.blur() // preventDefault also blocks blur: commit open editors
      const base = e.shiftKey || e.ctrlKey || e.metaKey ? useUi.getState().selection : []
      const start = toPage(e)
      const move = (ev: globalThis.PointerEvent) => setMarquee(normalizeRect(start, toPage(ev)))
      const up = (ev: globalThis.PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setMarquee(null)
        const r = normalizeRect(start, toPage(ev))
        if (r.width < 2 && r.height < 2) return
        useUi.setState({ selection: [...new Set([...base, ...idsInRect(annotations, r)])] })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    host.addEventListener('pointerdown', onDown)
    return () => host.removeEventListener('pointerdown', onDown)
  })

  function onMove(e: PointerEvent) {
    if (!drag) return
    const p = toPage(e)
    setDrag(
      drag.kind === 'draw'
        ? { ...drag, points: tool === 'ink' ? [...drag.points, p] : [drag.points[0]!, p] }
        : drag.kind === 'resize'
          ? { ...drag, at: p, keepAspect: e.shiftKey }
          : { ...drag, at: p },
    )
  }

  function onUp() {
    if (!drag) return
    setDrag(null)
    if (drag.kind === 'draw') {
      const a = fromGesture(tool, drag.points, page.id)
      if (!a) return
      change(`add ${a.type}`, (d) => docOps.addAnnotations(d, [a]))
      if (a.type === 'freetext')
        useUi.setState({ tool: 'select', selection: [a.id], editing: a.id })
      return
    }
    const moved = annotations.filter((a) =>
      drag.kind === 'move' ? selection.includes(a.id) : a.id === drag.id,
    )
    if (
      drag.kind === 'move' &&
      Math.hypot(drag.at.x - drag.start.x, drag.at.y - drag.start.y) < 0.5
    )
      return
    change(drag.kind, (d) => {
      for (const a of moved) docOps.updateAnnotation(d, a.id, dragged(a, drag, selection))
    })
  }

  async function onLink(e: React.MouseEvent, link: PdfLink) {
    e.preventDefault()
    e.stopPropagation()
    if (link.kind === 'internal') {
      const i = doc.history.present.pages.findIndex(
        (p) => p.sourceId === page.sourceId && p.sourceIndex === link.pageIndex,
      )
      if (i >= 0) goToPage(doc.id, i)
      return
    }
    // Links come from an untrusted file: always confirm, and the platform only opens http(s)/mailto.
    if (
      await askConfirm(
        t('dialog.linkTitle'),
        t('dialog.linkBody', { url: link.url }),
        t('dialog.open'),
      )
    )
      await platform.shell.openExternal(link.url)
  }

  const draft = drag?.kind === 'draw' ? fromGesture(tool, drag.points, page.id) : null
  const single = selection.length === 1 ? annotations.find((a) => a.id === selection[0]) : undefined
  const resizable =
    tool === 'select' && single && 'rect' in single && editing !== single.id
      ? (dragged(single, drag, selection) as typeof single)
      : null
  const handle = 8 / scale
  const interactive = tool === 'select'
  const pageHits = hits.filter((h) => h.pageId === page.id)
  const images = doc.history.present.images

  return (
    <svg
      ref={svgRef}
      className={cn(
        'absolute inset-0 h-full w-full overflow-visible',
        DRAW_TOOLS.has(tool) || tool === 'note' ? 'cursor-crosshair' : 'pointer-events-none',
      )}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
    >
      <g transform={pageMatrix(page.width, page.height, rotation, scale)}>
        {pageHits.map((h, i) =>
          h.rects.map((r, j) => (
            <rect
              key={`${i}-${j}`}
              x={r.x}
              y={r.y}
              width={r.width}
              height={r.height}
              fill={h === activeHit ? 'rgb(255 120 0 / 0.5)' : 'rgb(255 200 0 / 0.35)'}
            />
          )),
        )}
        {interactive &&
          links.map((l, i) => (
            <rect
              key={i}
              {...l.rect}
              fill="transparent"
              className="pointer-events-auto cursor-pointer"
              onClick={(e) => void onLink(e, l)}
            >
              <title>
                {l.kind === 'external' ? l.url : t('page.label', { n: l.pageIndex + 1 })}
              </title>
            </rect>
          ))}
        {annotations.map((orig) => {
          const a = dragged(orig, drag, selection)
          const b = annotationBounds(a)
          const pad = a.style.strokeWidth / 2 + 2
          if (editing === a.id && a.type === 'freetext') return <FreeTextEditor key={a.id} a={a} />
          return (
            <g
              key={a.id}
              className={cn(
                interactive && !MARKUP_TOOLS.has(tool) && 'pointer-events-auto cursor-move',
              )}
              onPointerDown={(e) => onAnnotationDown(e, orig)}
              onDoubleClick={() =>
                (a.type === 'freetext' || a.type === 'note') && useUi.setState({ editing: a.id })
              }
            >
              <Shape a={a} images={images} />
              <rect
                x={b.x - pad}
                y={b.y - pad}
                width={b.width + 2 * pad}
                height={b.height + 2 * pad}
                fill="transparent"
              />
              {selection.includes(a.id) && (
                <rect
                  x={b.x - pad}
                  y={b.y - pad}
                  width={b.width + 2 * pad}
                  height={b.height + 2 * pad}
                  fill="none"
                  stroke="var(--selection)"
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          )
        })}
        {resizable &&
          (Object.entries(corners(resizable.rect)) as [Corner, Point][]).map(([c, p]) => (
            <rect
              key={c}
              x={p.x - handle / 2}
              y={p.y - handle / 2}
              width={handle}
              height={handle}
              fill="var(--background)"
              stroke="var(--selection)"
              vectorEffect="non-scaling-stroke"
              aria-label={`resize ${c}`}
              className="pointer-events-auto cursor-nwse-resize"
              onPointerDown={(e) =>
                startDrag(e, {
                  kind: 'resize',
                  id: resizable.id,
                  fixed: corners(resizable.rect)[opposite[c]],
                  at: p,
                  keepAspect: e.shiftKey,
                })
              }
            />
          ))}
        {draft && <Shape a={draft} images={images} />}
        {marquee && (
          <rect
            {...marquee}
            fill="var(--selection)"
            fillOpacity={0.08}
            stroke="var(--selection)"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {annotations.map(
          (a) => a.type === 'note' && editing === a.id && <NoteEditor key={`edit-${a.id}`} a={a} />,
        )}
      </g>
    </svg>
  )
}

function FreeTextEditor({ a }: { a: Extract<Annotation, { type: 'freetext' }> }) {
  const [text, setText] = useState(a.text)
  const finish = () => {
    const { change } = useDocuments.getState()
    if (!text.trim()) change('delete', (d) => docOps.removeAnnotations(d, [a.id]))
    else if (text !== a.text) change('edit text', (d) => docOps.updateAnnotation(d, a.id, { text }))
    useUi.setState({ editing: null })
  }
  return (
    <foreignObject
      x={a.rect.x}
      y={a.rect.y}
      width={a.rect.width}
      height={a.rect.height}
      className="pointer-events-auto"
    >
      <textarea
        autoFocus
        aria-label={t('tool.freetext')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        style={{
          fontSize: a.fontSize,
          color: a.style.color,
          lineHeight: 1.2,
          fontFamily: 'Helvetica, Arial, sans-serif',
        }}
        className="h-full w-full resize-none bg-white/80 px-0.5 outline outline-1 outline-[var(--selection)]"
      />
    </foreignObject>
  )
}

function NoteEditor({ a }: { a: Extract<Annotation, { type: 'note' }> }) {
  const [text, setText] = useState(a.note ?? '')
  const finish = () => {
    const { change } = useDocuments.getState()
    // A note that never got text (and has no thread) is an accidental click: drop it.
    if (!text.trim() && !a.note && !a.replies?.length)
      change('delete', (d) => docOps.removeAnnotations(d, [a.id]))
    else if (text !== (a.note ?? ''))
      change('edit note', (d) => docOps.updateAnnotation(d, a.id, { note: text }))
    useUi.setState({ editing: null })
  }
  return (
    <foreignObject
      x={a.at.x + NOTE_SIZE + 4}
      y={a.at.y}
      width={200}
      height={110}
      className="pointer-events-auto"
    >
      <textarea
        autoFocus
        aria-label={t('tool.note')}
        placeholder={t('note.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        className="h-full w-full resize-none rounded-md border bg-amber-50 p-1.5 text-xs text-black shadow-md outline-none focus:ring-2 focus:ring-ring"
      />
    </foreignObject>
  )
}

/**
 * Whether a point is close enough to a text run that the user most likely wants to select text: inside the run's
 * line band (half a line above/below) and within ~1.5 line heights of its ends. Margins scale with the font size,
 * so it behaves the same at every zoom.
 */
function nearText(host: Element, x: number, y: number): boolean {
  for (const span of host.querySelectorAll('.textLayer span')) {
    const r = span.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const mx = r.height * GAP_MARGIN.x
    const my = r.height * GAP_MARGIN.y
    if (x >= r.left - mx && x <= r.right + mx && y >= r.top - my && y <= r.bottom + my) return true
  }
  return false
}
