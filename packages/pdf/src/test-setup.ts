/* eslint-disable @typescript-eslint/no-explicit-any -- polyfills */
// Test-only environment for pdf.js in Node 24 (browsers and Electron 44 have all of these natively).
import { beforeAll } from 'vitest'

;(Uint8Array.prototype as any).toHex ??= function (this: Uint8Array) {
  return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('')
}
// Used by pdf.js' AES-256 key derivation and page caches.
;(Math as any).sumPrecise ??= (xs: Iterable<number>) => [...xs].reduce((s, x) => s + x, 0)
;(Map.prototype as any).getOrInsertComputed ??= function <K, V>(this: Map<K, V>, k: K, fn: (k: K) => V) {
  if (!this.has(k)) this.set(k, fn(k))
  return this.get(k)
}

beforeAll(async () => {
  // Node has no Worker: run pdf.js's worker in-process.
  // @ts-expect-error the worker bundle ships no types
  ;(globalThis as any).pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs')
})
