import type { FileRef, FileSystemAdapter, OpenedFile, Platform, RecentFile, ShellAdapter } from '../contracts.ts'
import { safeExternalUrl } from '../url.ts'

// File System Access API is Chromium-only and not yet in lib.dom; declare the bits we use.
interface FsHandle extends FileSystemFileHandle {
  queryPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
}
type PickerTypes = { types: { description: string; accept: Record<string, string[]> }[] }
declare global {
  interface Window {
    showOpenFilePicker?(o: PickerTypes & { multiple?: boolean }): Promise<FsHandle[]>
    showSaveFilePicker?(o: PickerTypes & { suggestedName?: string }): Promise<FsHandle>
  }
}

const PDF_TYPES: PickerTypes = { types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }
const MAX_RECENT = 20

interface RecentRecord extends RecentFile {
  handle: FsHandle
}

// Tiny IndexedDB helper: one object store 'recent' keyed by ref.
let dbPromise: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('pdf-atelier-platform', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('recent', { keyPath: 'ref' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction('recent', mode).objectStore('recent')
  return new Promise((resolve, reject) => {
    const req = run(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function allRecent(): Promise<RecentRecord[]> {
  const all = await tx<RecentRecord[]>('readonly', (s) => s.getAll())
  return all.sort((a, b) => b.openedAt - a.openedAt)
}

async function remember(handle: FsHandle): Promise<FileRef> {
  // Same file opened again -> reuse its ref.
  const all = await allRecent()
  let ref: FileRef | undefined
  for (const r of all) if (await r.handle.isSameEntry(handle)) ref = r.ref
  ref ??= crypto.randomUUID()
  await tx('readwrite', (s) => s.put({ ref, name: handle.name, openedAt: Date.now(), handle } satisfies RecentRecord))
  for (const old of all.filter((r) => r.ref !== ref).slice(MAX_RECENT - 1)) {
    await tx('readwrite', (s) => s.delete(old.ref))
  }
  return ref
}

async function readHandle(handle: FsHandle, ref: FileRef): Promise<OpenedFile> {
  const file = await handle.getFile()
  return { ref, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
}

async function ensureWritable(handle: FsHandle): Promise<boolean> {
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
}

async function write(handle: FsHandle, bytes: Uint8Array): Promise<void> {
  // createWritable writes to a swap file and commits on close: the original survives a failed write.
  const w = await handle.createWritable()
  try {
    await w.write(bytes as Uint8Array<ArrayBuffer>)
    await w.close()
  } catch (e) {
    await w.abort()
    throw e
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/** Chromium: File System Access API. */
function fsAccessFiles(): FileSystemAdapter {
  return {
    capabilities: { saveInPlace: true, reopenRecent: true },
    async openFile() {
      try {
        const [handle] = await window.showOpenFilePicker!({ ...PDF_TYPES, multiple: false })
        if (!handle) return null
        return readHandle(handle, await remember(handle))
      } catch (e) {
        if (isAbort(e)) return null
        throw e
      }
    },
    async fromDroppedFile(file) {
      // ponytail: drops are read-only on web; DataTransferItem.getAsFileSystemHandle could make them writable.
      return { ref: null, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
    },
    async save(ref, bytes) {
      const rec = await tx<RecentRecord | undefined>('readonly', (s) => s.get(ref))
      if (!rec) throw new Error('Unknown file reference')
      if (!(await ensureWritable(rec.handle))) throw new Error('Write permission denied')
      await write(rec.handle, bytes)
    },
    async exportFile(suggestedName, bytes, type) {
      try {
        const handle = await window.showSaveFilePicker!({
          suggestedName,
          types: [{ description: type.description, accept: { [type.mime]: [`.${type.extension}`] } }],
        } as Parameters<NonNullable<typeof window.showSaveFilePicker>>[0])
        await write(handle, bytes)
        return true
      } catch (e) {
        if (isAbort(e)) return false
        throw e
      }
    },
    async saveAs(suggestedName, bytes) {
      try {
        const handle = await window.showSaveFilePicker!({ ...PDF_TYPES, suggestedName })
        await write(handle, bytes)
        return { ref: await remember(handle), name: handle.name }
      } catch (e) {
        if (isAbort(e)) return null
        throw e
      }
    },
    async openRecent(ref) {
      const rec = await tx<RecentRecord | undefined>('readonly', (s) => s.get(ref))
      if (!rec || !(await ensureWritable(rec.handle))) return null
      try {
        const opened = await readHandle(rec.handle, ref)
        await remember(rec.handle)
        return opened
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return null
        throw e
      }
    },
    async listRecent() {
      return (await allRecent()).map(({ ref, name, openedAt }) => ({ ref, name, openedAt }))
    },
    async removeRecent(ref) {
      await tx('readwrite', (s) => s.delete(ref))
    },
  }
}

/** Firefox/Safari: <input type=file> + download. No in-place save, no reopenable recents. */
function fallbackFiles(): FileSystemAdapter {
  return {
    capabilities: { saveInPlace: false, reopenRecent: false },
    openFile() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/pdf,.pdf'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resolve(null)
          file.arrayBuffer().then((b) => resolve({ ref: null, name: file.name, bytes: new Uint8Array(b) }), reject)
        }
        input.oncancel = () => resolve(null)
        input.click()
      })
    },
    async fromDroppedFile(file) {
      return { ref: null, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
    },
    async save() {
      throw new Error('Save in place is not supported in this browser')
    },
    async saveAs(suggestedName, bytes) {
      download(suggestedName, bytes, 'application/pdf')
      return { ref: null, name: suggestedName }
    },
    async exportFile(suggestedName, bytes, type) {
      download(suggestedName, bytes, type.mime)
      return true
    },
    async openRecent() {
      return null
    },
    async listRecent() {
      return []
    },
    async removeRecent() {},
  }
}

const shell: ShellAdapter = {
  async openExternal(url) {
    const safe = safeExternalUrl(url)
    if (!safe) throw new Error('Blocked URL scheme')
    window.open(safe, '_blank', 'noopener,noreferrer')
  },
}

export function createWebPlatform(): Platform {
  const hasFsAccess = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function'
  return { files: hasFsAccess ? fsAccessFiles() : fallbackFiles(), shell }
}

function download(name: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
