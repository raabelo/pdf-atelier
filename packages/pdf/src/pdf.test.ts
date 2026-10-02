/* eslint-disable @typescript-eslint/no-explicit-any -- poking at untyped pdf.js data in assertions */
import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib'
import { getDocument } from 'pdfjs-dist'
import { BLANK_SOURCE, type Annotation, type AnnotationStyle, type DocumentModel } from '@pdf-atelier/core'
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises' // eslint-disable-line no-restricted-imports -- test-only font loading
import { exportPdf, loadPdf, readAtelierAnnotations } from './index.ts'
import { setFontFetcher } from './fonts.ts'
import './test-setup.ts'

// Vite asset URLs have no server in node tests: read the font files straight from node_modules.
setFontFetcher(async (url) => {
  const name = url.split(/[/?]/).find((p) => p.endsWith('.woff'))!
  return new Uint8Array(await readFile(new URL(`../../../node_modules/@fontsource/noto-sans/files/${name}`, import.meta.url)))
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
      images: {},
      bookmarks: [],
    }
    const out = await exportPdf(doc, new Map([['s1', { bytes }]]))

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

  it('keeps protection: encrypted source exports encrypted with the same password', async () => {
    const plain = await PDFDocument.load(await makeSource())
    plain.encrypt({ userPassword: 's3cret', ownerPassword: 's3cret' })
    const bytes = await plain.save()
    await expect(loadPdf(bytes)).rejects.toMatchObject({ name: 'PasswordException' })

    const src = await loadPdf(bytes, { password: 's3cret' })
    const imported = await src.getAnnotations(0, 'p0')
    await src.destroy()
    expect(imported).toHaveLength(1)
    const ink: Annotation = { ...base, id: 'ink', pageId: 'p0', type: 'ink', paths: [[{ x: 10, y: 10 }, { x: 90, y: 20 }]] }
    const doc: DocumentModel = {
      id: 'd',
      title: 't',
      sources: { s1: { id: 's1', name: 'a.pdf' } },
      pages: [{ id: 'p0', sourceId: 's1', sourceIndex: 0, width: 600, height: 800, rotation: 0 }],
      annotations: Object.fromEntries([...imported, ink].map((a) => [a.id, a])),
      images: {},
      bookmarks: [],
    }
    const out = await exportPdf(doc, new Map([['s1', { bytes, password: 's3cret' }]]))

    await expect(loadPdf(out)).rejects.toMatchObject({ name: 'PasswordException' })
    const back = await loadPdf(out, { password: 's3cret' })
    const got = await back.getAnnotations(0, 'p0')
    expect(got.map((a) => a.type).sort()).toEqual(['ink', 'rect'])
    expect(got.find((a) => a.type === 'ink')).toMatchObject({ id: 'ink', paths: ink.type === 'ink' ? ink.paths : [] })
    await back.destroy()
  })

  it('writes FreeText outside WinAnsi with embedded Noto Sans subsets', async () => {
    const bytes = await makeSource()
    const text = 'Olá ação — Ωμέγα Ж'
    const ft: Annotation = { ...base, id: 'ft', pageId: 'p0', type: 'freetext', rect: { x: 50, y: 50, width: 200, height: 60 }, text, fontSize: 14 }
    const doc: DocumentModel = {
      id: 'd',
      title: 't',
      sources: { s1: { id: 's1', name: 'a.pdf' } },
      pages: [{ id: 'p0', sourceId: 's1', sourceIndex: 0, width: 600, height: 800, rotation: 0 }],
      annotations: { ft },
      images: {},
      bookmarks: [],
    }
    const out = await exportPdf(doc, new Map([['s1', { bytes }]]))

    const pdf = await PDFDocument.load(out)
    const { PDFDict, PDFName } = await import('@cantoo/pdf-lib')
    const annots = pdf.getPage(0).node.Annots()!
    const dicts = annots.asArray().map((r) => pdf.context.lookup(r, PDFDict))
    const freeText = dicts.find((d) => d.get(PDFName.of('Subtype'))?.toString() === '/FreeText')!
    const ap = pdf.context.lookup(freeText.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as any
    const fonts = ap.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict)
    // latin (with the accents), greek, cyrillic — no Helvetica, and nothing replaced by "?".
    expect(fonts.keys().map(String).sort()).toEqual(['/Noto0', '/Noto2', '/Noto4'])
    expect((await readAtelierAnnotations(out)).get([...(await readAtelierAnnotations(out)).keys()][0]!)).toMatchObject({ text })

    // Plain WinAnsi text keeps the standard Helvetica.
    const out2 = await exportPdf({ ...doc, annotations: { ft: { ...ft, text: 'Olá, ação €' } } }, new Map([['s1', { bytes }]]))
    expect(new TextDecoder('latin1').decode(out2)).not.toContain('Noto')
  })
})

// 1x1 red PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
const model = (pages: DocumentModel['pages'], extra: Partial<DocumentModel> = {}): DocumentModel => ({
  id: 'd',
  title: 't',
  sources: { s1: { id: 's1', name: 'a.pdf' } },
  pages,
  annotations: {},
  images: {},
  bookmarks: [],
  ...extra,
})
const pg = (id: string, sourceIndex: number, w = 600, h = 800) => ({ id, sourceId: 's1', sourceIndex, width: w, height: h, rotation: 0 as const })

describe('V1 export/import', () => {
  it('round-trips notes with replies, images, bookmarks and blank pages; subset export', async () => {
    const bytes = await makeSource()
    const note: Annotation = {
      ...base,
      id: 'n',
      pageId: 'p0',
      type: 'note',
      at: { x: 40, y: 40 },
      note: 'Revisar',
      replies: [
        { id: 'r1', text: 'Ok', createdAt: t, author: 'Ana' },
        { id: 'r2', text: 'Feito', createdAt: t + 1 },
      ],
    }
    const img: Annotation = { ...base, id: 'i', pageId: 'p2', type: 'image', kind: 'signature', rect: { x: 10, y: 10, width: 50, height: 20 }, imageId: 'png1' }
    const doc = model(
      [pg('p0', 0), { id: 'b', sourceId: BLANK_SOURCE, sourceIndex: 0, width: 200, height: 300, rotation: 0 }, pg('p2', 2, 400, 300)],
      {
        annotations: { n: note, i: img },
        images: { png1: { id: 'png1', mime: 'image/png', data: PNG, width: 1, height: 1 } },
        bookmarks: [{ id: 'bm', pageId: 'p2', title: 'Assinatura' }],
      },
    )
    const out = await exportPdf(doc, new Map([['s1', { bytes }]]))

    const res = await loadPdf(out)
    expect(res.pages[1]).toEqual({ width: 200, height: 300, rotation: 0 })
    expect(await res.getAnnotations(0, 'p0')).toEqual([{ ...note, importedFrom: expect.anything() }])
    expect(await res.getAnnotations(2, 'p2')).toEqual([{ ...img, importedFrom: expect.anything() }])
    const extras = await res.getAtelierExtras()
    expect(extras.images).toHaveLength(1)
    expect([...extras.images[0]!.data]).toEqual([...PNG])
    expect(extras.bookmarks).toEqual([{ pageIndex: 2, title: 'Assinatura' }])
    expect(await res.getOutline()).toEqual([]) // our group is not a "real" outline
    await res.destroy()

    // Standard structure for other readers: /Text note + 2 hidden /Text replies pointing at it; /Stamp with /AP.
    const raw = await getDocument({ data: out.slice() }).promise
    const p1 = (await (await raw.getPage(1)).getAnnotations({ intent: 'any' })) as any[]
    const parent = p1.find((a) => !a.inReplyTo)
    expect(p1.filter((a) => a.inReplyTo === parent.id).map((a) => a.contentsObj.str)).toEqual(['Ok', 'Feito'])
    const p3 = (await (await raw.getPage(3)).getAnnotations()) as any[]
    expect(p3.map((a) => [a.subtype, a.hasAppearance])).toEqual([['Stamp', true]])
    await raw.loadingTask.destroy()

    // Subset export (extract/split): only p2, with its annotation and bookmark.
    const sub = await exportPdf(doc, new Map([['s1', { bytes }]]), { pageIds: ['p2'] })
    const one = await loadPdf(sub)
    expect(one.pageCount).toBe(1)
    expect((await one.getAnnotations(0, 'x')).map((a) => a.type)).toEqual(['image'])
    expect((await one.getAtelierExtras()).bookmarks).toEqual([{ pageIndex: 0, title: 'Assinatura' }])
    await one.destroy()
  })

  it('keeps foreign stamps and hidden annotations, imports foreign reply threads once', async () => {
    const src = await PDFDocument.create()
    const page = src.addPage([600, 800])
    const ctx = src.context
    const stamp = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [10, 10, 60, 60], Name: 'Approved' }))
    const hidden = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [300, 300, 350, 350], F: 2 }))
    const square = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 200, 150], C: [1, 0, 0] }))
    const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [100, 100, 120, 120], IRT: square, RT: 'R', Contents: PDFString.of('foreign reply') }))
    for (const r of [stamp, hidden, square, reply]) page.node.addAnnot(r)
    const bytes = await src.save()

    const s = await loadPdf(bytes)
    const anns = await s.getAnnotations(0, 'p0')
    await s.destroy()
    expect(anns.map((a) => [a.type, a.replies?.map((r) => r.text)])).toEqual([['rect', ['foreign reply']]])

    const out = await exportPdf(model([pg('p0', 0)], { annotations: Object.fromEntries(anns.map((a) => [a.id, a])) }), new Map([['s1', { bytes }]]))
    const raw = await getDocument({ data: out.slice() }).promise
    const list = (await (await raw.getPage(1)).getAnnotations({ intent: 'any' })) as any[]
    expect(list.map((a) => a.subtype).sort()).toEqual(['Square', 'Square', 'Stamp', 'Text'])
    expect(list.filter((a) => a.subtype === 'Text').map((a) => a.contentsObj.str)).toEqual(['foreign reply'])
    await raw.loadingTask.destroy()
  })

  it('preserves the source outline across reorder and page removal', async () => {
    const src = await PDFDocument.create()
    for (let i = 0; i < 3; i++) src.addPage([300, 300])
    const ctx = src.context
    const pages = src.getPages().map((p) => p.ref)
    const [root, ch1, ch2, sec] = [ctx.nextRef(), ctx.nextRef(), ctx.nextRef(), ctx.nextRef()]
    ctx.assign(ch1, ctx.obj({ Title: PDFString.of('Ch1'), Parent: root, Next: ch2, Dest: [pages[0]!, PDFName.of('Fit')] }))
    ctx.assign(sec, ctx.obj({ Title: PDFString.of('Sec'), Parent: ch2, A: { S: 'GoTo', D: [pages[1]!, PDFName.of('XYZ'), 0, 300, 0] } }))
    ctx.assign(ch2, ctx.obj({ Title: PDFString.of('Ch2'), Parent: root, Prev: ch1, First: sec, Last: sec, Count: 1, Dest: [pages[2]!, PDFName.of('Fit')] }))
    ctx.assign(root, ctx.obj({ Type: 'Outlines', First: ch1, Last: ch2, Count: 2 }))
    src.catalog.set(PDFName.of('Outlines'), root)
    const bytes = await src.save()

    const outline = async (pages: DocumentModel['pages']) => {
      const out = await exportPdf(model(pages), new Map([['s1', { bytes }]]))
      const res = await loadPdf(out)
      try {
        return await res.getOutline()
      } finally {
        await res.destroy()
      }
    }
    expect(await outline([pg('c', 2, 300, 300), pg('a', 0, 300, 300), pg('b', 1, 300, 300)])).toEqual([
      { title: 'Ch1', pageIndex: 1, children: [] },
      { title: 'Ch2', pageIndex: 0, children: [{ title: 'Sec', pageIndex: 2, children: [] }] },
    ])
    expect(await outline([pg('a', 0, 300, 300), pg('c', 2, 300, 300)])).toEqual([
      { title: 'Ch1', pageIndex: 0, children: [] },
      { title: 'Ch2', pageIndex: 1, children: [] },
    ])
  })
})
