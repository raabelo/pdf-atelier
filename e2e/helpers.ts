import type { Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'

export async function makePdf(pages = 3): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    pdf.addPage([400, 500]).drawText(`Hello page ${i + 1} PDF Atelier`, { x: 40, y: 440, size: 20, font })
  }
  return Buffer.from(await pdf.save())
}

/** Simulates dropping a PDF file onto the app. */
export async function dropPdf(page: Page, bytes: Buffer, name: string): Promise<void> {
  await page.evaluate(
    ({ b64, name }) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([data], name, { type: 'application/pdf' }))
      const target = document.querySelector('main') ?? document.body
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { b64: bytes.toString('base64'), name },
  )
  await page.waitForSelector('[data-page-id] canvas', { timeout: 20_000 })
}

export async function drawRect(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('r')
  const box = (await page.locator('[data-page-id]').first().boundingBox())!
  await page.mouse.move(box.x + x, box.y + y)
  await page.mouse.down()
  await page.mouse.move(box.x + x + 100, box.y + y + 70, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('v')
}

export const annotationRects = (page: Page) => page.locator('[data-page-id] svg rect[stroke]')

export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}
