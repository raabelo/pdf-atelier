import { docOps, rotateSize, type DocumentModel } from '@pdf-atelier/core'
import { loadPdf, type PdfSource } from '@pdf-atelier/pdf'
import type { Platform } from '@pdf-atelier/platform'
import { zipSync } from 'fflate'
import { create } from 'zustand'
import { t } from '../i18n/index.ts'
import { activeDoc, useDocuments, type OpenDoc } from '../stores/documents.ts'
import { goToPage, notify, useUi, viewOf } from '../stores/ui.ts'
import { exportDoc, loadSource } from './actions.ts'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
const baseName = (doc: OpenDoc) => doc.name.replace(/\.pdf$/i, '')

/** Thumbnail multi-selection (page ids) of the active document. */
export const usePageSelection = create<{ ids: string[]; anchor: string | null }>(() => ({
  ids: [],
  anchor: null,
}))

/** Which page dialog is open (rendered by sidebar/PageDialogs.tsx). */
export const usePageDialog = create<{ open: 'split' | 'images' | 'merge' | null }>(() => ({
  open: null,
}))

/** Selected pages (document order), or the current page when nothing is selected. */
export function targetPages(doc: OpenDoc): string[] {
  const { pages } = doc.history.present
  const sel = new Set(usePageSelection.getState().ids)
  const ids = pages.filter((p) => sel.has(p.id)).map((p) => p.id)
  return ids.length ? ids : [pages[Math.min(viewOf(doc.id).page, pages.length - 1)]!.id]
}

const indexOf = (doc: OpenDoc, pageId: string) =>
  doc.history.present.pages.findIndex((p) => p.id === pageId)
const change = (...args: Parameters<ReturnType<typeof useDocuments.getState>['change']>) =>
  useDocuments.getState().change(...args)

export function insertBlankPage(doc = activeDoc()) {
  if (!doc) return
  const i = indexOf(doc, targetPages(doc).at(-1)!)
  const ref = doc.history.present.pages[i]!
  // Same visual size as the neighbour (blank pages carry no rotation of their own).
  const size = rotateSize(ref.width, ref.height, ref.rotation)
  change('insert page', (d) => void docOps.insertBlankPages(d, i + 1, 1, size))
  goToPage(doc.id, i + 1)
}

export function duplicatePages(doc = activeDoc()) {
  if (!doc) return
  const ids = targetPages(doc)
  change('duplicate pages', (d) => void docOps.duplicatePages(d, ids))
}

export function deletePages(doc = activeDoc()) {
  if (!doc) return
  const ids = targetPages(doc)
  if (ids.length >= doc.history.present.pages.length) return notify(t('error.removeAllPages'), true)
  change('delete pages', (d) => docOps.removePages(d, ids))
  usePageSelection.setState({ ids: [], anchor: null })
}

export function rotatePages(doc = activeDoc(), delta: 90 | -90 = 90) {
  if (!doc) return
  const ids = targetPages(doc)
  change('rotate pages', (d) => docOps.rotatePages(d, ids, delta))
}

export function toggleBookmark(doc = activeDoc()) {
  if (!doc) return
  const i = Math.min(viewOf(doc.id).page, doc.history.present.pages.length - 1)
  const pageId = doc.history.present.pages[i]!.id
  const existing = doc.history.present.bookmarks.find((b) => b.pageId === pageId)
  if (existing) change('remove bookmark', (d) => docOps.removeBookmark(d, existing.id))
  else change('add bookmark', (d) => void docOps.addBookmark(d, pageId, t('bookmark.default', { n: i + 1 })))
}

/** The model restricted to `pageIds` (document order kept): extract and split export this. */
export function subsetModel(model: DocumentModel, pageIds: Iterable<string>): DocumentModel {
  const ids = new Set(pageIds)
  return {
    ...model,
    pages: model.pages.filter((p) => ids.has(p.id)),
    annotations: Object.fromEntries(
      Object.entries(model.annotations).filter(([, a]) => ids.has(a.pageId)),
    ),
    bookmarks: model.bookmarks.filter((b) => ids.has(b.pageId)),
  }
}

export async function extractPages(platform: Platform, doc = activeDoc()) {
  if (!doc) return
  try {
    const ids = targetPages(doc)
    const [first, last] = [indexOf(doc, ids[0]!) + 1, indexOf(doc, ids.at(-1)!) + 1]
    const bytes = await exportDoc(doc, subsetModel(doc.history.present, ids))
    await platform.files.saveAs(`${baseName(doc)}-p${first}${last > first ? `-${last}` : ''}.pdf`, bytes)
  } catch (e) {
    notify(t('error.export', { message: message(e) }), true)
  }
}

/** "1-3, 4-10, 12" -> 0-based index groups; null when invalid or out of 1..max. */
export function parseRanges(text: string, max: number): number[][] | null {
  const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return null
  const groups: number[][] = []
  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] === undefined ? a : Number(m[2])
    if (a < 1 || b > max || a > b) return null
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i))
  }
  return groups
}

export const everyN = (n: number, max: number): number[][] =>
  Array.from({ length: Math.ceil(max / n) }, (_, g) =>
    Array.from({ length: Math.min(n, max - g * n) }, (_, i) => g * n + i),
  )

/** One PDF per group. Native pickers get one dialog per part; download-only browsers get a zip. */
export async function splitDocument(platform: Platform, groups: number[][], doc = activeDoc()) {
  if (!doc) return
  const { pages } = doc.history.present
  try {
    const parts: [string, Uint8Array][] = []
    for (const [i, g] of groups.entries()) {
      const bytes = await exportDoc(doc, subsetModel(doc.history.present, g.map((n) => pages[n]!.id)))
      parts.push([`${baseName(doc)}-${String(i + 1).padStart(2, '0')}.pdf`, bytes])
    }
    if (platform.files.capabilities.saveInPlace) {
      for (const [name, bytes] of parts) if (!(await platform.files.saveAs(name, bytes))) return
    } else {
      const zip = zipSync(Object.fromEntries(parts), { level: 0 })
      if (!(await platform.files.exportFile(`${baseName(doc)}.zip`, zip, ZIP))) return
    }
    notify(t('split.done', { n: parts.length }))
  } catch (e) {
    notify(t('error.export', { message: message(e) }), true)
  }
}

/** Inserts another PDF (with its annotations) after page index `after` (-1 = at the start). */
export async function mergePdf(platform: Platform, after: number, doc = activeDoc()) {
  if (!doc) return
  const file = await platform.files.openFile()
  if (!file) return
  try {
    const loaded = await loadSource(file)
    if (!loaded) return
    const { model, source } = loaded
    useDocuments.setState((s) => ({
      docs: s.docs.map((d) =>
        d.id === doc.id ? { ...d, sources: new Map(d.sources).set(source.pdf.id, source) } : d,
      ),
    }))
    change('insert pdf', (d) => {
      docOps.addSource(d, model.sources[source.pdf.id]!)
      docOps.insertPages(d, after + 1, model.pages)
      docOps.addAnnotations(d, Object.values(model.annotations))
      for (const img of Object.values(model.images)) docOps.addImage(d, img)
      for (const b of model.bookmarks) docOps.addBookmark(d, b.pageId, b.title)
    })
    goToPage(doc.id, after + 1)
    notify(t('merge.done', { n: model.pages.length, name: file.name }))
  } catch (e) {
    notify(t('error.open', { name: file.name, message: message(e) }), true)
  }
}

export interface ImageExportOptions {
  pages: 'current' | 'selection' | 'all'
  dpi: number
  format: 'png' | 'jpeg'
}

/** Renders pages as they will be saved (with annotations) to PNG/JPEG; several pages -> zip. */
export async function exportImages(platform: Platform, opts: ImageExportOptions, doc = activeDoc()) {
  if (!doc) return
  const model = doc.history.present
  const ids =
    opts.pages === 'all'
      ? model.pages.map((p) => p.id)
      : opts.pages === 'selection'
        ? targetPages(doc)
        : [model.pages[Math.min(viewOf(doc.id).page, model.pages.length - 1)]!.id]
  const numbers = ids.map((id) => indexOf(doc, id) + 1)
  const ctrl = new AbortController()
  const progress = (value: number) =>
    useUi.setState({ progress: { label: t('images.rendering'), value, cancel: () => ctrl.abort() } })
  let pdf: PdfSource | undefined
  progress(0)
  try {
    pdf = await loadPdf(await exportDoc(doc, subsetModel(model, ids)))
    const mime = `image/${opts.format}`
    const files: [string, Uint8Array][] = []
    for (let i = 0; i < pdf.pageCount; i++) {
      if (ctrl.signal.aborted) throw new DOMException('cancelled', 'AbortError')
      const canvas = document.createElement('canvas')
      await pdf.renderPage(i, canvas, {
        scale: opts.dpi / 72 / devicePixelRatio,
        rotation: pdf.pages[i]!.rotation,
        signal: ctrl.signal,
      })
      if (opts.format === 'jpeg') flattenOnWhite(canvas)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, 0.92))
      canvas.width = 0
      if (!blob) throw new Error('canvas.toBlob failed')
      files.push([`${baseName(doc)}-p${numbers[i]}.${opts.format === 'png' ? 'png' : 'jpg'}`, new Uint8Array(await blob.arrayBuffer())])
      progress((i + 1) / pdf.pageCount)
    }
    const ext = opts.format === 'png' ? 'png' : 'jpg'
    if (files.length === 1) {
      await platform.files.exportFile(files[0]![0], files[0]![1], { mime, extension: ext, description: ext.toUpperCase() })
    } else {
      await platform.files.exportFile(`${baseName(doc)}-images.zip`, zipSync(Object.fromEntries(files), { level: 0 }), ZIP)
    }
  } catch (e) {
    if (!isAbort(e)) notify(t('error.export', { message: message(e) }), true)
  } finally {
    useUi.setState({ progress: null })
    void pdf?.destroy()
  }
}

/** JPEG has no alpha: paint transparent areas white instead of black. */
function flattenOnWhite(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

const ZIP = { mime: 'application/zip', extension: 'zip', description: 'ZIP' }
