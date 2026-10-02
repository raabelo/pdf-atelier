import { describe, expect, it, vi } from 'vitest'
import {
  applyChange,
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
