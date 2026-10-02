import { createDocument, docOps, type Annotation, type ImageAsset } from '@pdf-atelier/core'
import type { PdfSource } from '@pdf-atelier/pdf'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeDoc, newOpenDoc, useDocuments } from '../stores/documents.ts'
import { useUi } from '../stores/ui.ts'
import {
  canCopy,
  copySelection,
  copyStyle,
  cutSelection,
  duplicateSelection,
  idsInRect,
  nextSelection,
  paste,
  pasteStyle,
} from './actions.ts'
import { stampSize } from './stamp.ts'

const fakePdf = { destroy: async () => {} } as unknown as PdfSource

function open() {
  const model = createDocument({
    title: 'a.pdf',
    source: { id: 's1', name: 'a.pdf' },
    pages: [
      { width: 600, height: 800, rotation: 0 },
      { width: 600, height: 800, rotation: 0 },
    ],
  })
  useDocuments
    .getState()
    .add(newOpenDoc(model, 'a.pdf', null, new Map([['s1', { bytes: new Uint8Array(), pdf: fakePdf }]])))
  return model
}

const style = { color: '#000000', fill: null, strokeWidth: 1, opacity: 1 }
const rect = (id: string, pageId: string, x: number, color = '#000000'): Annotation => ({
  id,
  type: 'rect',
  pageId,
  rect: { x, y: 10, width: 20, height: 20 },
  style: { ...style, color },
  createdAt: 0,
  updatedAt: 0,
})
const anns = () => Object.values(activeDoc()!.history.present.annotations)

describe('selection helpers', () => {
  it('toggles with the additive modifier and keeps a multi-selection on plain click', () => {
    expect(nextSelection(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(nextSelection(['a', 'b'], 'a', true)).toEqual(['b'])
    expect(nextSelection(['a', 'b'], 'a', false)).toEqual(['a', 'b'])
    expect(nextSelection(['a'], 'c', false)).toEqual(['c'])
  })

  it('marquee picks annotations whose bounds intersect', () => {
    const list = [rect('a', 'p', 0), rect('b', 'p', 100), rect('c', 'p', 300)]
    expect(idsInRect(list, { x: 15, y: 0, width: 100, height: 50 })).toEqual(['a', 'b'])
  })
})

describe('clipboard actions', () => {
  beforeEach(() => {
    useDocuments.setState({ docs: [], activeId: null })
    useUi.setState({ selection: [], clipboard: null, styleClipboard: null, views: {} })
    window.getSelection()?.removeAllRanges()
  })

  it('copy + paste onto the current page with offset; cut removes; duplicate selects copies', () => {
    const m = open()
    const [p1, p2] = m.pages
    useDocuments.getState().change('add', (d) => docOps.addAnnotations(d, [rect('a', p1!.id, 0)]))
    useUi.setState({ selection: ['a'] })
    expect(canCopy()).toBe(true)

    copySelection()
    useUi.setState({ views: { [m.id]: { zoom: 1, rotation: 0, page: 1, scale: 1 } } })
    paste()
    const pasted = anns().find((a) => a.id !== 'a')!
    expect(pasted.pageId).toBe(p2!.id)
    expect(pasted.type === 'rect' && pasted.rect.x).toBe(12)
    expect(useUi.getState().selection).toEqual([pasted.id])

    duplicateSelection()
    expect(anns()).toHaveLength(3)
    expect(useUi.getState().selection).not.toContain(pasted.id)

    useUi.setState({ selection: ['a'] })
    cutSelection()
    expect(anns().map((a) => a.id)).not.toContain('a')
    useDocuments.getState().undo()
    expect(anns().map((a) => a.id)).toContain('a')
  })

  it('paste into another tab brings the image assets along', () => {
    const m1 = open()
    const asset: ImageAsset = { id: 'img', mime: 'image/png', data: new Uint8Array([1]), width: 1, height: 1 }
    const img: Annotation = {
      id: 'i',
      type: 'image',
      kind: 'stamp',
      pageId: m1.pages[0]!.id,
      imageId: 'img',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      style,
      createdAt: 0,
      updatedAt: 0,
    }
    useDocuments.getState().change('add', (d) => {
      docOps.addImage(d, asset)
      docOps.addAnnotations(d, [img])
    })
    useUi.setState({ selection: ['i'] })
    copySelection()
    open() // second tab becomes active
    paste()
    expect(activeDoc()!.history.present.images.img).toBeDefined()
    expect(anns()).toHaveLength(1)
  })

  it('copy/paste style applies to the whole selection', () => {
    const m = open()
    const p = m.pages[0]!.id
    useDocuments
      .getState()
      .change('add', (d) => docOps.addAnnotations(d, [rect('a', p, 0, '#ff0000'), rect('b', p, 50), rect('c', p, 90)]))
    useUi.setState({ selection: ['a'] })
    copyStyle()
    useUi.setState({ selection: ['b', 'c'] })
    pasteStyle()
    expect(anns().every((a) => a.style.color === '#ff0000')).toBe(true)
  })
})

describe('stamp layout', () => {
  it('pads the text width and has a fixed height', () => {
    const a = stampSize(100)
    const b = stampSize(200)
    expect(b.width - a.width).toBe(100)
    expect(a.height).toBe(b.height)
    expect(a.width).toBeGreaterThan(100)
  })
})
