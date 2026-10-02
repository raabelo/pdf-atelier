/** Predefined stamps: label key -> color. Custom text uses the neutral color. */
export const STAMPS = [
  ['stamp.approved', '#16a34a'],
  ['stamp.rejected', '#dc2626'],
  ['stamp.draft', '#2563eb'],
  ['stamp.confidential', '#dc2626'],
  ['stamp.reviewed', '#7c3aed'],
  ['stamp.final', '#111111'],
] as const

export const CUSTOM_STAMP_COLOR = '#ea580c'

const FONT_PX = 48
const PAD_X = 28
const PAD_Y = 16
const BORDER = 6
export const STAMP_FONT = `700 ${FONT_PX}px Helvetica, Arial, sans-serif`

/** Canvas size for a stamp, given the measured text width. Pure: the testable part of the layout. */
export function stampSize(textWidth: number) {
  return {
    width: Math.ceil(textWidth + 2 * (PAD_X + BORDER)),
    height: FONT_PX + 2 * (PAD_Y + BORDER),
  }
}

/** Renders a stamp (rounded colored border + bold uppercase text) to PNG bytes. */
export async function renderStamp(text: string, color: string) {
  const label = text.trim().toUpperCase()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = STAMP_FONT
  const { width, height } = stampSize(ctx.measureText(label).width)
  canvas.width = width
  canvas.height = height
  ctx.font = STAMP_FONT // resizing resets the context
  ctx.strokeStyle = ctx.fillStyle = color
  ctx.lineWidth = BORDER
  ctx.beginPath()
  ctx.roundRect(BORDER / 2, BORDER / 2, width - BORDER, height - BORDER, 14)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, width / 2, height / 2 + 2)
  return { bytes: await canvasToPng(canvas), width, height }
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('canvas.toBlob failed')
  return new Uint8Array(await blob.arrayBuffer())
}
