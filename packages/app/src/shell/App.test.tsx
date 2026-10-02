import 'fake-indexeddb/auto'
import type { Platform } from '@pdf-atelier/platform'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@pdf-atelier/pdf', () => ({ loadPdf: vi.fn(), exportPdf: vi.fn(), configurePdf: vi.fn() }))

const { App } = await import('./App.tsx')

globalThis.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
})) as never
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as never

const platform: Platform = {
  files: {
    capabilities: { saveInPlace: false, reopenRecent: false },
    openFile: vi.fn(async () => null),
    fromDroppedFile: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    exportFile: vi.fn(),
    openRecent: vi.fn(),
    listRecent: vi.fn(async () => [{ ref: 'r1', name: 'contrato.pdf', openedAt: 1 }]),
    removeRecent: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
}

describe('App', () => {
  it('renders the empty state with recents and runs Open through the command registry', async () => {
    render(<App platform={platform} />)
    expect(await screen.findByText('contrato.pdf')).toBeTruthy()
    // Web fallback cannot reopen: the recent entry is not a button.
    expect(screen.queryByRole('button', { name: 'contrato.pdf' })).toBeNull()
    const open = screen.getAllByRole('button').find((b) => b.textContent?.match(/Open|Abrir/))!
    open.click()
    expect(platform.files.openFile).toHaveBeenCalled()
  })
})
