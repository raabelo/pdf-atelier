import { describe, expect, it, vi } from 'vitest'
import { handleKeyDown, matchKeys, registerCommands } from './registry.ts'

const ev = (
  key: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('matchKeys', () => {
  it('maps Mod to Ctrl off-mac and Meta on mac', () => {
    expect(matchKeys(ev('s', { ctrlKey: true }), 'Mod+S', false)).toBe(true)
    expect(matchKeys(ev('s', { metaKey: true }), 'Mod+S', false)).toBe(false)
    expect(matchKeys(ev('s', { metaKey: true }), 'Mod+S', true)).toBe(true)
  })
  it('requires exact modifiers for letters', () => {
    expect(matchKeys(ev('S', { ctrlKey: true, shiftKey: true }), 'Mod+S', false)).toBe(false)
    expect(matchKeys(ev('S', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+S', false)).toBe(true)
    expect(matchKeys(ev('z', { ctrlKey: true, altKey: true }), 'Mod+Z', false)).toBe(false)
  })
  it('handles symbol keys and Mod++', () => {
    expect(matchKeys(ev('+', { ctrlKey: true, shiftKey: true }), 'Mod++', false)).toBe(true)
    expect(matchKeys(ev('=', { ctrlKey: true }), 'Mod+=', false)).toBe(true)
    expect(matchKeys(ev('Delete'), 'Delete', false)).toBe(true)
  })
})

describe('handleKeyDown', () => {
  it('runs the command, respects when(), and ignores plain keys while typing', () => {
    const run = vi.fn()
    let enabled = true
    const off = registerCommands([
      { id: 't.x', labelKey: 'tool.select', keys: ['V'], when: () => enabled, run },
    ])
    const fire = (target: EventTarget = document.body) => {
      const e = new KeyboardEvent('keydown', { key: 'v', cancelable: true })
      Object.defineProperty(e, 'target', { value: target })
      handleKeyDown(e)
    }
    fire()
    expect(run).toHaveBeenCalledTimes(1)
    fire(document.createElement('input'))
    expect(run).toHaveBeenCalledTimes(1)
    enabled = false
    fire()
    expect(run).toHaveBeenCalledTimes(1)
    off()
  })
})
