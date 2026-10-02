import type { MessageKey } from '../i18n/messages.ts'

export interface Command {
  id: string
  labelKey: MessageKey
  /** e.g. 'Mod+S', 'Mod+Shift+Z', 'Delete'. Mod = Cmd on macOS, Ctrl elsewhere. */
  keys?: string[]
  /** Command is available (disabled in menus/toolbar otherwise). */
  when?: () => boolean
  run: () => void | Promise<void>
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const commands = new Map<string, Command>()

export function registerCommands(list: Command[]) {
  for (const c of list) commands.set(c.id, c)
  return () => list.forEach((c) => commands.delete(c.id))
}

export const getCommand = (id: string) => commands.get(id)

export function runCommand(id: string) {
  const c = commands.get(id)
  if (c && (c.when?.() ?? true)) void c.run()
}

/** Matches one combo against a keyboard event. Exported for tests. */
export function matchKeys(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  combo: string,
  mac = isMac,
) {
  const parts = combo.split('+')
  // 'Mod++' -> key '+'
  const key = combo.endsWith('++') ? '+' : parts.pop()!
  const mods = new Set(parts.filter(Boolean))
  const mod = mods.has('Mod')
  const want = {
    ctrl: mods.has('Ctrl') || (mod && !mac),
    meta: mods.has('Meta') || (mod && mac),
    shift: mods.has('Shift'),
    alt: mods.has('Alt'),
  }
  if (e.ctrlKey !== want.ctrl || e.metaKey !== want.meta || e.altKey !== want.alt) return false
  // Shift is implied by symbol keys like '+'; only enforce it for letters/named keys.
  if (key.length > 1 || /[a-z]/i.test(key)) {
    if (e.shiftKey !== want.shift) return false
  }
  return e.key.toLowerCase() === key.toLowerCase()
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** The one global keyboard listener. */
export function handleKeyDown(e: KeyboardEvent) {
  for (const c of commands.values()) {
    for (const combo of c.keys ?? []) {
      if (!matchKeys(e, combo)) continue
      // Plain keys (tool letters, Delete) must not fire while typing in a field.
      if (isTyping(e.target) && !/Mod|Ctrl|Meta/.test(combo)) continue
      if (!(c.when?.() ?? true)) continue
      e.preventDefault()
      void c.run()
      return
    }
  }
}

/** Human-readable shortcut for tooltips/menus. */
export function formatKeys(id: string) {
  const combo = commands.get(id)?.keys?.[0]
  if (!combo) return undefined
  return combo.replace('Mod', isMac ? '⌘' : 'Ctrl').replace('Shift', isMac ? '⇧' : 'Shift')
}
