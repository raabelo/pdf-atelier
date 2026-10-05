import {
  createTranslator,
  installedModels,
  route,
  removeModel as remove,
  type Lang,
  type Translator,
} from '@pdf-atelier/translate'
import { create } from 'zustand'
import { t } from '../i18n/index.ts'
import { useSettings } from '../stores/settings.ts'
import { notify, useUi } from '../stores/ui.ts'
import { detectLanguage } from '../tts/detect.ts'
import { textOfRange } from '../tts/highlight.ts'

interface TranslateStore {
  busy: boolean
  /** Source text, its language and the translation (partial while busy). */
  result: { source: string; from: string; text: string } | null
  /** Installed (cached) model ids. */
  installed: string[]
  /** Download progress per model id (0..1). */
  installing: Record<string, number>
}

export const useTranslate = create<TranslateStore>(() => ({
  busy: false,
  result: null,
  installed: [],
  installing: {},
}))

let translator: Translator | null = null
/** transformers.js lives in the worker, which starts on the first translation or download. */
const getTranslator = () => (translator ??= createTranslator('./tts/'))

export async function refreshModels() {
  useTranslate.setState({ installed: await installedModels() })
}

/** Downloads (first time) and loads a model, with progress in the panel. */
async function download(id: string) {
  useTranslate.setState((s) => ({ installing: { ...s.installing, [id]: 0 } }))
  try {
    await getTranslator().load(id, (loaded, total) =>
      useTranslate.setState((s) => ({
        installing: { ...s.installing, [id]: total ? loaded / total : 0 },
      })),
    )
  } finally {
    useTranslate.setState((s) => {
      const { [id]: _, ...rest } = s.installing
      return { installing: rest }
    })
    await refreshModels()
  }
}

export const installModel = (id: string) =>
  download(id).catch((e) => notify(t('translate.error', { message: errorText(e) }), true))

export async function removeModel(id: string) {
  await remove(id)
  await refreshModels()
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const base = (lang: string) => lang.toLowerCase().split('-')[0]!

let run = 0

export async function translateText(source: string) {
  const { from: configured, to } = useSettings.getState().translate
  const detected = configured === 'auto' ? detectLanguage(source) : null
  // Too short to detect: assume English, or the UI language when translating into English.
  const fallback = to === 'en' ? base(useSettings.getState().locale) : 'en'
  const from = (configured === 'auto' ? (detected ? base(detected) : fallback) : configured) as Lang
  const my = ++run
  useTranslate.setState({ busy: true, result: { source, from, text: '' } })
  try {
    // First use of a model downloads it (user decision: on-demand, stored locally).
    const { installed } = useTranslate.getState()
    for (const { model } of route(from, to as Lang))
      if (!installed.includes(model)) await download(model)
    await getTranslator().translate(source, from, to as Lang, (text) => {
      if (my === run) useTranslate.setState({ result: { source, from, text } })
    })
  } catch (e) {
    if (my === run) notify(t('translate.error', { message: errorText(e) }), true)
  } finally {
    if (my === run) useTranslate.setState({ busy: false })
  }
}

/** Translates the current selection into the sidebar panel. false = nothing selected. */
export function translateSelection(silent = false): boolean {
  const sel = window.getSelection()
  const text = sel && sel.rangeCount && !sel.isCollapsed ? textOfRange(sel.getRangeAt(0)).text : ''
  if (!text.trim()) {
    if (!silent) notify(t('tts.noSelection'))
    return false
  }
  useUi.setState({ sidebarOpen: true, panel: 'translate' })
  void translateText(text)
  return true
}
