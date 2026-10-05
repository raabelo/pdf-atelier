import type { WorkerRequest, WorkerResponse } from './translate.worker.ts'

type Distributive<T> = T extends unknown ? Omit<T, 'id'> : never

/** Languages offered for translation (base codes); every pair goes through English. */
export const LANGS = ['en', 'pt', 'es', 'fr', 'it', 'de'] as const
export type Lang = (typeof LANGS)[number]

/** Opus-MT models (Helsinki-NLP), ONNX conversions by Xenova on Hugging Face; license per model card. */
export const MODELS = [
  { id: 'Xenova/opus-mt-en-ROMANCE', license: 'Apache-2.0' },
  { id: 'Xenova/opus-mt-ROMANCE-en', license: 'Apache-2.0' },
  { id: 'Xenova/opus-mt-en-de', license: 'CC-BY-4.0' },
  { id: 'Xenova/opus-mt-de-en', license: 'Apache-2.0' },
]
/** q8 encoder + merged decoder. */
export const MODEL_BYTES = 113_000_000

const ROMANCE: string[] = ['pt', 'es', 'fr', 'it']

export interface Step {
  model: string
  /** Target-language token the multilingual en-ROMANCE model needs, e.g. ">>pt_br<<"; '' for others. */
  token: string
}

/** Model hops for from → to; pairs without English pivot through it. */
export function route(from: Lang, to: Lang): Step[] {
  if (from === to) return []
  if (from !== 'en' && to !== 'en') return [...route(from, 'en'), ...route('en', to)]
  if (from === 'en')
    return ROMANCE.includes(to)
      ? [{ model: 'Xenova/opus-mt-en-ROMANCE', token: `>>${to === 'pt' ? 'pt_br' : to}<<` }]
      : [{ model: `Xenova/opus-mt-en-${to}`, token: '' }]
  return [
    {
      model: ROMANCE.includes(from) ? 'Xenova/opus-mt-ROMANCE-en' : `Xenova/opus-mt-${from}-en`,
      token: '',
    },
  ]
}

/**
 * Splits text into sentences: Opus-MT tends to drop sentences when given several at once.
 * PDF line wraps become spaces; blank lines stay as paragraph breaks ("\n\n" chunks).
 * ponytail: a sentence past ~512 tokens gets truncated by Marian; split on clauses if that shows up.
 */
export function chunk(text: string, lang: string): string[] {
  const out: string[] = []
  const seg = new Intl.Segmenter(lang, { granularity: 'sentence' })
  for (const para of text.split(/\n\s*\n/)) {
    const flat = para.replace(/\s+/g, ' ').trim()
    if (!flat) continue
    if (out.length) out.push('\n\n')
    for (const { segment } of seg.segment(flat)) if (segment.trim()) out.push(segment.trim())
  }
  return out
}

const CACHE = 'transformers-cache' // transformers.js default env.cacheKey

/** Models whose files are in the browser cache (downloaded before). */
export async function installedModels(): Promise<string[]> {
  try {
    const urls = (await (await caches.open(CACHE)).keys()).map((r) => r.url)
    return MODELS.map((m) => m.id).filter((id) =>
      urls.some((u) => u.includes(`/${id}/`) && u.endsWith('.onnx')),
    )
  } catch {
    return [] // Cache API unavailable
  }
}

export async function removeModel(model: string) {
  const cache = await caches.open(CACHE)
  for (const r of await cache.keys()) if (r.url.includes(`/${model}/`)) await cache.delete(r)
}

export interface Translator {
  /** Downloads (if needed) and loads a model. */
  load(model: string, onProgress?: (loaded: number, total: number) => void): Promise<void>
  /** Translates the chunks in order; onChunk gets the text translated so far. */
  translate(text: string, from: Lang, to: Lang, onChunk?: (sofar: string) => void): Promise<string>
}

export function createTranslator(assetsBaseUrl: string): Translator {
  // Workers resolve relative URLs against their own script URL, so make the base absolute here.
  const base = new URL(assetsBaseUrl, globalThis.location?.href).href
  let worker: Worker | null = null
  let nextId = 1
  const pending = new Map<
    number,
    {
      resolve: (r: string) => void
      reject: (e: Error) => void
      progress?: (l: number, t: number) => void
    }
  >()

  function call(req: Distributive<WorkerRequest>, progress?: (l: number, t: number) => void) {
    if (!worker) {
      worker = new Worker(new URL('./translate.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data
        const p = pending.get(msg.id)
        if (!p) return
        if (msg.type === 'progress') return p.progress?.(msg.loaded, msg.total)
        pending.delete(msg.id)
        if (msg.type === 'error') p.reject(new Error(msg.message))
        else p.resolve(msg.result)
      }
    }
    const id = nextId++
    return new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject, progress })
      worker!.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  return {
    load: async (model, onProgress) => void (await call({ type: 'load', base, model }, onProgress)),
    async translate(text, from, to, onChunk) {
      const steps = route(from, to)
      let sofar = ''
      for (const c of chunk(text, from)) {
        sofar +=
          c === '\n\n'
            ? c
            : (sofar && !sofar.endsWith('\n') ? ' ' : '') +
              (await call({ type: 'translate', base, steps, text: c }))
        onChunk?.(sofar)
      }
      return sofar
    },
  }
}
