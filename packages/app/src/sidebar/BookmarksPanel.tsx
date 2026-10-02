import { docOps } from '@pdf-atelier/core'
import { cn } from 'cn'
import { Pencil, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { t } from '../i18n/index.ts'
import { useDocuments, type OpenDoc } from '../stores/documents.ts'
import { goToPage, useUi } from '../stores/ui.ts'
import { Input } from '../ui/controls.tsx'
import { IconButton } from '../ui/overlays.tsx'
import { row } from './OutlinePanel.tsx'

export function BookmarksPanel({ doc }: { doc: OpenDoc }) {
  const { pages, bookmarks } = doc.history.present
  const current = useUi((s) => s.views[doc.id]?.page ?? 0)
  const change = useDocuments((s) => s.change)
  const [editing, setEditing] = useState<string | null>(null)
  const order = new Map(pages.map((p, i) => [p.id, i]))
  const list = [...bookmarks].sort((a, b) => order.get(a.pageId)! - order.get(b.pageId)!)

  if (!list.length)
    return <p className="p-3 text-sm text-muted-foreground">{t('sidebar.noBookmarks')}</p>
  return (
    <ul className="h-full space-y-0.5 overflow-auto p-1" aria-label={t('sidebar.bookmarks')}>
      {list.map((b) => {
        const index = order.get(b.pageId)!
        return (
          <li key={b.id} className="group flex items-center gap-1">
            {editing === b.id ? (
              <form
                className="flex-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  const title = (new FormData(e.currentTarget).get('title') as string).trim()
                  if (title && title !== b.title)
                    change('rename bookmark', (d) => docOps.renameBookmark(d, b.id, title))
                  setEditing(null)
                }}
              >
                <Input
                  name="title"
                  autoFocus
                  defaultValue={b.title}
                  aria-label={t('bookmark.rename')}
                  onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                />
              </form>
            ) : (
              <button
                className={cn(row, 'flex flex-1 items-center gap-2', index === current && 'bg-accent')}
                onClick={() => goToPage(doc.id, index)}
                onDoubleClick={() => setEditing(b.id)}
              >
                <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{b.title}</span>
                <span className="text-xs text-muted-foreground">{index + 1}</span>
              </button>
            )}
            <IconButton
              size="icon-sm"
              label={t('bookmark.rename')}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              onClick={() => setEditing(b.id)}
            >
              <Pencil />
            </IconButton>
            <IconButton
              size="icon-sm"
              label={t('bookmark.remove')}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              onClick={() => change('remove bookmark', (d) => docOps.removeBookmark(d, b.id))}
            >
              <Trash2 />
            </IconButton>
          </li>
        )
      })}
    </ul>
  )
}
