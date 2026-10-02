import fontkit from '@cantoo/fontkit'
import latin from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url'
import latinExt from '@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff?url'
import greek from '@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff?url'
import greekExt from '@fontsource/noto-sans/files/noto-sans-greek-ext-400-normal.woff?url'
import cyrillic from '@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?url'
import cyrillicExt from '@fontsource/noto-sans/files/noto-sans-cyrillic-ext-400-normal.woff?url'
import vietnamese from '@fontsource/noto-sans/files/noto-sans-vietnamese-400-normal.woff?url'

/** Noto Sans (OFL) split by unicode range, as fontsource ships it. Latin first: it also provides the "?" fallback. */
export const NOTO_URLS = [latin, latinExt, greek, greekExt, cyrillic, cyrillicExt, vietnamese]

let fetchBytes: (url: string) => Promise<Uint8Array> = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status} ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Test hook: Node has no server behind Vite asset URLs. */
export function setFontFetcher(fn: (url: string) => Promise<Uint8Array>): void {
  fetchBytes = fn
  noto = null
}

let noto: Promise<Uint8Array[]> | null = null

/** Loaded once, only when some FreeText needs characters Helvetica/WinAnsi lacks. */
export function loadNotoSans(): Promise<Uint8Array[]> {
  noto ??= Promise.all(NOTO_URLS.map((u) => fetchBytes(u))).catch((e: unknown) => {
    noto = null
    throw e
  })
  return noto
}

/** fontkit build matching @cantoo/pdf-lib's subset API. */
export const pdfFontkit = fontkit
