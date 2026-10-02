import { z } from 'zod'

/**
 * IPC contract shared by preload/main (desktop) and the electron adapter (renderer).
 * Main validates every request against these schemas. The renderer never sends paths it chose:
 * it only holds opaque refs that main maps to paths the user picked through a dialog or drop.
 */
export const fileRef = z.string().min(1).max(200)
const bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'Expected Uint8Array')
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
  /** Preload-internal (not callable via bridge.invoke): dropped file path -> writable ref. */
  'files:refForDroppedPath': { req: z.tuple([z.string().min(1).max(4096)]), res: fileRef.nullable() },
  /** Files the OS asked us to open (argv / second instance), drained once. */
  'files:takePending': { req: z.tuple([]), res: z.array(opened) },
  'shell:openExternal': { req: z.tuple([z.string().max(4096)]), res: z.void() },
} as const

/** Channels the renderer may call through bridge.invoke. */
export const RENDERER_CHANNELS = Object.keys(ipc).filter((c) => c !== 'files:refForDroppedPath') as Exclude<
  keyof typeof ipc,
  'files:refForDroppedPath'
>[]

export type IpcChannel = keyof typeof ipc
export type RendererChannel = (typeof RENDERER_CHANNELS)[number]
export type IpcReq<C extends IpcChannel> = z.infer<(typeof ipc)[C]['req']>
export type IpcRes<C extends IpcChannel> = z.infer<(typeof ipc)[C]['res']>

/** Shape exposed by preload as window.pdfAtelier. */
export interface DesktopBridge {
  invoke<C extends RendererChannel>(channel: C, ...args: IpcReq<C>): Promise<IpcRes<C>>
  /**
   * Writable ref for a dropped File, or null. The path is resolved inside preload (webUtils),
   * so the renderer can never ask main for an arbitrary path.
   */
  refForDroppedFile(file: File): Promise<string | null>
  /** Native menu commands (main -> renderer). Returns unsubscribe. */
  onMenuCommand(cb: (commandId: string) => void): () => void
  /** Nudge from main that OS open requests are pending (pull them with 'files:takePending'). */
  onOpenRequest(cb: () => void): () => void
}

/** main -> renderer event channel for native menu commands. */
export const MENU_COMMAND_CHANNEL = 'menu:command'
/** main -> renderer nudge: files from the OS are waiting in 'files:takePending'. */
export const OPEN_REQUEST_CHANNEL = 'file:open-request'

declare global {
  interface Window {
    pdfAtelier?: DesktopBridge
  }
}
