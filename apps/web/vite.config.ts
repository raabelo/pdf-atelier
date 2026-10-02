import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { pathToFileURL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(join(root, 'packages/pdf/package.json'))
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'))

/** Static runtime assets: pdf.js data files under /pdfjs/, self-hosted TTS wasm under /tts/. */
async function assetMap(): Promise<{ from: string; to: string }[]> {
  const list = ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((d) => ({
    from: join(pdfjsDir, d),
    to: `pdfjs/${d}`,
  }))
  const ttsAssets = join(root, 'packages/tts/assets.ts')
  if (existsSync(ttsAssets)) {
    const { ttsAssetFiles } = (await import(pathToFileURL(ttsAssets).href)) as {
      ttsAssetFiles: { from: string; to: string }[]
    }
    for (const f of ttsAssetFiles)
      list.push({ from: join(root, 'node_modules', f.from), to: `tts/${f.to}` })
  }
  return list.filter((a) => existsSync(a.from))
}

function* walk(from: string, to: string): Generator<[string, string]> {
  if (statSync(from).isFile()) return yield [from, to]
  for (const name of readdirSync(from)) yield* walk(join(from, name), `${to}/${name}`)
}

function runtimeAssets(): Plugin {
  let files = new Map<string, string>()
  const load = async () => {
    files = new Map()
    for (const a of await assetMap())
      for (const [abs, url] of walk(a.from, a.to)) files.set(url, abs)
  }
  return {
    name: 'pdf-atelier-runtime-assets',
    async buildStart() {
      await load()
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''))
        const abs = files.get(path)
        if (!abs) return next()
        if (abs.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
        createReadStream(abs).pipe(res)
      })
    },
    generateBundle() {
      for (const [url, abs] of files)
        this.emitFile({ type: 'asset', fileName: url, source: readFileSync(abs) })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), runtimeAssets()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web', '@mintplex-labs/piper-tts-web'] },
  server: { fs: { allow: [root] } },
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
})
