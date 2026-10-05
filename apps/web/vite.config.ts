import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { pathToFileURL } from 'node:url'
import { defaultClientConditions, defineConfig, type Plugin } from 'vite'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(join(root, 'packages/pdf/package.json'))
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'))
/** Single version source: the desktop package (installer version). */
const version = (JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')) as { version: string }).version

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
        // Module scripts (onnxruntime's .mjs loader) are rejected without a JS MIME type.
        if (abs.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript')
        createReadStream(abs).pipe(res)
      })
    },
    generateBundle() {
      for (const [url, abs] of files)
        this.emitFile({ type: 'asset', fileName: url, source: readFileSync(abs) })
    },
  }
}

/**
 * Precache list for public/sw.js: the built app shell. pdf.js data and TTS wasm (/pdfjs/, /tts/)
 * are cached on first use instead. `version` changes whenever any shell file changes.
 */
function swManifest(): Plugin {
  return {
    name: 'pdf-atelier-sw-manifest',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const hash = createHash('sha256')
        const files = Object.values(bundle)
          .filter((f) => !/^(pdfjs|tts)\//.test(f.fileName))
          .map((f) => {
            hash.update(f.fileName).update(f.type === 'chunk' ? f.code : f.source)
            return f.fileName
          })
        files.push('manifest.webmanifest', 'icons/icon.svg', 'icons/icon-256.png')
        this.emitFile({
          type: 'asset',
          fileName: 'sw-manifest.json',
          source: JSON.stringify({ version: hash.digest('hex').slice(0, 16), files: files.sort() }),
        })
      },
    },
  }
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss(), runtimeAssets(), swManifest()],
  // onnxruntime-web: use the build that loads its wasm from wasmPaths (/tts/ort/) instead of bundling a 2nd copy.
  // transformers.js imports onnxruntime-web/webgpu, whose wasm differs from Piper's; use the CPU wasm build so both share /tts/ort/.
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
    alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: 'onnxruntime-web/wasm' }],
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web', '@mintplex-labs/piper-tts-web', '@huggingface/transformers'] },
  server: { fs: { allow: [root] } },
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
})
