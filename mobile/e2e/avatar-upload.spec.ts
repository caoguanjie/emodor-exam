import { expect, test, type Page } from '@playwright/test'

const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yC9sAAAAASUVORK5CYII=', 'base64')
const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })

async function setup(page: Page, mode: 'proxy' | 'direct', storage: 'network' | 'denied' = 'network', learnerState: 'verified' | 'unverified' | 'new' = 'verified') {
  const profile = { id: '17', username: 'avatar-fixture', real_name: '测试学员', phone: null, email: null, avatar_id: null as string | null, occupation: null, gender: null, birthday: null, source: 'external', category_id: '3', category_name: '测试工种', role: 'employee', status: 1 }
  if (learnerState === 'new') Object.assign(profile, { real_name: '', category_id: null, category_name: null })
  const record = { uploads: 0, sessions: 0, cancelled: 0, completed: 0, savedAvatar: null as string | null, storagePuts: 0 }
  await page.route('https://storage.example.test/**', async route => {
    record.storagePuts++
    if (storage === 'network') return route.abort('failed')
    return route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'AccessDenied' })
  })
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    let data: unknown
    if (path.endsWith('/mobile/auth/refresh')) data = { access_token: 'unusable-avatar-browser-fixture', expires_in: 900, user: { ...profile, id: 17, category_id: learnerState === 'new' ? null : 3, identity_status: learnerState === 'verified' ? 'verified' : 'unverified' } }
    else if (path.endsWith('/me/identity-verification')) data = { status: learnerState === 'verified' ? 'verified' : 'unverified', real_name: learnerState === 'verified' ? profile.real_name : null, id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }
    else if (path.endsWith('/me/training-categories')) data = { items: [{ id: '3', name: '测试工种' }], total: 1, page: 1, page_size: 100 }
    else if (path.endsWith('/me/training-category')) { Object.assign(profile, { category_id: '3', category_name: '测试工种' }); data = profile }
    else if (path.endsWith('/me/profile')) {
      if (req.method() === 'POST') { const body = req.postDataJSON(); record.savedAvatar = body.avatar_id; Object.assign(profile, body) }
      data = profile
    } else if (path.endsWith('/media/limits')) data = { upload_mode: mode, image_max_bytes: 10485760, allowed_image_types: ['image/jpeg', 'image/png'] }
    else if (path.endsWith('/media/upload')) {
      record.uploads++
      expect(req.headers().authorization).toBe('Bearer unusable-avatar-browser-fixture')
      expect(req.postDataBuffer()?.toString()).toContain('name="purpose"')
      data = { asset_id: '92', status: 'ready', duration_ms: null }
    } else if (path.endsWith('/media/upload-sessions')) {
      record.sessions++
      data = { session_id: 'avatar-session', state: 'uploading', mode: 'simple', result: null }
    } else if (path.endsWith('/avatar-session/credentials')) data = { mode: 'simple', method: 'PUT', url: 'https://storage.example.test/avatar', headers: { 'Content-Type': 'image/jpeg', 'x-cos-acl': 'private' } }
    else if (path.endsWith('/avatar-session/complete')) { record.completed++; data = null }
    else if (path.endsWith('/avatar-session') && req.method() === 'DELETE') { record.cancelled++; data = null }
    else if (path.endsWith('/tickets')) data = { content_url: '/api/v1/media/tickets/avatar-preview/content', expires_at: '2099-01-01T00:00:00Z' }
    else if (path.endsWith('/content')) return route.fulfill({ contentType: 'image/png', body: tiny })
    else return route.fulfill({ status: 404, json: { code: 40401, message: 'Unexpected fixture request', data: null } })
    return route.fulfill({ json: envelope(data) })
  })
  return record
}

async function chooseAvatar(page: Page, onboarding = false) {
  await page.goto(`/mobile/#/pages/profile/info${onboarding ? '?onboarding=1' : ''}`)
  const button = page.getByRole('button', { name: '更换头像', exact: true })
  await expect(button).toHaveAttribute('aria-disabled', 'false')
  const chooser = page.waitForEvent('filechooser')
  await button.click()
  await (await chooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: tiny })
}

test('proxy avatar upload works without Web Crypto and binds only when saving the profile', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'crypto', { value: {}, configurable: true }))
  const record = await setup(page, 'proxy')
  await chooseAvatar(page)
  await expect(page.getByText('头像已选择，保存后生效', { exact: true })).toBeVisible()
  expect(record).toMatchObject({ uploads: 1, sessions: 0, storagePuts: 0, savedAvatar: null })
  await page.getByText('保存资料', { exact: true }).click()
  await expect.poll(() => record.savedAvatar).toBe('92')
})

test('a browser COS network rejection falls back once without completing the failed direct session', async ({ page }) => {
  const record = await setup(page, 'direct')
  await chooseAvatar(page)
  await expect(page.getByText('头像已选择，保存后生效', { exact: true })).toBeVisible()
  await expect.poll(() => record.cancelled).toBe(1)
  expect(record).toMatchObject({ uploads: 1, sessions: 1, completed: 0, storagePuts: 1 })
})

test('explicit COS denial is not retried through proxy', async ({ page }) => {
  const record = await setup(page, 'direct', 'denied')
  await chooseAvatar(page)
  await expect(page.getByText('照片直传失败，请稍后重试', { exact: true })).toBeVisible()
  expect(record).toMatchObject({ uploads: 0, completed: 0, storagePuts: 2 })
})

test('a late return from the gallery keeps an upload error visible instead of silently reloading it away', async ({ page }) => {
  await setup(page, 'proxy', 'network', 'unverified')
  let releaseUpload!: () => void, uploadStarted = false
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve })
  await page.route('**/api/v1/media/upload', async route => {
    uploadStarted = true
    await uploadGate
    await route.fulfill({ status: 503, json: { code: 50004, message: '测试上传失败，请重试', data: null } })
  })
  await chooseAvatar(page)
  await expect.poll(() => uploadStarted).toBe(true)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  releaseUpload()
  await expect(page.getByText('测试上传失败，请重试', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('测试上传失败，请重试', { exact: true })).toBeVisible()
})

for (const learnerState of ['new', 'unverified'] as const) {
  test(`${learnerState} learner keeps the avatar upload through a late phone gallery hide/show`, async ({ page }) => {
    await setup(page, 'proxy', 'network', learnerState)
    let releaseUpload!: () => void, uploadStarted = false
    const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve })
    await page.route('**/api/v1/media/upload', async route => {
      uploadStarted = true
      await uploadGate
      await route.fallback()
    })
    await chooseAvatar(page, learnerState === 'new')
    await expect.poll(() => uploadStarted).toBe(true)
    // Phone browsers can dispatch the gallery's hide/show after chooseImage
    // has already resolved and the selected photo is being uploaded.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    releaseUpload()
    await expect(page.getByText('头像已选择，保存后生效', { exact: true })).toBeVisible()
  })

  test(`${learnerState} learner can choose and upload an avatar before identity verification`, async ({ page }) => {
    const record = await setup(page, 'proxy', 'network', learnerState)
    await chooseAvatar(page, learnerState === 'new')
    await expect(page.getByText('头像已选择，保存后生效', { exact: true })).toBeVisible()
    expect(record).toMatchObject({ uploads: 1, sessions: 0, storagePuts: 0, savedAvatar: null })
    if (learnerState === 'new') {
      await page.getByRole('textbox').first().fill('新学员')
      await page.getByRole('button', { name: '培训工种', exact: true }).click()
      await page.getByRole('button', { name: '选择测试工种', exact: true }).click()
      await page.getByText('确认培训工种', { exact: true }).click()
      await page.locator('.confirm-sheet__actions').getByText('确认培训工种', { exact: true }).click()
    }
    await page.getByText('保存并去实名认证', { exact: true }).click()
    await expect.poll(() => record.savedAvatar).toBe('92')
    await expect(page).toHaveURL(/pages\/identity\/index/)
  })
}
