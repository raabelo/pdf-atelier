import { useEffect, useRef, type RefObject } from 'react'
import type { PdfSource, RenderOptions } from '@pdf-atelier/pdf'
import type { Rotation } from '@pdf-atelier/core'

/** Cancellation errors from pdf.js/our engine are expected when the view changes. */
export const isAbort = (e: unknown) =>
  e instanceof Error &&
  ['AbortError', 'AbortException', 'RenderingCancelledException'].includes(e.name)

export const logUnlessAbort = (e: unknown) => {
  if (!isAbort(e)) console.error(e)
}

/**
 * Renders a page into a canvas, serializing renders on the same canvas:
 * pdf.js rejects a new render() while a cancelled one has not settled yet.
 */
export function useCanvasRender(
  canvas: RefObject<HTMLCanvasElement | null>,
  pdf: PdfSource,
  index: number,
  opts: Omit<RenderOptions, 'signal'> & { rotation: Rotation },
) {
  const last = useRef<Promise<unknown>>(Promise.resolve())
  const { scale, rotation } = opts
  useEffect(() => {
    const ctrl = new AbortController()
    last.current = last.current
      .catch(() => {})
      .then(() =>
        ctrl.signal.aborted
          ? undefined
          : pdf.renderPage(index, canvas.current!, { scale, rotation, signal: ctrl.signal }),
      )
      .catch(logUnlessAbort)
    return () => ctrl.abort()
  }, [canvas, pdf, index, scale, rotation])
}
