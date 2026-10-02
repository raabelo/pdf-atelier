export interface Voice {
  id: string
  name: string
  /** BCP-47, or '*' for the synthetic system default. */
  lang: string
  provider: 'piper' | 'system'
  installed: boolean
  sizeBytes?: number
  license?: string
  attribution?: string
}

export type SpeakResult = 'ended' | 'stopped'

export interface SpeakOptions {
  voiceId?: string
  lang: string
  /** 0.5..2 */
  rate: number
  /** Char offsets in the text passed to speak(). */
  onSegment?: (s: { start: number; end: number }) => void
}

export interface TextToSpeechProvider {
  getVoices(): Promise<Voice[]>
  /** 'ended' when it finished; 'stopped' when stop() or a newer speak() interrupted it. */
  speak(text: string, opts: SpeakOptions): Promise<SpeakResult>
  pause(): void
  resume(): void
  stop(): void
}

export interface TtsEngine extends TextToSpeechProvider {
  readonly state: 'idle' | 'speaking' | 'paused'
  subscribe(cb: () => void): () => void
  /** Downloads a piper model into local storage (OPFS). Call before speaking with a non-installed voice. */
  installVoice(id: string, onProgress?: (loaded: number, total: number) => void): Promise<void>
  removeVoice(id: string): Promise<void>
  /** Piper voice when one exists for lang (installed or downloadable), else a matching system voice. */
  resolveVoice(lang: string, preferredId?: string): Promise<Voice | null>
}

/** Internal provider shape used by the engine. */
export interface Provider extends TextToSpeechProvider {
  /** Optional warm-up of the next chunk (piper inference ahead of playback). */
  prefetch?(text: string, opts: SpeakOptions): void
  install?(id: string, onProgress?: (loaded: number, total: number) => void): Promise<void>
  remove?(id: string): Promise<void>
}
