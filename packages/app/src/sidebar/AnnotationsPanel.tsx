import { docOps, newId, type Annotation, type Reply } from '@pdf-atelier/core'
import { cn } from 'cn'
import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.ts'
import { useDocuments, type OpenDoc } from '../stores/documents.ts'
import { goToPage, useUi } from '../stores/ui.ts'
import { Button } from '../ui/button.tsx'
import { IconButton } from '../ui/overlays.tsx'

const summary = (a: Annotation) =>
  a.type === 'freetext' || a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout'
    ? a.text
    : a.type === 'image'
      ? t(`image.${a.kind}`)
      : ''

const change = (...args: Parameters<ReturnType<typeof useDocuments.getState>['change']>) =>
  useDocuments.getState().change(...args)

export function AnnotationsPanel({ doc }: { doc: OpenDoc }) {
  const selection = useUi((s) => s.selection)
  const { pages, annotations } = doc.history.present
  const order = new Map(pages.map((p, i) => [p.id, i]))
  const list = Object.values(annotations).sort(
    (a, b) => order.get(a.pageId)! - order.get(b.pageId)! || a.createdAt - b.createdAt,
  )
  const listRef = useRef<HTMLUListElement>(null)

  // Selecting on the page scrolls the panel to the item.
  useEffect(() => {
    if (selection.length === 1)
      listRef.current
        ?.querySelector(`[data-ann="${CSS.escape(selection[0]!)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [selection])

  if (!list.length)
    return <p className="p-3 text-sm text-muted-foreground">{t('sidebar.noAnnotations')}</p>
  return (
    <ul ref={listRef} className="h-full space-y-1 overflow-auto p-1" aria-label={t('sidebar.annotations')}>
      {list.map((a) => (
        <Item
          key={a.id}
          a={a}
          page={order.get(a.pageId)!}
          selected={selection.includes(a.id)}
          onSelect={() => {
            useUi.setState({ selection: [a.id], tool: 'select' })
            goToPage(doc.id, order.get(a.pageId)!)
          }}
        />
      ))}
    </ul>
  )
}

function Item({
  a,
  page,
  selected,
  onSelect,
}: {
  a: Annotation
  page: number
  selected: boolean
  onSelect: () => void
}) {
  const text = summary(a)
  return (
    <li data-ann={a.id} className={cn('rounded-md', selected && 'bg-accent')}>
      <button
        className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={onSelect}
      >
        <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: a.style.color }} />
        <span className="min-w-0">
          <span className="block text-xs text-muted-foreground">
            {t(`tool.${a.type}`)} · {t('page.label', { n: page + 1 })}
          </span>
          {text && <span className="line-clamp-2 whitespace-normal">{text}</span>}
          {a.note && <span className="block whitespace-pre-wrap">{a.note}</span>}
        </span>
      </button>
      {selected && <Thread a={a} />}
    </li>
  )
}

/** Note + replies of the selected annotation (exported as /Contents and /IRT replies). */
function Thread({ a }: { a: Annotation }) {
  const [draft, setDraft] = useState('')
  const replies = a.replies ?? []
  const add = () => {
    const text = draft.trim()
    if (!text) return
    const reply: Reply = { id: newId(), author: t('reply.you'), text, createdAt: Date.now() }
    change('reply', (d) => docOps.addReply(d, a.id, reply))
    setDraft('')
  }
  return (
    <div className="space-y-1.5 px-2 pb-2 pl-7 text-sm">
      {a.type !== 'note' && (
        <EditableText
          key={a.note ?? ''}
          label={t('reply.note')}
          value={a.note ?? ''}
          placeholder={t('reply.notePlaceholder')}
          onSave={(note) =>
            note !== (a.note ?? '') &&
            change('edit note', (d) => docOps.updateAnnotation(d, a.id, { note }))
          }
        />
      )}
      {replies.length > 0 && (
        <ul className="space-y-1 border-l-2 pl-2" aria-label={t('reply.thread')}>
          {replies.map((r) => (
            <ReplyItem key={r.id} annId={a.id} r={r} />
          ))}
        </ul>
      )}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <textarea
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              add()
            }
          }}
          placeholder={t('reply.placeholder')}
          aria-label={t('reply.placeholder')}
          className="min-h-8 flex-1 resize-y rounded-md border bg-background px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <Button size="sm" type="submit" disabled={!draft.trim()}>
          {t('reply.send')}
        </Button>
      </form>
    </div>
  )
}

function ReplyItem({ annId, r }: { annId: string; r: Reply }) {
  const [editing, setEditing] = useState(false)
  return (
    <li className="group">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="font-medium">{r.author ?? t('reply.you')}</span>
        <span>· {new Date(r.createdAt).toLocaleString()}</span>
        <span className="ml-auto flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton size="icon-sm" className="size-6" label={t('reply.edit')} onClick={() => setEditing(true)}>
            <Pencil />
          </IconButton>
          <IconButton
            size="icon-sm"
            className="size-6"
            label={t('reply.delete')}
            onClick={() => change('delete reply', (d) => docOps.removeReply(d, annId, r.id))}
          >
            <Trash2 />
          </IconButton>
        </span>
      </div>
      {editing ? (
        <EditableText
          autoFocus
          label={t('reply.edit')}
          value={r.text}
          onSave={(text) => {
            if (text.trim() && text !== r.text)
              change('edit reply', (d) => docOps.updateReply(d, annId, r.id, text))
            setEditing(false)
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap">{r.text}</p>
      )}
    </li>
  )
}

/** Textarea that commits on blur / Enter (Shift+Enter = newline), Escape cancels. */
function EditableText({
  label,
  value,
  placeholder,
  autoFocus,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  autoFocus?: boolean
  onSave: (v: string) => void
}) {
  const [text, setText] = useState(value)
  return (
    <textarea
      rows={Math.min(4, text.split('\n').length)}
      autoFocus={autoFocus}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onSave(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          setText(value)
          e.currentTarget.blur()
        }
      }}
      className="w-full resize-y rounded-md border bg-background px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    />
  )
}
