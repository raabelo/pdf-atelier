/** Text read aloud, built from DOM text nodes so speech offsets map back to the text layer. */
export interface MappedText {
  text: string
  pieces: { node: Text; from: number; at: number; len: number }[]
}

/** Text of the text nodes inside `range` (a selection or a whole text layer), with a DOM map. */
export function textOfRange(range: Range): MappedText {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode! : root,
    NodeFilter.SHOW_TEXT,
  )
  let text = ''
  const pieces: MappedText['pieces'] = []
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(n)) continue
    const from = n === range.startContainer ? range.startOffset : 0
    const to = n === range.endContainer ? range.endOffset : n.length
    const s = n.data.slice(from, to)
    if (!s) continue
    // pdf.js puts each text run in its own span: separate runs unless whitespace already does.
    // ponytail: runs split mid-word get a stray space; good enough for speech.
    if (text && !/\s$/.test(text) && !/^\s/.test(s)) text += ' '
    pieces.push({ node: n, from, at: text.length, len: s.length })
    text += s
  }
  return { text, pieces }
}

/** DOM range for text offsets [start, end), or null when unmapped/detached. */
export function rangeAt(m: MappedText, start: number, end: number): Range | null {
  const first = m.pieces.find((p) => p.at + p.len > start)
  const last = m.pieces.findLast((p) => p.at < end)
  if (!first || !last || !first.node.isConnected || !last.node.isConnected) return null
  const r = document.createRange()
  r.setStart(first.node, first.from + Math.max(0, start - first.at))
  r.setEnd(last.node, last.from + Math.min(last.len, end - last.at))
  return r
}

/** Native highlight (no DOM changes). Text-layer re-renders (zoom) drop it until the next sentence. */
export function showSegment(r: Range | null, scroll = false) {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
  if (!r) return void CSS.highlights.delete('tts')
  CSS.highlights.set('tts', new Highlight(r))
  if (scroll) r.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
