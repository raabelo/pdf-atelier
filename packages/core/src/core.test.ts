import { describe, expect, it, vi } from 'vitest'
import {
  applyChange,
  BLANK_SOURCE,
  collectClipboard,
  canRedo,
  canUndo,
  createDocument,
  createHistory,
  docOps,
  pageToView,
  redo,
  undo,
  viewToPage,
  type Annotation,
  type DocumentModel,
  type Rotation,
} from './index.ts'

const doc = (n = 3): DocumentModel =>
  createDocument({
    title: 't',
    source: { id: 's', name: 'a.pdf' },
    pages: Array.from({ length: n }, () => ({ width: 600, height: 800, rotation: 0 as Rotation })),
  })

const ink = (id: string, pageId: string): Annotation => ({
  id,
  pageId,
  type: 'ink',
  paths: [[{ x: 1, y: 1 }]],
  style: { color: '#000', fill: null, strokeWidth: 1, opacity: 1 },
  createdAt: 0,
  updatedAt: 0,
})

describe('history', () => {
  it('undo/redo and no-op', () => {
    let h = createHistory({ n: 0 })
    expect(applyChange(h, 'noop', () => {})).toBe(h)
    h = applyChange(h, 'inc', (d) => void (d.n += 1))
    h = applyChange(h, 'inc', (d) => void (d.n += 1))
    expect(h.present.n).toBe(2)
    h = undo(h)
    expect(h.present.n).toBe(1)
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present.n).toBe(2)
    h = undo(undo(h))
    expect(h.present.n).toBe(0)
    expect(canUndo(h)).toBe(false)
    expect(applyChange(h, 'x', (d) => void (d.n = 5)).future).toHaveLength(0)
  })

  it('coalesces same key within 1s', () => {
    vi.useFakeTimers()
    let h = createHistory({ x: 0 })
    h = applyChange(h, 'drag', (d) => void (d.x = 1), { coalesceKey: 'k' })
    h = applyChange(h, 'drag', (d) => void (d.x = 2), { coalesceKey: 'k' })
    expect(h.past).toHaveLength(1)
    vi.advanceTimersByTime(1500)
    h = applyChange(h, 'drag', (d) => void (d.x = 3), { coalesceKey: 'k' })
    expect(h.past).toHaveLength(2)
    expect(undo(undo(h)).present.x).toBe(0)
    vi.useRealTimers()
  })

  it('caps past at 200', () => {
    let h = createHistory({ n: 0 })
    for (let i = 0; i < 250; i++) h = applyChange(h, 'inc', (d) => void (d.n += 1))
    expect(h.past).toHaveLength(200)
  })
})

describe('docOps', () => {
  it('moves pages keeping order', () => {
    const d0 = doc(5)
    const ids = d0.pages.map((p) => p.id)
    let h = createHistory(d0)
    h = applyChange(h, 'move', (d) => docOps.movePages(d, [ids[0]!, ids[1]!], 4))
    expect(h.present.pages.map((p) => p.id)).toEqual([ids[2], ids[3], ids[0], ids[1], ids[4]])
    expect(undo(h).present.pages.map((p) => p.id)).toEqual(ids)
  })

  it('rotates and removes pages with their annotations', () => {
    const d0 = doc(2)
    const [p1, p2] = d0.pages.map((p) => p.id) as [string, string]
    let h = createHistory(d0)
    h = applyChange(h, 'rot', (d) => docOps.rotatePages(d, [p1], -90))
    expect(h.present.pages[0]!.rotation).toBe(270)
    h = applyChange(h, 'add', (d) => docOps.addAnnotations(d, [ink('a', p1), ink('b', p2)]))
    h = applyChange(h, 'rm', (d) => docOps.removePages(d, [p1]))
    expect(h.present.pages).toHaveLength(1)
    expect(Object.keys(h.present.annotations)).toEqual(['b'])
    expect(() => applyChange(h, 'rm', (d) => docOps.removePages(d, [p2]))).toThrow()
    expect(Object.keys(undo(h).present.annotations).sort()).toEqual(['a', 'b'])
  })
})

describe('geometry', () => {
  it.each([0, 90, 180, 270] as Rotation[])('page<->view roundtrip at %i', (rot) => {
    const page = { width: 600, height: 800 }
    const p = { x: 10, y: 20 }
    const v = pageToView(p, page, rot, 1.5)
    const back = viewToPage(v, page, rot, 1.5)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('90° maps top-left to top-right', () => {
    expect(pageToView({ x: 0, y: 0 }, { width: 600, height: 800 }, 90, 1)).toEqual({ x: 800, y: 0 })
  })
})

describe('V1 ops', () => {
  const apply = (d: DocumentModel, fn: (d: import('immer').Draft<DocumentModel>) => void) =>
    applyChange(createHistory(d), 'x', fn).present

  it('duplicate, clipboard paste, style and replies', () => {
    let d = doc()
    const p0 = d.pages[0]!.id
    const p1 = d.pages[1]!.id
    const a = { ...ink('a', p0), replies: [{ id: 'r', text: 'hi', createdAt: 0 }] }
    d = apply(d, (x) => docOps.addAnnotations(x, [a]))
    let dup: string[] = []
    d = apply(d, (x) => void (dup = docOps.duplicateAnnotations(x, ['a'], { x: 10, y: 5 })))
    const copy = d.annotations[dup[0]!]!
    expect(copy.type === 'ink' && copy.paths[0]![0]).toEqual({ x: 11, y: 6 })
    expect(copy.replies![0]!.id).not.toBe('r')

    const clip = collectClipboard(d, ['a'])
    let pasted: string[] = []
    d = apply(d, (x) => void (pasted = docOps.pasteAnnotations(x, clip, p1, { x: 0, y: 0 })))
    expect(d.annotations[pasted[0]!]!.pageId).toBe(p1)

    d = apply(d, (x) => docOps.setStyle(x, ['a'], { color: '#f00' }))
    expect(d.annotations.a!.style).toMatchObject({ color: '#f00', strokeWidth: 1 })

    d = apply(d, (x) => docOps.addReply(x, 'a', { id: 'r2', text: 'yo', createdAt: 1 }))
    d = apply(d, (x) => docOps.updateReply(x, 'a', 'r2', 'yo!'))
    d = apply(d, (x) => docOps.removeReply(x, 'a', 'r'))
    expect(d.annotations.a!.replies).toEqual([{ id: 'r2', text: 'yo!', createdAt: 1 }])
  })

  it('duplicate/blank pages and bookmarks', () => {
    let d = doc(2)
    const [p0, p1] = d.pages.map((p) => p.id)
    d = apply(d, (x) => docOps.addAnnotations(x, [ink('a', p0!)]))
    let copies: string[] = []
    d = apply(d, (x) => void (copies = docOps.duplicatePages(x, [p0!])))
    expect(d.pages.map((p) => p.id)).toEqual([p0, copies[0], p1])
    expect(Object.values(d.annotations).filter((a) => a.pageId === copies[0])).toHaveLength(1)

    d = apply(d, (x) => void docOps.insertBlankPages(x, 0, 2, { width: 100, height: 200 }))
    expect(d.pages.slice(0, 2).map((p) => [p.sourceId, p.width])).toEqual([[BLANK_SOURCE, 100], [BLANK_SOURCE, 100]])

    d = apply(d, (x) => void docOps.addBookmark(x, p1!, 'B'))
    const bm = d.bookmarks[0]!.id
    d = apply(d, (x) => docOps.renameBookmark(x, bm, 'C'))
    expect(d.bookmarks[0]!.title).toBe('C')
    d = apply(d, (x) => docOps.removePages(x, [p1!]))
    expect(d.bookmarks).toEqual([])
  })
})
