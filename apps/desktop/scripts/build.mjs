// Bundles main + preload to CommonJS (sandboxed preloads cannot load ESM).
// The renderer is the web app build (apps/web/dist), loaded via app:// — no copy needed.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

export function buildMain({ dev = false } = {}) {
  return build({
    absWorkingDir: root,
    entryPoints: { main: 'src/main.ts', preload: 'src/preload.ts' },
    outdir: 'out',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    logLevel: 'info',
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildMain()
