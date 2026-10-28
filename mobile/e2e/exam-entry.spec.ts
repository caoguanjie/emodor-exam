import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yC9sAAAAASUVORK5CYII=', 'base64')
const paper = (id = '41') => ({ paper_id: id, title: `公共随机考试${id}`, mode: 'random', pool_scope: 'public', category_id: null, status: 'published', source: 'external', difficulty: 'hard', total_score: 100, pass_score: 60, duration_minutes: 30, question_count: 100, active_record_id: null, latest_record_id: null })

async function setup(page: Page, options: { loggedIn?: boolean; name?: string; verified?: boolean; papers?: string[] } = {}) {
  const state = { authenticated: options.loggedIn !== false, name: options.name ?? '合成学员', verified: !!options.verified, userId: 17, starts: 0, listReads: 0, profileWrites: [] as unknown[], identityCreates: 0, uploads: 0 }
  const profile = () => ({ id: String(state.userId), username: `learner-${state.userId}`, real_name: state.name, phone: '13800000000', email: null, avatar_id: null, occupation: null, gender: null, birthday: null, source: 'external', category_id: null, category_name: null, role: 'employee', status: 1 })
  const session = () => ({ access_token: `synthetic-mobile-${state.userId}`, expires_in: 900, user: { id: state.userId, username: `learner-${state.userId}`, real_name: state.name, phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: state.verified ? 'verified' : 'unverified' } })
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.endsWith('/mobile/auth/refresh')) return route.fulfill({ status: state.authenticated ? 200 : 401, json: state.authenticated ? envelope(session()) : { code: 40107, message: '请先登录', data: null } })
    if (path.endsWith('/mobile/auth/sms/send')) return route.fulfill({ json: envelope({ challenge_id: 'synthetic-entry', expires_in: 300, retry_after: 1, masked_phone: '138****0000' }) })
    if (path.endsWith('/mobile/auth/sms/login')) { state.authenticated = true; return route.fulfill({ json: envelope(session()) }) }
    if (path.endsWith('/mobile/auth/logout')) { state.authenticated = false; return route.fulfill({ json: envelope(null) }) }
    if (path.endsWith('/me/profile')) {
      if (request.method() === 'POST') { const patch = request.postDataJSON(); state.profileWrites.push(patch); state.name = patch.real_name ?? state.name }
      return route.fulfill({ json: envelope(profile()) })
    }
    if (path.endsWith('/me/training-categories')) return route.fulfill({ json: envelope({ items: [], total: 0, page: 1, page_size: 100 }) })
    if (path.endsWith('/me/exams')) { state.listReads++; const items = (options.papers ?? ['41', '42']).map(id => paper(id)); return route.fulfill({ json: envelope({ items, total: items.length, page: 1, page_size: 10 }) }) }
    if (/\/me\/exams\/\d+$/.test(path)) return route.fulfill({ json: envelope(paper(path.split('/').at(-1)!)) })
    if (path.endsWith('/start')) { state.starts++; return route.fulfill({ status: 403, json: { code: 40302, message: '合成用例仅验证导航', data: { reason_code: 'IDENTITY_REQUIRED' } } }) }
    if (path.endsWith('/me/identity-verification')) return route.fulfill({ json: envelope({ status: state.verified ? 'verified' : 'unverified', real_name: state.verified ? state.name : null, id_number_masked: state.verified ? 'SYN****0017' : null, verified_at: state.verified ? '2026-10-28T00:00:00Z' : null, current_session_id: null, reason_code: null }) })
    if (path.endsWith('/identity-verification/images')) { state.uploads++; const data = request.postDataBuffer()?.toString() || ''; const imageType = data.includes('id_card_portrait') ? 'id_card_portrait' : data.includes('id_card_emblem') ? 'id_card_emblem' : 'face'; return route.fulfill({ json: envelope({ asset_id: `synthetic-${state.uploads}`, image_type: imageType, scan_status: 'safe', processed_preview: imageType === 'face' ? null : { content_url: '/api/v1/media/tickets/entry/content', expires_at: '2030-01-01T00:00:00Z' } }) }) }
    if (path.endsWith('/identity-verification/sessions')) { state.identityCreates++; state.verified = true; return route.fulfill({ json: envelope({ session_id: 'synthetic-session', status: 'verified', reason_code: null, clear_materials: [], expires_at: '2030-01-01T00:00:00Z' }) }) }
    if (path.endsWith('/content')) return route.fulfill({ contentType: 'image/png', body: tiny })
    if (path.endsWith('/me/home')) return route.fulfill({ json: envelope({ site_config: { logo_asset_id: null, banners: [] }, courses: { items: [], total: 0, page: 1, page_size: 4 } }) })
    if (path.endsWith('/public/site-config')) return route.fulfill({ json: envelope({ logo_asset_id: null, banners: [], about_us: '' }) })
    return route.fulfill({ status: 404, json: { code: 40401, message: 'unexpected fixture request', data: null } })
  })
  return state
}

async function login(page: Page) {
  await expect(page.getByText('手机号验证码登录', { exact: true })).toBeVisible()
  await page.getByRole('textbox').first().fill('13800000000')
  await page.getByText('获取验证码', { exact: true }).click()
  await expect(page.getByText('验证码已发送，请留意手机短信', { exact: true })).toBeVisible()
  await page.getByRole('spinbutton').fill('123456')
  await page.getByRole('checkbox', { name: '我已阅读并同意服务协议' }).click()
  await expect(page.locator('#mobile-sms-login')).not.toHaveClass(/is-disabled|is-loading/)
  await page.locator('#mobile-sms-login').click()
}

test('a list 401 refreshing into another account automatically reloads that account list without starting', async ({ page }) => {
  const state = await setup(page, { loggedIn: true, verified: true })
  let reads = 0
  await page.route('**/api/v1/me/exams?*', async route => {
    reads++
    if (reads === 1) {
      state.userId = 18
      return route.fulfill({ status: 401, json: { code: 40107, message: 'expired', data: null } })
    }
    expect(route.request().headers().authorization).toBe('Bearer synthetic-mobile-18')
    return route.fulfill({ json: envelope({ items: [paper('42')], total: 1, page: 1, page_size: 20 }) })
  })
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.getByText('公共随机考试42', { exact: true })).toBeVisible()
  expect(reads).toBe(2)
  expect(state.starts).toBe(0)
})

async function collect(page: Page) {
  for (const label of ['身份证人像面', '身份证国徽面', '本人正脸照片']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    if (label === '本人正脸照片') await page.locator('#identity-live-face').click()
    else await page.getByRole('button', { name: '从相册选择', exact: true }).click()
    await (await chooser).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tiny })
    await expect(page.getByText(label === '本人正脸照片' ? '已上传 · 重新拍摄' : '已上传 · 可重拍', { exact: true }).first()).toBeVisible()
  }
  await page.getByText('我已阅读并同意', { exact: true }).click()
}

test('generic entry returns to the exam Tab after login and rejects an external return URL', async ({ page }) => {
  const state = await setup(page, { loggedIn: false })
  await page.goto('/mobile/#/pages/exam/index?return_url=https%3A%2F%2Fevil.invalid')
  // uni H5 renders its first page (login) at #/ as well as its named route.
  await expect(page.getByText('手机号验证码登录', { exact: true })).toBeVisible()
  await page.reload()
  await login(page)
  await expect(page).toHaveURL(/pages\/exam\/index$/)
  await expect(page.getByText('公共随机考试41', { exact: true })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/pages/exam/index')
  expect(state.starts).toBe(0)
})

test('a newly logged-in learner saves only a name, then returns to the pending Tab without forced identity', async ({ page }) => {
  const state = await setup(page, { loggedIn: false, name: '' })
  await page.goto('/mobile/#/pages/exam/index')
  await login(page)
  await expect(page).toHaveURL(/pages\/profile\/info\?onboarding=1$/)
  await expect(page.getByRole('textbox').first()).toBeEditable()
  await page.getByRole('textbox').first().fill('合成新学员')
  await page.getByText('保存并返回考试列表', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/exam\/index$/)
  await expect(page.getByText('公共随机考试41', { exact: true })).toBeVisible()
  expect(state.profileWrites).toEqual([{ real_name: '合成新学员', gender: null, birthday: null }])
  expect(state.identityCreates).toBe(0); expect(state.starts).toBe(0)
})

test('blank-category learners browse first, verify after choosing, and return to instructions without starting', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.getByText('公共随机考试42', { exact: true })).toBeVisible()
  expect(state.identityCreates).toBe(0)
  await page.getByText('公共随机考试42', { exact: true }).click()
  await page.getByText('开始答题', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/identity\/index$/)
  expect(state.starts).toBe(0)
  await page.reload()
  await expect(page.locator('#identity-submit')).toBeVisible()
  await collect(page)
  await expect(page.locator('#identity-submit')).not.toHaveClass(/is-disabled/)
  await page.locator('#identity-submit').click()
  await expect(page).toHaveURL(/pages\/exam\/instructions\?paper_id=42$/)
  await expect(page.getByText('公共随机考试42', { exact: true })).toBeVisible()
  expect(state.identityCreates).toBe(1); expect(state.starts).toBe(0)
})

test('direct opening and the existing Tab button share the list, including an empty list', async ({ page }) => {
  const state = await setup(page, { papers: [] })
  await page.goto('/mobile/#/pages/home/index')
  await page.getByRole('button', { name: '考试', exact: true }).click()
  await expect(page).toHaveURL(/pages\/exam\/index$/)
  await expect(page.getByText('暂无考试', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('暂无考试', { exact: true })).toBeVisible()
  expect(state.listReads).toBeGreaterThanOrEqual(2); expect(state.starts).toBe(0)
})

test('an account switch during verification discards the previous selected paper and reloads the new account list', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=42')
  await page.getByText('开始答题', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/identity\/index$/)
  state.userId = 18
  state.verified = true
  await page.reload()
  await expect(page).toHaveURL(/pages\/exam\/index$/)
  await expect(page.getByText('公共随机考试41', { exact: true })).toBeVisible()
  expect(state.starts).toBe(0)
})
