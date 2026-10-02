import type { TtsEngine, Voice } from '@pdf-atelier/tts'
import { create } from 'zustand'
import { t } from '../i18n/index.ts'
import { activeDoc } from '../stores/documents.ts'
import { useSettings } from '../stores/settings.ts'
import { notify, viewOf } from '../stores/ui.ts'

interface TtsStore {
  state: TtsEngine['state']
  voices: Voice[]
  /** Text currently being read and the sentence range inside it. */
  current: { text: string; start: number; end: number } | null
  /** Piper download progress per voice id (0..1). */
  installing: Record<string, number>
}

export const useTts = create<TtsStore>(() => ({
  state: 'idle',
  voices: [],
  current: null,
  installing: {},
}))

let engine: Promise<TtsEngine> | null = null

/** Lazy: the TTS package (and Piper worker) loads only when reading is first used. */
export function getEngine() {
  engine ??= import('@pdf-atelier/tts').then(({ createTtsEngine }) => {
    const e = createTtsEngine({ assetsBaseUrl: './tts/' })
    e.subscribe(() =>
      useTts.setState({ state: e.state, ...(e.state === 'idle' && { current: null }) }),
    )
    return e
  })
  return engine
}

export async function refreshVoices() {
  useTts.setState({ voices: await (await getEngine()).getVoices() })
}

export async function installVoice(id: string) {
  const e = await getEngine()
  useTts.setState((s) => ({ installing: { ...s.installing, [id]: 0 } }))
  try {
    await e.installVoice(id, (loaded, total) =>
      useTts.setState((s) => ({
        installing: { ...s.installing, [id]: total ? loaded / total : 0 },
      })),
    )
  } finally {
    useTts.setState((s) => {
      const { [id]: _, ...rest } = s.installing
      return { installing: rest }
    })
    await refreshVoices()
  }
}

export async function removeVoice(id: string) {
  await (await getEngine()).removeVoice(id)
  await refreshVoices()
}

let reading = 0

async function speak(text: string) {
  const e = await getEngine()
  const { lang, voiceId, rate } = useSettings.getState().tts
  const voice = await e.resolveVoice(lang, voiceId ?? undefined)
  // First use of a Piper voice downloads it (user decision: on-demand download, stored locally).
  if (voice?.provider === 'piper' && !voice.installed) await installVoice(voice.id)
  await e.speak(text, {
    lang,
    rate,
    ...(voice && { voiceId: voice.id }),
    onSegment: ({ start, end }) => useTts.setState({ current: { text, start, end } }),
  })
}

export async function speakText(text: string) {
  const run = ++reading
  if (!text.trim()) return
  try {
    await speak(text)
  } catch (e) {
    if (run === reading)
      notify(t('tts.error', { message: e instanceof Error ? e.message : String(e) }), true)
  }
}

export function readSelection() {
  const text = window.getSelection()?.toString() ?? ''
  if (text.trim()) void speakText(text)
  else notify(t('tts.noSelection'))
}

/** Continuous reading: current page, then the following ones, until stopped. */
export async function readFromCurrentPage() {
  const doc = activeDoc()
  if (!doc) return
  const run = ++reading
  const pages = doc.history.present.pages
  for (let i = viewOf(doc.id).page; i < pages.length && run === reading; i++) {
    const p = pages[i]!
    const text = await doc.sources.get(p.sourceId)!.pdf.getPageText(p.sourceIndex)
    if (run !== reading) return
    try {
      await speak(text)
    } catch (e) {
      notify(t('tts.error', { message: e instanceof Error ? e.message : String(e) }), true)
      return
    }
    // ponytail: no reliable "finished vs stopped" signal from speak(); state is idle in both cases
    if (run !== reading) return
  }
}

export async function stopReading() {
  reading++
  ;(await getEngine()).stop()
}

export async function togglePause() {
  const e = await getEngine()
  if (e.state === 'speaking') e.pause()
  else if (e.state === 'paused') e.resume()
}
