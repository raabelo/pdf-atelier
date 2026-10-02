import { BLANK_SOURCE } from '@pdf-atelier/core'
import type { OutlineItem } from '@pdf-atelier/pdf'
import { useEffect, useState } from 'react'
import { t } from '../i18n/index.ts'
import type { OpenDoc } from '../stores/documents.ts'
import { goToPage } from '../stores/ui.ts'

export const row =
  'w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

type Section = { sourceId: string; name: string; items: OutlineItem[] }

/** One outline per source still used by the document (merged PDFs keep their own outlines). */
export function OutlinePanel({ doc }: { doc: OpenDoc }) {
  const { pages, sources: infos } = doc.history.present
  const used = [...new Set(pages.map((p) => p.sourceId))].filter((id) => id !== BLANK_SOURCE)
  const key = used.join()
  const [sections, setSections] = useState<Section[] | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all(
      key.split(',').filter(Boolean).map(async (sourceId) => ({
        sourceId,
        name: infos[sourceId]?.name ?? '',
        items: await doc.sources.get(sourceId)!.pdf.getOutline().catch(() => []),
      })),
    ).then((s) => alive && setSections(s.filter((x) => x.items.length)))
    return () => {
      alive = false
    }
  }, [key, doc.sources, infos])

  // Outline targets are (source, page) pairs: follow them to wherever that page is now.
  const go = (sourceId: string, sourceIndex: number) => {
    const idx = pages.findIndex((p) => p.sourceId === sourceId && p.sourceIndex === sourceIndex)
    if (idx >= 0) goToPage(doc.id, idx)
  }

  const render = (sourceId: string, list: OutlineItem[], depth: number) => (
    <ul role={depth ? 'group' : 'tree'} aria-label={depth ? undefined : t('sidebar.outline')}>
      {list.map((it, i) => (
        <li key={i} role="treeitem" aria-selected={false}>
          <button
            className={row}
            style={{ paddingLeft: 8 + depth * 12 }}
            disabled={it.pageIndex === null}
            onClick={() => go(sourceId, it.pageIndex!)}
          >
            {it.title}
          </button>
          {it.children.length > 0 && render(sourceId, it.children, depth + 1)}
        </li>
      ))}
    </ul>
  )

  if (!sections) return null
  if (!sections.length)
    return <p className="p-3 text-sm text-muted-foreground">{t('sidebar.noOutline')}</p>
  return (
    <div className="h-full overflow-auto p-1">
      {sections.map((s) => (
        <section key={s.sourceId}>
          {sections.length > 1 && (
            <h3 className="truncate px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
              {s.name}
            </h3>
          )}
          {render(s.sourceId, s.items, 0)}
        </section>
      ))}
    </div>
  )
}
