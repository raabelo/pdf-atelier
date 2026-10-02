# TTS runtime assets

Piper needs these files served from the TTS base URL (default `/tts/`). They are self-hosted, so nothing loads from a CDN at runtime. The list lives in `assets.ts` as `ttsAssetFiles`; copy each entry at build time (and serve it in dev).

| From (`node_modules/…`) | To (`/tts/…`) | Size | License |
|---|---|---|---|
| `onnxruntime-web/dist/ort-wasm-simd-threaded.wasm` | `ort/ort-wasm-simd-threaded.wasm` | 13.6 MB | MIT |
| `onnxruntime-web/dist/ort-wasm-simd-threaded.mjs` | `ort/ort-wasm-simd-threaded.mjs` | 24 KB | MIT |
| `@diffusionstudio/piper-wasm/build/piper_phonemize.wasm` | `piper/piper_phonemize.wasm` | ~0.6 MB | espeak-ng: GPL-3.0 |
| `@diffusionstudio/piper-wasm/build/piper_phonemize.data` | `piper/piper_phonemize.data` | 18 MB | espeak-ng data: GPL-3.0 |

- **Dependency to add:** `@diffusionstudio/piper-wasm@1.0.0` (devDependency of the web app) provides the phonemizer files. `@mintplex-labs/piper-tts-web` only bundles the JS glue and defaults to jsDelivr.
- **Serving:**
  - Serve `.wasm` as `application/wasm`.
  - CSP `script-src` needs `'wasm-unsafe-eval'`.
- **Vite setup:**
  - Set `worker.format: 'es'`, because the worker uses dynamic imports.
  - Keep `onnxruntime-web` and `@mintplex-labs/piper-tts-web` in `optimizeDeps.exclude`.
- **Threads:** onnxruntime runs multi-threaded only when the page is `crossOriginIsolated` (COOP/COEP). Otherwise it falls back to one thread.

## Voice models

- **Where they come from:** downloaded on first use from `https://huggingface.co/diffusionstudio/piper-voices`, a mirror of `rhasspy/piper-voices`.
- **The URL is fixed:** it is hard-coded in the library as `HF_BASE`, with no option to override it.
- **CSP `connect-src`:** must allow `https://huggingface.co https://*.huggingface.co https://*.hf.co` (HF redirects LFS files to a CDN host).
- **Storage:** models are cached in OPFS under `piper/`.

| Voice | Lang | License | Attribution |
|---|---|---|---|
| `en_US-ljspeech-medium` | en-US | Public domain | — |
| `pt_BR-faber-medium` | pt-BR | CC0-1.0 | — |
| `es_ES-davefx-medium` | es-ES | CC0-1.0 | — |
| `fr_FR-siwis-medium` | fr-FR | CC-BY-4.0 | Required: show `Voice.attribution` in the voices UI |

Each model is about 63 MB.
