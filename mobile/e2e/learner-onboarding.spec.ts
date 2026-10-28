import { expect, test, type Page } from '@playwright/test'

const user = { id: 17, username: 'learner', real_name: '', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'unverified' }
const blank = { id: '17', username: 'learner', real_name: '', phone: '13800000000', email: null, avatar_id: null, occupation: null, gender: null, birthday: null, source: 'external', category_id: null as string | null, category_name: null as string | null, role: 'employee', status: 1 }
const unverified = { status: 'unverified', real_name: null, id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }
const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
async function mocks(page: Page, initial = blank, status = 'unverified') {
  let profile = { ...initial }
  const writes: unknown[] = []
  await page.route('**/api/v1/mobile/auth/refresh', route => route.fulfill({ json: envelope({ access_token: 'onboarding-local', expires_in: 900, user: { ...user, real_name: profile.real_name, category_id: profile.category_id, identity_status: status } }) }))
  await page.route('**/api/v1/me/profile', route => {
    if (route.request().method() === 'POST') { const patch = route.request().postDataJSON(); writes.push(patch); profile = { ...profile, ...patch } }
    return route.fulfill({ json: envelope(profile) })
  })
  await page.route('**/api/v1/me/training-categories?**', route => route.fulfill({ json: envelope({ items: [{ id: '3', name: '电工' }], total: 1, page: 1, page_size: 100 }) }))
  await page.route('**/api/v1/me/training-category', route => { profile = { ...profile, category_id: '3', category_name: '电工' }; return route.fulfill({ json: envelope(profile) }) })
  await page.route('**/api/v1/me/identity-verification', route => route.fulfill({ json: envelope({ ...unverified, status, ...(status === 'verified' ? { real_name: profile.real_name, id_number_masked: '000****0000' } : {}) }) }))
  await page.route('**/api/v1/me/home?**', route => route.fulfill({ json: envelope({ site_config: { logo_asset_id: null, banners: [] }, courses: { items: [], total: 0, page: 1, page_size: 4 } }) }))
  return { writes }
}

test('restored new learner is guided to required profile, while a complete learner enters home', async ({ page }) => {
  await mocks(page)
  await page.goto('/mobile/#/pages/auth/login')
  await expect(page).toHaveURL(/pages\/profile\/info\?onboarding=1$/)
  await expect(page.getByRole('textbox').first()).toBeEditable()
})

test('complete learner can enter home without an avatar or forced identity', async ({ page }) => {
  await mocks(page, { ...blank, real_name: '学员', category_id: '3', category_name: '电工' })
  await page.goto('/mobile/#/pages/auth/login')
  await expect(page).toHaveURL(/pages\/home\/index$/)
})

test('requires a name, allows blank category and saves directly to identity', async ({ page }) => {
  const { writes } = await mocks(page)
  await page.goto('/mobile/#/pages/profile/info?onboarding=1')
  const name = page.getByRole('textbox').first()
  await expect(name).toBeEditable()
  await page.getByText('保存并去实名认证', { exact: true }).click()
  await expect(page.getByText('请输入真实姓名', { exact: true })).toBeVisible()
  await name.fill('  测试学员  ')
  await page.getByText('保存并去实名认证', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/identity\/index$/)
  expect(writes).toEqual([{ real_name: '测试学员', gender: null, birthday: null }])
})

test('optional category still confirms explicitly and keeps the unsaved name draft', async ({ page }) => {
  await mocks(page)
  await page.goto('/mobile/#/pages/profile/info?onboarding=1')
  const name = page.getByRole('textbox').first()
  await expect(name).toBeEditable()
  await name.fill('  测试学员  ')
  await page.getByRole('button', { name: '培训工种', exact: true }).click()
  await page.getByRole('button', { name: '选择电工', exact: true }).click()
  await page.getByText('确认培训工种', { exact: true }).click()
  await page.locator('.confirm-sheet__actions').getByText('确认培训工种', { exact: true }).click()
  await expect(page.getByText('培训工种已确认', { exact: true })).toBeVisible()
  await expect(name).toHaveValue('  测试学员  ')
  await page.getByText('保存并去实名认证', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/identity\/index$/)
})

test('verified name is locked and a normal optional-profile save stays on the page', async ({ page }) => {
  const { writes } = await mocks(page, { ...blank, real_name: '证件姓名', category_id: '3', category_name: '电工' }, 'verified')
  await page.goto('/mobile/#/pages/profile/info')
  const name = page.getByRole('textbox').first()
  await expect(name).toHaveValue('证件姓名')
  await expect(name).not.toBeEditable()
  await page.getByText('保存资料', { exact: true }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  expect(writes).toEqual([{ gender: null, birthday: null }])
  await expect(page).toHaveURL(/pages\/profile\/info$/)
})

test('a direct new identity entry with incomplete profile returns to completion', async ({ page }) => {
  await mocks(page)
  await page.goto('/mobile/#/pages/identity/index')
  await expect(page).toHaveURL(/pages\/profile\/info\?onboarding=1$/)
})

test('late save after leaving the page cannot navigate to identity', async ({ page }) => {
  await mocks(page, { ...blank, real_name: '学员', category_id: '3', category_name: '电工' })
  let release: () => Promise<void> = async () => {}
  await page.route('**/api/v1/me/profile', route => route.request().method() === 'POST' ? new Promise<void>(resolve => { release = async () => { await route.fulfill({ json: envelope({ ...blank, real_name: '学员', category_id: '3', category_name: '电工' }) }); resolve() } }) : route.fulfill({ json: envelope({ ...blank, real_name: '学员', category_id: '3', category_name: '电工' }) }))
  await page.goto('/mobile/#/pages/profile/info')
  await expect(page.getByRole('textbox').first()).toBeEditable()
  await page.getByText('保存并去实名认证', { exact: true }).click()
  await expect(page.locator('.profile-info__footer .wd-button')).toHaveClass(/is-loading/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/pages\/profile\/index$/)
  await release()
  await expect(page).toHaveURL(/pages\/profile\/index$/)
})

test('identity resumes profile readiness after leaving during an in-flight profile read', async ({ page }) => {
  const complete = { ...blank, real_name: '学员', category_id: '3', category_name: '电工' }
  await mocks(page, complete)
  let reads = 0, release: () => Promise<void> = async () => {}
  await page.route('**/api/v1/me/profile', route => {
    reads++
    if (reads === 1) return new Promise<void>(resolve => { release = async () => { await route.fulfill({ json: envelope(complete) }); resolve() } })
    return route.fulfill({ json: envelope(complete) })
  })
  await page.goto('/mobile/#/pages/identity/index')
  await expect.poll(() => reads).toBe(1)
  await page.evaluate(() => uni.navigateTo({ url: '/pages/profile/terms' }))
  await expect(page.getByText('一、服务内容', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect.poll(() => reads).toBe(2)
  const portrait = page.getByRole('button', { name: '身份证人像面', exact: true })
  await expect(portrait).toHaveAttribute('aria-disabled', 'false')
  await release()
  await expect(portrait).toHaveAttribute('aria-disabled', 'false')
})

for (const reason of ['FACE_MISMATCH', 'SESSION_EXPIRED']) {
  test(`old pending identity ${reason} rechecks required profile before allowing new materials`, async ({ page }) => {
    await mocks(page, blank, 'pending')
    let profileReads = 0, writes = 0, settled = false
    let releaseSession: () => Promise<void> = async () => {}
    let releaseProfile: () => Promise<void> = async () => {}
    await page.route('**/api/v1/me/identity-verification', route => route.fulfill({ json: envelope({ ...unverified, status: settled ? 'rejected' : 'pending', current_session_id: 'old-session', reason_code: settled ? reason : null }) }))
    await page.route('**/api/v1/me/identity-verification/sessions/old-session', route => new Promise<void>(resolve => {
      releaseSession = async () => {
        settled = true
        await route.fulfill({ json: envelope({ session_id: 'old-session', status: 'rejected', reason_code: reason, clear_materials: [], expires_at: '2026-10-27T00:00:00Z' }) })
        resolve()
      }
    }))
    await page.route('**/api/v1/me/identity-verification/sessions', route => { writes++; return route.abort() })
    await page.route('**/api/v1/me/identity-verification/images', route => { writes++; return route.abort() })
    await page.route('**/api/v1/me/profile', route => {
      profileReads++
      if (profileReads === 1) return new Promise<void>(resolve => { releaseProfile = async () => { await route.fulfill({ json: envelope(blank) }); resolve() } })
      return route.fulfill({ json: envelope(blank) })
    })
    await page.goto('/mobile/#/pages/identity/index')
    await expect(page.getByText('身份核验处理中', { exact: true })).toBeVisible()
    expect(profileReads).toBe(0)
    await releaseSession()
    await expect.poll(() => profileReads).toBe(1)
    const portrait = page.getByRole('button', { name: '身份证人像面', exact: true })
    await expect(portrait).toHaveAttribute('aria-disabled', 'true')
    await portrait.dispatchEvent('click')
    await expect(page.getByText('上传身份证人像面', { exact: true })).toBeHidden()
    await expect(page.locator('#identity-submit')).toHaveClass(/is-disabled/)
    await releaseProfile()
    await expect(page).toHaveURL(/pages\/profile\/info\?onboarding=1$/)
    expect(writes).toBe(0)
  })
}

test('unloaded identity page ignores a late profile read after a new profile page has a draft', async ({ page }) => {
  await mocks(page)
  let reads = 0, release: () => Promise<void> = async () => {}
  await page.route('**/api/v1/me/profile', route => {
    reads++
    if (reads === 1) return new Promise<void>(resolve => { release = async () => { await route.fulfill({ json: envelope(blank) }); resolve() } })
    return route.fulfill({ json: envelope(blank) })
  })
  await page.goto('/mobile/#/pages/identity/index')
  await expect.poll(() => reads).toBe(1)
  // H5 reLaunch unloads the identity page without requiring onHide first.
  await page.evaluate(() => uni.reLaunch({ url: '/pages/profile/info' }))
  const name = page.getByRole('textbox').first()
  await expect(name).toBeEditable()
  await name.fill('新页面的姓名草稿')
  await release()
  // Let the completed transport and uni-app navigation callbacks settle.
  await page.waitForTimeout(200)
  await expect(page).toHaveURL(/pages\/profile\/info$/)
  await expect(name).toHaveValue('新页面的姓名草稿')
})
