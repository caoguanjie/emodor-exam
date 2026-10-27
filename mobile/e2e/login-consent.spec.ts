import { expect, test, type Page } from '@playwright/test'

const consentName = '我已阅读并同意服务协议'

async function prepareLogin(page: Page, expiresIn = 300) {
  await page.route('**/api/v1/mobile/auth/refresh', route => route.fulfill({ status: 401, json: { code: 40107, message: '会话已失效', data: null } }))
  await page.route('**/api/v1/mobile/auth/sms/send', route => route.fulfill({ json: { code: 0, message: 'ok', data: { challenge_id: 'consent-challenge', expires_in: expiresIn, retry_after: 60, masked_phone: '138****0000' } } }))
  await page.goto('/mobile/#/pages/auth/login')
  await page.getByRole('textbox').first().fill('13800000000')
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('验证码已发送，请留意手机短信', { exact: true })).toBeVisible()
  await page.getByRole('spinbutton').fill('123456')
  await expect(page.locator('#mobile-sms-login')).not.toHaveClass(/is-disabled/)
}

test('unchecked login waits for explicit consent; cancellation and modal dismissal send nothing', async ({ page }) => {
  let logins = 0
  let releaseLogin: () => Promise<void> = async () => {}
  await page.route('**/api/v1/mobile/auth/sms/login', route => {
    logins++
    expect(route.request().postDataJSON()).toEqual({ phone: '13800000000', challenge_id: 'consent-challenge', code: '123456' })
    releaseLogin = () => route.fulfill({ json: { code: 40011, message: '验证码错误，请重新输入', data: null } })
  })
  await prepareLogin(page)
  const checkbox = page.getByRole('checkbox', { name: consentName })
  await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  await page.locator('#mobile-sms-login').click()
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeVisible()
  await expect(page.getByText(/将自动勾选并同意《服务协议》/)).toBeVisible()
  expect(logins).toBe(0)
  await page.getByText('暂不同意', { exact: true }).click()
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeHidden()
  await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  expect(logins).toBe(0)

  await page.locator('#mobile-sms-login').click()
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeVisible()
  await page.locator('.wd-overlay:visible').last().click({ position: { x: 3, y: 3 } })
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeHidden()
  await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  expect(logins).toBe(0)

  await page.locator('#mobile-sms-login').click()
  await page.getByText('同意并登录', { exact: true }).click()
  await expect.poll(() => logins).toBe(1)
  await expect(checkbox).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('#mobile-sms-login')).toHaveClass(/is-loading/)
  await page.locator('#mobile-sms-login').dispatchEvent('click')
  expect(logins).toBe(1)
  await releaseLogin()
  await expect(page.getByText('验证码错误，请重新输入', { exact: true })).toBeVisible()
})

test('already checked login submits directly without another consent dialog', async ({ page }) => {
  let logins = 0
  await page.route('**/api/v1/mobile/auth/sms/login', route => {
    logins++
    return route.fulfill({ json: { code: 40011, message: '验证码错误，请重新输入', data: null } })
  })
  await prepareLogin(page)
  await page.getByRole('checkbox', { name: consentName }).click()
  await page.locator('#mobile-sms-login').click()
  await expect(page.getByText('验证码错误，请重新输入', { exact: true })).toBeVisible()
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeHidden()
  expect(logins).toBe(1)
})

test('an expired challenge dismisses pending consent without checking or submitting', async ({ page }) => {
  await page.clock.install()
  let logins = 0
  await page.route('**/api/v1/mobile/auth/sms/login', route => { logins++; return route.abort() })
  await prepareLogin(page)
  await page.locator('#mobile-sms-login').click()
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeVisible()
  await page.clock.fastForward(301000)
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeHidden()
  await expect(page.getByRole('checkbox', { name: consentName })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('验证码已过期，请重新获取', { exact: true })).toBeVisible()
  expect(logins).toBe(0)
})

test('changing phone invalidates pending consent and the old SMS challenge', async ({ page }) => {
  let logins = 0
  await page.route('**/api/v1/mobile/auth/sms/login', route => { logins++; return route.abort() })
  await prepareLogin(page)
  await page.locator('#mobile-sms-login').click()
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeVisible()
  await page.getByRole('textbox').first().fill('13900000000')
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeHidden()
  await expect(page.getByRole('checkbox', { name: consentName })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('spinbutton')).toHaveValue('')
  expect(logins).toBe(0)
})

test('static preview uses the same consent flow and an independent API-free service agreement link', async ({ page }) => {
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) calls.push(request.url()) })
  await page.goto('/mobile/#/pages/auth/login?scenario=login-default')
  await page.getByText('《服务协议》', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/profile\/terms\?scenario=terms-default$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  const checkbox = page.getByRole('checkbox', { name: consentName })
  await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('textbox').first().fill('13800000000')
  await page.getByText('获取验证码', { exact: true }).click()
  await page.getByRole('spinbutton').fill('268013')
  await page.getByText('登录', { exact: true }).click()
  await expect(page.getByText('请阅读并同意协议', { exact: true })).toBeVisible()
  await page.getByText('暂不同意', { exact: true }).click()
  await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  await page.getByText('登录', { exact: true }).click()
  await page.getByText('同意并登录', { exact: true }).click()
  await expect(page.getByText('推荐课程', { exact: true })).toBeVisible()
  expect(calls).toEqual([])
})

for (const width of [320, 390]) {
  test(`service agreement stays in one row at ${width}px and opening it does not toggle consent`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/mobile/#/pages/auth/login?scenario=login-default')
    const checkbox = page.getByRole('checkbox', { name: consentName })
    const link = page.getByRole('button', { name: '《服务协议》', exact: true })
    await expect(checkbox).toBeVisible()
    const checkboxBox = await checkbox.boundingBox()
    const linkBox = await link.boundingBox()
    expect(checkboxBox).not.toBeNull()
    expect(linkBox).not.toBeNull()
    expect(Math.abs(checkboxBox!.y + checkboxBox!.height / 2 - linkBox!.y - linkBox!.height / 2)).toBeLessThan(4)
    expect(linkBox!.x).toBeGreaterThan(checkboxBox!.x)
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await checkbox.click()
    await expect(checkbox).toHaveAttribute('aria-checked', 'true')
    await link.click()
    await expect(page).toHaveURL(/pages\/profile\/terms\?scenario=terms-default$/)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })
}

for (const returnBeforeResponse of [false, true]) {
  test(`late login success does not navigate after opening terms${returnBeforeResponse ? ' and returning' : ''}`, async ({ page }) => {
    let releaseLogin: () => Promise<void> = async () => {}
    let loginReceived = false
    await page.route('**/api/v1/mobile/auth/sms/login', route => {
      loginReceived = true
      releaseLogin = () => route.fulfill({ json: { code: 0, message: 'ok', data: {
        access_token: 'consent-memory-access', expires_in: 900,
        user: { id: 17, username: 'learner-17', real_name: '', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'unverified' },
      } } })
    })
    await page.route('**/api/v1/me/home?**', route => route.fulfill({ json: { code: 0, message: 'ok', data: { site_config: { logo_asset_id: null, banners: [] }, courses: { items: [], total: 0, page: 1, page_size: 4 } } } }))
    await prepareLogin(page)
    await page.getByRole('checkbox').click()
    await page.locator('#mobile-sms-login').click()
    await expect.poll(() => loginReceived).toBe(true)
    await page.getByText('《服务协议》', { exact: true }).click()
    await expect(page).toHaveURL(/pages\/profile\/terms$/)
    if (returnBeforeResponse) {
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(page).toHaveURL(/#\/(?:pages\/auth\/login)?$/)
    }
    const response = page.waitForResponse('**/api/v1/mobile/auth/sms/login')
    await releaseLogin()
    await response
    // uni-app navigation dispatch is asynchronous; observe after its transition turn.
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(returnBeforeResponse ? /#\/(?:pages\/auth\/login)?$/ : /pages\/profile\/terms$/)
  })
}
