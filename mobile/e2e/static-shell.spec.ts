import { expect, test } from '@playwright/test'
import { shellRouteCatalog } from '../src/fixtures/route-catalog/shell'

for (const route of shellRouteCatalog) {
  test(`shell ${route.path} ${route.scenario} (${route.pencilBoard})`, async ({ page }, testInfo) => {
    const errors: string[] = []
    const failedResponses: string[] = []
    const apiRequests: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') {
        const location = message.location().url
        errors.push(location ? `${message.text()} @ ${location}` : message.text())
      }
    })
    page.on('response', response => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
    })
    page.on('requestfailed', request => failedResponses.push(`FAILED ${request.url()} ${request.failure()?.errorText || ''}`))
    page.on('request', request => { if (request.url().includes('/api/v1/')) apiRequests.push(request.url()) })
    await page.goto(`/#${route.path}?scenario=${route.scenario}`)
    await expect(page.getByText(route.expectedText, { exact: false }).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(failedResponses).toEqual([])
    expect(apiRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`${route.scenario}.png`), fullPage: true })
  })
}

test('SMS form switches to sent state and accepts a complete fixture entry', async ({ page }) => {
  await page.goto('/#/pages/auth/login?scenario=login-default')
  await page.getByRole('textbox').first().fill('13800000000')
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('验证码已发送，请留意手机短信')).toBeVisible()
  await page.getByRole('spinbutton').fill('268013')
  await page.getByText('登录', { exact: true }).click()
  await expect(page.getByText('推荐课程', { exact: true })).toBeVisible()
})

test('profile choice updates the visible value and saves locally', async ({ page }) => {
  await page.goto('/#/pages/profile/info?scenario=profile-job')
  await page.getByRole('button', { name: '选择电工', exact: true }).click()
  await expect(page.getByRole('button', { name: '工种', exact: true })).toContainText('电工')
  await page.getByText('保存资料', { exact: true }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
})

test('profile keeps authoritative identity fields read-only while choices remain editable', async ({ page }) => {
  await page.goto('/#/pages/profile/info?scenario=profile-info')
  const name = page.getByRole('textbox').nth(0)
  const phone = page.getByRole('textbox').nth(1)
  await expect(name).toHaveValue('学员演示账号')
  await expect(phone).toHaveValue('13800000000')
  await expect(name).not.toBeEditable()
  await expect(phone).not.toBeEditable()
  await expect(name).toBeDisabled()
  await expect(phone).toBeDisabled()
  await page.getByRole('button', { name: '工种', exact: true }).click()
  await page.getByRole('button', { name: '选择电工', exact: true }).click()
  await expect(page.getByRole('button', { name: '工种', exact: true })).toContainText('电工')
  await page.getByText('保存资料', { exact: true }).click()
  await expect(name).toHaveValue('学员演示账号')
  await expect(phone).toHaveValue('13800000000')
})

test('chapter headings fold and expand their lessons', async ({ page }) => {
  await page.goto('/#/pages/course/detail?scenario=course-collapsed')
  const chapter = page.getByRole('button', { name: '第一章 隐患排查方法', exact: true })
  await expect(chapter).toHaveAttribute('aria-expanded', 'false')
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-expanded', 'true')
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-expanded', 'false')
})

test('course catalog shows chapter counts, continuous lesson numbers and chapter.lesson codes', async ({ page }) => {
  await page.goto('/#/pages/course/detail?scenario=course-no-video')
  await expect(page.locator('.chapter-list__count')).toHaveText('共6课时')
  await expect(page.locator('.chapter-list__section-count')).toHaveText(['3节', '3节'])
  await expect(page.locator('.chapter-list__number')).toHaveText(['1', '2', '3', '4', '5', '6'])
  await expect(page.locator('.chapter-list__name')).toHaveText([
    '1.1 隐患排查清单', '1.2 隐患与风险分级', '1.3 整改措施设计',
    '2.1 责任人与整改时限', '2.2 复查销项', '2.3 隐患数据分析',
  ])
})

test('logout confirmation stays above and blocks the fixed tab bar', async ({ page }) => {
  await page.goto('/#/pages/profile/index?scenario=profile-default')
  await page.getByText('退出登录', { exact: true }).click()
  const message = page.getByText('确定要退出当前账号吗？', { exact: true })
  await expect(message).toBeVisible()
  const popupZ = await message.evaluate((element) => {
    let current: HTMLElement | null = element as HTMLElement
    while (current && !current.classList.contains('wd-popup')) current = current.parentElement
    return current ? Number.parseInt(getComputedStyle(current).zIndex || '0', 10) : 0
  })
  const tabZ = await page.locator('.tab-bar').evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10))
  expect(popupZ).toBeGreaterThan(tabZ)
  const tabReceivesPointer = await page.locator('.tab-bar__item').first().evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === element || element.contains(hit)
  })
  expect(tabReceivesPointer).toBe(false)
  await page.locator('.confirm-sheet').getByText('取消', { exact: true }).click()
  await expect(message).toBeHidden()
  await expect(page).toHaveURL(/#\/pages\/profile\/index\?scenario=profile-default$/)
  await page.locator('.profile-logout').getByText('退出登录', { exact: true }).click()
  await expect(message).toBeVisible()
  await page.locator('.confirm-sheet__actions .wd-button').last().click()
  await expect(page.getByText('手机号验证码登录', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/(?:pages\/auth\/login)?$/)
})

test('deep-linked pages use their specified return fallback instead of the home page', async ({ page }) => {
  await page.goto('/#/pages/course/detail?scenario=course-video')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/course\/index\?scenario=course-list$/)

  await page.goto('/#/pages/exam/review?scenario=exam-review-single')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/exam\/index$/)

  await page.goto('/#/pages/profile/wrong-book?scenario=exam-wrong-book')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/profile\/index\?scenario=profile-default$/)
})

test('profile static previews preserve their scenario across menu and return journeys without API calls', async ({ page }) => {
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) calls.push(request.url()) })
  await page.goto('/#/pages/profile/index?scenario=profile-default')
  await page.getByRole('button', { name: '我的错题本', exact: true }).click()
  await expect(page).toHaveURL(/scenario=exam-wrong-book$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/scenario=profile-default$/)
  await page.getByRole('button', { name: '考试记录', exact: true }).click()
  await expect(page).toHaveURL(/scenario=exam-history$/)
  await page.locator('.history-record').first().click()
  await expect(page).toHaveURL(/scenario=exam-result$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/scenario=exam-history$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/scenario=profile-default$/)
  await page.getByText('实名认证', { exact: true }).click()
  await expect(page).toHaveURL(/scenario=identity-collect$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/scenario=profile-default$/)
  await page.getByText('关于我们', { exact: true }).click()
  await expect(page).toHaveURL(/scenario=about-default$/)
  await page.getByText('服务条款', { exact: true }).click()
  await expect(page).toHaveURL(/scenario=terms-default$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/scenario=about-default$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/scenario=profile-default$/)
  expect(calls).toEqual([])
})
