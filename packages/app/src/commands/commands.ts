import { canRedo, canUndo, docOps } from '@pdf-atelier/core'
import type { Platform } from '@pdf-atelier/platform'
import { closeDoc, openWithDialog, save } from '../files/actions.ts'
import {
  deletePages,
  duplicatePages,
  extractPages,
  insertBlankPage,
  rotatePages,
  toggleBookmark,
  usePageDialog,
} from '../files/pages.ts'
import { printDoc } from '../files/print.ts'
import { stepHit } from '../sidebar/search.ts'
import { activeDoc, useDocuments } from '../stores/documents.ts'
import { useSettings } from '../stores/settings.ts'
import { goToPage, updateView, useUi, viewOf, type Tool } from '../stores/ui.ts'
import {
  readFromCurrentPage,
  readSelection,
  stopReading,
  togglePause,
  useTts,
} from '../tts/controller.ts'
import {
  canCopy,
  canPaste,
  copySelection,
  copyStyle,
  cutSelection,
  duplicateSelection,
  paste,
  pasteStyle,
} from '../annotations/actions.ts'
import { pickImage } from '../annotations/images.ts'
import type { Command } from './registry.ts'

const hasDoc = () => !!activeDoc()
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6]

function zoomBy(dir: 1 | -1) {
  const doc = activeDoc()
  if (!doc) return
  const { scale } = viewOf(doc.id)
  const next =
    dir > 0
      ? ZOOM_STEPS.find((z) => z > scale + 0.01)
      : ZOOM_STEPS.findLast((z) => z < scale - 0.01)
  if (next) updateView(doc.id, { zoom: next })
}

function stepPage(delta: number) {
  const doc = activeDoc()
  if (!doc) return
  const last = doc.history.present.pages.length - 1
  goToPage(doc.id, Math.max(0, Math.min(last, viewOf(doc.id).page + delta)))
}

const tools: [Tool, string][] = [
  ['select', 'V'],
  ['highlight', 'H'],
  ['underline', 'U'],
  ['strikeout', 'K'],
  ['freetext', 'T'],
  ['ink', 'P'],
  ['rect', 'R'],
  ['ellipse', 'O'],
  ['line', 'L'],
  ['arrow', 'A'],
  ['note', 'N'],
]

export function createCommands(platform: Platform): Command[] {
  return [
    {
      id: 'file.open',
      labelKey: 'cmd.file.open',
      keys: ['Mod+O'],
      run: () => openWithDialog(platform),
    },
    {
      id: 'file.save',
      labelKey: 'cmd.file.save',
      keys: ['Mod+S'],
      when: hasDoc,
      run: () => save(platform),
    },
    {
      id: 'file.saveAs',
      labelKey: 'cmd.file.saveAs',
      keys: ['Mod+Shift+S'],
      when: hasDoc,
      run: () => save(platform, activeDoc(), true),
    },
    {
      id: 'file.print',
      labelKey: 'cmd.file.print',
      keys: ['Mod+P'],
      when: () => hasDoc() && !useUi.getState().progress,
      run: () => printDoc(),
    },
    {
      id: 'help.about',
      labelKey: 'cmd.help.about',
      run: () => useUi.setState({ aboutOpen: true }),
    },
    {
      id: 'file.close',
      labelKey: 'cmd.file.close',
      keys: ['Mod+W'],
      when: hasDoc,
      run: () => closeDoc(),
    },
    {
      id: 'edit.undo',
      labelKey: 'cmd.edit.undo',
      keys: ['Mod+Z'],
      when: () => !!activeDoc() && canUndo(activeDoc()!.history),
      run: () => {
        useUi.setState({ selection: [] })
        useDocuments.getState().undo()
      },
    },
    {
      id: 'edit.redo',
      labelKey: 'cmd.edit.redo',
      keys: ['Mod+Shift+Z', 'Mod+Y'],
      when: () => !!activeDoc() && canRedo(activeDoc()!.history),
      run: () => {
        useUi.setState({ selection: [] })
        useDocuments.getState().redo()
      },
    },
    {
      id: 'edit.delete',
      labelKey: 'cmd.edit.delete',
      keys: ['Delete', 'Backspace'],
      when: () => useUi.getState().selection.length > 0,
      run: () => {
        const ids = useUi.getState().selection
        useDocuments.getState().change('delete', (d) => docOps.removeAnnotations(d, ids))
        useUi.setState({ selection: [] })
      },
    },
    {
      id: 'edit.find',
      labelKey: 'cmd.edit.find',
      keys: ['Mod+F'],
      when: hasDoc,
      run: () => {
        useUi.setState({ sidebarOpen: true, panel: 'search' })
        requestAnimationFrame(() => document.getElementById('search-input')?.focus())
      },
    },
    {
      id: 'view.zoomIn',
      labelKey: 'cmd.view.zoomIn',
      keys: ['Mod+=', 'Mod++'],
      when: hasDoc,
      run: () => zoomBy(1),
    },
    {
      id: 'view.zoomOut',
      labelKey: 'cmd.view.zoomOut',
      keys: ['Mod+-'],
      when: hasDoc,
      run: () => zoomBy(-1),
    },
    {
      id: 'view.fitWidth',
      labelKey: 'cmd.view.fitWidth',
      keys: ['Mod+1'],
      when: hasDoc,
      run: () => updateView(activeDoc()!.id, { zoom: 'fit-width' }),
    },
    {
      id: 'view.fitPage',
      labelKey: 'cmd.view.fitPage',
      keys: ['Mod+0'],
      when: hasDoc,
      run: () => updateView(activeDoc()!.id, { zoom: 'fit-page' }),
    },
    {
      id: 'view.rotate',
      labelKey: 'cmd.view.rotate',
      keys: ['Mod+R'],
      when: hasDoc,
      run: () => {
        const id = activeDoc()!.id
        updateView(id, { rotation: ((viewOf(id).rotation + 90) % 360) as 0 | 90 | 180 | 270 })
      },
    },
    {
      id: 'view.nextPage',
      labelKey: 'cmd.view.nextPage',
      keys: ['PageDown', 'Mod+ArrowDown'],
      when: hasDoc,
      run: () => stepPage(1),
    },
    {
      id: 'view.prevPage',
      labelKey: 'cmd.view.prevPage',
      keys: ['PageUp', 'Mod+ArrowUp'],
      when: hasDoc,
      run: () => stepPage(-1),
    },
    {
      id: 'view.toggleSidebar',
      labelKey: 'cmd.view.toggleSidebar',
      keys: ['Mod+\\'],
      run: () => useUi.setState((s) => ({ sidebarOpen: !s.sidebarOpen })),
    },
    ...pageCommands(platform),
    {
      id: 'view.toggleTheme',
      labelKey: 'cmd.view.toggleTheme',
      run: () => {
        const order = ['system', 'light', 'dark'] as const
        const { theme, set } = useSettings.getState()
        set({ theme: order[(order.indexOf(theme) + 1) % order.length]! })
      },
    },
    ...tools.map(([tool, key]): Command => ({
      id: `tool.${tool}`,
      labelKey: `tool.${tool}`,
      keys: [key],
      run: () => useUi.setState({ tool, selection: [], editing: null }),
    })),
    {
      id: 'tool.image',
      labelKey: 'tool.image',
      keys: ['I'],
      when: hasDoc,
      run: pickImage,
    },
    {
      id: 'insert.signature',
      labelKey: 'cmd.insert.signature',
      keys: ['G'],
      when: hasDoc,
      run: () => useUi.setState({ insertDialog: 'signature' }),
    },
    {
      id: 'insert.stamp',
      labelKey: 'cmd.insert.stamp',
      keys: ['M'],
      when: hasDoc,
      run: () => useUi.setState({ insertDialog: 'stamp' }),
    },
    // Clipboard: annotation copy/paste only when no text is selected and no field is focused.
    { id: 'edit.copy', labelKey: 'cmd.edit.copy', keys: ['Mod+C'], when: canCopy, run: copySelection },
    { id: 'edit.cut', labelKey: 'cmd.edit.cut', keys: ['Mod+X'], when: canCopy, run: cutSelection },
    { id: 'edit.paste', labelKey: 'cmd.edit.paste', keys: ['Mod+V'], when: canPaste, run: paste },
    {
      id: 'edit.duplicate',
      labelKey: 'cmd.edit.duplicate',
      keys: ['Mod+D'],
      when: canCopy,
      run: duplicateSelection,
    },
    {
      id: 'edit.copyStyle',
      labelKey: 'cmd.edit.copyStyle',
      keys: ['Mod+Alt+C'],
      when: canCopy,
      run: copyStyle,
    },
    {
      id: 'edit.pasteStyle',
      labelKey: 'cmd.edit.pasteStyle',
      keys: ['Mod+Alt+V'],
      when: () => canCopy() && !!useUi.getState().styleClipboard,
      run: pasteStyle,
    },
    {
      id: 'tts.play',
      labelKey: 'cmd.tts.play',
      keys: ['Mod+Shift+R'],
      when: hasDoc,
      run: () => (readSelection(true) ? undefined : readFromCurrentPage()),
    },
    {
      id: 'tts.pause',
      labelKey: 'cmd.tts.pause',
      keys: ['Mod+Shift+P'],
      when: () => useTts.getState().state !== 'idle',
      run: togglePause,
    },
    {
      id: 'tts.stop',
      labelKey: 'cmd.tts.stop',
      keys: ['Escape'],
      when: () => useTts.getState().state !== 'idle',
      run: stopReading,
    },
  ]
}

/** Page tools (toolbar "Pages" menu, thumbnail context menu); they act on the thumbnail selection. */
function pageCommands(platform: Platform): Command[] {
  const dialog = (open: 'split' | 'images' | 'merge') => () => usePageDialog.setState({ open })
  return [
    { id: 'page.insertBlank', labelKey: 'cmd.page.insertBlank', when: hasDoc, run: () => insertBlankPage() },
    { id: 'page.duplicate', labelKey: 'cmd.page.duplicate', when: hasDoc, run: () => duplicatePages() },
    { id: 'page.rotate', labelKey: 'cmd.page.rotate', when: hasDoc, run: () => rotatePages() },
    { id: 'page.delete', labelKey: 'cmd.page.delete', when: hasDoc, run: () => deletePages() },
    { id: 'page.bookmark', labelKey: 'cmd.page.bookmark', keys: ['Mod+B'], when: hasDoc, run: () => toggleBookmark() },
    { id: 'page.extract', labelKey: 'cmd.page.extract', when: hasDoc, run: () => extractPages(platform) },
    { id: 'page.split', labelKey: 'cmd.page.split', when: hasDoc, run: dialog('split') },
    { id: 'page.merge', labelKey: 'cmd.page.merge', when: hasDoc, run: dialog('merge') },
    { id: 'page.exportImages', labelKey: 'cmd.page.exportImages', when: hasDoc, run: dialog('images') },
    {
      id: 'search.next',
      labelKey: 'cmd.search.next',
      keys: ['F3'],
      when: () => useUi.getState().search.hits.length > 0,
      run: () => stepHit(1),
    },
    {
      id: 'search.prev',
      labelKey: 'cmd.search.prev',
      keys: ['Shift+F3'],
      when: () => useUi.getState().search.hits.length > 0,
      run: () => stepHit(-1),
    },
  ]
}
