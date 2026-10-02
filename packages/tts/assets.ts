/**
 * Runtime files Piper needs, self-hosted under the TTS assets base URL (default '/tts/') so nothing
 * loads from a CDN. `from` is relative to the repo's node_modules. Import from build configs only.
 */
export const ttsAssetFiles: { from: string; to: string }[] = [
  { from: 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', to: 'ort/ort-wasm-simd-threaded.wasm' },
  { from: 'onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', to: 'ort/ort-wasm-simd-threaded.mjs' },
  { from: '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', to: 'piper/piper_phonemize.wasm' },
  { from: '@diffusionstudio/piper-wasm/build/piper_phonemize.data', to: 'piper/piper_phonemize.data' },
]
