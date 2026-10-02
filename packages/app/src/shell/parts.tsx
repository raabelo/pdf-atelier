import { cn } from 'cn'
import { ArrowLeftRight, FileText, FolderOpen, Maximize, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RecentFile } from '@pdf-atelier/platform'
import { runCommand } from '../commands/registry.ts'
import { closeDoc, openRecent } from '../files/actions.ts'
import { t } from '../i18n/index.ts'
import { usePlatform } from '../platform.ts'
import { BookmarksPanel } from '../sidebar/BookmarksPanel.tsx'
import { OutlinePanel } from '../sidebar/OutlinePanel.tsx'
import { SearchPanel } from '../sidebar/SearchPanel.tsx'
import { AnnotationsPanel } from '../sidebar/AnnotationsPanel.tsx'
import { Thumbnails } from '../sidebar/Thumbnails.tsx'
import { isDirty, useActiveDoc, useDocuments } from '../stores/documents.ts'
import { goToPage, useUi, type Panel } from '../stores/ui.ts'
import { useTts } from '../tts/controller.ts'
import { TtsPanel } from '../tts/TtsPanel.tsx'
import { Cmd } from './Toolbar.tsx'
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

const PANELS: Panel[] = ['pages', 'outline', 'bookmarks', 'annotations', 'search', 'tts']

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
        ) : panel === 'bookmarks' ? (
          <BookmarksPanel key={doc.id} doc={doc} />
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
          <PageJump docId={doc.id} page={view?.page ?? 0} total={doc.history.present.pages.length} />
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
      {doc && (
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={t('status.view')}>
          <Cmd id="view.zoomOut" icon={ZoomOut} className={SMALL} />
          <span className="w-11 text-center tabular-nums" aria-label={t('status.zoom')}>
            {Math.round((view?.scale ?? 1) * 100)}%
          </span>
          <Cmd id="view.zoomIn" icon={ZoomIn} className={SMALL} />
          <Cmd id="view.fitWidth" icon={ArrowLeftRight} className={SMALL} />
          <Cmd id="view.fitPage" icon={Maximize} className={SMALL} />
          <Cmd id="view.rotate" icon={RotateCw} className={SMALL} />
        </div>
      )}
    </footer>
  )
}

const SMALL = 'size-6 [&_svg]:size-3.5'

/** "Page [n] of total": the number turns into an input; Enter jumps, Escape/blur cancels. */
function PageJump({ docId, page, total }: { docId: string; page: number; total: number }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const jump = () => {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n)) goToPage(docId, Math.min(total, Math.max(1, n)) - 1)
    setEditing(false)
  }
  return (
    <span className="flex items-center gap-1">
      {t('status.pageLabel')}
      {editing ? (
        <input
          autoFocus
          inputMode="numeric"
          aria-label={t('status.goToPage')}
          className="h-5 w-12 rounded border bg-background px-1 text-center tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          onFocus={(e) => e.target.select()}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') jump()
            else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <button
          type="button"
          title={t('status.goToPage')}
          className="min-w-6 rounded px-1 tabular-nums text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none"
          onClick={() => {
            setValue(String(page + 1))
            setEditing(true)
          }}
        >
          {page + 1}
        </button>
      )}
      {t('status.of', { total })}
    </span>
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

export function ProgressDialog() {
  const progress = useUi((s) => s.progress)
  return (
    <Dialog
      open={!!progress}
      onOpenChange={(o) => !o && progress?.cancel()}
      title={progress?.label ?? ''}
      footer={
        <Button variant="outline" onClick={() => progress?.cancel()}>
          {t('dialog.cancel')}
        </Button>
      }
    >
      <progress className="mt-4 w-full" value={progress?.value ?? 0} max={1} />
    </Dialog>
  )
}

declare const __APP_VERSION__: string | undefined
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html'
/** AGPL-3.0 §13: network users must be offered the source. Hidden while empty. */
const SOURCE_URL = ''

const CREDITS: [string, string][] = [
  ['PDF.js', 'Apache-2.0'],
  ['pdf-lib (@cantoo/pdf-lib)', 'MIT'],
  ['Piper / piper-tts-web', 'MIT / GPL-3.0'],
  ['espeak-ng', 'GPL-3.0'],
  ['ONNX Runtime Web', 'MIT'],
  ['Voz en_US ljspeech', 'Public domain'],
  ['Voz pt_BR faber', 'CC0'],
  ['Voz es_ES davefx', 'CC0'],
  ['Voz fr_FR siwis — SIWIS French Speech Synthesis Database', 'CC BY 4.0'],
]

export function AboutDialog() {
  const platform = usePlatform()
  const open = useUi((s) => s.aboutOpen)
  const link = (url: string, label: string) => (
    <button className="text-left underline" onClick={() => void platform.shell.openExternal(url)}>
      {label}
    </button>
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useUi.setState({ aboutOpen: o })}
      title={t('app.name')}
      description={`${t('about.version', { version: APP_VERSION })} — ${t('about.description')}`}
      footer={<Button onClick={() => useUi.setState({ aboutOpen: false })}>{t('dialog.ok')}</Button>}
    >
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('about.license')}</dt>
        <dd>{link(LICENSE_URL, 'AGPL-3.0')}</dd>
        {SOURCE_URL && (
          <>
            <dt className="text-muted-foreground">{t('about.source')}</dt>
            <dd>{link(SOURCE_URL, SOURCE_URL)}</dd>
          </>
        )}
      </dl>
      <h3 className="mt-4 mb-1 text-xs font-semibold text-muted-foreground uppercase">
        {t('about.credits')}
      </h3>
      <ul className="max-h-40 space-y-0.5 overflow-auto text-xs">
        {CREDITS.map(([name, license]) => (
          <li key={name} className="flex justify-between gap-2">
            <span>{name}</span>
            <span className="text-muted-foreground">{license}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
