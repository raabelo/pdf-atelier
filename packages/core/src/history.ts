import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer'

enablePatches()

export interface HistoryEntry {
  label: string
  patches: Patch[]
  inverse: Patch[]
  coalesceKey?: string
  at: number
}

export interface History<T> {
  present: T
  past: HistoryEntry[]
  future: HistoryEntry[]
}

const MAX_PAST = 200
const COALESCE_MS = 1000

export function createHistory<T>(initial: T): History<T> {
  return { present: initial, past: [], future: [] }
}

export function applyChange<T>(
  h: History<T>,
  label: string,
  recipe: (draft: Draft<T>) => void,
  opts?: { coalesceKey?: string },
): History<T> {
  const [present, patches, inverse] = produceWithPatches(h.present, recipe)
  if (patches.length === 0) return h
  const at = Date.now()
  const last = h.past.at(-1)
  if (last && opts?.coalesceKey && last.coalesceKey === opts.coalesceKey && at - last.at <= COALESCE_MS) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...patches],
      inverse: [...inverse, ...last.inverse],
      at,
    }
    return { present, past: [...h.past.slice(0, -1), merged], future: [] }
  }
  const entry: HistoryEntry = { label, patches, inverse, at, ...(opts?.coalesceKey ? { coalesceKey: opts.coalesceKey } : {}) }
  return { present, past: [...h.past, entry].slice(-MAX_PAST), future: [] }
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0
export const canRedo = <T>(h: History<T>) => h.future.length > 0

export function undo<T>(h: History<T>): History<T> {
  const entry = h.past.at(-1)
  if (!entry) return h
  return { present: applyPatches(h.present as object, entry.inverse) as T, past: h.past.slice(0, -1), future: [entry, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  const [entry, ...future] = h.future
  if (!entry) return h
  return { present: applyPatches(h.present as object, entry.patches) as T, past: [...h.past, entry], future }
}
