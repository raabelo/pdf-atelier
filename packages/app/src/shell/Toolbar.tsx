import { canRedo, canUndo, docOps, type AnnotationType } from '@pdf-atelier/core'
import {
  ArrowUpRight,
  Circle,
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
  RotateCw,
  Save,
  Square,
  Strikethrough,
  Sun,
  Type,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import { formatKeys, runCommand } from '../commands/registry.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import { useActiveDoc, useDocuments } from '../stores/documents.ts'
import { useSettings } from '../stores/settings.ts'
import { useUi, type Tool } from '../stores/ui.ts'
import { PagesMenu } from '../sidebar/PagesMenu.tsx'
import { Button } from '../ui/button.tsx'
import { Separator, Slider } from '../ui/controls.tsx'
import { IconButton, Popover } from '../ui/overlays.tsx'
import { copyStyle, pasteStyle } from '../annotations/actions.ts'
import { InsertDialogs } from '../annotations/InsertDialogs.tsx'

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

function Cmd({ id, icon: Icon, disabled }: { id: string; icon: LucideIcon; disabled?: boolean }) {
  return (
    <IconButton
      label={t(`cmd.${id}` as MessageKey)}
      shortcut={formatKeys(id)}
      disabled={disabled}
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

  return (
    <Popover
      trigger={
        <Button variant="ghost" size="icon" aria-label={t('style.title')}>
          <span
            className="size-4 rounded-full border"
            style={{ background: style.color, opacity: style.opacity }}
          />
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
      <Cmd id="view.zoomOut" icon={ZoomOut} disabled={noDoc} />
      <Cmd id="view.zoomIn" icon={ZoomIn} disabled={noDoc} />
      <Cmd id="view.rotate" icon={RotateCw} disabled={noDoc} />
      <Separator vertical />
      <PagesMenu disabled={noDoc} />
      <div className="ml-auto" />
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
