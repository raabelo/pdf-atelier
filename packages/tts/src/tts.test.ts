import { describe, expect, it } from 'vitest'
import { createEngine } from './engine.ts'
import { splitSentences } from './sentences.ts'
import type { Provider, Voice } from './types.ts'

describe('splitSentences', () => {
  it('splits English and keeps offsets into the original text', () => {
    const text = 'The first sentence is here. And this is the second one!  Is this the third one?'
    const parts = splitSentences(text, 'en')
    expect(parts.map((p) => p.text)).toEqual([
      'The first sentence is here.',
      'And this is the second one!',
      'Is this the third one?',
    ])
    for (const p of parts) expect(text.slice(p.start, p.end)).toBe(p.text)
  })

  it('treats PDF line wraps as spaces and merges short pieces (abbreviations)', () => {
    const text = 'O Dr. Silva chegou cedo\nao hospital hoje. Ele atendeu muitos pacientes ontem.'
    const parts = splitSentences(text, 'pt-BR')
    expect(parts[0]!.text).toBe('O Dr. Silva chegou cedo ao hospital hoje.')
    expect(parts.at(-1)!.text).toBe('Ele atendeu muitos pacientes ontem.')
    for (const p of parts) expect(text.slice(p.start, p.end).replace('\n', ' ')).toBe(p.text)
  })

  it('caps long sentences near 250 chars at a word boundary', () => {
    const text = Array.from({ length: 120 }, (_, i) => `palavra${i}`).join(' ') + '.'
    const parts = splitSentences(text, 'pt')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) {
      expect(p.text.length).toBeLessThanOrEqual(250)
      expect(text.slice(p.start, p.end)).toBe(p.text)
    }
    expect(parts.map((p) => p.text).join(' ')).toBe(text)
  })

  it('returns nothing for blank text', () => {
    expect(splitSentences('  \n ', 'en')).toEqual([])
  })
})

function fakeProvider(voices: Voice[], log: string[] = []): Provider {
  return {
    getVoices: async () => voices,
    speak: async (text) => (log.push(text), 'ended'),
    pause() {},
    resume() {},
    stop() {},
  }
}

const v = (id: string, lang: string, provider: Voice['provider']): Voice => ({
  id,
  name: id,
  lang,
  provider,
  installed: provider === 'system',
})

describe('engine.resolveVoice', () => {
  const piper = fakeProvider([v('pt_BR-faber-medium', 'pt-BR', 'piper'), v('en_US-ljspeech-medium', 'en-US', 'piper')])
  const system = fakeProvider([v('sys-de', 'de-DE', 'system'), v('sys-en-gb', 'en-GB', 'system')])
  const engine = createEngine({ piper, system })

  it('prefers piper for languages it covers, falling back to the base language', async () => {
    expect((await engine.resolveVoice('pt-BR'))?.id).toBe('pt_BR-faber-medium')
    expect((await engine.resolveVoice('pt-PT'))?.id).toBe('pt_BR-faber-medium')
    expect((await engine.resolveVoice('en_GB'))?.id).toBe('en_US-ljspeech-medium')
  })

  it('uses system voices for other languages, null when nothing matches', async () => {
    expect((await engine.resolveVoice('de'))?.id).toBe('sys-de')
    expect(await engine.resolveVoice('it-IT')).toBeNull()
  })

  it('honours a preferred voice id', async () => {
    expect((await engine.resolveVoice('en-US', 'sys-en-gb'))?.id).toBe('sys-en-gb')
  })

  it('falls back to the synthetic system default when the runtime lists no voices', async () => {
    const e = createEngine({ piper, system: fakeProvider([v('system-default', '*', 'system')]) })
    expect((await e.resolveVoice('it-IT'))?.id).toBe('system-default')
  })
})

describe('engine.speak', () => {
  it('speaks sentence by sentence with segment offsets and returns to idle', async () => {
    const log: string[] = []
    const engine = createEngine({ piper: fakeProvider([]), system: fakeProvider([v('sys-en', 'en-US', 'system')], log) })
    const segments: { start: number; end: number }[] = []
    const text = 'Hello there, my friend. How are you doing today?'
    expect(await engine.speak(text, { lang: 'en-US', rate: 1, onSegment: (s) => segments.push(s) })).toBe('ended')
    expect(log).toEqual(['Hello there, my friend.', 'How are you doing today?'])
    expect(segments.map((s) => text.slice(s.start, s.end))).toEqual(log)
    expect(engine.state).toBe('idle')
  })
  it("resolves 'stopped' when stop() interrupts it", async () => {
    let release!: () => void
    const slow: Provider = {
      ...fakeProvider([v('sys-en', 'en-US', 'system')]),
      speak: () => new Promise((r) => (release = () => r('stopped'))),
      stop: () => release?.(),
    }
    const engine = createEngine({ piper: fakeProvider([]), system: slow })
    const result = engine.speak('One sentence here. And another one.', { lang: 'en-US', rate: 1 })
    await new Promise((r) => setTimeout(r, 0))
    expect(engine.state).toBe('speaking')
    engine.stop()
    expect(await result).toBe('stopped')
    expect(engine.state).toBe('idle')
  })
})
