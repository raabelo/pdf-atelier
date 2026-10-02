import { createDocument, docOps, type Annotation } from '@pdf-atelier/core'
import type { PdfSource } from '@pdf-atelier/pdf'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeDoc, isDirty, newOpenDoc, savedMark, useDocuments } from './documents.ts'

const fakePdf = { id: 's1', destroy: async () => {} } as unknown as PdfSource

function open() {
  const model = createDocument({
    title: 'a.pdf',
    source: { id: 's1', name: 'a.pdf' },
    pages: [{ width: 100, height: 200, rotation: 0 }],
  })
  useDocuments
    .getState()
    .add(
      newOpenDoc(
        model,
        'a.pdf',
        null,
        new Map([['s1', { bytes: new Uint8Array(), pdf: fakePdf }]]),
      ),
    )
  return model
}

const rect = (pageId: string): Annotation => ({
  id: 'a1',
  type: 'rect',
  pageId,
  rect: { x: 1, y: 2, width: 3, height: 4 },
  style: { color: '#000', fill: null, strokeWidth: 1, opacity: 1 },
  createdAt: 0,
  updatedAt: 0,
})

describe('documents store', () => {
  beforeEach(() => useDocuments.setState({ docs: [], activeId: null }))

  it('open -> annotate -> undo/redo -> save tracks dirty state', () => {
    const model = open()
    const { change, undo, redo, markSaved } = useDocuments.getState()
    expect(isDirty(activeDoc()!)).toBe(false)

    change('add', (d) => docOps.addAnnotations(d, [rect(model.pages[0]!.id)]))
    expect(activeDoc()!.history.present.annotations.a1).toBeDefined()
    expect(isDirty(activeDoc()!)).toBe(true)

    undo()
    expect(isDirty(activeDoc()!)).toBe(false) // back at the saved (initial) position
    expect(activeDoc()!.history.present.annotations.a1).toBeUndefined()
    redo()
    expect(activeDoc()!.history.present.annotations.a1).toBeDefined()

    markSaved(model.id, 'ref', 'a.pdf', savedMark(activeDoc()!.history))
    expect(isDirty(activeDoc()!)).toBe(false)
    expect(activeDoc()!.ref).toBe('ref')

    undo()
    expect(isDirty(activeDoc()!)).toBe(true)
    redo()
    expect(isDirty(activeDoc()!)).toBe(false)

    // Undo past the save point, then branch: the saved state is unreachable.
    undo()
    change('add2', (d) => docOps.addAnnotations(d, [{ ...rect(model.pages[0]!.id), id: 'a2' }]))
    undo()
    expect(isDirty(activeDoc()!)).toBe(true)
  })

  it('stays dirty once the history cap drops the saved initial state', () => {
    const model = open()
    const { change, undo } = useDocuments.getState()
    for (let i = 0; i < 201; i++)
      change(`m${i}`, (d) => {
        d.title = `t${i}`
      })
    for (let i = 0; i < 201; i++) undo()
    expect(activeDoc()!.history.present.title).not.toBe(model.title)
    expect(isDirty(activeDoc()!)).toBe(true)
  })

  it('close activates the neighbour tab', () => {
    const a = open()
    const b = open()
    useDocuments.getState().close(b.id)
    expect(useDocuments.getState().activeId).toBe(a.id)
    useDocuments.getState().close(a.id)
    expect(useDocuments.getState().activeId).toBeNull()
  })
})
