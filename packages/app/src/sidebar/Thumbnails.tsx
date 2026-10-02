import { BLANK_SOURCE, docOps, rotateSize, type PageModel } from '@pdf-atelier/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from 'cn'
import { RotateCw, Star, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { useCanvasRender } from '../viewer/useCanvasRender.ts'
import { t } from '../i18n/index.ts'
import { deletePages, usePageSelection } from '../files/pages.ts'
import { useDocuments, type OpenDoc } from '../stores/documents.ts'
import { goToPage, notify, useUi } from '../stores/ui.ts'
import { IconButton } from '../ui/overlays.tsx'
import { PageContextMenu } from './PagesMenu.tsx'

const THUMB_W = 120

const Thumb = memo(function Thumb({ doc, page }: { doc: OpenDoc; page: PageModel }) {
  if (page.sourceId === BLANK_SOURCE) {
    const s = rotateSize(page.width, page.height, page.rotation)
    const k = THUMB_W / Math.max(page.width, page.height)
    return <div className="bg-white shadow-sm" style={{ width: s.width * k, height: s.height * k }} />
  }
  return <PdfThumb doc={doc} page={page} />
})

function PdfThumb({ doc, page }: { doc: OpenDoc; page: PageModel }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pdf = doc.sources.get(page.sourceId)!.pdf
  useCanvasRender(ref, pdf, page.sourceIndex, {
    scale: THUMB_W / Math.max(page.width, page.height),
    rotation: page.rotation,
  })
  return <canvas ref={ref} className="bg-white shadow-sm" />
}

export function Thumbnails({ doc }: { doc: OpenDoc }) {
  const pages = doc.history.present.pages
  const current = useUi((s) => s.views[doc.id]?.page ?? 0)
  const change = useDocuments((s) => s.change)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const selected = usePageSelection((s) => s.ids)
  const bookmarked = new Set(doc.history.present.bookmarks.map((b) => b.pageId))

  // Click: go to page; Ctrl/Cmd toggles; Shift selects a range from the anchor.
  const select = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, index: number) => {
    const id = pages[index]!.id
    const { ids, anchor } = usePageSelection.getState()
    const a = anchor ? pages.findIndex((p) => p.id === anchor) : -1
    if (e.shiftKey && a >= 0) {
      const [from, to] = a < index ? [a, index] : [index, a]
      usePageSelection.setState({ ids: pages.slice(from, to + 1).map((p) => p.id) })
    } else if (e.ctrlKey || e.metaKey) {
      usePageSelection.setState({
        ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
        anchor: id,
      })
    } else usePageSelection.setState({ ids: [], anchor: id })
    goToPage(doc.id, index)
  }

  // React Compiler can't memoize useVirtualizer's API; this component doesn't rely on that.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const p = pages[i]!
      const s = rotateSize(p.width, p.height, p.rotation)
      return (THUMB_W / Math.max(p.width, p.height)) * s.height + 44
    },
    overscan: 4,
  })
  useEffect(() => virtualizer.measure(), [virtualizer, pages])
  // The selection belongs to this document (component is keyed by doc id).
  useEffect(() => () => usePageSelection.setState({ ids: [], anchor: null }), [])
  useEffect(() => virtualizer.scrollToIndex(current), [virtualizer, current])

  const move = (id: string, to: number) => change('move page', (d) => docOps.movePages(d, [id], to))
  const remove = (id: string) => {
    if (pages.length === 1) return notify(t('error.removeAllPages'), true)
    usePageSelection.setState({ ids: [id] })
    deletePages(doc)
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto" aria-description={t('page.moveHint')}>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const p = pages[v.index]!
          return (
            <div
              key={p.id}
              className="absolute left-0 w-full px-2"
              style={{ top: v.start, height: v.size }}
              draggable
              onDragStart={() => setDragId(p.id)}
              onDragOver={(e) => {
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                setDropAt(e.clientY < r.top + r.height / 2 ? v.index : v.index + 1)
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropAt(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dropAt !== null) move(dragId, dropAt)
                setDragId(null)
                setDropAt(null)
              }}
            >
              <PageContextMenu
                onOpen={() => {
                  // Right-click outside the selection acts on that page only.
                  if (!selected.includes(p.id)) usePageSelection.setState({ ids: [p.id], anchor: p.id })
                  goToPage(doc.id, v.index)
                }}
              >
              <div
                role="button"
                tabIndex={0}
                aria-label={t('page.label', { n: v.index + 1 })}
                aria-current={v.index === current ? 'page' : undefined}
                aria-pressed={selected.includes(p.id)}
                onClick={(e) => select(e, v.index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') select(e, v.index)
                  if (e.altKey && e.key === 'ArrowUp' && v.index > 0) move(p.id, v.index - 1)
                  if (e.altKey && e.key === 'ArrowDown' && v.index < pages.length - 1)
                    move(p.id, v.index + 2)
                }}
                className={cn(
                  'group relative flex flex-col items-center gap-1 rounded-md p-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                  v.index === current && 'bg-accent',
                  selected.includes(p.id) && 'ring-2 ring-[var(--selection)]',
                  dragId === p.id && 'opacity-40',
                  dropAt === v.index && 'border-t-2 border-t-[var(--selection)]',
                  dropAt === v.index + 1 &&
                    v.index === pages.length - 1 &&
                    'border-b-2 border-b-[var(--selection)]',
                )}
              >
                <Thumb doc={doc} page={p} />
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {bookmarked.has(p.id) && (
                    <Star
                      className="size-3 fill-amber-400 text-amber-500"
                      aria-label={t('bookmark.marked')}
                    />
                  )}
                  {v.index + 1}
                </span>
                <div className="absolute top-1 right-1 hidden gap-0.5 rounded-md bg-background/90 shadow group-focus-within:flex group-hover:flex">
                  <IconButton
                    size="icon-sm"
                    label={t('page.rotate')}
                    onClick={(e) => {
                      e.stopPropagation()
                      change('rotate page', (d) => docOps.rotatePages(d, [p.id], 90))
                    }}
                  >
                    <RotateCw />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    label={t('page.delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(p.id)
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
              </PageContextMenu>
            </div>
          )
        })}
      </div>
    </div>
  )
}
