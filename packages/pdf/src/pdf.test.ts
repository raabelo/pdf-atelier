/* eslint-disable @typescript-eslint/no-explicit-any -- poking at untyped pdf.js data in assertions */
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { getDocument } from 'pdfjs-dist'
import type { Annotation, AnnotationStyle, DocumentModel } from '@pdf-atelier/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { exportPdf, loadPdf, readAtelierAnnotations } from './index.ts'

// pdf.js's modern build expects Uint8Array#toHex (browsers have it; Node 24's V8 does not yet).
;(Uint8Array.prototype as any).toHex ??= function (this: Uint8Array) {
  return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('')
}

beforeAll(async () => {
  // Node has no Worker: run pdf.js's worker in-process.
  // @ts-expect-error the worker bundle ships no types
  ;(globalThis as any).pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs')
})

async function makeSource() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sizes = [
    [600, 800],
    [500, 700],
    [400, 300],
  ] as const
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h])
    page.drawText(`Hello World page ${i}`, { x: 50, y: h - 100, size: 20, font })
  })
  // A foreign annotation (no /PDFAtelier) on page 0.
  const square = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 200, 150], C: [1, 0, 0] })
  doc.getPage(0).node.addAnnot(doc.context.register(square))
  return doc.save()
}

const style: AnnotationStyle = { color: '#3366ff', fill: null, strokeWidth: 2, opacity: 0.8 }
const t = 1_700_000_000_000
const base = { style, createdAt: t, updatedAt: t }

describe('pdf engine + writer', () => {
  it('reads text, searches and imports foreign annotations', async () => {
    const src = await loadPdf(await makeSource())
    expect(src.pageCount).toBe(3)
    expect(src.pages[1]).toEqual({ width: 500, height: 700, rotation: 0 })
    expect(await src.getPageText(0)).toContain('Hello World page 0')

    const hits = []
    for await (const h of src.search('world')) hits.push(h)
    expect(hits.map((h) => h.pageIndex)).toEqual([0, 1, 2])
    const r = hits[0]!.rects[0]!
    expect(r.y).toBeGreaterThan(70)
    expect(r.y).toBeLessThan(100)

    const anns = await src.getAnnotations(0, 'p0')
    expect(anns).toHaveLength(1)
    expect(anns[0]).toMatchObject({
      type: 'rect',
      pageId: 'p0',
      rect: { x: 100, y: 800 - 150, width: 100, height: 50 },
      style: { color: '#ff0000' },
      importedFrom: { objectId: expect.stringMatching(/^\d+R$/) },
    })
    await src.destroy()
  })

  it('exports reordered/rotated pages with every annotation type and round-trips them', async () => {
    const bytes = await makeSource()
    const src = await loadPdf(bytes, { id: 's1' })
    const imported = (await src.getAnnotations(0, 'p0'))[0]!
    await src.destroy()

    const anns: Annotation[] = [
      { ...imported, style: { ...imported.style, color: '#00ff00' } },
      { ...base, id: 'hl', pageId: 'p2', type: 'highlight', rects: [{ x: 50, y: 80, width: 120, height: 20 }], text: 'Hello' },
      { ...base, id: 'ul', pageId: 'p2', type: 'underline', rects: [{ x: 50, y: 80, width: 60, height: 20 }], text: 'He' },
      { ...base, id: 'so', pageId: 'p2', type: 'strikeout', rects: [{ x: 50, y: 80, width: 60, height: 20 }], text: 'He' },
      { ...base, id: 'ink', pageId: 'p0', type: 'ink', paths: [[{ x: 10, y: 10 }, { x: 50, y: 60 }, { x: 90, y: 20 }]] },
      { ...base, id: 'sq', pageId: 'p0', type: 'rect', rect: { x: 300, y: 300, width: 80, height: 40 }, style: { ...style, fill: '#ffff00' } },
      { ...base, id: 'el', pageId: 'p0', type: 'ellipse', rect: { x: 300, y: 400, width: 80, height: 40 } },
      { ...base, id: 'ln', pageId: 'p0', type: 'line', from: { x: 10, y: 500 }, to: { x: 200, y: 520 } },
      { ...base, id: 'ar', pageId: 'p0', type: 'arrow', from: { x: 200, y: 600 }, to: { x: 10, y: 580 }, note: 'Olá, nota' },
      { ...base, id: 'ft', pageId: 'p0', type: 'freetext', rect: { x: 50, y: 650, width: 150, height: 60 }, text: 'Texto livre com acentuação e €', fontSize: 12 },
    ]
    const doc: DocumentModel = {
      id: 'd',
      title: 't',
      sources: { s1: { id: 's1', name: 'a.pdf' } },
      // Page 1 deleted, page 2 moved first, page 0 rotated.
      pages: [
        { id: 'p2', sourceId: 's1', sourceIndex: 2, width: 400, height: 300, rotation: 0 },
        { id: 'p0', sourceId: 's1', sourceIndex: 0, width: 600, height: 800, rotation: 90 },
      ],
      annotations: Object.fromEntries(anns.map((a) => [a.id, a])),
    }
    const out = await exportPdf(doc, new Map([['s1', bytes]]))

    const res = await loadPdf(out)
    expect(res.pageCount).toBe(2)
    expect(res.pages).toEqual([
      { width: 400, height: 300, rotation: 0 },
      { width: 600, height: 800, rotation: 90 },
    ])
    expect(await res.getPageText(0)).toContain('page 2')

    const got = [...(await res.getAnnotations(0, 'p2')), ...(await res.getAnnotations(1, 'p0'))]
    expect(got).toHaveLength(anns.length) // the original foreign square was replaced, not duplicated
    for (const a of anns) {
      const back = got.find((g) => g.id === a.id)!
      expect({ ...back, importedFrom: undefined }).toEqual({ ...a, importedFrom: undefined })
    }
    expect((await readAtelierAnnotations(out)).size).toBe(anns.length)

    // Every written annotation carries an appearance stream other readers can draw.
    const raw = await getDocument({ data: out.slice() }).promise
    for (const i of [1, 2]) {
      const list = await (await raw.getPage(i)).getAnnotations()
      expect(list.every((a: any) => a.hasAppearance)).toBe(true)
    }
    const subtypes = (await (await raw.getPage(2)).getAnnotations()).map((a: any) => a.subtype).sort()
    expect(subtypes).toEqual(['Circle', 'FreeText', 'Ink', 'Line', 'Line', 'Square', 'Square'])
    await raw.loadingTask.destroy()
    await res.destroy()
  })

  it('ignores invalid /PDFAtelier JSON from untrusted files', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    const { PDFHexString } = await import('@cantoo/pdf-lib')
    const bad = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [10, 10, 50, 50],
      PDFAtelier: PDFHexString.fromText('{"id":"x","type":"rect","rect":{"x":"<img>"}}'),
    })
    page.node.addAnnot(doc.context.register(bad))
    const bytes = await doc.save()
    expect((await readAtelierAnnotations(bytes)).size).toBe(0)
    const src = await loadPdf(bytes)
    const [a] = await src.getAnnotations(0, 'p')
    expect(a).toMatchObject({ type: 'rect', rect: { x: 10, y: 150, width: 40, height: 40 } })
    expect(a!.id).not.toBe('x')
    await src.destroy()
  })
})
