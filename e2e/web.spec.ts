import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
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
