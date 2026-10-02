import {
  applyChange,
  createHistory,
  redo as redoH,
  undo as undoH,
  type DocumentModel,
  type History,
  type HistoryEntry,
} from '@pdf-atelier/core'
import type { PdfSource } from '@pdf-atelier/pdf'
import type { FileRef } from '@pdf-atelier/platform'
import type { Draft } from 'immer'
import { create } from 'zustand'

export interface OpenSource {
  /** Original file bytes (export always composes from these: non-destructive). */
  bytes: Uint8Array
  pdf: PdfSource
  /** Password used to open it; the exporter needs it to decrypt. */
  password?: string
}

/**
 * Saved position in the history: the last past entry when saved (null = initial state),
 * or 'lost' once that position can no longer be reached by undo/redo.
 */
export type SavedMark = HistoryEntry | null | 'lost'

export interface OpenDoc {
  id: string
  name: string
  ref: FileRef | null
  history: History<DocumentModel>
  saved: SavedMark
  sources: Map<string, OpenSource>
}

interface DocumentsStore {
  docs: OpenDoc[]
  activeId: string | null
  add(doc: OpenDoc): void
  close(id: string): void
  setActive(id: string): void
  change(
    label: string,
    recipe: (d: Draft<DocumentModel>) => void,
    opts?: { coalesceKey?: string },
  ): void
  undo(): void
  redo(): void
  /** `mark` = savedMark() taken when the export started (edits made during the save stay dirty). */
  markSaved(id: string, ref: FileRef | null, name: string, mark: SavedMark): void
}

/** Position-based: undoing back to the saved state clears dirty. */
export const savedMark = (h: History<DocumentModel>): SavedMark => h.past.at(-1) ?? null
export const isDirty = (d: OpenDoc) => savedMark(d.history) !== d.saved

/** After a new change, the saved position is unreachable if its entry left `past` or was dropped by the cap. */
function keepMark(saved: SavedMark, prev: HistoryEntry[], next: HistoryEntry[]): SavedMark {
  if (saved === 'lost') return saved
  if (saved === null) return prev.length >= 2 && next[0] === prev[1] ? 'lost' : null
  return next.includes(saved) ? saved : 'lost'
}

export const newOpenDoc = (
  model: DocumentModel,
  name: string,
  ref: FileRef | null,
  sources: Map<string, OpenSource>,
): OpenDoc => ({
  id: model.id,
  name,
  ref,
  history: createHistory(model),
  saved: null,
  sources,
})

export const useDocuments = create<DocumentsStore>((set, get) => {
  const updateActive = (fn: (d: OpenDoc) => OpenDoc) =>
    set((s) => ({ docs: s.docs.map((d) => (d.id === s.activeId ? fn(d) : d)) }))
  return {
    docs: [],
    activeId: null,
    add: (doc) => set((s) => ({ docs: [...s.docs, doc], activeId: doc.id })),
    close: (id) => {
      const { docs, activeId } = get()
      const i = docs.findIndex((d) => d.id === id)
      const doc = docs[i]
      if (!doc) return
      for (const src of doc.sources.values()) void src.pdf.destroy()
      const rest = docs.filter((d) => d.id !== id)
      set({
        docs: rest,
        activeId: activeId === id ? (rest[Math.min(i, rest.length - 1)]?.id ?? null) : activeId,
      })
    },
    setActive: (id) => set({ activeId: id }),
    change: (label, recipe, opts) =>
      updateActive((d) => {
        const history = applyChange(d.history, label, recipe, opts)
        if (history === d.history) return d
        return { ...d, history, saved: keepMark(d.saved, d.history.past, history.past) }
      }),
    undo: () => updateActive((d) => ({ ...d, history: undoH(d.history) })),
    redo: () => updateActive((d) => ({ ...d, history: redoH(d.history) })),
    markSaved: (id, ref, name, mark) =>
      set((s) => ({
        docs: s.docs.map((d) => (d.id === id ? { ...d, ref, name, saved: mark } : d)),
      })),
  }
})

export const activeDoc = () => {
  const { docs, activeId } = useDocuments.getState()
  return docs.find((d) => d.id === activeId)
}

export const useActiveDoc = () => useDocuments((s) => s.docs.find((d) => d.id === s.activeId))
