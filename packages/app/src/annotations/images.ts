import { docOps, newId, type ImageAnnotation, type ImageAsset } from '@pdf-atelier/core'
import { useEffect } from 'react'
import { t } from '../i18n/index.ts'
import { activeDoc, useDocuments } from '../stores/documents.ts'
import { notify, useUi, viewOf } from '../stores/ui.ts'
import { canvasToPng } from './stamp.ts'

const MAX_PX = 2000

/** Decodes a PNG/JPEG file, downscaling (re-encoded in the same format) when larger than MAX_PX. */
export async function fileToAsset(file: File): Promise<ImageAsset> {
  const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') throw new Error(file.type || file.name)
  const bitmap = await createImageBitmap(file)
  const k = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * k)
  const height = Math.round(bitmap.height * k)
  let data: Uint8Array = new Uint8Array(await file.arrayBuffer())
  if (k < 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
    if (mime === 'image/png') data = await canvasToPng(canvas)
    else {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
      data = new Uint8Array(await blob!.arrayBuffer())
    }
  }
  bitmap.close()
  return { id: newId(), mime, data, width, height }
}

const MAX_SHARE: Record<ImageAnnotation['kind'], number> = { image: 0.6, signature: 0.35, stamp: 0.35 }

/** Adds the asset + an image annotation centered on the current page of the active document. */
export function placeImage(asset: ImageAsset, kind: ImageAnnotation['kind']) {
  const doc = activeDoc()
  if (!doc) return
  const { pages } = doc.history.present
  const page = pages[Math.min(viewOf(doc.id).page, pages.length - 1)]!
  const k = Math.min(
    (page.width * MAX_SHARE[kind]) / asset.width,
    (page.height * MAX_SHARE[kind]) / asset.height,
    1,
  )
  const width = asset.width * k
  const height = asset.height * k
  const now = Date.now()
  const a: ImageAnnotation = {
    id: newId(),
    type: 'image',
    kind,
    pageId: page.id,
    imageId: asset.id,
    rect: { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height },
    style: { ...useUi.getState().styles.image },
    createdAt: now,
    updatedAt: now,
  }
  useDocuments.getState().change(`add ${kind}`, (d) => {
    docOps.addImage(d, asset)
    docOps.addAnnotations(d, [a])
  })
  useUi.setState({ tool: 'select', selection: [a.id], editing: null })
}

/** Opens the native file picker for PNG/JPEG and places the chosen image. Works in both runtimes. */
export function pickImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      placeImage(await fileToAsset(file), 'image')
    } catch (e) {
      notify(t('error.image', { message: e instanceof Error ? e.message : String(e) }), true)
    }
  }
  input.click()
}

/** Object URLs per image id, shared by every page view; never revoked while the asset may still render. */
const urls = new Map<string, { url: string; data: Uint8Array }>()

export function imageUrl(asset: ImageAsset): string {
  const hit = urls.get(asset.id)
  if (hit && hit.data === asset.data) return hit.url
  if (hit) URL.revokeObjectURL(hit.url)
  const url = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mime }))
  urls.set(asset.id, { url, data: asset.data })
  return url
}

/** Revokes URLs of assets no open document has any more (imageUrl recreates them if undo brings one back). */
export function useImageUrlGc() {
  const docs = useDocuments((s) => s.docs)
  useEffect(() => {
    const live = new Set(docs.flatMap((d) => Object.keys(d.history.present.images ?? {})))
    for (const [id, { url }] of urls)
      if (!live.has(id)) {
        URL.revokeObjectURL(url)
        urls.delete(id)
      }
  }, [docs])
}
