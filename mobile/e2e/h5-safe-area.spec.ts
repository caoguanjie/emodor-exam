import { expect, test } from '@playwright/test'

test('browser-owned top inset does not push H5 navigation down', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await page.goto('/#/pages/profile/wrong-book?scenario=exam-wrong-book')
  await expect(page.locator('.wrong-card').first()).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.head).display)).toBe('none')
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 44, bottom: 20, left: 0, right: 0 },
  })
  const bar = page.locator('.top-bar')
  await expect(bar).toBeVisible()
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=contain/)
  // Confirm the browser actually reports the nonzero inset under test.
  const probe = await page.evaluate(() => {
    const element = document.createElement('div')
    element.style.paddingTop = 'env(safe-area-inset-top)'
    document.body.append(element)
    const value = getComputedStyle(element).paddingTop
    element.remove()
    return value
  })
  expect(probe).toBe('44px')
  await expect(page.locator('.app-page')).toHaveCSS('padding-top', '0px')
  await expect(bar).toHaveCSS('top', '0px')
  expect((await bar.boundingBox())?.y).toBe(0)
  const body = await page.locator('.app-page__body').boundingBox()
  const navigation = await bar.boundingBox()
  expect(body!.y).toBe(navigation!.height)
  await expect(page.locator('.app-page')).toHaveCSS('--app-safe-area-bottom', '20px')

  // Resizing/browser chrome changes must not reintroduce the gap.
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  })
  await expect(bar).toHaveCSS('top', '0px')
  await expect(page.locator('.app-page')).toHaveCSS('padding-top', '0px')
})

for (const route of [
  { path: 'auth/login?scenario=login-default', container: '.login-page__hero' },
  { path: 'exam/take?scenario=exam-single', container: '.take-page' },
]) {
  test(`H5 top inset also stays empty on ${route.path}`, async ({ page, context }) => {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 44, bottom: 20, left: 0, right: 0 },
    })
    await page.goto(`/#/pages/${route.path}`)
    await expect(page.locator(route.container)).toHaveCSS('padding-top', '0px')
    await expect(page.locator('.top-bar')).toHaveCSS('--app-safe-area-top', '0px')
  })
}
