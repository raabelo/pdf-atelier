import type { Annotation } from '@pdf-atelier/core'
import type { OutlineItem } from '@pdf-atelier/pdf'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.ts'
import type { OpenDoc } from '../stores/documents.ts'
import { goToPage, useUi } from '../stores/ui.ts'
import { Input } from '../ui/controls.tsx'

const row =
  'w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const pageIndexOf = (doc: OpenDoc, sourceId: string, sourceIndex: number) =>
  doc.history.present.pages.findIndex(
    (p) => p.sourceId === sourceId && p.sourceIndex === sourceIndex,
  )

export function OutlinePanel({ doc }: { doc: OpenDoc }) {
  const [items, setItems] = useState<OutlineItem[] | null>(null)
  // ponytail: outline of the first source only; merged documents (V1) need one section per source
  const [sourceId, source] = [...doc.sources][0]!
  useEffect(() => {
    let alive = true
    source.pdf.getOutline().then(
      (o) => alive && setItems(o),
      () => alive && setItems([]),
    )
    return () => {
      alive = false
    }
  }, [source])

  const render = (list: OutlineItem[], depth: number) => (
    <ul role={depth ? 'group' : 'tree'} aria-label={depth ? undefined : t('sidebar.outline')}>
      {list.map((it, i) => (
        <li key={i} role="treeitem" aria-selected={false}>
          <button
            className={row}
            style={{ paddingLeft: 8 + depth * 12 }}
            disabled={it.pageIndex === null}
            onClick={() => {
              const idx = pageIndexOf(doc, sourceId, it.pageIndex!)
              if (idx >= 0) goToPage(doc.id, idx)
            }}
          >
            {it.title}
          </button>
          {it.children.length > 0 && render(it.children, depth + 1)}
        </li>
      ))}
    </ul>
  )

  if (!items) return null
  if (!items.length)
    return <p className="p-3 text-sm text-muted-foreground">{t('sidebar.noOutline')}</p>
  return <div className="h-full overflow-auto p-1">{render(items, 0)}</div>
}

const summary = (a: Annotation) =>
  a.type === 'freetext' ||
  a.type === 'highlight' ||
  a.type === 'underline' ||
  a.type === 'strikeout'
    ? a.text
    : (a.note ?? '')

export function AnnotationsPanel({ doc }: { doc: OpenDoc }) {
  const selection = useUi((s) => s.selection)
  const { pages, annotations } = doc.history.present
  const order = new Map(pages.map((p, i) => [p.id, i]))
  const list = Object.values(annotations).sort(
    (a, b) => order.get(a.pageId)! - order.get(b.pageId)! || a.createdAt - b.createdAt,
  )
  if (!list.length)
    return <p className="p-3 text-sm text-muted-foreground">{t('sidebar.noAnnotations')}</p>
  return (
    <ul className="h-full space-y-0.5 overflow-auto p-1" aria-label={t('sidebar.annotations')}>
      {list.map((a) => (
        <li key={a.id}>
          <button
            className={cn(row, 'flex items-start gap-2', selection.includes(a.id) && 'bg-accent')}
            onClick={() => {
              useUi.setState({ selection: [a.id], tool: 'select' })
              goToPage(doc.id, order.get(a.pageId)!)
            }}
          >
            <span
              className="mt-1 size-3 shrink-0 rounded-sm"
              style={{ background: a.style.color }}
            />
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">
                {t(`tool.${a.type}`)} · {t('page.label', { n: order.get(a.pageId)! + 1 })}
              </span>
              <span className="line-clamp-2 whitespace-normal">{summary(a)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function SearchPanel({ doc }: { doc: OpenDoc }) {
  const search = useUi((s) => s.search)
  const abort = useRef<AbortController | null>(null)

  async function run(query: string, caseSensitive: boolean) {
    abort.current?.abort()
    const ctrl = (abort.current = new AbortController())
    useUi.setState({ search: { query, caseSensitive, hits: [], active: 0, running: !!query } })
    if (!query) return
    const hits: typeof search.hits = []
    const { pages } = doc.history.present
    for (const [sourceId, src] of doc.sources) {
      for await (const h of src.pdf.search(query, { caseSensitive, signal: ctrl.signal })) {
        if (ctrl.signal.aborted) return
        const page = pages.find((p) => p.sourceId === sourceId && p.sourceIndex === h.pageIndex)
        if (page) hits.push({ pageId: page.id, rects: h.rects, snippet: h.snippet })
        useUi.setState((s) => ({ search: { ...s.search, hits: [...hits] } }))
      }
    }
    const order = new Map(pages.map((p, i) => [p.id, i]))
    hits.sort((a, b) => order.get(a.pageId)! - order.get(b.pageId)!)
    useUi.setState((s) => ({ search: { ...s.search, hits, running: false } }))
  }

  useEffect(() => () => abort.current?.abort(), [])

  const focusHit = (i: number) => {
    const hit = search.hits[i]
    if (!hit) return
    useUi.setState((s) => ({ search: { ...s.search, active: i } }))
    goToPage(
      doc.id,
      doc.history.present.pages.findIndex((p) => p.id === hit.pageId),
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const q = new FormData(e.currentTarget).get('q') as string
          if (q === search.query && search.hits.length)
            focusHit((search.active + 1) % search.hits.length)
          else void run(q, search.caseSensitive)
        }}
      >
        <Input
          id="search-input"
          name="q"
          type="search"
          defaultValue={search.query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
        />
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={search.caseSensitive}
            onChange={(e) => void run(search.query, e.target.checked)}
          />
          {t('search.matchCase')}
        </label>
      </form>
      {search.query && !search.running && (
        <p className="text-xs text-muted-foreground" role="status">
          {search.hits.length ? t('search.results', { n: search.hits.length }) : t('search.none')}
        </p>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto">
        {search.hits.map((h, i) => (
          <li key={i}>
            <button
              className={cn(row, 'whitespace-normal', i === search.active && 'bg-accent')}
              onClick={() => focusHit(i)}
            >
              <span className="block text-xs text-muted-foreground">
                {t('page.label', {
                  n: doc.history.present.pages.findIndex((p) => p.id === h.pageId) + 1,
                })}
              </span>
              <span className="line-clamp-2">{h.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
