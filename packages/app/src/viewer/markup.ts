import {
  newId,
  viewToPageRect,
  type Annotation,
  type DocumentModel,
  type Rect,
  type Rotation,
} from '@pdf-atelier/core'

/** Merges per-glyph-run rects into one rect per text line. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Rect[] = []
  for (const r of sorted) {
    const line = lines.find(
      (l) => Math.abs(l.y + l.height / 2 - (r.y + r.height / 2)) < Math.min(l.height, r.height) / 2,
    )
    if (!line) {
      lines.push({ ...r })
      continue
    }
    const x2 = Math.max(line.x + line.width, r.x + r.width)
    const y2 = Math.max(line.y + line.height, r.y + r.height)
    line.x = Math.min(line.x, r.x)
    line.y = Math.min(line.y, r.y)
    line.width = x2 - line.x
    line.height = y2 - line.y
  }
  return lines
}

/** Client rects of the selected text only (range.getClientRects() also returns whole block boxes). */
function textRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode! : root,
    NodeFilter.SHOW_TEXT,
  )
  const out: DOMRect[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n) || !n.textContent?.trim()) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    if (n === range.startContainer) r.setStart(n, range.startOffset)
    if (n === range.endContainer) r.setEnd(n, range.endOffset)
    out.push(...r.getClientRects())
  }
  return out
}

/**
 * Converts the current DOM text selection (inside page elements marked with data-page-id)
 * into text-markup annotations, one per page.
 */
export function selectionToMarkup(
  type: 'highlight' | 'underline' | 'strikeout',
  doc: DocumentModel,
  view: { scale: number; rotation: Rotation },
  style: Annotation['style'],
  root: HTMLElement,
): Annotation[] {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) return []
  const text = sel.toString().trim()
  const byPage = new Map<string, Rect[]>()
  const pageEls = [...root.querySelectorAll<HTMLElement>('[data-page-id]')].map((el) => ({
    el,
    box: el.getBoundingClientRect(),
  }))
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const r of textRects(sel.getRangeAt(i))) {
      if (r.width < 1 || r.height < 1) continue
      const cx = r.x + r.width / 2
      const cy = r.y + r.height / 2
      const hit = pageEls.find(
        ({ box }) => cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom,
      )
      if (!hit) continue
      const page = doc.pages.find((p) => p.id === hit.el.dataset.pageId)
      if (!page) continue
      const rotation = ((page.rotation + view.rotation) % 360) as Rotation
      const rect = viewToPageRect(
        { x: r.x - hit.box.left, y: r.y - hit.box.top, width: r.width, height: r.height },
        page,
        rotation,
        view.scale,
      )
      byPage.set(page.id, [...(byPage.get(page.id) ?? []), rect])
    }
  }
  const now = Date.now()
  return [...byPage].map(([pageId, rects]) => ({
    id: newId(),
    type,
    pageId,
    rects: mergeLineRects(rects),
    text,
    style,
    createdAt: now,
    updatedAt: now,
  }))
}
