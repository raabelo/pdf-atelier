import type { Platform } from '../contracts.ts'
import type { DesktopBridge } from '../ipc.ts'

/** Renderer side of the desktop runtime: every call goes through the preload bridge to main. */
export function createElectronPlatform(bridge: DesktopBridge): Platform {
  return {
    files: {
      capabilities: { saveInPlace: true, reopenRecent: true },
      openFile: () => bridge.invoke('files:open'),
      async fromDroppedFile(file) {
        const [bytes, ref] = await Promise.all([file.arrayBuffer(), bridge.refForDroppedFile(file)])
        return { ref, name: file.name, bytes: new Uint8Array(bytes) }
      },
      save: (ref, bytes) => bridge.invoke('files:save', ref, bytes),
      saveAs: (name, bytes) => bridge.invoke('files:saveAs', name, bytes),
      openRecent: (ref) => bridge.invoke('files:openRecent', ref),
      listRecent: () => bridge.invoke('files:listRecent'),
      removeRecent: (ref) => bridge.invoke('files:removeRecent', ref),
    },
    shell: { openExternal: (url) => bridge.invoke('shell:openExternal', url) },
    onNativeCommand: (cb) => bridge.onMenuCommand(cb),
  }
}
