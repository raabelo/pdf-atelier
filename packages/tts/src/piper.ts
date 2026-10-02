import type { Provider, SpeakOptions, SpeakResult, Voice } from './types.ts'
import type { WorkerRequest, WorkerResponse } from './piper.worker.ts'

type Distributive<T> = T extends unknown ? Omit<T, 'id'> : never

/** Medium-quality voices whose dataset licenses allow redistribution in a GPL/AGPL app. */
export const PIPER_VOICES: Voice[] = [
  { id: 'en_US-ljspeech-medium', name: 'LJSpeech (Piper)', lang: 'en-US', license: 'Public domain' },
  { id: 'pt_BR-faber-medium', name: 'Faber (Piper)', lang: 'pt-BR', license: 'CC0-1.0' },
  { id: 'es_ES-davefx-medium', name: 'DaveFX (Piper)', lang: 'es-ES', license: 'CC0-1.0' },
  {
    id: 'fr_FR-siwis-medium',
    name: 'Siwis (Piper)',
    lang: 'fr-FR',
    license: 'CC-BY-4.0',
    attribution: 'SIWIS French Speech Synthesis Database (Honnet, Lazaridis, Garner, Yamagishi), CC BY 4.0',
  },
].map((v) => ({ ...v, provider: 'piper' as const, installed: false, sizeBytes: 63_200_000 }))

export function createPiperProvider(assetsBaseUrl: string): Provider {
  // The worker resolves relative URLs against its own script URL (e.g. /assets/), so make the base absolute here.
  const base = new URL(assetsBaseUrl, globalThis.location?.href).href
  let worker: Worker | null = null
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; progress?: (l: number, t: number) => void }
  >()

  function call<T>(req: Distributive<WorkerRequest>, progress?: (l: number, t: number) => void): Promise<T> {
    if (!worker) {
      worker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' })
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
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (r: unknown) => void, reject, progress })
      worker!.postMessage({ ...req, id })
    })
  }

  // ponytail: cache keyed by voice+text, only holds the in-flight/next chunk; enough for sentence look-ahead.
  const cache = new Map<string, Promise<Blob>>()
  const predict = (text: string, voiceId: string) => {
    const key = `${voiceId}\n${text}`
    let p = cache.get(key)
    if (!p) {
      p = call<Blob>({ type: 'predict', voiceId, base, text })
      cache.set(key, p)
    }
    return p
  }

  let audio: HTMLAudioElement | null = null
  let finish: ((r: SpeakResult) => void) | null = null
  let gen = 0 // bumped by stop(); a speak() that sees a newer gen bails out
  let paused = false

  return {
    async getVoices() {
      let installed: string[] = []
      try {
        installed = await call<string[]>({ type: 'stored' })
      } catch {
        // OPFS unavailable: everything shows as not installed.
      }
      return PIPER_VOICES.map((v) => ({ ...v, installed: installed.includes(v.id) }))
    },

    prefetch(text: string, opts: SpeakOptions) {
      if (opts.voiceId) predict(text, opts.voiceId).catch(() => {})
    },

    async speak(text: string, opts: SpeakOptions): Promise<SpeakResult> {
      if (!opts.voiceId) throw new Error('Piper needs a voiceId')
      const key = `${opts.voiceId}\n${text}`
      const my = gen
      const blob = await predict(text, opts.voiceId).finally(() => cache.delete(key))
      if (my !== gen) return 'stopped'
      const url = URL.createObjectURL(blob)
      try {
        return await new Promise<SpeakResult>((resolve, reject) => {
          const el = new Audio(url)
          audio = el
          el.playbackRate = opts.rate
          finish = resolve
          el.onended = () => resolve('ended')
          el.onerror = () => reject(new Error('Audio playback failed'))
          if (!paused) el.play().catch(reject)
        })
      } finally {
        audio = null
        finish = null
        URL.revokeObjectURL(url)
      }
    },

    pause() {
      paused = true
      audio?.pause()
    },
    resume() {
      paused = false
      void audio?.play()
    },
    stop() {
      gen++
      paused = false
      cache.clear()
      audio?.pause()
      finish?.('stopped')
    },

    install: (id, onProgress) => call<void>({ type: 'load', voiceId: id, base }, onProgress),
    remove: (id) => call<void>({ type: 'remove', voiceId: id }),
  }
}
