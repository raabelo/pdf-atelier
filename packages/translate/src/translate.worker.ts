// Runs Opus-MT (transformers.js on onnxruntime-web wasm) off the main thread.
// Models download from Hugging Face on first use and stay in the browser cache ("transformers-cache").
import { env, pipeline, Tensor, type TranslationPipeline } from '@huggingface/transformers'
import type { Step } from './index.ts'

export type WorkerRequest =
  | { id: number; type: 'load'; base: string; model: string }
  | { id: number; type: 'translate'; base: string; steps: Step[]; text: string }

export type WorkerResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'done'; result: string }
  | { id: number; type: 'error'; message: string }

env.allowLocalModels = false

/** Loaded pipelines, oldest first. A pivot pair needs two at once; keep no more than that in memory. */
const pipes = new Map<string, Promise<TranslationPipeline>>()

function load(model: string, base: string, onProgress?: (loaded: number, total: number) => void) {
  // Same self-hosted onnxruntime wasm Piper uses (no CDN).
  env.backends.onnx.wasm!.wasmPaths = `${base}ort/`
  let p = pipes.get(model)
  if (p) {
    pipes.delete(model) // re-insert as most recent
  } else {
    p = pipeline('translation', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (e) => {
        if (e.status === 'progress_total') onProgress?.(e.loaded, e.total)
      },
    }) as Promise<TranslationPipeline>
    p.catch(() => pipes.delete(model))
  }
  pipes.set(model, p)
  while (pipes.size > 2) {
    const [oldest, q] = pipes.entries().next().value!
    pipes.delete(oldest)
    void q.then((x) => x.dispose()).catch(() => {})
  }
  return p
}

/**
 * transformers.js v4 tokenizes a ">>lang<<" prefix as plain text (MarianTokenizer's override is
 * never called), so encode without it and put the language token id first ourselves.
 */
async function run(pipe: TranslationPipeline, token: string, text: string) {
  if (!token) {
    const [out] = (await pipe(text)) as { translation_text: string }[]
    return out!.translation_text
  }
  const lang = pipe.tokenizer.get_vocab().get(token)
  if (lang === undefined) throw new Error(`Unknown language token ${token}`)
  const ids = [BigInt(lang), ...(pipe.tokenizer(text).input_ids as Tensor).tolist()[0]!.map(BigInt)]
  const input_ids = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length])
  const attention_mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [
    1,
    ids.length,
  ])
  const out = await pipe.model.generate({ input_ids, attention_mask })
  return pipe.tokenizer.batch_decode(out as Tensor, { skip_special_tokens: true })[0]!
}

async function translate(steps: Step[], base: string, text: string) {
  for (const s of steps) text = await run(await load(s.model, base), s.token, text)
  return text
}

const reply = (msg: WorkerResponse) => postMessage(msg)

addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      await load(msg.model, msg.base, (loaded, total) =>
        reply({ id: msg.id, type: 'progress', loaded, total }),
      )
      return reply({ id: msg.id, type: 'done', result: '' })
    }
    reply({ id: msg.id, type: 'done', result: await translate(msg.steps, msg.base, msg.text) })
  } catch (err) {
    reply({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
