import { newId, type ImageAsset } from '@pdf-atelier/core'
import { openDB } from 'idb'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t, type MessageKey } from '../i18n/index.ts'
import { notify, useUi } from '../stores/ui.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/controls.tsx'
import { Dialog, IconButton } from '../ui/overlays.tsx'
import { imageUrl, placeImage, useImageUrlGc } from './images.ts'
import { CUSTOM_STAMP_COLOR, STAMPS, canvasToPng, renderStamp } from './stamp.ts'

/** Mounted once (toolbar): signature pad + stamp picker, opened via useUi.insertDialog. */
export function InsertDialogs() {
  const dialog = useUi((s) => s.insertDialog)
  useImageUrlGc()
  const close = () => useUi.setState({ insertDialog: null })
  return (
    <>
      <SignatureDialog open={dialog === 'signature'} onClose={close} />
      <StampDialog open={dialog === 'stamp'} onClose={close} />
    </>
  )
}

const asAsset = (bytes: Uint8Array, width: number, height: number): ImageAsset => ({
  id: newId(),
  mime: 'image/png',
  data: bytes,
  width,
  height,
})

// Saved signatures live in the app's IndexedDB key/value store (same DB as settings).
const kv = () => openDB('pdf-atelier', 1, { upgrade: (d) => void d.createObjectStore('kv') })
async function loadSignatures(): Promise<ImageAsset[]> {
  try {
    return ((await (await kv()).get('kv', 'signatures')) as ImageAsset[] | undefined) ?? []
  } catch {
    return []
  }
}
const storeSignatures = (list: ImageAsset[]) =>
  kv()
    .then((d) => d.put('kv', list, 'signatures'))
    .catch(() => {})

const INK = '#111827'
const PAD_W = 480
const PAD_H = 180

/** Copies the inked bounding box (+margin) of `src` into a new canvas. */
function crop(src: HTMLCanvasElement, box: { x0: number; y0: number; x1: number; y1: number }) {
  const m = 8
  const x = Math.max(0, Math.floor(box.x0 - m))
  const y = Math.max(0, Math.floor(box.y0 - m))
  const w = Math.min(src.width, Math.ceil(box.x1 + m)) - x
  const h = Math.min(src.height, Math.ceil(box.y1 + m)) - y
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h)
  return out
}

function typedSignature(name: string) {
  const font = 'italic 64px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive'
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = font
  const w = ctx.measureText(name).width
  c.width = Math.ceil(w + 24)
  c.height = 100
  ctx.font = font
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 12, 50)
  return c
}

function SignatureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [name, setName] = useState('')
  const [save, setSave] = useState(true)
  const [saved, setSaved] = useState<ImageAsset[]>([])
  const [inked, setInked] = useState(false)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const box = useRef({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (open) void loadSignatures().then(setSaved)
  }, [open])

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const setup = (c: HTMLCanvasElement | null) => {
    if (!c || canvas.current === c) return
    canvas.current = c
    c.width = PAD_W * dpr
    c.height = PAD_H * dpr
  }
  const clear = () => {
    const c = canvas.current
    c?.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    box.current = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    setInked(false)
  }

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * PAD_W * dpr, y: ((e.clientY - r.top) / r.height) * PAD_H * dpr }
  }
  const draw = (to: { x: number; y: number }) => {
    const ctx = canvas.current!.getContext('2d')!
    const from = last.current ?? to
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.5 * dpr
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.beginPath()
    // Midpoint quadratic smoothing between consecutive samples.
    ctx.moveTo(from.x, from.y)
    ctx.quadraticCurveTo(from.x, from.y, (from.x + to.x) / 2, (from.y + to.y) / 2)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    const b = box.current
    box.current = { x0: Math.min(b.x0, to.x), y0: Math.min(b.y0, to.y), x1: Math.max(b.x1, to.x), y1: Math.max(b.y1, to.y) }
    last.current = to
  }

  async function insert(asset: ImageAsset) {
    placeImage(asset, 'signature')
    onClose()
  }

  async function create() {
    const src = mode === 'draw' ? crop(canvas.current!, box.current) : typedSignature(name.trim())
    const asset = asAsset(await canvasToPng(src), src.width, src.height)
    if (save) {
      const list = [asset, ...saved].slice(0, 10)
      setSaved(list)
      await storeSignatures(list)
    }
    clear()
    setName('')
    await insert(asset)
  }

  const remove = (id: string) => {
    const list = saved.filter((s) => s.id !== id)
    setSaved(list)
    void storeSignatures(list)
  }

  const ready = mode === 'draw' ? inked : !!name.trim()
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('signature.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button disabled={!ready} onClick={() => void create().catch((e) => notify(String(e), true))}>
            {t('signature.insert')}
          </Button>
        </>
      }
    >
      <div className="mt-3 space-y-3 text-sm">
        {saved.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs text-muted-foreground">{t('signature.saved')}</h3>
            <ul className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <li key={s.id} className="flex items-center rounded-md border bg-white">
                  <button
                    className="p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={t('signature.useSaved')}
                    onClick={() => void insert({ ...s, id: newId() })}
                  >
                    <img src={imageUrl(s)} alt="" className="h-10 max-w-40 object-contain" />
                  </button>
                  <IconButton size="icon-sm" className="size-6" label={t('signature.delete')} onClick={() => remove(s.id)}>
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div role="radiogroup" aria-label={t('signature.title')} className="flex gap-1">
          {(['draw', 'type'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              role="radio"
              aria-checked={mode === m}
              variant={mode === m ? 'secondary' : 'ghost'}
              onClick={() => setMode(m)}
            >
              {t(`signature.${m}`)}
            </Button>
          ))}
        </div>
        {mode === 'draw' ? (
          <div>
            <canvas
              ref={setup}
              aria-label={t('signature.pad')}
              className="w-full touch-none rounded-md border bg-white"
              style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                last.current = null
                draw(point(e))
                setInked(true)
              }}
              onPointerMove={(e) => e.buttons === 1 && draw(point(e))}
              onPointerUp={() => (last.current = null)}
            />
            <Button size="sm" variant="ghost" onClick={clear}>
              {t('signature.clear')}
            </Button>
          </div>
        ) : (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('signature.namePlaceholder')}
            aria-label={t('signature.namePlaceholder')}
            style={{ fontFamily: '"Segoe Script", "Brush Script MT", cursive' }}
          />
        )}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          {t('signature.remember')}
        </label>
      </div>
    </Dialog>
  )
}

function StampDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [custom, setCustom] = useState('')
  async function insert(text: string, color: string) {
    try {
      const { bytes, width, height } = await renderStamp(text, color)
      placeImage(asAsset(bytes, width, height), 'stamp')
      onClose()
      setCustom('')
    } catch (e) {
      notify(String(e), true)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('stamp.title')}>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {STAMPS.map(([key, color]) => (
          <button
            key={key}
            onClick={() => void insert(t(key as MessageKey), color)}
            className="rounded-md border-[3px] px-2 py-1.5 text-sm font-bold tracking-wide uppercase hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            style={{ borderColor: color, color }}
          >
            {t(key as MessageKey)}
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (custom.trim()) void insert(custom, CUSTOM_STAMP_COLOR)
        }}
      >
        <Input
          value={custom}
          maxLength={40}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={t('stamp.custom')}
          aria-label={t('stamp.custom')}
        />
        <Button type="submit" disabled={!custom.trim()}>
          {t('stamp.insert')}
        </Button>
      </form>
    </Dialog>
  )
}
