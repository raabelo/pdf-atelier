/**
 * Port of pdf.js TextLayerBuilder's selection support (web/text_layer_builder.js), which the bare `TextLayer`
 * class lacks. Text-layer spans are absolutely positioned, so a drag that starts in the gaps between them
 * selects nothing. While a layer is "selecting", its `.endOfContent` element (see text-layer.css) covers the
 * layer and gives the browser a selection anchor. Only the modern-Chromium/Firefox path is ported (Electron 44
 * is Chromium 152; pdf.js skips the anchor-moving workaround for Chromium >= 148).
 */
const layers = new Map<HTMLElement, HTMLElement>() // text layer div -> its endOfContent
let global: AbortController | null = null

function reset(end: HTMLElement, layer: HTMLElement) {
  layer.append(end)
  end.style.width = ''
  end.style.height = ''
  layer.classList.remove('selecting')
}

function enableGlobalListeners() {
  if (global) return
  global = new AbortController()
  const { signal } = global
  let pointerDown = false
  const resetAll = () => layers.forEach(reset)
  document.addEventListener('pointerdown', () => (pointerDown = true), { signal })
  document.addEventListener('pointerup', () => ((pointerDown = false), resetAll()), { signal })
  window.addEventListener('blur', () => ((pointerDown = false), resetAll()), { signal })
  document.addEventListener('keyup', () => !pointerDown && resetAll(), { signal })
  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection()
      if (!selection?.rangeCount) return resetAll()
      for (const [layer, end] of layers) {
        let active = false
        for (let i = 0; i < selection.rangeCount && !active; i++) active = selection.getRangeAt(i).intersectsNode(layer)
        if (active) layer.classList.add('selecting')
        else reset(end, layer)
      }
    },
    { signal },
  )
}

/** Call after TextLayer.render(); returns the cleanup. */
export function bindTextSelection(layer: HTMLElement): () => void {
  const end = document.createElement('div')
  end.className = 'endOfContent'
  layer.append(end)
  const ac = new AbortController()
  layer.addEventListener(
    'mousedown',
    (e) => {
      layer.classList.add('selecting')
      if (e.button === 0 && !e.shiftKey && !(e.target as Element).closest('span')) startFromGap(e, layer)
    },
    { signal: ac.signal },
  )
  layers.set(layer, end)
  enableGlobalListeners()
  return () => {
    ac.abort()
    layers.delete(layer)
    if (!layers.size) {
      global?.abort()
      global = null
    }
  }
}

/** Line-band margins (in line heights) within which a press in a gap counts as "next to" a text run. */
export const GAP_MARGIN = { x: 1.5, y: 0.5 }

/**
 * A press in a gap next to a word would let the browser pick an arbitrary caret (often mid-word). Instead,
 * anchor at the nearest edge of the closest run on that line and extend the selection to the pointer
 * (snapping to run edges again whenever the pointer is over a gap).
 */
function startFromGap(e: MouseEvent, layer: HTMLElement) {
  const anchor = nearestEdge(layer, e.clientX, e.clientY)
  if (!anchor) return // far from text: default browser behavior
  e.preventDefault()
  const selection = document.getSelection()!
  selection.collapse(anchor.node, anchor.offset)
  const move = (ev: MouseEvent) => {
    const caret = caretAt(ev.clientX, ev.clientY)
    const focus =
      caret && caret.node instanceof Text && layer.contains(caret.node) ? caret : nearestEdge(layer, ev.clientX, ev.clientY)
    if (focus) selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

/** Start/end of the closest text run on the line at (x, y), within GAP_MARGIN; null if none. */
function nearestEdge(layer: HTMLElement, x: number, y: number): { node: Text; offset: number } | null {
  let best: { node: Text; offset: number; dist: number } | null = null
  for (const span of layer.querySelectorAll('span')) {
    const node = span.firstChild
    if (!(node instanceof Text) || !node.length) continue
    const r = span.getBoundingClientRect()
    if (!r.width || y < r.top - r.height * GAP_MARGIN.y || y > r.bottom + r.height * GAP_MARGIN.y) continue
    const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
    if (dist > r.height * GAP_MARGIN.x || (best && dist >= best.dist)) continue
    best = { node, offset: x < r.left + r.width / 2 ? 0 : node.length, dist }
  }
  return best
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y)
    return p && { node: p.offsetNode, offset: p.offset }
  }
  const r = document.caretRangeFromPoint?.(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : null
}
