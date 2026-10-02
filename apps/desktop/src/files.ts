import { randomUUID } from 'node:crypto'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'

export const MAX_RECENT = 20
export const MAX_PDF_BYTES = 1024 ** 3

export interface RecentEntry {
  ref: string
  path: string
  name: string
  openedAt: number
}

export const isPdfPath = (p: string) => isAbsolute(p) && extname(p).toLowerCase() === '.pdf'

/** Maps an app:// URL pathname to a file inside `root`; null on traversal or bad encoding. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const target = resolve(root, '.' + (decoded.startsWith('/') ? decoded : `/${decoded}`))
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

/** Throws unless `path` is an existing regular .pdf file within the size limit. */
export async function assertPdfFile(path: string): Promise<void> {
  if (!isPdfPath(path)) throw new Error('Not a PDF path')
  const st = await stat(path)
  if (!st.isFile()) throw new Error('Not a file')
  if (st.size > MAX_PDF_BYTES) throw new Error('File too large')
}

export async function readPdf(path: string): Promise<Uint8Array> {
  await assertPdfFile(path)
  return readFile(path)
}

/** Write to a temp file then rename, so a crash never leaves a half-written PDF. */
export async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, path)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/**
 * Paths the renderer may touch. Refs are only issued for paths the user picked (dialog/drop)
 * or previously opened (recents), so a compromised renderer cannot reach arbitrary files.
 */
export class FileRegistry {
  private granted = new Map<string, string>()
  private recent: RecentEntry[] = []

  constructor(private readonly storePath: string) {}

  async load(): Promise<void> {
    try {
      const data: unknown = JSON.parse(await readFile(this.storePath, 'utf8'))
      this.recent = (Array.isArray(data) ? data : [])
        .filter(
          (e): e is RecentEntry =>
            typeof e?.ref === 'string' &&
            typeof e.path === 'string' &&
            typeof e.name === 'string' &&
            typeof e.openedAt === 'number' &&
            isPdfPath(e.path),
        )
        .slice(0, MAX_RECENT)
    } catch {
      this.recent = []
    }
    for (const e of this.recent) this.granted.set(e.ref, e.path)
  }

  /** Grants access to `path` and returns its ref (stable per path). */
  grant(path: string): string {
    for (const [ref, p] of this.granted) if (samePath(p, path)) return ref
    const ref = randomUUID()
    this.granted.set(ref, path)
    return ref
  }

  pathFor(ref: string): string | undefined {
    return this.granted.get(ref)
  }

  isRecent(ref: string): boolean {
    return this.recent.some((e) => e.ref === ref)
  }

  list(): RecentEntry[] {
    return [...this.recent]
  }

  async touch(ref: string): Promise<void> {
    const path = this.granted.get(ref)
    if (!path) return
    this.recent = [
      { ref, path, name: basename(path), openedAt: Date.now() },
      ...this.recent.filter((e) => e.ref !== ref),
    ].slice(0, MAX_RECENT)
    await this.persist()
  }

  async remove(ref: string): Promise<void> {
    this.recent = this.recent.filter((e) => e.ref !== ref)
    await this.persist()
  }

  private persist(): Promise<void> {
    return writeAtomic(this.storePath, Buffer.from(JSON.stringify(this.recent)))
  }
}
