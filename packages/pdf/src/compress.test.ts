/* eslint-disable @typescript-eslint/no-explicit-any -- untyped pdf.js data in assertions */
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from '@cantoo/pdf-lib'
import { createDocument, docOps, type DocumentModel } from '@pdf-atelier/core'
import { produce } from 'immer'
import { getDocument } from 'pdfjs-dist'
import { readFile } from 'node:fs/promises' // eslint-disable-line no-restricted-imports -- test fixture
import { expect, it } from 'vitest'
import { exportPdf } from './index.ts'
import './test-setup.ts'

/** Source with an uncompressed content stream, a thumbnail and an embedded PNG (as merged files often have). */
async function makeSource(png: Uint8Array, label: string) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const image = await doc.embedPng(png)
  const page = doc.addPage([400, 400])
  page.drawText(`Hello ${label}`, { x: 40, y: 340, size: 18, font })
  page.drawImage(image, { x: 40, y: 40, width: 128, height: 128 })
  // Uncompressed extra content: lots of vector ops, as some generators write them.
  const ops = Array.from({ length: 400 }, (_, i) => `${i % 300} ${i % 200} 5 5 re f`).join('\n')
  const raw = PDFRawStream.of(doc.context.obj({}), new TextEncoder().encode(`q 0.2 0.4 0.8 rg\n${ops}\nQ`))
  page.node.addContentStream(doc.context.register(raw))
  page.node.set(PDFName.of('Thumb'), doc.context.register(PDFRawStream.of(doc.context.obj({}), new Uint8Array(5000))))
  return doc.save({ useObjectStreams: false })
}

async function fingerprint(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice() }).promise
  const out = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const ops = await page.getOperatorList()
    const text = await page.getTextContent()
    out.push({ ops: ops.fnArray.join(','), text: text.items.map((t: any) => t.str).join('|') })
  }
  await pdf.loadingTask.destroy()
  return out
}

it('compresses losslessly: smaller file, identical drawing operators and text, duplicates merged', async () => {
  const png = new Uint8Array(await readFile(new URL('../../../apps/desktop/build/icon.png', import.meta.url)))
  const [a, b] = await Promise.all([makeSource(png, 'A'), makeSource(png, 'B')])
  let doc: DocumentModel = createDocument({ title: 't', source: { id: 'a', name: 'a.pdf' }, pages: [{ width: 400, height: 400, rotation: 0 }] })
  doc = produce(doc, (d) => {
    docOps.addSource(d, { id: 'b', name: 'b.pdf' })
    docOps.insertPages(d, 1, [{ id: 'pb', sourceId: 'b', sourceIndex: 0, width: 400, height: 400, rotation: 0 }])
  })
  const sources = new Map([
    ['a', { bytes: a }],
    ['b', { bytes: b }],
  ])

  const plain = await exportPdf(doc, sources)
  const small = await exportPdf(doc, sources, { compress: true })
  expect(small.length).toBeLessThan(plain.length * 0.8)
  expect(await fingerprint(small)).toEqual(await fingerprint(plain))

  const out = await PDFDocument.load(small)
  const images = out.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
  // The PNG becomes an image + its alpha /SMask; the copy from the second source is merged away.
  expect(images.length).toBe(2)
  expect(out.getPages().every((p) => !p.node.has(PDFName.of('Thumb')))).toBe(true)
})

it('keeps encryption when compressing', async () => {
  const png = new Uint8Array(await readFile(new URL('../../../apps/desktop/build/icon.png', import.meta.url)))
  const src = await PDFDocument.load(await makeSource(png, 'X'))
  src.encrypt({ userPassword: 'pw', ownerPassword: 'pw' })
  const bytes = await src.save()
  const doc = createDocument({ title: 't', source: { id: 's', name: 's.pdf' }, pages: [{ width: 400, height: 400, rotation: 0 }] })
  const out = await exportPdf(doc, new Map([['s', { bytes, password: 'pw' }]]), { compress: true })
  await expect(getDocument({ data: out.slice() }).promise).rejects.toMatchObject({ name: 'PasswordException' })
})
