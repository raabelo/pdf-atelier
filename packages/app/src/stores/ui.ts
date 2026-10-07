import type { AnnotationStyle, AnnotationType, Clipboard, Rect, Rotation } from '@pdf-atelier/core'
import { create } from 'zustand'
import { useSettings } from './settings.ts'

export type Tool = 'select' | AnnotationType
export type Zoom = number | 'fit-width' | 'fit-page'
export type Panel = 'pages' | 'outline' | 'bookmarks' | 'annotations' | 'search' | 'tts' | 'translate'

export interface ViewState {
  zoom: Zoom
  /** View-only extra rotation (page rotation itself is part of the document). */
  rotation: Rotation
  /** 0-based index of the page most in view. */
  page: number
  /** Effective CSS px per point, computed by the viewer from `zoom`. */
  scale: number
}

export interface SearchState {
  query: string
  caseSensitive: boolean
  hits: { pageId: string; rects: Rect[]; snippet: string }[]
  active: number
  running: boolean
}

const style = (
  color: string,
  opacity = 1,
  strokeWidth = 2,
  fill: string | null = null,
): AnnotationStyle => ({
  color,
  fill,
  strokeWidth,
  opacity,
})

export const defaultStyles: Record<AnnotationType, AnnotationStyle> = {
  highlight: style('#ffd400', 0.4),
  underline: style('#2563eb'),
  strikeout: style('#dc2626'),
  freetext: style('#111111'),
  ink: style('#dc2626', 1, 2),
  rect: style('#2563eb'),
  ellipse: style('#2563eb'),
  line: style('#111111'),
  arrow: style('#111111'),
  note: style('#f59e0b'),
  image: style('#111111'),
}

export const defaultView: ViewState = { zoom: 'fit-width', rotation: 0, page: 0, scale: 1 }

interface Confirm {
  title: string
  body: string
  confirmLabel: string
  /** Shows a password field; resolve receives its value. */
  password?: boolean
  resolve: (ok: boolean, value?: string) => void
}

interface UiStore {
  tool: Tool
  styles: Record<AnnotationType, AnnotationStyle>
  /** Default font size (pt) for new text boxes. */
  fontSize: number
  sidebarOpen: boolean
  panel: Panel
  views: Record<string, ViewState>
  /** Selected annotation ids in the active document. */
  selection: string[]
  /** Annotation being edited inline (freetext text, note popover). */
  editing: string | null
  /** In-app annotation clipboard (shared by every tab). */
  clipboard: Clipboard | null
  styleClipboard: AnnotationStyle | null
  /** Insert dialogs (signature pad, stamp picker). */
  insertDialog: 'signature' | 'stamp' | null
  search: SearchState
  /** Page to scroll to; the viewer consumes it. */
  scrollTo: { docId: string; page: number; nonce: number } | null
  confirm: Confirm | null
  /** Long-running cancelable task (printing). value 0..1. */
  progress: { label: string; value: number; cancel: () => void } | null
  aboutOpen: boolean
  message: { text: string; error?: boolean } | null
  set(patch: Partial<Omit<UiStore, 'set'>>): void
}

export const useUi = create<UiStore>((set) => ({
  tool: 'select',
  styles: defaultStyles,
  fontSize: 10,
  sidebarOpen: typeof window === 'undefined' || window.innerWidth >= 900,
  panel: 'pages',
  views: {},
  selection: [],
  editing: null,
  clipboard: null,
  styleClipboard: null,
  insertDialog: null,
  search: { query: '', caseSensitive: false, hits: [], active: 0, running: false },
  scrollTo: null,
  confirm: null,
  progress: null,
  aboutOpen: false,
  message: null,
  set: (patch) => set(patch),
}))

export const viewOf = (docId: string | null | undefined): ViewState =>
  (docId && useUi.getState().views[docId]) || { ...defaultView, zoom: useSettings.getState().zoom }

export function updateView(docId: string, patch: Partial<ViewState>) {
  if (patch.zoom !== undefined) useSettings.getState().set({ zoom: patch.zoom })
  useUi.setState((s) => ({
    views: { ...s.views, [docId]: { ...viewOf(docId), ...s.views[docId], ...patch } },
  }))
}

export function goToPage(docId: string, page: number) {
  updateView(docId, { page })
  useUi.setState({ scrollTo: { docId, page, nonce: Date.now() } })
}

export const askConfirm = (title: string, body: string, confirmLabel: string) =>
  new Promise<boolean>((resolve) =>
    useUi.setState({ confirm: { title, body, confirmLabel, resolve } }),
  )

export const askPassword = (title: string, body: string, confirmLabel: string) =>
  new Promise<string | null>((resolve) =>
    useUi.setState({
      confirm: {
        title,
        body,
        confirmLabel,
        password: true,
        resolve: (ok, v) => resolve(ok ? (v ?? '') : null),
      },
    }),
  )

export function notify(text: string, error = false) {
  useUi.setState({ message: { text, error } })
}
