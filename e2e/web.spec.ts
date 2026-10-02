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
