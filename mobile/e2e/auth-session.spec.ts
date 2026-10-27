import { expect, test, type Page } from '@playwright/test'

const user = { id: 17, username: 'learner-17', real_name: '', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'unverified' }
const session = { access_token: 'browser-memory-access', expires_in: 900, user }
// Authentication cases isolate their read-model requests after real business pages mount.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/me/home?**', route => route.fulfill({ json: { code: 0, message: 'ok', data: { site_config: { logo_asset_id: null, banners: [] }, courses: { items: [], total: 0, page: 1, page_size: 4 } } } }))
  await page.route('**/api/v1/me/profile', route => route.fulfill({ json: { code: 0, message: 'ok', data: { id: '17', username: user.username, real_name: user.real_name, phone: null, email: null, avatar_id: null, occupation: null, gender: null, birthday: null, source: user.source, category_id: null, role: user.role, status: 1 } } }))
})
async function noSession(page: Page) {
  await page.route('**/api/v1/mobile/auth/refresh', route => route.fulfill({ status: 401, json: { code: 40107, message: '会话已失效', data: null } }))
}
async function openLogin(page: Page) {
  await page.goto('/#/pages/auth/login')
  await expect(page.getByText('手机号验证码登录', { exact: true })).toBeVisible()
  await page.getByRole('textbox').first().fill('13800000000')
}

test('real API login handles loading, resend countdown, wrong code and success without forcing identity', async ({ page, context }) => {
  await context.addCookies([{ name: 'ruleexam_refresh', value: 'pc-cookie-preserved', domain: '127.0.0.1', path: '/api/v1/auth', httpOnly: true, sameSite: 'Strict' }])
  await noSession(page)
  let sends = 0
  await page.route('**/api/v1/mobile/auth/sms/send', async route => {
    sends++
    expect(route.request().postDataJSON()).toEqual({ phone: '13800000000' })
    await new Promise(resolve => setTimeout(resolve, 200))
    await route.fulfill({ json: { code: 0, message: 'ok', data: { challenge_id: 'challenge-browser', expires_in: 300, retry_after: 2, masked_phone: '138****0000' } } })
  })
  await page.route('**/api/v1/mobile/auth/sms/login', route => {
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({ phone: '13800000000', challenge_id: 'challenge-browser' })
    return route.fulfill({ json: body.code === '123456' ? { code: 0, message: 'ok', data: session } : { code: 40011, message: '验证码错误，请重新输入', data: null } })
  })
  await openLogin(page)
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('发送中', { exact: true })).toBeVisible()
  await expect(page.getByText('验证码已发送，请留意手机短信', { exact: true })).toBeVisible()
  await expect(page.getByText(/\d+s 后重新获取/)).toBeVisible()
  expect(sends).toBe(1)
  await page.getByRole('spinbutton').fill('111111')
  await page.getByRole('checkbox', { name: '我已阅读并同意服务协议' }).click()
  await expect(page.locator('#mobile-sms-login')).not.toHaveClass(/is-disabled|is-loading/)
  await page.locator('#mobile-sms-login').click()
  await expect(page.getByText('验证码错误，请重新输入', { exact: true })).toBeVisible()
  // uni H5 throttles native input updates by 100ms; use normal key entry when correcting a code.
  await page.getByRole('spinbutton').press('ControlOrMeta+A')
  await page.getByRole('spinbutton').pressSequentially('123456', { delay: 120 })
  await expect(page.locator('#mobile-sms-login')).not.toHaveClass(/is-disabled|is-loading/)
  await page.locator('#mobile-sms-login').click()
  await expect(page).toHaveURL(/#\/pages\/home\/index$/)
  await expect(page.getByText('推荐课程', { exact: true })).toBeVisible()
  const persisted = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage), document.cookie].join('|'))
  expect(persisted).not.toContain('browser-memory-access')
  expect(persisted).not.toContain('challenge-browser')
  expect((await context.cookies()).some(cookie => cookie.name === 'ruleexam_refresh' && cookie.value === 'pc-cookie-preserved')).toBe(true)
})

test('bootstrap restores the mobile session silently and leaves the login page', async ({ page }) => {
  let refreshes = 0
  await page.route('**/api/v1/mobile/auth/refresh', route => { refreshes++; return route.fulfill({ json: { code: 0, message: 'ok', data: session } }) })
  await page.goto('/#/pages/auth/login')
  await expect(page).toHaveURL(/#\/pages\/home\/index$/)
  await expect(page.getByText('推荐课程', { exact: true })).toBeVisible()
  expect(refreshes).toBe(1)
})

test('send rate limit uses retry_after and keeps the form available after countdown', async ({ page }) => {
  await noSession(page)
  await page.route('**/api/v1/mobile/auth/sms/send', route => route.fulfill({ status: 429, json: { code: 42911, message: '发送过于频繁，请稍后重试', data: { retry_after: 2 } } }))
  await openLogin(page)
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('发送过于频繁，请稍后重试', { exact: true })).toBeVisible()
  await expect(page.getByText(/\d+s 后重新获取/)).toBeVisible()
  await expect(page.getByText('重新获取', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('textbox').first()).toBeEditable()
})

test('offline send gives a retryable network message', async ({ page }) => {
  await noSession(page)
  await page.route('**/api/v1/mobile/auth/sms/send', route => route.abort('internetdisconnected'))
  await openLogin(page)
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('网络连接失败，请检查网络后重试', { exact: true })).toBeVisible()
  await expect(page.getByText('重新获取', { exact: true })).toBeVisible()
})

test('changing the phone after send invalidates the old challenge', async ({ page }) => {
  await noSession(page)
  await page.route('**/api/v1/mobile/auth/sms/send', route => route.fulfill({ json: { code: 0, message: 'ok', data: { challenge_id: 'old-phone-challenge', expires_in: 300, retry_after: 60, masked_phone: '138****0000' } } }))
  await openLogin(page)
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('验证码已发送，请留意手机短信', { exact: true })).toBeVisible()
  await page.getByRole('spinbutton').fill('123456')
  await page.getByRole('textbox').first().fill('13900000000')
  await expect(page.getByRole('spinbutton')).toHaveValue('')
  // uni-button is a custom element; Wot enforces disabled through its state class.
  await expect(page.locator('#mobile-sms-login')).toHaveClass(/is-disabled/)
})

test('scenario login remains an API-free static Pencil preview', async ({ page }) => {
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) calls.push(request.url()) })
  await page.goto('/#/pages/auth/login?scenario=login-sent')
  await expect(page.getByText('49s 后重新获取', { exact: true })).toBeVisible()
  expect(calls).toEqual([])
})

test('login submission stays disabled until bootstrap refresh has settled', async ({ page }) => {
  let completeRefresh: () => Promise<void> = async () => {}
  await page.route('**/api/v1/mobile/auth/refresh', route => { completeRefresh = () => route.fulfill({ status: 401, json: { code: 40107, message: '会话已失效', data: null } }) })
  await page.route('**/api/v1/mobile/auth/sms/send', route => route.fulfill({ json: { code: 0, message: 'ok', data: { challenge_id: 'boot-challenge', expires_in: 300, retry_after: 60, masked_phone: '138****0000' } } }))
  await page.route('**/api/v1/mobile/auth/sms/login', route => route.fulfill({ json: { code: 0, message: 'ok', data: session } }))
  await openLogin(page)
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('验证码已发送，请留意手机短信', { exact: true })).toBeVisible()
  await page.getByRole('spinbutton').fill('123456')
  await expect(page.locator('#mobile-sms-login')).toHaveClass(/is-disabled/)
  await completeRefresh()
  await expect(page.locator('#mobile-sms-login')).not.toHaveClass(/is-disabled/)
  await page.getByRole('checkbox', { name: '我已阅读并同意服务协议' }).click()
  await page.locator('#mobile-sms-login').click()
  await expect(page).toHaveURL(/#\/pages\/home\/index$/)
})

test('normal profile logout waits for the mobile endpoint and clears the session', async ({ page }) => {
  let refreshes = 0
  let logoutCalls = 0
  let completeLogout: () => Promise<void> = async () => {}
  await page.route('**/api/v1/mobile/auth/refresh', route => { refreshes++; return route.fulfill({ json: { code: 0, message: 'ok', data: session } }) })
  await page.route('**/api/v1/mobile/auth/logout', route => {
    logoutCalls++
    expect(route.request().headers().authorization).toBe('Bearer browser-memory-access')
    completeLogout = () => route.fulfill({ json: { code: 0, message: 'ok', data: null } })
  })
  await page.goto('/#/pages/profile/index')
  await page.locator('.profile-logout').getByText('退出登录', { exact: true }).click()
  await page.locator('.confirm-sheet').getByText('取消', { exact: true }).click()
  expect(logoutCalls).toBe(0)
  await page.locator('.profile-logout').getByText('退出登录', { exact: true }).click()
  await page.locator('.confirm-sheet__actions .wd-button').last().click()
  await expect.poll(() => logoutCalls).toBe(1)
  await expect(page).toHaveURL(/#\/pages\/profile\/index$/)
  await completeLogout()
  await expect(page.getByText('手机号验证码登录', { exact: true })).toBeVisible()
  expect(refreshes).toBe(1)
})

test('normal profile logout still returns to login when the endpoint is offline', async ({ page }) => {
  let refreshes = 0
  let logoutCalls = 0
  await page.route('**/api/v1/mobile/auth/refresh', route => { refreshes++; return route.fulfill({ json: { code: 0, message: 'ok', data: session } }) })
  await page.route('**/api/v1/mobile/auth/logout', route => { logoutCalls++; return route.abort('internetdisconnected') })
  await page.goto('/#/pages/profile/index')
  await page.locator('.profile-logout').getByText('退出登录', { exact: true }).click()
  await page.locator('.confirm-sheet__actions .wd-button').last().click()
  await expect(page.getByText('手机号验证码登录', { exact: true })).toBeVisible()
  expect(logoutCalls).toBe(1)
  expect(refreshes).toBe(1)
})
