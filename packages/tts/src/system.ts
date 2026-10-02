import type { Provider, SpeakOptions, Voice } from './types.ts'

/** Used when the runtime exposes no voices (e.g. Electron on Windows): speak by utterance.lang only. */
export const SYSTEM_DEFAULT: Voice = {
  id: 'system-default',
  name: 'System default',
  lang: '*',
  provider: 'system',
  installed: true,
}

/** Web Speech API. The engine feeds it one sentence at a time (Chrome cuts long utterances). */
export function createSystemProvider(): Provider {
  const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis
  let finish: (() => void) | null = null
  let gen = 0 // bumped by stop()

  async function nativeVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!synth) return []
    const now = synth.getVoices()
    if (now.length) return now
    // Chrome loads voices asynchronously.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1000)
      synth.addEventListener('voiceschanged', () => (clearTimeout(t), resolve()), { once: true })
    })
    return synth.getVoices()
  }

  return {
    async getVoices() {
      if (!synth) return []
      const list = await nativeVoices()
      if (!list.length) return [SYSTEM_DEFAULT]
      return list.map((v) => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang.replace('_', '-'),
        provider: 'system' as const,
        installed: true,
      }))
    },

    async speak(text: string, opts: SpeakOptions) {
      if (!synth) throw new Error('Speech synthesis is not available')
      const u = new SpeechSynthesisUtterance(text)
      u.lang = opts.lang
      u.rate = opts.rate
      const my = gen
      const voice = (await nativeVoices()).find((v) => v.voiceURI === opts.voiceId)
      if (my !== gen) return
      if (voice) u.voice = voice
      await new Promise<void>((resolve) => {
        finish = resolve
        u.onend = () => resolve()
        // 'interrupted'/'canceled' come from stop(); other errors also just end this chunk.
        u.onerror = () => resolve()
        synth.speak(u)
      })
      finish = null
    },

    pause: () => synth?.pause(),
    resume: () => synth?.resume(),
    stop() {
      gen++
      synth?.cancel()
      finish?.()
    },
  }
}
