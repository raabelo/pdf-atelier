import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { MENU_COMMAND_CHANNEL, RENDERER_CHANNELS, type DesktopBridge } from '@pdf-atelier/platform'

const allowed = new Set<string>(RENDERER_CHANNELS)

const bridge: DesktopBridge = {
  invoke: ((channel: string, ...args: unknown[]) => {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  }) as DesktopBridge['invoke'],
  async refForDroppedFile(file) {
    const path = webUtils.getPathForFile(file)
    return path ? ipcRenderer.invoke('files:refForDroppedPath', path) : null
  },
  onMenuCommand(cb) {
    const listener = (_e: unknown, id: unknown) => {
      if (typeof id === 'string') cb(id)
    }
    ipcRenderer.on(MENU_COMMAND_CHANNEL, listener)
    return () => ipcRenderer.off(MENU_COMMAND_CHANNEL, listener)
  },
}

contextBridge.exposeInMainWorld('pdfAtelier', bridge)
