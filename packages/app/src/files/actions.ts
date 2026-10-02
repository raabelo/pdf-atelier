import { BLANK_SOURCE, createDocument, newId, type Annotation } from '@pdf-atelier/core'
import { exportPdf, loadPdf } from '@pdf-atelier/pdf'
import type { OpenedFile, Platform } from '@pdf-atelier/platform'
import { t } from '../i18n/index.ts'
import {
  activeDoc,
  isDirty,
  newOpenDoc,
  savedMark,
  useDocuments,
  type OpenDoc,
  type OpenSource,
} from '../stores/documents.ts'
import { blankSource } from './blank.ts'
import { askConfirm, askPassword, notify } from '../stores/ui.ts'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** loadPdf, asking for the password while the file is encrypted. null = user cancelled. */
async function loadWithPassword(file: OpenedFile) {
  let password: string | undefined
  for (;;) {
    try {
      const pdf = await loadPdf(file.bytes, password === undefined ? {} : { password })
      return { pdf, password }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'PasswordException')) throw e
      const p = await askPassword(
        t('dialog.passwordTitle'),
        t('dialog.passwordBody', { name: file.name }),
        t('dialog.open'),
      )
      if (p === null) return null
      password = p
    }
  }
}

/**
 * Parses a file as a document source: model pages + every existing annotation, imported eagerly
 * (exportPdf rewrites supported annotation types from the model, so nothing may be left unimported).
 * null = user cancelled the password prompt.
 */
export async function loadSource(file: OpenedFile) {
  const loaded = await loadWithPassword(file)
  if (!loaded) return null
  const { pdf, password } = loaded
  const model = createDocument({
    title: file.name,
    source: { id: pdf.id, name: file.name },
    pages: [...pdf.pages],
  })
  const [imported, extras] = await Promise.all([
    Promise.all(model.pages.map((p, i) => pdf.getAnnotations(i, p.id))),
    pdf.getAtelierExtras(),
  ])
  model.annotations = Object.fromEntries(imported.flat().map((a: Annotation) => [a.id, a]))
  model.images = Object.fromEntries(extras.images.map((img) => [img.id, img]))
  model.bookmarks = extras.bookmarks.flatMap(({ pageIndex, title }) => {
    const page = model.pages[pageIndex]
    return page ? [{ id: newId(), pageId: page.id, title }] : []
  })
  const source: OpenSource = { bytes: file.bytes, pdf, ...(password !== undefined && { password }) }
  return { model, source }
}

export async function openFile(file: OpenedFile) {
  try {
    const loaded = await loadSource(file)
    if (!loaded) return
    const { model, source } = loaded
    // Existing annotations become part of the model (no history entry): they are edited/exported like ours.
    useDocuments
      .getState()
      .add(
        newOpenDoc(
          model,
          file.name,
          file.ref,
          new Map([
            [source.pdf.id, source],
            [BLANK_SOURCE, blankSource],
          ]),
        ),
      )
  } catch (e) {
    notify(t('error.open', { name: file.name, message: message(e) }), true)
  }
}

export async function openWithDialog(platform: Platform) {
  const file = await platform.files.openFile()
  if (file) await openFile(file)
}

export async function openDropped(platform: Platform, files: FileList | File[]) {
  for (const f of Array.from(files)) {
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
      await openFile(await platform.files.fromDroppedFile(f))
  }
}

export async function openRecent(platform: Platform, ref: string) {
  const file = await platform.files.openRecent(ref)
  if (file) await openFile(file)
  else notify(t('error.open', { name: ref, message: 'not found' }), true)
}

/** Composes a model into PDF bytes (non-destructive: always from the original sources). */
export const exportDoc = (doc: OpenDoc, model = doc.history.present) =>
  exportPdf(
    model,
    new Map(
      [...doc.sources]
        .filter(([id]) => id !== BLANK_SOURCE)
        .map(([id, s]) => [id, { bytes: s.bytes, password: s.password }]),
    ),
    // Our bookmarks are written as one outline group with this title.
    { bookmarksTitle: t('sidebar.bookmarks') },
  )

export async function save(
  platform: Platform,
  doc: OpenDoc | undefined = activeDoc(),
  forceDialog = false,
) {
  if (!doc) return
  const mark = savedMark(doc.history)
  try {
    const bytes = await exportDoc(doc)
    if (doc.ref && platform.files.capabilities.saveInPlace && !forceDialog) {
      await platform.files.save(doc.ref, bytes)
      useDocuments.getState().markSaved(doc.id, doc.ref, doc.name, mark)
    } else {
      const result = await platform.files.saveAs(doc.name, bytes)
      if (result) useDocuments.getState().markSaved(doc.id, result.ref, result.name, mark)
    }
    notify(t('status.saved'))
  } catch (e) {
    notify(t('error.save', { message: message(e) }), true)
  }
}

export async function closeDoc(id = useDocuments.getState().activeId) {
  const doc = useDocuments.getState().docs.find((d) => d.id === id)
  if (!doc) return
  if (
    isDirty(doc) &&
    !(await askConfirm(
      t('dialog.unsavedTitle'),
      t('dialog.unsavedBody', { name: doc.name }),
      t('dialog.discard'),
    ))
  )
    return
  useDocuments.getState().close(doc.id)
}
