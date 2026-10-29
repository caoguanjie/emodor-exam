import { expect, test } from '@playwright/test'
import { identityRouteCatalog } from '../src/fixtures/route-catalog/identity'

for (const route of identityRouteCatalog) {
  test(`identity ${route.scenario} (${route.pencilBoard})`, async ({ page }, testInfo) => {
    // The dev server has no favicon; it is unrelated to the API-free screen.
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
    const errors: string[] = []
    const apiRequests: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', request => { if (request.url().includes('/api/v1/')) apiRequests.push(request.url()) })
    await page.goto(`/mobile/#${route.path}?scenario=${route.scenario}`)
    await expect(page.getByText(route.expectedText, { exact: false }).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(apiRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`${route.scenario}.png`), fullPage: true })
  })
}

test('three fixture materials and consent are required before submission', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) apiRequests.push(request.url()) })
  await page.goto('/mobile/#/pages/identity/index?scenario=identity-collect')
  const submit = page.locator('#identity-submit')
  await expect(submit).toHaveClass(/is-disabled/)
  await page.getByRole('button', { name: '身份证人像面', exact: true }).click()
  await page.getByRole('button', { name: '从相册选择', exact: true }).click()
  await expect(page.getByRole('button', { name: '身份证人像面', exact: true })).toContainText('已上传')
  await page.getByRole('button', { name: '身份证国徽面', exact: true }).click()
  await page.getByRole('button', { name: '拍照', exact: true }).click()
  await page.getByRole('button', { name: '本人正脸照片', exact: true }).click()
  await expect(page.locator('#identity-live-face')).toBeVisible()
  await page.locator('#identity-live-face').click()
  await expect(submit).toHaveClass(/is-disabled/)
  await page.getByText('我已阅读并同意', { exact: true }).click()
  await expect(submit).not.toHaveClass(/is-disabled/)
  await submit.click()
  await expect(page.getByText('正在核验身份', { exact: true })).toBeVisible()
  expect(apiRequests).toEqual([])
})

test('face recapture preserves the two ready identity-card materials', async ({ page }) => {
  await page.goto('/mobile/#/pages/identity/index?scenario=identity-face-rejected')
  await expect(page.getByRole('button', { name: '身份证人像面', exact: true })).toContainText('已上传')
  await expect(page.getByRole('button', { name: '身份证国徽面', exact: true })).toContainText('已上传')
  await page.getByRole('button', { name: '本人正脸照片', exact: true }).click()
  await page.locator('#identity-live-face').click()
  await expect(page.getByText('人像核验未通过，证件照片已保留。', { exact: true })).toHaveCount(0)
  await expect(page.locator('#identity-submit')).not.toHaveClass(/is-disabled/)
})

test('a pending verification is queryable but cannot be resubmitted', async ({ page }) => {
  await page.goto('/mobile/#/pages/identity/index?scenario=identity-pending')
  await expect(page.getByRole('button', { name: '身份证人像面', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.locator('#identity-submit')).toHaveCount(0)
  await page.locator('#identity-query-status').click()
  await expect(page.getByText('认证结果处理中', { exact: true })).toBeVisible()
})

test('leaving the capture page discards the temporary fixture choices', async ({ page }) => {
  await page.goto('/mobile/#/pages/identity/index?scenario=identity-collect')
  await page.getByRole('button', { name: '身份证人像面', exact: true }).click()
  await page.getByRole('button', { name: '从相册选择', exact: true }).click()
  await page.goto('/mobile/#/pages/profile/index?scenario=profile-default')
  await page.goto('/mobile/#/pages/identity/index?scenario=identity-collect')
  await expect(page.getByRole('button', { name: '身份证人像面', exact: true })).toContainText('拍照 / 相册选择')
})
