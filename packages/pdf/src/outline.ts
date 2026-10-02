/**
 * PDF outline (bookmarks tree) read/write with pdf-lib. copyPages drops /Outlines, so exportPdf rebuilds it:
 * each source's original outline remapped to the output pages, plus our "Favoritos" group (doc.bookmarks),
 * marked with BOOKMARKS_KEY so import maps it back to bookmarks instead of showing it as outline.
 * Input comes from untrusted files: every object is type-checked and loops/depth are bounded.
 */
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib'

export const BOOKMARKS_KEY = 'PDFAtelierBookmarks'

export interface OutlineNode {
  title: string
  /** Page index in the document the node was read from / is written to. */
  pageIndex: number | null
  /** Destination parameters after the page (e.g. /XYZ x y z), primitives only. */
  view: PDFObject[]
  children: OutlineNode[]
  /** Our bookmarks group. */
  marker?: boolean
}

const MAX_ITEMS = 10_000
const MAX_DEPTH = 32

const deref = (doc: PDFDocument, o: PDFObject | undefined): PDFObject | undefined =>
  o instanceof PDFRef ? doc.context.lookup(o) : o

const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** Reads the outline tree; `marker` is set on our bookmarks group. */
export function readOutline(doc: PDFDocument): OutlineNode[] {
  const root = deref(doc, doc.catalog.get(PDFName.of('Outlines')))
  if (!(root instanceof PDFDict)) return []
  const pageRefs = doc.getPages().map((p) => p.ref)
  const pageOf = (dest: PDFArray | undefined) => {
    const target = dest?.get(0)
    if (target instanceof PDFRef) {
      const i = pageRefs.findIndex((r) => r.objectNumber === target.objectNumber && r.generationNumber === target.generationNumber)
      return i === -1 ? null : i
    }
    if (target instanceof PDFNumber && Number.isInteger(target.asNumber())) return target.asNumber()
    return null
  }
  const seen = new Set<PDFObject>()
  let budget = MAX_ITEMS

  const walk = (first: PDFObject | undefined, depth: number): OutlineNode[] => {
    const nodes: OutlineNode[] = []
    let ref = first
    while (ref && budget-- > 0 && depth < MAX_DEPTH && !seen.has(ref)) {
      seen.add(ref)
      const item = deref(doc, ref)
      if (!(item instanceof PDFDict)) break
      const dest = resolveDest(doc, itemDest(doc, item))
      nodes.push({
        title: text(deref(doc, item.get(PDFName.of('Title')))),
        pageIndex: pageOf(dest),
        view: primitives(dest?.asArray().slice(1) ?? []),
        children: walk(item.get(PDFName.of('First')), depth + 1),
        ...(item.has(PDFName.of(BOOKMARKS_KEY)) && { marker: true }),
      })
      ref = item.get(PDFName.of('Next'))
    }
    return nodes
  }
  return walk(root.get(PDFName.of('First')), 0)
}

function itemDest(doc: PDFDocument, item: PDFDict): PDFObject | undefined {
  const dest = item.get(PDFName.of('Dest'))
  if (dest) return dest
  const action = deref(doc, item.get(PDFName.of('A')))
  if (action instanceof PDFDict && deref(doc, action.get(PDFName.of('S')))?.toString() === '/GoTo') return action.get(PDFName.of('D'))
  return undefined
}

/** Explicit destination array for a /Dest value (array, dest dict, or named destination). */
function resolveDest(doc: PDFDocument, value: PDFObject | undefined, depth = 0): PDFArray | undefined {
  const v = deref(doc, value)
  if (v instanceof PDFArray) return v
  if (depth > 4) return undefined
  if (v instanceof PDFDict) return resolveDest(doc, v.get(PDFName.of('D')), depth + 1)
  const key = v instanceof PDFName ? v.decodeText() : v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null
  if (key === null) return undefined
  const dests = deref(doc, doc.catalog.get(PDFName.of('Dests')))
  if (dests instanceof PDFDict) {
    const hit = dests.get(PDFName.of(key))
    if (hit) return resolveDest(doc, hit, depth + 1)
  }
  const names = deref(doc, doc.catalog.get(PDFName.of('Names')))
  const tree = names instanceof PDFDict ? deref(doc, names.get(PDFName.of('Dests'))) : undefined
  return resolveDest(doc, searchNameTree(doc, tree, key, 0), depth + 1)
}

function searchNameTree(doc: PDFDocument, node: PDFObject | undefined, key: string, depth: number): PDFObject | undefined {
  if (!(node instanceof PDFDict) || depth > MAX_DEPTH) return undefined
  const names = deref(doc, node.get(PDFName.of('Names')))
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) if (text(deref(doc, names.get(i))) === key) return names.get(i + 1)
  }
  const kids = deref(doc, node.get(PDFName.of('Kids')))
  if (kids instanceof PDFArray) {
    for (const kid of kids.asArray()) {
      const hit = searchNameTree(doc, deref(doc, kid), key, depth + 1)
      if (hit) return hit
    }
  }
  return undefined
}

/** Keeps destination view parameters only when they are context-free primitives; else falls back to /Fit. */
function primitives(view: PDFObject[]): PDFObject[] {
  return view.length && view.every((o) => o instanceof PDFName || o instanceof PDFNumber || o === PDFNull) ? view : []
}

/** Writes `nodes` as the document outline (replacing any existing one). pageIndex refers to `doc`'s pages. */
export function writeOutline(doc: PDFDocument, nodes: OutlineNode[]): void {
  if (!nodes.length) return
  const pageRefs = doc.getPages().map((p) => p.ref)
  const ctx = doc.context
  const rootRef = ctx.nextRef()

  const build = (parent: PDFRef, list: OutlineNode[]): PDFRef[] => {
    const refs = list.map(() => ctx.nextRef())
    list.forEach((n, i) => {
      const kids = build(refs[i]!, n.children)
      const page = n.pageIndex !== null ? pageRefs[n.pageIndex] : undefined
      ctx.assign(
        refs[i]!,
        ctx.obj({
          Title: PDFHexString.fromText(n.title),
          Parent: parent,
          ...(i > 0 && { Prev: refs[i - 1] }),
          ...(i < refs.length - 1 && { Next: refs[i + 1] }),
          ...(kids.length && { First: kids[0], Last: kids.at(-1), Count: -kids.length }),
          ...(page && { Dest: ctx.obj([page, ...(n.view.length ? n.view : [PDFName.of('Fit')])]) }),
          ...(n.marker && { [BOOKMARKS_KEY]: PDFBool.True }),
        }),
      )
    })
    return refs
  }
  const top = build(rootRef, nodes)
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top.at(-1), Count: top.length }))
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
}
