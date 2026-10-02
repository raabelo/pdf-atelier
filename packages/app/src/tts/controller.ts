import type { TtsEngine, Voice } from '@pdf-atelier/tts'
import { create } from 'zustand'
import { t } from '../i18n/index.ts'
import { activeDoc } from '../stores/documents.ts'
import { useSettings } from '../stores/settings.ts'
import { goToPage, notify, viewOf } from '../stores/ui.ts'
import { detectLanguage } from './detect.ts'
import { rangeAt, showSegment, textOfRange, type MappedText } from './highlight.ts'

interface TtsStore {
  state: TtsEngine['state']
  voices: Voice[]
  /** Text currently being read and the sentence range inside it. */
  current: { text: string; start: number; end: number } | null
  /** Piper download progress per voice id (0..1). */
  installing: Record<string, number>
  /** Language picked by auto-detection for the current reading (null = configured language). */
  detected: string | null
}

export const useTts = create<TtsStore>(() => ({
  state: 'idle',
  voices: [],
  current: null,
  installing: {},
  detected: null,
}))

let engine: Promise<TtsEngine> | null = null

/** Lazy: the TTS package (and Piper worker) loads only when reading is first used. */
export function getEngine() {
  engine ??= import('@pdf-atelier/tts').then(({ createTtsEngine }) => {
    const e = createTtsEngine({ assetsBaseUrl: './tts/' })
    e.subscribe(() => {
      useTts.setState({ state: e.state, ...(e.state === 'idle' && { current: null }) })
      if (e.state === 'idle') showSegment(null)
    })
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

async function speak(m: MappedText, follow: boolean): Promise<'ended' | 'stopped'> {
  const e = await getEngine()
  const { lang: configured, voiceId, rate, autoDetect } = useSettings.getState().tts
  const detected = autoDetect ? detectLanguage(m.text) : null
  useTts.setState({ detected })
  const lang = detected ?? configured
  // The chosen voice only applies to the configured language; a detected one resolves its own.
  const voice = await e.resolveVoice(lang, lang === configured ? (voiceId ?? undefined) : undefined)
  // First use of a Piper voice downloads it (user decision: on-demand download, stored locally).
  if (voice?.provider === 'piper' && !voice.installed) await installVoice(voice.id)
  return e.speak(m.text, {
    lang,
    rate,
    ...(voice && { voiceId: voice.id }),
    onSegment: ({ start, end }) => {
      useTts.setState({ current: { text: m.text, start, end } })
      showSegment(rangeAt(m, start, end), follow)
    },
  })
}

async function speakMapped(m: MappedText) {
  const run = ++reading
  if (!m.text.trim()) return
  try {
    await speak(m, false)
  } catch (e) {
    if (run === reading) notify(t('tts.error', { message: errorText(e) }), true)
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Plain text (no highlight mapping). */
export const speakText = (text: string) => speakMapped({ text, pieces: [] })

/** Reads the current selection, highlighting each sentence in place. false = nothing selected. */
export function readSelection(silent = false): boolean {
  const sel = window.getSelection()
  const m = sel && sel.rangeCount && !sel.isCollapsed ? textOfRange(sel.getRangeAt(0)) : null
  if (m?.text.trim()) {
    void speakMapped(m)
    return true
  }
  if (!silent) notify(t('tts.noSelection'))
  return false
}

/** Waits (up to ~3s) for a page's text layer to be rendered after scrolling to it. */
async function textLayerOf(pageId: string): Promise<HTMLElement | null> {
  for (let i = 0; i < 180; i++) {
    const el = document.querySelector<HTMLElement>(`[data-page-id="${pageId}"] .textLayer`)
    if (el?.querySelector('span')) return el
    await new Promise(requestAnimationFrame)
  }
  return null
}

/** Continuous reading: current page, then the following ones, until stopped. */
export async function readFromCurrentPage() {
  const doc = activeDoc()
  if (!doc) return
  const run = ++reading
  const pages = doc.history.present.pages
  for (let i = viewOf(doc.id).page; i < pages.length && run === reading; i++) {
    const p = pages[i]!
    goToPage(doc.id, i)
    const layer = await textLayerOf(p.id)
    let m: MappedText
    if (layer) {
      const r = document.createRange()
      r.selectNodeContents(layer)
      m = textOfRange(r)
    } else {
      m = { text: await doc.sources.get(p.sourceId)!.pdf.getPageText(p.sourceIndex), pieces: [] }
    }
    if (run !== reading) return
    if (!m.text.trim()) continue
    try {
      if ((await speak(m, true)) === 'stopped' || run !== reading) return
    } catch (e) {
      notify(t('tts.error', { message: errorText(e) }), true)
      return
    }
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
