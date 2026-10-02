import { docOps, rotateSize, type Annotation, type Rotation } from '@pdf-atelier/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import '@pdf-atelier/pdf/text-layer.css'
import { useDocuments, type OpenDoc } from '../stores/documents.ts'
import { useSettings } from '../stores/settings.ts'
import { updateView, useUi, viewOf } from '../stores/ui.ts'
import { readSelection } from '../tts/controller.ts'
import { selectionToMarkup } from './markup.ts'
import { PageView } from './PageView.tsx'

const GAP = 16
const PAD = 24

export function Viewer({ doc }: { doc: OpenDoc }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const view = useUi((s) => s.views[doc.id]) ?? viewOf(doc.id)
  const scrollTo = useUi((s) => s.scrollTo)
  const model = doc.history.present
  const pages = model.pages

  const rotationOf = (i: number) => ((pages[i]!.rotation + view.rotation) % 360) as Rotation
  const sizeOf = (i: number) => rotateSize(pages[i]!.width, pages[i]!.height, rotationOf(i))

  // Effective scale from the zoom mode and the viewport size.
  const maxWidth = Math.max(...pages.map((_, i) => sizeOf(i).width))
  let scale = typeof view.zoom === 'number' ? view.zoom : 1
  if (box.width > 0 && view.zoom === 'fit-width') scale = (box.width - 2 * PAD) / maxWidth
  if (box.width > 0 && view.zoom === 'fit-page' && pages[view.page]) {
    const s = sizeOf(view.page)
    scale = Math.min((box.width - 2 * PAD) / s.width, (box.height - 2 * PAD) / s.height)
  }
  scale = Math.max(0.1, Math.min(8, scale))

  useEffect(() => {
    if (Math.abs(view.scale - scale) > 1e-3) updateView(doc.id, { scale })
  }, [doc.id, scale, view.scale])

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(([e]) =>
      setBox({ width: e!.contentRect.width, height: e!.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // React Compiler can't memoize useVirtualizer's API; this component doesn't rely on that.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => sizeOf(i).height * scale + GAP,
    paddingStart: PAD,
    paddingEnd: PAD,
    overscan: 1,
  })

  useEffect(() => virtualizer.measure(), [virtualizer, pages])

  // Zoom/rotation keep the reading position: the page under the "current page" line (a third down the viewport,
  // see onScroll) and how far into it, plus the horizontal center. Recorded on scroll, restored before paint.
  const anchor = useRef<{ index: number; fraction: number; x: number } | null>(null)
  useLayoutEffect(() => {
    virtualizer.measure()
    const el = scrollRef.current
    const a = anchor.current
    if (!el || !a) return
    // getTotalSize() recomputes the measurements for the new scale (and refreshes measurementsCache). Grow the
    // scroll area right away so the new scrollTop isn't clamped to the old height.
    ;(el.firstElementChild as HTMLElement).style.height = `${virtualizer.getTotalSize()}px`
    const m = virtualizer.measurementsCache[a.index]
    if (!m) return
    el.scrollTop = m.start + a.fraction * m.size - el.clientHeight / 3
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2
  }, [virtualizer, scale, view.rotation])

  // Scroll requests (thumbnails, outline, search, page navigation).
  useEffect(() => {
    if (scrollTo?.docId === doc.id) virtualizer.scrollToIndex(scrollTo.page, { align: 'start' })
  }, [scrollTo, doc.id, virtualizer])

  // Keep the per-tab current page in sync with the scroll position.
  const onScroll = () => {
    const el = scrollRef.current!
    const line = el.scrollTop + el.clientHeight / 3
    // From the measurements, not getVirtualItems(): the rendered range is still stale during this event
    // (a page jump is a single scroll event), which used to leave the current page and anchor unset.
    const at = virtualizer.getVirtualItemForOffset(line)
    if (at) {
      anchor.current = {
        index: at.index,
        fraction: Math.max(0, (line - at.start) / at.size),
        x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
      }
      if (at.index !== viewOf(doc.id).page) updateView(doc.id, { page: at.index })
    }
  }

  const byPage = useMemo(() => {
    const m = new Map<string, Annotation[]>()
    for (const a of Object.values(model.annotations))
      m.set(a.pageId, [...(m.get(a.pageId) ?? []), a])
    return m
  }, [model.annotations])

  // Markup made by the double-click of a click sequence: a following triple-click replaces it.
  const multiClick = useRef<{ ids: string[]; at: number } | null>(null)

  // Text selection finished: create markup (markup tools) or read it aloud (auto-read).
  const onMouseUp = (e: MouseEvent) => {
    const { tool, styles } = useUi.getState()
    if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
      const anns = selectionToMarkup(
        tool,
        model,
        { scale, rotation: view.rotation },
        styles[tool],
        scrollRef.current!,
      )
      if (!anns.length) return
      const prev = multiClick.current
      const replace = e.detail >= 3 && prev && Date.now() - prev.at < 1000 ? prev.ids : []
      useDocuments.getState().change(
        tool,
        (d) => {
          docOps.removeAnnotations(d, replace)
          docOps.addAnnotations(d, anns)
        },
        // Same key as the double-click entry: the replacement merges into one undo step.
        e.detail >= 2 ? { coalesceKey: 'markup-multiclick' } : undefined,
      )
      multiClick.current = e.detail >= 2 ? { ids: anns.map((a) => a.id), at: Date.now() } : null
      window.getSelection()?.removeAllRanges()
      return
    }
    if (useSettings.getState().tts.autoRead) readSelection(true)
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onMouseUp={onMouseUp}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.textLayer'))
          useUi.setState({ selection: [] })
      }}
      className="relative h-full overflow-auto bg-canvas"
      tabIndex={-1}
    >
      <div
        style={{ height: virtualizer.getTotalSize(), minWidth: maxWidth * scale + 2 * PAD }}
        className="relative w-full"
      >
        {box.width > 0 &&
          virtualizer.getVirtualItems().map((v) => {
            const page = pages[v.index]!
            return (
              <div
                key={page.id}
                className="absolute left-0 w-full px-6"
                style={{ top: v.start, height: v.size - GAP }}
              >
                <PageView
                  doc={doc}
                  page={page}
                  index={v.index}
                  rotation={rotationOf(v.index)}
                  scale={scale}
                  annotations={byPage.get(page.id) ?? []}
                />
              </div>
            )
          })}
      </div>
    </div>
  )
}
