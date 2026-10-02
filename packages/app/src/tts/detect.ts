import { franc } from 'franc-min'

/** ISO 639-3 (franc) -> reading language. Unlisted languages keep the configured one. */
const LANGS: Record<string, string> = {
  por: 'pt-BR',
  eng: 'en-US',
  spa: 'es-ES',
  fra: 'fr-FR',
  deu: 'de-DE',
  ita: 'it-IT',
}

/** Detected BCP-47 language, or null when the text is too short or the language unsupported. */
export function detectLanguage(text: string): string | null {
  if (text.trim().length < 20) return null
  return LANGS[franc(text, { only: Object.keys(LANGS) })] ?? null
}
