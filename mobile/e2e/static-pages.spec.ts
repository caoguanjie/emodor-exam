import { expect, test } from '@playwright/test'
import { routeCatalog } from '../src/fixtures/route-catalog'

for (const width of [320, 430]) {
  test(`all static routes fit a ${width}px viewport`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 844 })

    let errors: string[] = []
    let failures: string[] = []
    let apiRequests: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('response', response => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
    })
    page.on('requestfailed', request => failures.push(`${request.url()} ${request.failure()?.errorText || ''}`))
    page.on('request', request => {
      if (request.url().includes('/api/v1/')) apiRequests.push(request.url())
    })

    for (const route of routeCatalog) {
      errors = []
      failures = []
      apiRequests = []
      await page.goto('about:blank')
      await page.goto(`/#${route.path}?scenario=${route.scenario}`)
      await expect(page.getByText(route.expectedText, { exact: false }).first()).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(errors, `${route.scenario} console/page errors`).toEqual([])
      expect(failures, `${route.scenario} failed resources`).toEqual([])
      expect(apiRequests, `${route.scenario} unexpected API requests`).toEqual([])
    }
  })
}
