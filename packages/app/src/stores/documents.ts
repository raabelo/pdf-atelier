import {
  applyChange,
  createHistory,
  redo as redoH,
  undo as undoH,
  type DocumentModel,
  type History,
} from '@pdf-atelier/core'
import type { PdfSource } from '@pdf-atelier/pdf'
import type { FileRef } from '@pdf-atelier/platform'
import type { Draft } from 'immer'
import { create } from 'zustand'

export interface OpenSource {
  /** Original file bytes (export always composes from these: non-destructive). */
  bytes: Uint8Array
  pdf: PdfSource
}

export interface OpenDoc {
  id: string
  name: string
  ref: FileRef | null
  history: History<DocumentModel>
  /** `history.present` at the last save; dirty = present !== saved. */
  saved: DocumentModel
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
  /** `model` = the exact state that was written (edits made during the save stay dirty). */
  markSaved(id: string, ref: FileRef | null, name: string, model: DocumentModel): void
}

export const isDirty = (d: OpenDoc) => d.history.present !== d.saved

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
  saved: model,
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
      updateActive((d) => ({ ...d, history: applyChange(d.history, label, recipe, opts) })),
    undo: () => updateActive((d) => ({ ...d, history: undoH(d.history) })),
    redo: () => updateActive((d) => ({ ...d, history: redoH(d.history) })),
    markSaved: (id, ref, name, model) =>
      set((s) => ({
        docs: s.docs.map((d) => (d.id === id ? { ...d, ref, name, saved: model } : d)),
      })),
  }
})

export const activeDoc = () => {
  const { docs, activeId } = useDocuments.getState()
  return docs.find((d) => d.id === activeId)
}

export const useActiveDoc = () => useDocuments((s) => s.docs.find((d) => d.id === s.activeId))
