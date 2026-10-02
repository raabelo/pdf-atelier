import {
  annotationBounds,
  collectClipboard,
  docOps,
  type Annotation,
  type Rect,
} from '@pdf-atelier/core'
import { activeDoc, useDocuments } from '../stores/documents.ts'
import { useUi, viewOf } from '../stores/ui.ts'

const STEP = 12

/** Click on an annotation: additive (Shift/Ctrl/Cmd) toggles it, plain click keeps a multi-selection being dragged. */
export function nextSelection(selection: string[], id: string, additive: boolean): string[] {
  if (additive) return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]
  return selection.includes(id) ? selection : [id]
}

/** Annotations whose bounds intersect the marquee rect (page coords). */
export function idsInRect(annotations: Annotation[], r: Rect): string[] {
  return annotations
    .filter((a) => {
      const b = annotationBounds(a)
      return b.x <= r.x + r.width && b.x + b.width >= r.x && b.y <= r.y + r.height && b.y + b.height >= r.y
    })
    .map((a) => a.id)
}

/** Text selected in a text layer or focus in a field: Ctrl+C/X/V must stay native. */
export function nativeClipboardWanted(): boolean {
  const el = document.activeElement
  const typing =
    el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
  return typing || !!window.getSelection()?.toString()
}

export const canCopy = () => useUi.getState().selection.length > 0 && !nativeClipboardWanted()
export const canPaste = () => !!activeDoc() && !!useUi.getState().clipboard && !nativeClipboardWanted()

let pastes = 0

export function copySelection() {
  const doc = activeDoc()
  if (!doc) return
  useUi.setState({ clipboard: collectClipboard(doc.history.present, useUi.getState().selection) })
  pastes = 0
}

export function cutSelection() {
  copySelection()
  const ids = useUi.getState().selection
  useDocuments.getState().change('cut', (d) => docOps.removeAnnotations(d, ids))
  useUi.setState({ selection: [] })
  pastes = -1 // the first paste of a cut lands in place
}

/** Pastes onto the current page of the active document (works across tabs: images travel along). */
export function paste() {
  const doc = activeDoc()
  const clip = useUi.getState().clipboard
  if (!doc || !clip) return
  const { pages } = doc.history.present
  const page = pages[Math.min(viewOf(doc.id).page, pages.length - 1)]!
  const step = STEP * ++pastes
  let ids: string[] = []
  useDocuments.getState().change('paste', (d) => {
    ids = docOps.pasteAnnotations(d, clip, page.id, { x: step, y: step })
  })
  useUi.setState({ selection: ids, tool: 'select', editing: null })
}

export function duplicateSelection() {
  const sel = useUi.getState().selection
  let ids: string[] = []
  useDocuments.getState().change('duplicate', (d) => {
    ids = docOps.duplicateAnnotations(d, sel, { x: STEP, y: STEP })
  })
  useUi.setState({ selection: ids })
}

export function copyStyle() {
  const doc = activeDoc()
  const first = doc?.history.present.annotations[useUi.getState().selection[0] ?? '']
  if (first) useUi.setState({ styleClipboard: { ...first.style } })
}

export function pasteStyle() {
  const { selection, styleClipboard } = useUi.getState()
  if (styleClipboard)
    useDocuments.getState().change('paste style', (d) => docOps.setStyle(d, selection, styleClipboard))
}
