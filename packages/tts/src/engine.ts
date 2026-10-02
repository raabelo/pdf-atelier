import { createPiperProvider } from './piper.ts'
import { splitSentences } from './sentences.ts'
import { createSystemProvider } from './system.ts'
import type { Provider, SpeakOptions, TtsEngine, Voice } from './types.ts'

export function createTtsEngine(opts: { assetsBaseUrl?: string } = {}): TtsEngine {
  return createEngine({ piper: createPiperProvider(opts.assetsBaseUrl ?? '/tts/'), system: createSystemProvider() })
}

const norm = (lang: string) => lang.replace('_', '-').toLowerCase()
const base = (lang: string) => norm(lang).split('-')[0]

/** Best voice for lang: exact match, then same base language; '*' (system default) matches anything. */
function pick(voices: Voice[], lang: string): Voice | undefined {
  const l = norm(lang)
  return (
    voices.find((v) => norm(v.lang) === l) ??
    voices.find((v) => base(v.lang) === base(l)) ??
    voices.find((v) => v.lang === '*')
  )
}

/** Exported for tests (inject fake providers). */
export function createEngine(providers: { piper: Provider; system: Provider }): TtsEngine {
  let state: TtsEngine['state'] = 'idle'
  let run = 0
  let active: Provider | null = null
  const listeners = new Set<() => void>()
  const setState = (s: TtsEngine['state']) => {
    state = s
    listeners.forEach((cb) => cb())
  }

  async function getVoices() {
    const [piper, system] = await Promise.all([
      providers.piper.getVoices().catch(() => []),
      providers.system.getVoices().catch(() => []),
    ])
    return [...piper, ...system]
  }

  const engine: TtsEngine = {
    get state() {
      return state
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getVoices,

    async resolveVoice(lang, preferredId) {
      const voices = await getVoices()
      const preferred = voices.find((v) => v.id === preferredId)
      if (preferred) return preferred
      return (
        pick(
          voices.filter((v) => v.provider === 'piper' && v.lang !== '*'),
          lang,
        ) ??
        pick(
          voices.filter((v) => v.provider === 'system'),
          lang,
        ) ??
        null
      )
    },

    async speak(text, opts: SpeakOptions) {
      engine.stop()
      const token = ++run
      const voice = await engine.resolveVoice(opts.lang, opts.voiceId)
      if (token !== run) return 'stopped'
      if (!voice) throw new Error(`No voice for ${opts.lang}`)
      const provider = voice.provider === 'piper' ? providers.piper : providers.system
      const o = { ...opts, voiceId: voice.id }
      const parts = splitSentences(text, opts.lang)
      active = provider
      setState('speaking')
      try {
        for (let i = 0; i < parts.length; i++) {
          if (token !== run) return 'stopped'
          const part = parts[i]!
          const next = parts[i + 1]
          if (next) provider.prefetch?.(next.text, o)
          opts.onSegment?.({ start: part.start, end: part.end })
          if ((await provider.speak(part.text, o)) === 'stopped' || token !== run) return 'stopped'
        }
        return 'ended'
      } finally {
        if (token === run) {
          active = null
          setState('idle')
        }
      }
    },

    pause() {
      if (state !== 'speaking') return
      active?.pause()
      setState('paused')
    },
    resume() {
      if (state !== 'paused') return
      active?.resume()
      setState('speaking')
    },
    stop() {
      run++
      const a = active
      active = null
      a?.stop()
      if (state !== 'idle') setState('idle')
    },

    async installVoice(id, onProgress) {
      await providers.piper.install?.(id, onProgress)
    },
    async removeVoice(id) {
      await providers.piper.remove?.(id)
    },
  }
  return engine
}
