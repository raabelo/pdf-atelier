import { canRedo, canUndo, docOps, type AnnotationType } from '@pdf-atelier/core'
import {
  ArrowUpRight,
  Circle,
  Download,
  FolderOpen,
  Info,
  Highlighter,
  ImagePlus,
  Paintbrush,
  Signature,
  Stamp,
  StickyNote,
  Minus,
  Monitor,
  Moon,
  MousePointer2,
  PanelLeft,
  Pencil,
  Printer,
  Redo2,
  Save,
  Square,
  Strikethrough,
  Sun,
  Type,
  Underline,
  Undo2,
  type LucideIcon,
  Shrink,
} from 'lucide-react'
import { cn } from 'cn'
import { formatKeys, runCommand } from '../commands/registry.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import { useActiveDoc, useDocuments } from '../stores/documents.ts'
import { usePlatform } from '../platform.ts'
import { useSettings } from '../stores/settings.ts'
import { useUi, type Tool } from '../stores/ui.ts'
import { PagesMenu } from '../sidebar/PagesMenu.tsx'
import { Button } from '../ui/button.tsx'
import { Separator, Slider } from '../ui/controls.tsx'
import { IconButton, Popover } from '../ui/overlays.tsx'
import { copyStyle, pasteStyle } from '../annotations/actions.ts'
import { InsertDialogs } from '../annotations/InsertDialogs.tsx'

/** Always the newest release's installer (electron-builder artifactName is version-free). */
const WINDOWS_INSTALLER_URL =
  'https://github.com/raabelo/pdf-atelier/releases/latest/download/PDF-Atelier-Setup.exe'

const TOOLS: [Tool, LucideIcon][] = [
  ['select', MousePointer2],
  ['highlight', Highlighter],
  ['underline', Underline],
  ['strikeout', Strikethrough],
  ['freetext', Type],
  ['ink', Pencil],
  ['rect', Square],
  ['ellipse', Circle],
  ['line', Minus],
  ['arrow', ArrowUpRight],
  ['note', StickyNote],
]

const COLORS = [
  '#111111',
  '#dc2626',
  '#ea580c',
  '#ffd400',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
  '#ffffff',
]

export function Cmd({
  id,
  icon: Icon,
  disabled,
  className,
}: {
  id: string
  icon: LucideIcon
  disabled?: boolean
  className?: string
}) {
  return (
    <IconButton
      label={t(`cmd.${id}` as MessageKey)}
      shortcut={formatKeys(id)}
      disabled={disabled}
      className={className}
      onClick={() => runCommand(id)}
    >
      <Icon />
    </IconButton>
  )
}

function StyleControls() {
  const tool = useUi((s) => s.tool)
  const styles = useUi((s) => s.styles)
  const selection = useUi((s) => s.selection)
  const styleClip = useUi((s) => s.styleClipboard)
  const defaultFontSize = useUi((s) => s.fontSize)
  const doc = useActiveDoc()
  const selected = selection.map((id) => doc?.history.present.annotations[id]).filter((a) => !!a)
  const type: AnnotationType = selected[0]?.type ?? (tool === 'select' ? 'rect' : tool)
  const style = selected[0]?.style ?? styles[type]

  // Edits apply to the selection (undoable) and become the tool default.
  const apply = (patch: Partial<typeof style>) => {
    useUi.setState((s) => ({ styles: { ...s.styles, [type]: { ...s.styles[type], ...patch } } }))
    if (selected.length)
      useDocuments
        .getState()
        .change(
          'style',
          (d) =>
            selected.forEach((a) =>
              docOps.updateAnnotation(d, a.id, { style: { ...a.style, ...patch } }),
            ),
          { coalesceKey: `style:${selection.join()}` },
        )
  }

  const texts = selected.filter((a) => a.type === 'freetext')
  const fontSize = texts[0]?.fontSize ?? defaultFontSize
  const applyFontSize = (size: number) => {
    useUi.setState({ fontSize: size })
    if (texts.length)
      useDocuments
        .getState()
        .change(
          'font size',
          (d) => texts.forEach((a) => docOps.updateAnnotation(d, a.id, { fontSize: size })),
          { coalesceKey: `fontSize:${selection.join()}` },
        )
  }

  return (
    <Popover
      trigger={
        <Button variant="ghost" size="icon" aria-label={t('style.title')} className="relative">
          <span
            className="size-4 rounded-full border"
            style={{ background: style.color, opacity: style.opacity }}
          />
          {/* Badge: hints that text options (font size) live here too. */}
          <span
            aria-hidden
            className={cn(
              'absolute bottom-1 left-1.25 rounded-sm px-0.5 font-serif text-[10px] leading-none font-bold text-foreground',
            )}
          >
            A
          </span>
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">{t('style.color')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={c}
                aria-pressed={style.color === c}
                className="size-6 rounded-full border aria-pressed:ring-2 aria-pressed:ring-ring"
                style={{ background: c }}
                onClick={() => apply({ color: c })}
              />
            ))}
            <input
              type="color"
              aria-label={t('style.color')}
              value={style.color}
              onChange={(e) => apply({ color: e.target.value })}
              className="size-6"
            />
          </div>
        </fieldset>
        {(type === 'rect' || type === 'ellipse') && (
          <fieldset>
            <legend className="mb-1 text-xs text-muted-foreground">{t('style.fill')}</legend>
            <div className="flex flex-wrap gap-1.5">
              <button
                className="h-6 rounded-md border px-2 text-xs aria-pressed:ring-2 aria-pressed:ring-ring"
                aria-pressed={!style.fill}
                onClick={() => apply({ fill: null })}
              >
                {t('style.noFill')}
              </button>
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`${t('style.fill')} ${c}`}
                  aria-pressed={style.fill === c}
                  className="size-6 rounded-md border aria-pressed:ring-2 aria-pressed:ring-ring"
                  style={{ background: c }}
                  onClick={() => apply({ fill: c })}
                />
              ))}
            </div>
          </fieldset>
        )}
        {/* Always shown: without text boxes selected it sets the default for new ones. */}
        <div>
          <span className="text-xs text-muted-foreground">
            {t('style.fontSize')}: {fontSize}pt
          </span>
          <Slider
            label={t('style.fontSize')}
            min={6}
            max={72}
            step={1}
            value={[fontSize]}
            onValueChange={([v]) => applyFontSize(v!)}
          />
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {t('style.width')}: {style.strokeWidth}pt
          </span>
          <Slider
            label={t('style.width')}
            min={0.5}
            max={12}
            step={0.5}
            value={[style.strokeWidth]}
            onValueChange={([v]) => apply({ strokeWidth: v! })}
          />
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {t('style.opacity')}: {Math.round(style.opacity * 100)}%
          </span>
          <Slider
            label={t('style.opacity')}
            min={0.1}
            max={1}
            step={0.05}
            value={[style.opacity]}
            onValueChange={([v]) => apply({ opacity: v! })}
          />
        </div>
        {selected.length > 0 && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={copyStyle}>
              <Paintbrush /> {t('cmd.edit.copyStyle')}
            </Button>
            <Button size="sm" variant="outline" onClick={pasteStyle} disabled={!styleClip}>
              {t('cmd.edit.pasteStyle')}
            </Button>
          </div>
        )}
      </div>
    </Popover>
  )
}

export function Toolbar() {
  const platform = usePlatform()
  const doc = useActiveDoc()
  const tool = useUi((s) => s.tool)
  const theme = useSettings((s) => s.theme)
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  const noDoc = !doc

  return (
    <header
      role="toolbar"
      aria-label="PDF Atelier"
      className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2"
    >
      <IconButton
        label={t('cmd.view.toggleSidebar')}
        shortcut={formatKeys('view.toggleSidebar')}
        onClick={() => runCommand('view.toggleSidebar')}
      >
        <PanelLeft />
      </IconButton>
      <Separator vertical />
      <Cmd id="file.open" icon={FolderOpen} />
      <Cmd id="file.save" icon={Save} disabled={noDoc} />
      <Cmd id="file.saveCompressed" icon={Shrink} disabled={noDoc} />
      <Cmd id="file.print" icon={Printer} disabled={noDoc} />
      <Separator vertical />
      <Cmd id="edit.undo" icon={Undo2} disabled={!doc || !canUndo(doc.history)} />
      <Cmd id="edit.redo" icon={Redo2} disabled={!doc || !canRedo(doc.history)} />
      <Separator vertical />
      {TOOLS.map(([id, Icon]) => (
        <IconButton
          key={id}
          label={t(`tool.${id}`)}
          shortcut={formatKeys(`tool.${id}`)}
          aria-pressed={tool === id}
          disabled={noDoc}
          onClick={() => runCommand(`tool.${id}`)}
        >
          <Icon />
        </IconButton>
      ))}
      {(
        [
          ['tool.image', ImagePlus, 'tool.image'],
          ['insert.signature', Signature, 'cmd.insert.signature'],
          ['insert.stamp', Stamp, 'cmd.insert.stamp'],
        ] as const
      ).map(([id, Icon, label]) => (
        <IconButton
          key={id}
          label={t(label)}
          shortcut={formatKeys(id)}
          disabled={noDoc}
          onClick={() => runCommand(id)}
        >
          <Icon />
        </IconButton>
      ))}
      <StyleControls />
      <InsertDialogs />
      <Separator vertical />
      <PagesMenu disabled={noDoc} />
      <div className="ml-auto" />
      {!platform.onOpenFile && ( // web only: the desktop app already is the download
        <IconButton
          label={t('app.downloadWindows')}
          onClick={() => void platform.shell.openExternal(WINDOWS_INSTALLER_URL)}
        >
          <Download />
        </IconButton>
      )}
      <Cmd id="help.about" icon={Info} />
      <IconButton
        label={`${t('cmd.view.toggleTheme')}: ${t(`theme.${theme}`)}`}
        onClick={() => runCommand('view.toggleTheme')}
      >
        <ThemeIcon />
      </IconButton>
    </header>
  )
}
