import { readFileSync } from 'node:fs'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { annotationRects, collectErrors, drawRect, dropPdf, makePdf } from './helpers'

test('open, annotate, undo, save and reopen keeps annotations', async ({ page }) => {
  // Force the non-Chromium fallback so Save produces a download instead of a native dialog.
  await page.addInitScript(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  const errors = collectErrors(page)
  await page.goto('/')
  await dropPdf(page, await makePdf(), 'teste.pdf')
  await expect(page.locator('.textLayer').first()).toContainText('Hello page 1')

  await drawRect(page, 50, 50)
  await expect(annotationRects(page)).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(annotationRects(page)).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(annotationRects(page)).toHaveCount(1)

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')])
  const saved = readFileSync((await download.path())!)

  await dropPdf(page, saved, 'reaberto.pdf')
  await expect(page.getByRole('tab', { name: /reaberto\.pdf/ })).toBeVisible()
  await expect(annotationRects(page)).toHaveCount(1)
  expect(errors).toEqual([])
})

test('page reorder and rotation survive save and reopen', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('/')
  await dropPdf(page, await makePdf(), 'pages.pdf')

  // Keyboard reorder on the thumbnails: page 3 to the top.
  await page.getByRole('button', { name: /^(Page|Página) 3$/ }).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await page.getByRole('button', { name: /^(Page|Página) 2$/ }).focus()
  await page.keyboard.press('Alt+ArrowUp')
  const first = page.getByRole('button', { name: /^(Page|Página) 1$/ })
  await first.hover()
  await first.getByRole('button', { name: /Rotate page|Girar página/ }).click()

  const firstPage = page.locator('[data-page-id]').first()
  await expect(firstPage.locator('.textLayer')).toContainText('Hello page 3')

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')])
  await dropPdf(page, readFileSync((await download.path())!), 'pages-reopened.pdf')
  await expect(page.getByRole('tab', { name: /pages-reopened\.pdf/ })).toBeVisible()
  await expect(firstPage.locator('.textLayer')).toContainText('Hello page 3')
  const box = (await firstPage.boundingBox())!
  expect(box.width).toBeGreaterThan(box.height) // 400x500 page rotated 90°
})

test('undo back to the saved state clears the dirty marker', async ({ page }) => {
  await page.goto('/')
  await dropPdf(page, await makePdf(1), 'dirty.pdf')
  const tab = page.getByRole('tab', { name: /dirty\.pdf/ })
  await expect(tab).not.toContainText('●')
  await drawRect(page, 50, 50)
  await expect(tab).toContainText('●')
  await page.keyboard.press('Control+z')
  await expect(tab).not.toContainText('●')
})

test('print rasterizes every page and calls window.print', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      ;(window as { printedPages?: number }).printedPages =
        document.querySelectorAll('#print-root img').length
      dispatchEvent(new Event('afterprint'))
    }
  })
  await page.goto('/')
  await dropPdf(page, await makePdf(3), 'print.pdf')
  await page.keyboard.press('Control+p')
  await page.waitForFunction(() => (window as { printedPages?: number }).printedPages !== undefined)
  expect(await page.evaluate(() => (window as { printedPages?: number }).printedPages)).toBe(3)
  await expect(page.locator('#print-root')).toHaveCount(0) // cleaned up after printing
})

const noNativePickers = (page: Page) =>
  page.addInitScript(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
const thumbs = (page: Page) => page.getByRole('button', { name: /^(Page|Página) \d+$/ })
async function pagesMenu(page: Page, item: RegExp) {
  await page.getByRole('button', { name: /^(Pages|Páginas)$/ }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('blank page, duplicate and bookmark survive save and reopen', async ({ page }) => {
  await noNativePickers(page)
  const errors = collectErrors(page)
  await page.goto('/')
  await dropPdf(page, await makePdf(2), 'ops.pdf')
  await pagesMenu(page, /Insert blank page|Inserir página em branco/)
  await expect(thumbs(page)).toHaveCount(3)
  await pagesMenu(page, /Duplicate pages|Duplicar páginas/)
  await expect(thumbs(page)).toHaveCount(4)
  await page.keyboard.press('Control+b')

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')])
  await dropPdf(page, readFileSync((await download.path())!), 'ops-reopened.pdf')
  await expect(page.getByRole('tab', { name: /ops-reopened\.pdf/ })).toBeVisible()
  await expect(thumbs(page)).toHaveCount(4)
  await page.getByRole('tab', { name: /^(Bookmarks|Favoritos)$/ }).click()
  await expect(page.getByRole('list', { name: /Bookmarks|Favoritos/ }).getByRole('listitem')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('extracting one page downloads a 1-page PDF', async ({ page }) => {
  await noNativePickers(page)
  await page.goto('/')
  await dropPdf(page, await makePdf(3), 'extract.pdf')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    pagesMenu(page, /Extract pages|Extrair páginas/),
  ])
  const pdf = await PDFDocument.load(readFileSync((await download.path())!))
  expect(pdf.getPageCount()).toBe(1)
})

test('regex search finds matches and highlights them in the text layer', async ({ page }) => {
  await page.goto('/')
  await dropPdf(page, await makePdf(3), 'search.pdf')
  await page.keyboard.press('Control+f')
  await page.getByLabel(/Regular expression|Expressão regular/).check()
  await page.locator('#search-input').fill(String.raw`page \d`)
  await page.locator('#search-input').press('Enter')
  await expect(page.getByRole('status').filter({ hasText: /3 (results|resultados)/ })).toBeVisible()
  await page.waitForFunction(() => (CSS.highlights.get('search')?.size ?? 0) > 0)
})

test('service worker registers for offline use', async ({ page }) => {
  await page.goto('/')
  const active = await page.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => r.active?.scriptURL ?? ''),
  )
  expect(active).toMatch(/sw\.js$/)
})

test('compressed copy downloads a smaller, equivalent PDF and reports the gain', async ({ page }) => {
  await noNativePickers(page)
  await page.goto('/')
  // Uncompressed source (no object streams, raw content) so there is something to gain.
  const src = await PDFDocument.load(await makePdf(3))
  const original = Buffer.from(await src.save({ useObjectStreams: false }))
  await dropPdf(page, original, 'grande.pdf')
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Alt+s')])
  expect(download.suggestedFilename()).toMatch(/grande-(comprimido|compressed)\.pdf/)
  const bytes = readFileSync((await download.path())!)
  expect(bytes.length).toBeLessThan(original.length)
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3)
  await expect(page.getByText(/−\d+%/)).toBeVisible()
})
