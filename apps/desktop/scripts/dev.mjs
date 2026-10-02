// Dev: build main/preload, start the web app's Vite dev server, run Electron against it.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { createServer } from 'vite'
import { buildMain } from './build.mjs'

const desktopDir = fileURLToPath(new URL('..', import.meta.url))
const webDir = fileURLToPath(new URL('../../web', import.meta.url))

await buildMain({ dev: true })
const server = await createServer({ root: webDir, configFile: `${webDir}/vite.config.ts` })
await server.listen()
const url = server.resolvedUrls?.local[0]
if (!url) throw new Error('Vite dev server has no local URL')

const electron = spawn(electronPath, ['.'], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: { ...process.env, PDF_ATELIER_DEV_URL: url },
})

const stop = async (code = 0) => {
  electron.kill()
  await server.close()
  process.exit(code)
}
electron.on('exit', (code) => void stop(code ?? 0))
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
