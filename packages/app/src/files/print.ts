import { loadPdf, type PdfSource } from '@pdf-atelier/pdf'
import { t } from '../i18n/index.ts'
import { activeDoc } from '../stores/documents.ts'
import { notify, useUi } from '../stores/ui.ts'
import { exportDoc } from './actions.ts'

const PRINT_DPI = 150

/**
 * Prints exactly what Save would write: export with annotations, rasterize every page,
 * then window.print() a print-only container. Same code in web and desktop.
 */
export async function printDoc(doc = activeDoc()) {
  if (!doc) return
  const ctrl = new AbortController()
  const root = document.createElement('div')
  root.id = 'print-root'
  const urls: string[] = []
  const cleanup = () => {
    root.remove()
    urls.forEach((u) => URL.revokeObjectURL(u))
  }
  const progress = (value: number) =>
    useUi.setState({ progress: { label: t('print.preparing'), value, cancel: () => ctrl.abort() } })

  let pdf: PdfSource | undefined
  progress(0)
  try {
    pdf = await loadPdf(await exportDoc(doc))
    // ponytail: every page is held as a PNG until the dialog closes (~1-2 MB each at 150 DPI);
    // 1000+ page documents need page ranges or chunked printing.
    for (let i = 0; i < pdf.pageCount; i++) {
      if (ctrl.signal.aborted) throw new DOMException('cancelled', 'AbortError')
      const canvas = document.createElement('canvas')
      await pdf.renderPage(i, canvas, {
        scale: PRINT_DPI / 72 / devicePixelRatio,
        rotation: pdf.pages[i]!.rotation,
        signal: ctrl.signal,
      })
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      canvas.width = 0 // release the bitmap now
      if (!blob) throw new Error('canvas.toBlob failed')
      const img = new Image()
      img.alt = ''
      img.src = urls[urls.push(URL.createObjectURL(blob)) - 1]!
      root.append(img)
      progress((i + 1) / pdf.pageCount)
    }
    await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode()))
    document.body.append(root)
    useUi.setState({ progress: null })
    addEventListener('afterprint', cleanup, { once: true })
    window.print()
  } catch (e) {
    cleanup()
    if (!(e instanceof DOMException && e.name === 'AbortError'))
      notify(t('error.print', { message: e instanceof Error ? e.message : String(e) }), true)
  } finally {
    useUi.setState({ progress: null })
    void pdf?.destroy()
  }
}
