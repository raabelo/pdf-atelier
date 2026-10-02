export interface Sentence {
  text: string
  /** Offsets into the original text (end exclusive). */
  start: number
  end: number
}

const MIN = 20
const MAX = 250

/**
 * Splits text into speakable chunks with offsets into the original string.
 * Single line breaks (PDF line wraps) are treated as spaces; blank lines still separate.
 * Very short pieces ("Dr.", "1.") are merged with a neighbour; long ones are cut near MAX at a space.
 */
export function splitSentences(text: string, lang: string): Sentence[] {
  // Same length replacement keeps offsets valid.
  const norm = text.replace(/\r/g, ' ').replace(/(?<!\n)\n(?!\n)/g, ' ')
  const segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' })

  const pieces: { start: number; end: number }[] = []
  for (const { segment, index } of segmenter.segment(norm)) {
    const lead = segment.length - segment.trimStart().length
    const body = segment.trim()
    if (!body) continue
    const start = index + lead
    const end = start + body.length
    const prev = pieces.at(-1)
    if (prev && (prev.end - prev.start < MIN || end - start < MIN) && end - prev.start <= MAX) {
      prev.end = end
    } else {
      pieces.push({ start, end })
    }
  }

  const out: Sentence[] = []
  for (const p of pieces) {
    let start = p.start
    while (p.end - start > MAX) {
      const window = norm.slice(start, start + MAX)
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '))
      const space = window.lastIndexOf(' ')
      const at = cut > MAX / 2 ? cut + 1 : space > MAX / 2 ? space : MAX
      out.push(make(norm, start, start + at))
      start += at
      while (norm[start] === ' ') start++
    }
    out.push(make(norm, start, p.end))
  }
  return out
}

function make(norm: string, start: number, end: number): Sentence {
  while (end > start && norm[end - 1] === ' ') end--
  return { text: norm.slice(start, end), start, end }
}
