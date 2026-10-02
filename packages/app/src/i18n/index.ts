import { useSettings } from '../stores/settings.ts'
import { en, ptBR, type MessageKey } from './messages.ts'

export type { MessageKey }
export const locales = { 'pt-BR': ptBR, en } as const
export type Locale = keyof typeof locales

/** Translates using the current settings locale. The app root remounts on locale change. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = locales[useSettings.getState().locale][key] ?? en[key]
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text
}
