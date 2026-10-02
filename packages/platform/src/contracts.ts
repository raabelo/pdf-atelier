/**
 * Platform contracts. The app only talks to these; web and electron implement them.
 * Capabilities are explicit: never promise what the runtime cannot do.
 */

/** Opaque reference to a file the user granted access to. Web: stored handle key; desktop: main-process id. */
export type FileRef = string

export interface OpenedFile {
  /** null when the file cannot be written back (web fallback, some dropped files). */
  ref: FileRef | null
  name: string
  bytes: Uint8Array
}

export interface RecentFile {
  ref: FileRef
  name: string
  openedAt: number
}

export interface FileSystemCapabilities {
  /** Save writes back to the opened file (otherwise Save behaves as Save As / download). */
  saveInPlace: boolean
  /** Recent files can be reopened without a picker. */
  reopenRecent: boolean
}

export interface FileSystemAdapter {
  readonly capabilities: FileSystemCapabilities
  /** Shows the open dialog. null = cancelled. */
  openFile(): Promise<OpenedFile | null>
  /** Converts a dropped DOM File; desktop also recovers a writable ref. */
  fromDroppedFile(file: File): Promise<OpenedFile>
  /** Writes to an existing ref. Only when capabilities.saveInPlace. */
  save(ref: FileRef, bytes: Uint8Array): Promise<void>
  /** Save dialog (or download). ref is null when the result is not writable again. null = cancelled. */
  saveAs(suggestedName: string, bytes: Uint8Array): Promise<{ ref: FileRef | null; name: string } | null>
  /**
   * Saves a non-document export (image, zip…) chosen by the user. No ref, not added to recents.
   * Returns false if cancelled.
   */
  exportFile(suggestedName: string, bytes: Uint8Array, type: ExportType): Promise<boolean>
  /** Only when capabilities.reopenRecent. null = file gone or permission denied. */
  openRecent(ref: FileRef): Promise<OpenedFile | null>
  listRecent(): Promise<RecentFile[]>
  removeRecent(ref: FileRef): Promise<void>
}

export interface ExportType {
  /** e.g. 'image/png' */
  mime: string
  /** Without dot, e.g. 'png' */
  extension: string
  /** Shown in the save dialog filter, e.g. 'PNG' */
  description: string
}

export interface ShellAdapter {
  /** Opens http(s)/mailto URLs outside the app. Implementations validate the scheme. */
  openExternal(url: string): Promise<void>
}

export interface Platform {
  files: FileSystemAdapter
  shell: ShellAdapter
  /** Commands from the native app menu (desktop only), e.g. 'file.open'. Returns unsubscribe. */
  onNativeCommand?(cb: (commandId: string) => void): () => void
  /** Files the OS asks the app to open ("Open with", double-click). Desktop only. Returns unsubscribe. */
  onOpenFile?(cb: (file: OpenedFile) => void): () => void
}
