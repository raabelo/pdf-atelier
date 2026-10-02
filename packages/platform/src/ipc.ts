import { z } from 'zod'

/**
 * IPC contract shared by preload/main (desktop) and the electron adapter (renderer).
 * Main validates every request against these schemas. The renderer never sends paths it chose:
 * it only holds opaque refs that main maps to paths the user picked through a dialog or drop.
 */
export const fileRef = z.string().min(1).max(200)
const bytes = z.instanceof(Uint8Array)
const opened = z.object({ ref: fileRef, name: z.string(), bytes })

export const ipc = {
  'files:open': { req: z.tuple([]), res: opened.nullable() },
  'files:save': { req: z.tuple([fileRef, bytes]), res: z.void() },
  'files:saveAs': {
    req: z.tuple([z.string().max(255), bytes]),
    res: z.object({ ref: fileRef, name: z.string() }).nullable(),
  },
  'files:openRecent': { req: z.tuple([fileRef]), res: opened.nullable() },
  'files:listRecent': {
    req: z.tuple([]),
    res: z.array(z.object({ ref: fileRef, name: z.string(), openedAt: z.number() })),
  },
  'files:removeRecent': { req: z.tuple([fileRef]), res: z.void() },
  /** Path of a dropped file (from webUtils.getPathForFile in preload) -> writable ref. */
  'files:refForDroppedPath': { req: z.tuple([z.string().min(1).max(4096)]), res: fileRef.nullable() },
  'shell:openExternal': { req: z.tuple([z.string().max(4096)]), res: z.void() },
} as const

export type IpcChannel = keyof typeof ipc
export type IpcReq<C extends IpcChannel> = z.infer<(typeof ipc)[C]['req']>
export type IpcRes<C extends IpcChannel> = z.infer<(typeof ipc)[C]['res']>

/** Shape exposed by preload as window.pdfAtelier. */
export interface DesktopBridge {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcReq<C>): Promise<IpcRes<C>>
  /** Path of a dropped File (Electron webUtils), or '' if unavailable. */
  pathForFile(file: File): string
}

declare global {
  interface Window {
    pdfAtelier?: DesktopBridge
  }
}
