import { expect, test } from '@playwright/test'
import { examRouteCatalog } from '../src/fixtures/route-catalog/exam'

for (const route of examRouteCatalog) {
  test(`exam ${route.path} ${route.scenario} (${route.pencilBoard})`, async ({ page }, testInfo) => {
    const errors: string[] = []
    const failures: string[] = []
    const apiRequests: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`) })
    page.on('requestfailed', request => failures.push(`${request.url()} ${request.failure()?.errorText}`))
    page.on('request', request => { if (request.url().includes('/api/v1/')) apiRequests.push(request.url()) })
    await page.goto(`/#${route.path}?scenario=${route.scenario}`)
    await expect(page.getByText(route.expectedText, { exact: false }).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(failures).toEqual([])
    expect(apiRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`${route.scenario}.png`), fullPage: true })
  })
}

test('single selections replace each other and stay with their stable item after a card jump', async ({ page }) => {
  await page.goto('/#/pages/exam/take?scenario=exam-single')
  await page.getByRole('radio', { name: '选项 A', exact: true }).click()
  await expect(page.getByRole('radio', { name: '选项 A', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: '选项 C', exact: true })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: '打开答题卡', exact: true }).click()
  await page.getByRole('button', { name: '跳转第 11 题', exact: true }).click()
  await expect(page.getByText('多选题 · 请选择所有符合的选项')).toBeVisible()
  await page.getByRole('button', { name: '打开答题卡', exact: true }).click()
  await page.getByRole('button', { name: '跳转第 1 题', exact: true }).click()
  await expect(page.getByRole('radio', { name: '选项 A', exact: true })).toHaveAttribute('aria-checked', 'true')
})

test('multiple selections toggle independently and exiting first asks for confirmation', async ({ page }) => {
  await page.goto('/#/pages/exam/take?scenario=exam-multiple')
  const a = page.getByRole('checkbox', { name: '选项 A', exact: true })
  const b = page.getByRole('checkbox', { name: '选项 B', exact: true })
  const c = page.getByRole('checkbox', { name: '选项 C', exact: true })
  await a.click()
  await b.click()
  await expect(a).toHaveAttribute('aria-checked', 'false')
  await expect(b).toHaveAttribute('aria-checked', 'true')
  await expect(c).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '退出答题', exact: true }).click()
  await expect(page.getByText('确定退出答题？')).toBeVisible()
  await page.getByText('继续答题', { exact: true }).click()
  await expect(b).toHaveAttribute('aria-checked', 'true')
})

test('timeout locks choices and has no automatic submission action', async ({ page }) => {
  await page.goto('/#/pages/exam/take?scenario=exam-timeout')
  await expect(page.getByText('考试时间已到')).toBeVisible()
  await expect(page.getByRole('radio', { name: '选项 ✓', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: '交卷', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('已锁定作答，正在查询服务端考试状态。', { exact: false })).toBeVisible()
})

test('result, review verdict and review card share the same frozen grading summary', async ({ page }) => {
  await page.goto('/#/pages/exam/result?scenario=exam-result')
  await expect(page.getByText('79', { exact: true })).toBeVisible()
  await expect(page.getByText('16', { exact: true })).toBeVisible()
  await expect(page.getByText('3', { exact: true })).toBeVisible()
  await expect(page.getByText('1', { exact: true })).toBeVisible()

  await page.goto('/#/pages/exam/review?scenario=exam-review-judgment')
  await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
  await expect(page.getByText('得 4 / 4', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开解析卡', exact: true }).click()
  await expect(page.getByText('对 16 · 错 3 · 未答 1', { exact: true })).toBeVisible()
})
