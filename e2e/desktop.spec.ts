import { _electron as electron, expect, test } from '@playwright/test'
import { annotationRects, collectErrors, drawRect, dropPdf, makePdf } from './helpers'

test('desktop host runs the shared app with a locked-down bridge', async () => {
  const app = await electron.launch({ args: ['apps/desktop'] })
  const page = await app.firstWindow()
  const errors = collectErrors(page)
  await page.waitForLoadState('domcontentloaded')

  expect(page.url()).toMatch(/^app:\/\/pdf-atelier\//)
  const env = await page.evaluate(() => ({
    bridge: typeof window.pdfAtelier?.invoke,
    require: typeof (window as { require?: unknown }).require,
    process: typeof (window as { process?: unknown }).process,
  }))
  expect(env).toEqual({ bridge: 'function', require: 'undefined', process: 'undefined' })
  // IPC round-trip through main (sender validation + zod).
  expect(await page.evaluate(() => window.pdfAtelier!.invoke('files:listRecent'))).toBeInstanceOf(Array)
  // Channels outside the allowlist are rejected by the preload.
  await expect(
    page.evaluate(() => (window.pdfAtelier!.invoke as (c: string) => Promise<unknown>)('files:refForDroppedPath')),
  ).rejects.toThrow()

  await dropPdf(page, await makePdf(), 'desktop.pdf')
  await drawRect(page, 50, 50)
  await expect(annotationRects(page)).toHaveCount(1)
  expect(errors).toEqual([])
  // Dirty document: closing would show the native 'unsaved changes' dialog; exit the process directly.
  await app.evaluate(({ app }) => app.exit(0))
})
