import { BLANK_SOURCE } from '@pdf-atelier/core'
import { create } from 'zustand'
import { activeDoc, type OpenDoc } from '../stores/documents.ts'
import { goToPage, useUi } from '../stores/ui.ts'
import { rangeAt, textOfRange } from '../tts/highlight.ts'

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** Options not kept in ui.search (which the viewer reads) + the last regex error. */
export const useSearchOptions = create<{ wholeWord: boolean; regex: boolean; error: string | null }>(
  () => ({ wholeWord: false, regex: false, error: null }),
)

/** Throws SyntaxError for an invalid user regex. */
export function buildMatcher(query: string, o: SearchOptions): RegExp {
  const src = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Unicode-aware word boundaries (\b is ASCII-only: "ação" would break).
  const body = o.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])` : src
  return new RegExp(body, o.caseSensitive ? 'gu' : 'giu')
}

/** Non-empty matches as [start, end) offsets (zero-length regex matches are skipped). */
export function findAll(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = []
  for (const m of text.matchAll(re)) if (m[0]) out.push([m.index, m.index + m[0].length])
  return out
}

const snippetOf = (text: string, [s, e]: [number, number]) =>
  (s > 30 ? '…' : '') + text.slice(Math.max(0, s - 30), e + 30).replace(/\s+/g, ' ').trim() + (e + 30 < text.length ? '…' : '')

let runId = 0
let lastDoc: string | null = null
export const searchedDoc = () => lastDoc

/** Searches page texts in document order; hits carry no rects (highlights come from the text layer DOM). */
export async function runSearch(doc: OpenDoc, query: string, o: SearchOptions) {
  const run = ++runId
  lastDoc = doc.id
  useUi.setState({ search: { query, caseSensitive: o.caseSensitive, hits: [], active: 0, running: !!query } })
  useSearchOptions.setState({ wholeWord: o.wholeWord, regex: o.regex, error: null })
  if (!query) return paint()
  let re: RegExp
  try {
    re = buildMatcher(query, o)
  } catch (e) {
    useSearchOptions.setState({ error: e instanceof Error ? e.message : String(e) })
    useUi.setState((s) => ({ search: { ...s.search, running: false } }))
    return
  }
  const hits: { pageId: string; rects: []; snippet: string }[] = []
  const texts = new Map<string, Promise<string>>() // duplicated pages share their source text
  for (const p of doc.history.present.pages) {
    if (p.sourceId === BLANK_SOURCE) continue
    const key = `${p.sourceId}:${p.sourceIndex}`
    if (!texts.has(key)) texts.set(key, doc.sources.get(p.sourceId)!.pdf.getPageText(p.sourceIndex))
    const text = await texts.get(key)!
    if (run !== runId) return
    for (const m of findAll(text, re)) hits.push({ pageId: p.id, rects: [], snippet: snippetOf(text, m) })
    useUi.setState((s) => ({ search: { ...s.search, hits: [...hits] } }))
  }
  useUi.setState((s) => ({ search: { ...s.search, running: false } }))
  paint()
}

let scrollPending = false

export function focusHit(i: number, doc = activeDoc()) {
  const hit = useUi.getState().search.hits[i]
  if (!doc || !hit) return
  useUi.setState((s) => ({ search: { ...s.search, active: i } }))
  scrollPending = true
  goToPage(doc.id, doc.history.present.pages.findIndex((p) => p.id === hit.pageId))
  paint()
}

export function stepHit(delta: 1 | -1) {
  const { hits, active } = useUi.getState().search
  if (hits.length) focusHit((active + delta + hits.length) % hits.length)
}

export function clearSearch() {
  runId++
  useUi.setState({ search: { query: '', caseSensitive: useUi.getState().search.caseSensitive, hits: [], active: 0, running: false } })
  paint()
}

/**
 * Highlights matches on rendered pages with the CSS Custom Highlight API, from the text layer DOM
 * (exact glyph boxes, unlike engine rects). Re-runs when text layers appear (scroll, zoom).
 */
function paint() {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
  const { query, caseSensitive, hits, active } = useUi.getState().search
  CSS.highlights.delete('search')
  CSS.highlights.delete('search-active')
  if (!query || !hits.length) return
  const { wholeWord, regex } = useSearchOptions.getState()
  let re: RegExp
  try {
    re = buildMatcher(query, { caseSensitive, wholeWord, regex })
  } catch {
    return
  }
  const activeHit = hits[active]
  const activeK = hits.slice(0, active).filter((h) => h.pageId === activeHit?.pageId).length
  const all = new Highlight()
  for (const layer of document.querySelectorAll<HTMLElement>('[data-page-id] .textLayer')) {
    const pageId = layer.closest<HTMLElement>('[data-page-id]')!.dataset.pageId
    if (!hits.some((h) => h.pageId === pageId)) continue
    const r = document.createRange()
    r.selectNodeContents(layer)
    const mapped = textOfRange(r)
    findAll(mapped.text, re).forEach(([s, e], k) => {
      const range = rangeAt(mapped, s, e)
      if (!range) return
      all.add(range)
      if (pageId === activeHit?.pageId && k === activeK) {
        CSS.highlights.set('search-active', new Highlight(range))
        if (scrollPending) {
          scrollPending = false
          range.startContainer.parentElement?.scrollIntoView({ block: 'center' })
        }
      }
    })
  }
  CSS.highlights.set('search', all)
}

// Text layers are created/replaced as pages scroll in or zoom changes: repaint then.
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  let queued = false
  new MutationObserver((records) => {
    if (queued || !useUi.getState().search.hits.length) return
    if (!records.some((r) => (r.target as Element).classList?.contains('textLayer') || [...r.addedNodes].some((n) => n instanceof Element && n.classList.contains('textLayer'))))
      return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      paint()
    })
  }).observe(document.documentElement, { childList: true, subtree: true })
}
