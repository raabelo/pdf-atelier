import { openDB } from 'idb'
import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

export interface Settings {
  theme: Theme
  locale: 'pt-BR' | 'en'
  tts: {
    lang: string
    voiceId: string | null
    rate: number
    autoRead: boolean
    /** Pick the reading language from the text (franc) instead of `lang`. */
    autoDetect: boolean
  }
  translate: {
    /** Source language, or 'auto' to detect it (franc). */
    from: string
    to: string
    autoTranslate: boolean
  }
}

const isPt = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('pt')
const defaults: Settings = {
  theme: 'system',
  locale: isPt ? 'pt-BR' : 'en',
  tts: { lang: 'pt-BR', voiceId: null, rate: 1, autoRead: false, autoDetect: true },
  translate: { from: 'auto', to: isPt ? 'pt' : 'en', autoTranslate: false },
}

interface SettingsStore extends Settings {
  loaded: boolean
  set(patch: Partial<Settings>): void
  setTts(patch: Partial<Settings['tts']>): void
  setTranslate(patch: Partial<Settings['translate']>): void
}

export const useSettings = create<SettingsStore>((set) => ({
  ...defaults,
  loaded: false,
  set: (patch) => set(patch),
  setTts: (patch) => set((s) => ({ tts: { ...s.tts, ...patch } })),
  setTranslate: (patch) => set((s) => ({ translate: { ...s.translate, ...patch } })),
}))

// Persistence: one IndexedDB key/value store shared by app-level state (both runtimes).
const db = () => openDB('pdf-atelier', 1, { upgrade: (d) => void d.createObjectStore('kv') })

export async function loadSettings() {
  try {
    const saved = (await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined
    useSettings.setState({
      ...saved,
      tts: { ...defaults.tts, ...saved?.tts },
      translate: { ...defaults.translate, ...saved?.translate },
      loaded: true,
    })
  } catch {
    useSettings.setState({ loaded: true }) // private mode / storage disabled: keep defaults
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  useSettings.subscribe(({ theme, locale, tts, translate }) => {
    clearTimeout(timer)
    timer = setTimeout(
      () =>
        void db()
          .then((d) => d.put('kv', { theme, locale, tts, translate }, 'settings'))
          .catch(() => {}),
      300,
    )
  })
}
