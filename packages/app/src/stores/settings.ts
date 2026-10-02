import { openDB } from 'idb'
import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

export interface Settings {
  theme: Theme
  locale: 'pt-BR' | 'en'
  tts: { lang: string; voiceId: string | null; rate: number; autoRead: boolean }
}

const defaults: Settings = {
  theme: 'system',
  locale:
    typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('pt')
      ? 'pt-BR'
      : 'en',
  tts: { lang: 'pt-BR', voiceId: null, rate: 1, autoRead: false },
}

interface SettingsStore extends Settings {
  loaded: boolean
  set(patch: Partial<Settings>): void
  setTts(patch: Partial<Settings['tts']>): void
}

export const useSettings = create<SettingsStore>((set) => ({
  ...defaults,
  loaded: false,
  set: (patch) => set(patch),
  setTts: (patch) => set((s) => ({ tts: { ...s.tts, ...patch } })),
}))

// Persistence: one IndexedDB key/value store shared by app-level state (both runtimes).
const db = () => openDB('pdf-atelier', 1, { upgrade: (d) => void d.createObjectStore('kv') })

export async function loadSettings() {
  try {
    const saved = (await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined
    useSettings.setState({ ...saved, tts: { ...defaults.tts, ...saved?.tts }, loaded: true })
  } catch {
    useSettings.setState({ loaded: true }) // private mode / storage disabled: keep defaults
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  useSettings.subscribe(({ theme, locale, tts }) => {
    clearTimeout(timer)
    timer = setTimeout(
      () =>
        void db()
          .then((d) => d.put('kv', { theme, locale, tts }, 'settings'))
          .catch(() => {}),
      300,
    )
  })
}
