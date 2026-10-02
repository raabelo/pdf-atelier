import { useState } from 'react'
import {
  everyN,
  exportImages,
  mergePdf,
  parseRanges,
  splitDocument,
  usePageDialog,
  usePageSelection,
  type ImageExportOptions,
} from '../files/pages.ts'
import { t } from '../i18n/index.ts'
import { usePlatform } from '../platform.ts'
import { useActiveDoc } from '../stores/documents.ts'
import { useUi } from '../stores/ui.ts'
import { Button } from '../ui/button.tsx'
import { Input, Select } from '../ui/controls.tsx'
import { Dialog } from '../ui/overlays.tsx'

const FORM = 'page-dialog-form'
const label = 'mt-3 block space-y-1 text-sm'
const hint = 'text-xs text-muted-foreground'

/** Split / export images / insert PDF dialogs, opened by the page commands. */
export function PageDialogs() {
  const open = usePageDialog((s) => s.open)
  const doc = useActiveDoc()
  const close = () => usePageDialog.setState({ open: null })
  if (!doc) return null
  const total = doc.history.present.pages.length
  const body =
    open === 'split' ? (
      <SplitForm total={total} onDone={close} />
    ) : open === 'images' ? (
      <ImagesForm onDone={close} />
    ) : open === 'merge' ? (
      <MergeForm total={total} onDone={close} />
    ) : null
  const title =
    open === 'split' ? t('split.title') : open === 'images' ? t('images.title') : t('cmd.page.merge')
  const action =
    open === 'split' ? t('split.run') : open === 'images' ? t('images.run') : t('dialog.open')
  return (
    <Dialog
      open={!!open}
      onOpenChange={(o) => !o && close()}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" form={FORM}>
            {action}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}

function SplitForm({ total, onDone }: { total: number; onDone: () => void }) {
  const platform = usePlatform()
  const [mode, setMode] = useState<'every' | 'ranges'>('every')
  const [error, setError] = useState(false)
  return (
    <form
      id={FORM}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const groups =
          mode === 'every'
            ? everyN(Math.max(1, Number(f.get('n')) || 1), total)
            : parseRanges(String(f.get('ranges')), total)
        if (!groups) return setError(true)
        onDone()
        void splitDocument(platform, groups)
      }}
    >
      <fieldset className="mt-3 space-y-2 text-sm">
        {(['every', 'ranges'] as const).map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
            {t(m === 'every' ? 'split.every' : 'split.ranges')}
          </label>
        ))}
      </fieldset>
      {mode === 'every' ? (
        <label className={label}>
          <span className={hint}>N</span>
          <Input name="n" type="number" min={1} max={total} defaultValue={1} autoFocus />
        </label>
      ) : (
        <label className={label}>
          <span className={hint}>{t('split.rangesHint')}</span>
          <Input
            name="ranges"
            autoFocus
            aria-invalid={error}
            placeholder={`1-${Math.ceil(total / 2)}, ${Math.ceil(total / 2) + 1}-${total}`}
            onChange={() => setError(false)}
          />
        </label>
      )}
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {t('split.invalid', { max: total })}
        </p>
      )}
    </form>
  )
}

function ImagesForm({ onDone }: { onDone: () => void }) {
  const platform = usePlatform()
  const hasSelection = usePageSelection((s) => s.ids.length > 0)
  return (
    <form
      id={FORM}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onDone()
        void exportImages(platform, {
          pages: f.get('pages') as ImageExportOptions['pages'],
          dpi: Number(f.get('dpi')),
          format: f.get('format') as ImageExportOptions['format'],
        })
      }}
    >
      <label className={label}>
        <span className={hint}>{t('images.pages')}</span>
        <Select name="pages" defaultValue={hasSelection ? 'selection' : 'current'}>
          <option value="current">{t('images.current')}</option>
          {hasSelection && <option value="selection">{t('images.selection')}</option>}
          <option value="all">{t('images.all')}</option>
        </Select>
      </label>
      <label className={label}>
        <span className={hint}>{t('images.dpi')}</span>
        <Select name="dpi" defaultValue="150">
          {[72, 150, 300].map((d) => (
            <option key={d} value={d}>
              {d} DPI
            </option>
          ))}
        </Select>
      </label>
      <label className={label}>
        <span className={hint}>{t('images.format')}</span>
        <Select name="format" defaultValue="png">
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </Select>
      </label>
    </form>
  )
}

function MergeForm({ total, onDone }: { total: number; onDone: () => void }) {
  const platform = usePlatform()
  const doc = useActiveDoc()
  const current = useUi((s) => (doc ? (s.views[doc.id]?.page ?? 0) : 0))
  return (
    <form
      id={FORM}
      onSubmit={(e) => {
        e.preventDefault()
        const after = Number(new FormData(e.currentTarget).get('after'))
        onDone()
        void mergePdf(platform, Math.max(0, Math.min(total, after)) - 1)
      }}
    >
      <label className={label}>
        <span className={hint}>{t('merge.where')}</span>
        <Input name="after" type="number" min={0} max={total} defaultValue={current + 1} autoFocus />
      </label>
    </form>
  )
}
