import { rotateSize, type Annotation, type PageModel, type Rotation } from '@pdf-atelier/core'
import { memo, useEffect, useRef } from 'react'
import { t } from '../i18n/index.ts'
import type { OpenDoc } from '../stores/documents.ts'
import { blankSource } from '../files/blank.ts'
import { AnnotationLayer } from './AnnotationLayer.tsx'
import { logUnlessAbort, useCanvasRender } from './useCanvasRender.ts'

interface Props {
  doc: OpenDoc
  page: PageModel
  index: number
  rotation: Rotation
  scale: number
  annotations: Annotation[]
}

export const PageView = memo(function PageView({
  doc,
  page,
  index,
  rotation,
  scale,
  annotations,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  // Blank inserted pages (BLANK_SOURCE) draw nothing; the fallback also covers docs without that entry.
  const pdf = (doc.sources.get(page.sourceId) ?? blankSource).pdf
  const size = rotateSize(page.width * scale, page.height * scale, rotation)

  useCanvasRender(canvasRef, pdf, page.sourceIndex, { scale, rotation })

  useEffect(() => {
    const container = textRef.current!
    const ctrl = new AbortController()
    let cleanup: (() => void) | undefined
    pdf
      .renderTextLayer(page.sourceIndex, container, { scale, rotation, signal: ctrl.signal })
      .then((c) => (ctrl.signal.aborted ? c() : (cleanup = c)), logUnlessAbort)
    return () => {
      ctrl.abort()
      cleanup?.()
      container.replaceChildren() // a cancelled layer may have appended spans already
    }
  }, [pdf, page.sourceIndex, scale, rotation])

  return (
    <div
      data-page-id={page.id}
      role="group"
      aria-label={t('page.label', { n: index + 1 })}
      className="relative mx-auto bg-white shadow-md"
      style={{ width: size.width, height: size.height }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div ref={textRef} className="absolute inset-0" />
      <AnnotationLayer
        doc={doc}
        page={page}
        rotation={rotation}
        scale={scale}
        annotations={annotations}
      />
    </div>
  )
})
