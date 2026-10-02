import { cn } from 'cn'
import { FileText, FolderOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RecentFile } from '@pdf-atelier/platform'
import { runCommand } from '../commands/registry.ts'
import { closeDoc, openRecent } from '../files/actions.ts'
import { t } from '../i18n/index.ts'
import { usePlatform } from '../platform.tsx'
import { AnnotationsPanel, OutlinePanel, SearchPanel } from '../sidebar/panels.tsx'
import { Thumbnails } from '../sidebar/Thumbnails.tsx'
import { isDirty, useActiveDoc, useDocuments } from '../stores/documents.ts'
import { useUi, type Panel } from '../stores/ui.ts'
import { useTts } from '../tts/controller.ts'
import { TtsPanel } from '../tts/TtsPanel.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/controls.tsx'
import { Dialog, IconButton } from '../ui/overlays.tsx'

export function TabsBar() {
  const docs = useDocuments((s) => s.docs)
  const activeId = useDocuments((s) => s.activeId)
  if (!docs.length) return null
  return (
    <div
      role="tablist"
      aria-label="Documents"
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b bg-muted/40 px-2"
    >
      {docs.map((d) => (
        <div
          key={d.id}
          className={cn(
            'group flex h-8 max-w-56 min-w-0 items-center gap-1 rounded-t-md border border-b-0 pr-1 pl-3 text-sm',
            d.id === activeId
              ? 'bg-background'
              : 'border-transparent text-muted-foreground hover:bg-background/60',
          )}
        >
          <button
            role="tab"
            aria-selected={d.id === activeId}
            className="min-w-0 truncate outline-none focus-visible:underline"
            onClick={() => {
              useDocuments.getState().setActive(d.id)
              useUi.setState({ selection: [], editing: null })
            }}
            title={d.name}
          >
            {isDirty(d) && <span aria-label={t('status.unsaved')}>● </span>}
            {d.name}
          </button>
          <IconButton
            size="icon-sm"
            label={t('cmd.file.close')}
            className="size-6"
            onClick={() => void closeDoc(d.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  )
}

const PANELS: Panel[] = ['pages', 'outline', 'annotations', 'search', 'tts']

export function Sidebar() {
  const doc = useActiveDoc()
  const open = useUi((s) => s.sidebarOpen)
  const panel = useUi((s) => s.panel)
  if (!open) return null
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-background max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-xl">
      <div
        role="tablist"
        aria-label="Sidebar"
        className="flex shrink-0 gap-0.5 overflow-x-auto border-b p-1"
      >
        {PANELS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={panel === p}
            onClick={() => useUi.setState({ panel: p })}
            className="rounded-md px-2 py-1 text-xs whitespace-nowrap outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-accent aria-selected:font-medium"
          >
            {t(`sidebar.${p}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1">
        {panel === 'tts' ? (
          <TtsPanel />
        ) : !doc ? null : panel === 'pages' ? (
          <Thumbnails key={doc.id} doc={doc} />
        ) : panel === 'outline' ? (
          <OutlinePanel key={doc.id} doc={doc} />
        ) : panel === 'annotations' ? (
          <AnnotationsPanel doc={doc} />
        ) : (
          <SearchPanel key={doc.id} doc={doc} />
        )}
      </div>
    </aside>
  )
}

export function StatusBar() {
  const doc = useActiveDoc()
  const view = useUi((s) => (doc ? s.views[doc.id] : undefined))
  const message = useUi((s) => s.message)
  const tts = useTts((s) => s.state)

  useEffect(() => {
    if (!message) return
    const id = setTimeout(() => useUi.setState({ message: null }), message.error ? 8000 : 3000)
    return () => clearTimeout(id)
  }, [message])

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 text-xs text-muted-foreground">
      {doc && (
        <>
          <span>
            {t('status.page', {
              n: (view?.page ?? 0) + 1,
              total: doc.history.present.pages.length,
            })}
          </span>
          <span>
            {t('status.zoom')}: {Math.round((view?.scale ?? 1) * 100)}%
          </span>
          <span>{isDirty(doc) ? t('status.unsaved') : ''}</span>
        </>
      )}
      {tts !== 'idle' && <span>🔊 {t('tts.reading')}</span>}
      <span
        role="status"
        aria-live="polite"
        className={cn('ml-auto truncate', message?.error && 'text-destructive')}
      >
        {message?.text}
      </span>
    </footer>
  )
}

export function EmptyState() {
  const platform = usePlatform()
  const [recent, setRecent] = useState<RecentFile[]>([])
  const reload = () => void platform.files.listRecent().then(setRecent, () => setRecent([]))
  useEffect(reload, [platform])
  const canReopen = platform.files.capabilities.reopenRecent

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-canvas p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <FileText className="mx-auto size-12 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold">{t('empty.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('empty.drop')}</p>
        </div>
        <Button onClick={() => runCommand('file.open')}>
          <FolderOpen /> {t('cmd.file.open')}
        </Button>
        <section className="text-left">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('empty.recent')}
          </h2>
          {!canReopen && (
            <p className="mb-2 text-xs text-muted-foreground">{t('empty.recentLimited')}</p>
          )}
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty.noRecent')}</p>
          ) : (
            <ul className="divide-y rounded-md border bg-background">
              {recent.map((r) => (
                <li key={r.ref} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {canReopen ? (
                    <button
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      onClick={() => void openRecent(platform, r.ref)}
                    >
                      {r.name}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  )}
                  <IconButton
                    size="icon-sm"
                    label={t('empty.remove')}
                    onClick={() => void platform.files.removeRecent(r.ref).then(reload)}
                  >
                    <X />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm)
  const [value, setValue] = useState('')
  const close = (ok: boolean) => {
    confirm?.resolve(ok, value)
    setValue('')
    useUi.setState({ confirm: null })
  }
  return (
    <Dialog
      open={!!confirm}
      onOpenChange={(o) => !o && close(false)}
      title={confirm?.title ?? ''}
      description={confirm?.body}
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={() => close(true)}>{confirm?.confirmLabel ?? t('dialog.ok')}</Button>
        </>
      }
    >
      {confirm?.password && (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault()
            close(true)
          }}
        >
          <Input
            type="password"
            autoFocus
            aria-label={confirm.title}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </form>
      )}
    </Dialog>
  )
}
