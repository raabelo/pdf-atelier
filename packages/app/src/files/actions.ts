import { createDocument, type Annotation } from '@pdf-atelier/core'
import { exportPdf, loadPdf } from '@pdf-atelier/pdf'
import type { OpenedFile, Platform } from '@pdf-atelier/platform'
import { t } from '../i18n/index.ts'
import { activeDoc, isDirty, newOpenDoc, useDocuments, type OpenDoc } from '../stores/documents.ts'
import { askConfirm, askPassword, notify } from '../stores/ui.ts'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** loadPdf, asking for the password while the file is encrypted. null = user cancelled. */
async function loadWithPassword(file: OpenedFile) {
  let password: string | undefined
  for (;;) {
    try {
      return await loadPdf(file.bytes, password === undefined ? {} : { password })
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

export async function openFile(file: OpenedFile) {
  try {
    const pdf = await loadWithPassword(file)
    if (!pdf) return
    const model = createDocument({
      title: file.name,
      source: { id: pdf.id, name: file.name },
      pages: [...pdf.pages],
    })
    // Existing annotations become part of the model (no history entry): they are edited/exported like ours.
    const imported = await Promise.all(model.pages.map((p, i) => pdf.getAnnotations(i, p.id)))
    model.annotations = Object.fromEntries(imported.flat().map((a: Annotation) => [a.id, a]))
    useDocuments
      .getState()
      .add(newOpenDoc(model, file.name, file.ref, new Map([[pdf.id, { bytes: file.bytes, pdf }]])))
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

export async function save(
  platform: Platform,
  doc: OpenDoc | undefined = activeDoc(),
  forceDialog = false,
) {
  if (!doc) return
  const model = doc.history.present
  try {
    const bytes = await exportPdf(model, new Map([...doc.sources].map(([id, s]) => [id, s.bytes])))
    if (doc.ref && platform.files.capabilities.saveInPlace && !forceDialog) {
      await platform.files.save(doc.ref, bytes)
      useDocuments.getState().markSaved(doc.id, doc.ref, doc.name, model)
    } else {
      const result = await platform.files.saveAs(doc.name, bytes)
      if (result) useDocuments.getState().markSaved(doc.id, result.ref, result.name, model)
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
