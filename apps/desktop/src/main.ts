import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type IpcMainInvokeEvent } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { ipc, MENU_COMMAND_CHANNEL, OPEN_REQUEST_CHANNEL, safeExternalUrl, type IpcChannel, type IpcReq, type IpcRes } from '@pdf-atelier/platform'
import { assertPdfFile, FileRegistry, isPdfPath, readPdf, resolveInside, writeAtomic } from './files.ts'

const SCHEME = 'app'
const HOST = 'pdf-atelier'
const APP_ORIGIN = `${SCHEME}://${HOST}`
const DEV_URL = process.env.PDF_ATELIER_DEV_URL
const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }]

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://huggingface.co https://*.hf.co blob: data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

// Must run before app is ready. `standard` gives app:// a real origin (IndexedDB/OPFS), `secure` a secure context.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
])

if (!app.requestSingleInstanceLock()) app.quit()

const webRoot = app.isPackaged ? join(process.resourcesPath, 'web') : join(__dirname, '../../web/dist')
const files = new FileRegistry(join(app.getPath('userData'), 'recent.json'))
let win: BrowserWindow | null = null
/** Refs of files the OS asked us to open, waiting for the renderer to pull them. */
let pendingOpen: string[] = []

/** Queues PDFs passed on the command line ("Open with", double-click, second instance). */
async function queueArgvFiles(argv: readonly string[]): Promise<void> {
  for (const arg of argv) {
    if (!isPdfPath(arg)) continue // skips the exe, '.', and Chromium flags
    try {
      await assertPdfFile(arg)
    } catch {
      continue
    }
    const ref = files.grant(arg)
    await files.touch(ref)
    pendingOpen.push(ref)
  }
  if (pendingOpen.length) win?.webContents.send(OPEN_REQUEST_CHANNEL)
}

function serveApp(): void {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url)
    const file = url.host === HOST ? resolveInside(webRoot, url.pathname === '/' ? '/index.html' : url.pathname) : null
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, {
        headers: {
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

// Node's URL.origin is "null" for custom schemes like app://, so compare protocol + host instead.
const originOf = (url: string) => {
  const u = new URL(url)
  return `${u.protocol}//${u.host}`
}
const allowedOrigins = new Set([APP_ORIGIN, ...(DEV_URL ? [originOf(DEV_URL)] : [])])

function assertTrustedSender(e: IpcMainInvokeEvent): void {
  const frame = e.senderFrame
  if (!frame || frame.parent !== null || !allowedOrigins.has(originOf(frame.url))) {
    throw new Error('Untrusted IPC sender')
  }
}

function handle<C extends IpcChannel>(channel: C, fn: (...args: IpcReq<C>) => Promise<IpcRes<C>>): void {
  ipcMain.handle(channel, (e, ...args: unknown[]) => {
    assertTrustedSender(e)
    return fn(...(ipc[channel].req.parse(args) as IpcReq<C>))
  })
}

async function openGranted(ref: string) {
  const path = files.pathFor(ref)
  if (!path) return null
  try {
    const bytes = await readPdf(path)
    await files.touch(ref)
    return { ref, name: basename(path), bytes }
  } catch {
    return null
  }
}

function registerIpc(): void {
  handle('files:open', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: PDF_FILTERS })
    const path = r.filePaths[0]
    if (r.canceled || !path) return null
    return openGranted(files.grant(path))
  })
  handle('files:save', async (ref, bytes) => {
    const path = files.pathFor(ref)
    if (!path) throw new Error('Unknown file reference')
    await writeAtomic(path, bytes)
  })
  handle('files:saveAs', async (name, bytes) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: basename(name), filters: PDF_FILTERS })
    if (r.canceled || !r.filePath) return null
    const path = isPdfPath(r.filePath) ? r.filePath : `${r.filePath}.pdf`
    await writeAtomic(path, bytes)
    const ref = files.grant(path)
    await files.touch(ref)
    return { ref, name: basename(path) }
  })
  handle('files:openRecent', async (ref) => (files.isRecent(ref) ? openGranted(ref) : null))
  handle('files:listRecent', async () => files.list().map(({ ref, name, openedAt }) => ({ ref, name, openedAt })))
  handle('files:removeRecent', async (ref) => files.remove(ref))
  handle('files:refForDroppedPath', async (path) => {
    try {
      await assertPdfFile(path)
    } catch {
      return null
    }
    const ref = files.grant(path)
    await files.touch(ref)
    return ref
  })
  handle('files:takePending', async () => {
    const refs = pendingOpen
    pendingOpen = []
    const opened = await Promise.all(refs.map(openGranted))
    return opened.filter((f) => f !== null)
  })
  handle('shell:openExternal', async (url) => {
    const safe = safeExternalUrl(url)
    if (!safe) throw new Error('Blocked URL scheme')
    await shell.openExternal(safe)
  })
}

function buildMenu(): void {
  const pt = app.getLocale().startsWith('pt')
  const t = (en: string, ptBr: string) => (pt ? ptBr : en)
  // Accelerators are shown but not registered: the shared app's shortcut registry handles keys in both runtimes.
  const cmd = (label: string, id: string, accelerator?: string): Electron.MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => win?.webContents.send(MENU_COMMAND_CHANNEL, id),
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: t('&File', '&Arquivo'),
        submenu: [
          cmd(t('Open…', 'Abrir…'), 'file.open', 'CmdOrCtrl+O'),
          cmd(t('Save', 'Salvar'), 'file.save', 'CmdOrCtrl+S'),
          cmd(t('Save As…', 'Salvar como…'), 'file.saveAs', 'CmdOrCtrl+Shift+S'),
          { type: 'separator' },
          cmd(t('Print…', 'Imprimir…'), 'file.print', 'CmdOrCtrl+P'),
          { type: 'separator' },
          { role: 'quit', label: t('Exit', 'Sair') },
        ],
      },
      {
        label: t('&Edit', '&Editar'),
        submenu: [
          cmd(t('Undo', 'Desfazer'), 'edit.undo', 'CmdOrCtrl+Z'),
          cmd(t('Redo', 'Refazer'), 'edit.redo', 'CmdOrCtrl+Shift+Z'),
          { type: 'separator' },
          { role: 'cut', label: t('Cut', 'Recortar') },
          { role: 'copy', label: t('Copy', 'Copiar') },
          { role: 'paste', label: t('Paste', 'Colar') },
          { type: 'separator' },
          cmd(t('Find…', 'Buscar…'), 'edit.find', 'CmdOrCtrl+F'),
        ],
      },
      {
        label: t('&View', '&Exibir'),
        submenu: [
          cmd(t('Zoom In', 'Ampliar'), 'view.zoomIn', 'CmdOrCtrl+='),
          cmd(t('Zoom Out', 'Reduzir'), 'view.zoomOut', 'CmdOrCtrl+-'),
          cmd(t('Toggle Sidebar', 'Alternar barra lateral'), 'view.toggleSidebar'),
          { type: 'separator' },
          { role: 'togglefullscreen', label: t('Full Screen', 'Tela cheia') },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const, { role: 'reload' } as const]),
        ],
      },
      { label: t('&Help', 'Aj&uda'), submenu: [cmd(t('About PDF Atelier', 'Sobre o PDF Atelier'), 'help.about')] },
    ]),
  )
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'PDF Atelier',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  // The app cancels unload while a tab is dirty; Electron would then silently refuse to close. Ask natively.
  win.webContents.on('will-prevent-unload', (e) => {
    const pt = app.getLocale().startsWith('pt')
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'warning',
      buttons: pt ? ['Sair sem salvar', 'Cancelar'] : ['Quit without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: pt ? 'Há documentos com alterações não salvas.' : 'Some documents have unsaved changes.',
    })
    if (choice === 0) e.preventDefault() // ignores the renderer's beforeunload veto
  })
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`)
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault())
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

app.on('second-instance', (_e, argv) => {
  void queueArgvFiles(argv)
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.on('window-all-closed', () => app.quit())

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
  await files.load()
  serveApp()
  registerIpc()
  buildMenu()
  createWindow()
  await queueArgvFiles(process.argv)
})
