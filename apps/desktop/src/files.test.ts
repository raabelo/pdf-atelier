import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPdfFile, FileRegistry, isPdfPath, MAX_RECENT, resolveInside, writeAtomic } from './files.ts'

const root = join(tmpdir(), 'web-root')

describe('resolveInside', () => {
  it('maps normal paths inside root', () => {
    expect(resolveInside(root, '/index.html')).toBe(join(root, 'index.html'))
    expect(resolveInside(root, '/assets/a%20b.js')).toBe(join(root, 'assets', 'a b.js'))
  })
  it('blocks traversal, encoded traversal, root itself and bad encoding', () => {
    for (const p of ['/../secret', '/assets/../../x', '/%2e%2e/x', '/..%5c..%5cx', '/', '/%E0%A4%A', '/a%00.js']) {
      expect(resolveInside(root, p), p).toBeNull()
    }
  })
})

describe('pdf validation', () => {
  it('accepts only absolute .pdf paths', () => {
    expect(isPdfPath(join(root, 'a.PDF'))).toBe(true)
    expect(isPdfPath('a.pdf')).toBe(false)
    expect(isPdfPath(join(root, 'a.exe'))).toBe(false)
  })
  it('rejects directories and missing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfa-'))
    await expect(assertPdfFile(join(dir, 'missing.pdf'))).rejects.toThrow()
    await expect(assertPdfFile(dir)).rejects.toThrow()
    await writeFile(join(dir, 'ok.pdf'), '%PDF-1.7')
    await expect(assertPdfFile(join(dir, 'ok.pdf'))).resolves.toBeUndefined()
  })
})

describe('FileRegistry', () => {
  it('issues stable refs, persists recents, ignores tampered entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfa-'))
    const store = join(dir, 'recent.json')
    const reg = new FileRegistry(store)
    await reg.load()
    const a = reg.grant(join(dir, 'a.pdf'))
    expect(reg.grant(join(dir, 'a.pdf'))).toBe(a)
    expect(reg.isRecent(a)).toBe(false)
    await reg.touch(a)

    const raw = JSON.parse(await readFile(store, 'utf8'))
    raw.push({ ref: 'evil', path: 'C:\\Windows\\system32\\config\\SAM', name: 'x', openedAt: 1 })
    await writeFile(store, JSON.stringify(raw))

    const reloaded = new FileRegistry(store)
    await reloaded.load()
    expect(reloaded.isRecent(a)).toBe(true)
    expect(reloaded.pathFor(a)).toBe(join(dir, 'a.pdf'))
    expect(reloaded.pathFor('evil')).toBeUndefined()
    expect(reloaded.pathFor('unknown')).toBeUndefined()
  })
  it('caps recents and survives a corrupt store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfa-'))
    const store = join(dir, 'recent.json')
    await writeFile(store, '{not json')
    const reg = new FileRegistry(store)
    await reg.load()
    for (let i = 0; i < MAX_RECENT + 5; i++) await reg.touch(reg.grant(join(dir, `${i}.pdf`)))
    expect(reg.list()).toHaveLength(MAX_RECENT)
    expect(reg.list()[0]?.name).toBe(`${MAX_RECENT + 4}.pdf`)
  })
})

describe('writeAtomic', () => {
  it('replaces existing content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfa-'))
    const f = join(dir, 'x.pdf')
    await writeFile(f, 'old')
    await writeAtomic(f, Buffer.from('new'))
    expect(await readFile(f, 'utf8')).toBe('new')
  })
})
