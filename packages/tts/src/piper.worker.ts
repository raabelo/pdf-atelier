// Runs Piper (onnxruntime-web + espeak-ng phonemizer wasm) off the main thread.
// Models live in OPFS dir "piper" (the library's cache layout), fetched from Hugging Face on first use.
import { TtsSession, remove, stored } from '@mintplex-labs/piper-tts-web'

export type WorkerRequest =
  | { id: number; type: 'load'; voiceId: string; base: string }
  | { id: number; type: 'predict'; voiceId: string; base: string; text: string }
  | { id: number; type: 'remove'; voiceId: string }
  | { id: number; type: 'stored' }

export type WorkerResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'done'; result?: Blob | string[] }
  | { id: number; type: 'error'; message: string }

let session: TtsSession | null = null

async function getSession(voiceId: string, base: string, onProgress?: (l: number, t: number) => void) {
  if (session?.voiceId !== voiceId) {
    // The library keeps a singleton that never reloads the model on voice change; reset it.
    TtsSession._instance = null
    session = null
  }
  if (!session) {
    session = await TtsSession.create({
      voiceId,
      progress: (p) => {
        if (p.url.endsWith('.onnx')) onProgress?.(p.loaded, p.total)
      },
      wasmPaths: {
        onnxWasm: `${base}ort/`,
        piperWasm: `${base}piper/piper_phonemize.wasm`,
        piperData: `${base}piper/piper_phonemize.data`,
      },
    })
  }
  return session
}

const reply = (msg: WorkerResponse) => postMessage(msg)

addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'load':
        await getSession(msg.voiceId, msg.base, (loaded, total) =>
          reply({ id: msg.id, type: 'progress', loaded, total }),
        )
        return reply({ id: msg.id, type: 'done' })
      case 'predict': {
        const s = await getSession(msg.voiceId, msg.base)
        return reply({ id: msg.id, type: 'done', result: await s.predict(msg.text) })
      }
      case 'remove':
        if (session?.voiceId === msg.voiceId) {
          TtsSession._instance = null
          session = null
        }
        await remove(msg.voiceId)
        return reply({ id: msg.id, type: 'done' })
      case 'stored':
        return reply({ id: msg.id, type: 'done', result: await stored() })
    }
  } catch (err) {
    reply({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
