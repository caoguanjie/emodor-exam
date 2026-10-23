import { expect, test, type Page } from '@playwright/test'
const user = { id: 17, username: 'learner-17', real_name: '待认证学员', phone_masked: '138****0000', role: 'employee', source: 'institution', category_id: 3, identity_status: 'unverified' }
const profile = { id: '17', username: 'learner-17', real_name: '待认证学员', phone: '13900000000', email: null, avatar_id: null, occupation: '电工', gender: 'female', birthday: '2000-03-04', source: 'institution', category_id: '3', role: 'employee', status: 1 }
const initial = { status: 'unverified', real_name: null, id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }
const pending = { session_id: 's-1', status: 'pending', reason_code: null, clear_materials: [], expires_at: '2030-01-01T00:00:00Z' }
const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yC9sAAAAASUVORK5CYII=', 'base64')
async function setup(page: Page, options: { rejected?: boolean; foreverPending?: boolean; failLoad?: boolean; alreadyVerified?: boolean; failSave?: boolean; shortTicket?: boolean; createError?: boolean } = {}) {
  const record = { uploads: 0, reads: 0, queries: 0, creates: 0, saves: [] as unknown[], deleted: [] as string[], verified: false, failLoad: !!options.failLoad, avatar: null as string | null, ticketOwners: [] as unknown[] }
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (path.endsWith('/mobile/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'identity-browser-memory', expires_in: 900, user }) })
    if (path.endsWith('/me/identity-verification')) {
      record.reads++
      if (record.failLoad) return route.abort('internetdisconnected')
      return route.fulfill({ json: envelope(record.verified ? { ...initial, status: 'verified', real_name: '权威姓名', id_number_masked: '110***********0017', verified_at: '2026-10-22T00:00:00Z' } : initial) })
    }
    if (path.endsWith('/identity-verification/images')) {
      record.uploads++
      const body = req.postDataBuffer()?.toString() || ''
      const imageType = body.includes('id_card_portrait') ? 'id_card_portrait' : body.includes('id_card_emblem') ? 'id_card_emblem' : 'face'
      return route.fulfill({ json: envelope({ asset_id: `asset-${imageType}-${record.uploads}`, image_type: imageType, scan_status: 'safe', processed_preview: imageType === 'face' ? null : { content_url: `/api/v1/media/tickets/processed-${imageType}/content`, expires_at: '2030-01-01T00:00:00Z' } }) })
    }
    if (req.method() === 'DELETE' && path.includes('/identity-verification/images/')) { record.deleted.push(path.split('/').at(-1)!); return route.fulfill({ json: envelope(null) }) }
    if (path.endsWith('/identity-verification/sessions')) {
      record.creates++
      if (options.alreadyVerified) { record.verified = true; return route.fulfill({ status: 409, json: { code: 40960, message: 'already verified', data: { status: 'verified' } } }) }
      if (options.createError) return route.fulfill({ status: 400, json: { code: 40001, message: '请重拍人像面', data: { reason_code: 'ID_CARD_PORTRAIT_PARSE_FAILED', clear_materials: ['id_card_portrait'] } } })
      return route.fulfill({ json: envelope(pending) })
    }
    if (path.includes('/identity-verification/sessions/')) {
      record.queries++
      if (options.rejected) return route.fulfill({ json: envelope({ ...pending, status: 'rejected', reason_code: 'FACE_MISMATCH', clear_materials: ['face'] }) })
      if (options.foreverPending) return route.fulfill({ json: envelope(pending) })
      record.verified = true; return route.fulfill({ json: envelope({ ...pending, status: 'verified' }) })
    }
    if (path.endsWith('/media/upload')) return route.fulfill({ json: envelope({ asset_id: 'avatar-new', status: 'ready', duration_ms: null }) })
    if (path.endsWith('/me/profile')) {
      if (req.method() === 'POST') { const body = req.postDataJSON(); record.saves.push(body); if (options.failSave && record.saves.length === 1) return route.fulfill({ status: 503, json: { code: 50001, message: '资料保存失败，请重试', data: null } }); if (body.avatar_id) record.avatar = body.avatar_id }
      return route.fulfill({ json: envelope({ ...profile, avatar_id: record.avatar }) })
    }
    if (path.endsWith('/tickets')) { const owner = req.postDataJSON(); record.ticketOwners.push(owner); const firstCover = owner.owner_type === 'training_course_cover' && record.ticketOwners.filter((item: any) => item.owner_type === 'training_course_cover').length === 1; return route.fulfill({ json: envelope({ content_url: '/api/v1/media/tickets/display/content', expires_at: new Date(Date.now() + (options.shortTicket && firstCover ? 1200 : 300000)).toISOString() }) }) }
    if (path.endsWith('/content')) return route.fulfill({ contentType: 'image/png', body: tiny })
    if (path.endsWith('/me/courses')) return route.fulfill({ json: envelope({ items: [{ id: 'c-1', title: '有封面的课程', category_id: '3', cover_asset_id: 'cover-1', status: 'published', required_lesson_count: 1 }], total: 1, page: 1, page_size: 10 }) })
    if (path.endsWith('/progress')) return route.fulfill({ json: envelope({ required: 1, completed: 0, completion_rate: 0, lessons: [] }) })
    return route.fulfill({ status: 404, json: { code: 40401, message: 'unexpected request', data: null } })
  })
  return record
}
async function pick(page: Page, label: string, face = false) {
  await page.getByRole('button', { name: label, exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  if (face) await page.locator('#identity-live-face').click()
  else await page.getByRole('button', { name: '从相册选择', exact: true }).click()
  await (await chooser).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tiny })
  await expect(page.getByText(face ? '已上传 · 重新拍摄' : '已上传 · 可重拍', { exact: true }).first()).toBeVisible()
}
async function collect(page: Page) {
  await pick(page, '身份证人像面'); await pick(page, '身份证国徽面'); await pick(page, '本人正脸照片', true)
  await page.getByText('我已阅读并同意', { exact: true }).click()
}
test('active entry stays unverified, cancel uploads nothing, three images then authority refresh shows success', async ({ page }) => {
  const record = await setup(page)
  await page.goto('/#/pages/profile/index')
  await expect(page.getByText('未实名', { exact: true })).toBeVisible()
  await page.getByText('实名认证', { exact: true }).click()
  await expect(page.locator('#identity-submit')).toHaveClass(/is-disabled/)
  await page.getByRole('button', { name: '身份证人像面', exact: true }).click()
  await page.getByText('取消', { exact: true }).click(); expect(record.uploads).toBe(0)
  await collect(page)
  await expect(page.locator('.capture__preview img').first()).toHaveAttribute('src', `${new URL(page.url()).origin}/api/v1/media/tickets/processed-id_card_portrait/content`)
  await page.locator('#identity-submit').click()
  await expect(page.getByText('实名认证成功', { exact: true })).toBeVisible()
  await expect(page.getByText('权威姓名', { exact: true })).toBeVisible()
  expect(record.uploads).toBe(3); expect(record.creates).toBe(1); expect(record.reads).toBeGreaterThanOrEqual(2)
  await page.getByText('查看实名信息', { exact: true }).click()
  await expect(page.getByText('已通过实名认证', { exact: true })).toBeVisible()
  await expect(page.locator('.identity-result__list').getByText('权威姓名', { exact: true })).toBeVisible()
  await expect(page.locator('.identity-result__list').getByText('110***********0017', { exact: true })).toBeVisible()
})
test('failed authority read offers retry rather than a collect form', async ({ page }) => {
  const record = await setup(page, { failLoad: true }); await page.goto('/#/pages/identity/index')
  await expect(page.getByText('暂时无法获取实名状态', { exact: true })).toBeVisible()
  await expect(page.locator('#identity-submit')).toHaveCount(0)
  record.failLoad = false; await page.getByText('重新加载', { exact: true }).click()
  await expect(page.locator('#identity-submit')).toBeVisible()
})
test('rejection clears just face and leaves processed ID previews for a new photo', async ({ page }) => {
  await setup(page, { rejected: true }); await page.goto('/#/pages/identity/index'); await collect(page); await page.locator('#identity-submit').click()
  await expect(page.getByText('正脸核验未通过，请本人重新现场拍照。', { exact: true })).toBeVisible()
  await expect(page.getByText('已上传 · 可重拍', { exact: true })).toHaveCount(2)
  await expect(page.getByText('已上传 · 重新拍摄', { exact: true })).toHaveCount(0)
})
test('pending stops after twelve queries and allows manual query', async ({ page }) => {
  const record = await setup(page, { foreverPending: true }); await page.goto('/#/pages/identity/index'); await collect(page); await page.locator('#identity-submit').click()
  await expect.poll(() => record.queries, { timeout: 12000 }).toBe(12)
  await expect(page.locator('#identity-query-status')).not.toHaveClass(/is-disabled/)
  await page.locator('#identity-query-status').click(); await expect.poll(() => record.queries).toBeGreaterThan(12)
  await expect(page.getByText('实名认证成功', { exact: true })).toHaveCount(0)
})
test('avatar upload waits for profile save and course covers use their owner policy', async ({ page }) => {
  const record = await setup(page, { failSave: true, shortTicket: true }); await page.goto('/#/pages/profile/info')
  await expect(page.getByRole('button', { name: '更换头像', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '更换头像', exact: true })).toHaveAttribute('aria-disabled', 'false')
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '更换头像', exact: true }).click(); await (await chooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: tiny })
  await expect(page.getByText('头像已选择，保存后生效', { exact: true })).toBeVisible(); expect(record.saves).toEqual([])
  await page.getByText('保存资料', { exact: true }).click(); await expect(page.getByText('资料保存失败，请重试', { exact: true })).toBeVisible()
  await expect(page.getByText('头像已选择，保存后生效', { exact: true })).toBeVisible(); expect(record.avatar).toBeNull()
  await page.getByText('保存资料', { exact: true }).click(); await expect.poll(() => record.avatar).toBe('avatar-new')
  await page.goto('/#/pages/course/index'); await expect(page.getByText('有封面的课程', { exact: true })).toBeVisible()
  await expect(page.locator('.course-card__cover img').first()).toHaveAttribute('src', `${new URL(page.url()).origin}/api/v1/media/tickets/display/content`)
  await expect.poll(() => record.ticketOwners).toContainEqual({ owner_type: 'training_course_cover', owner_id: 'c-1' })
  await expect.poll(() => record.ticketOwners.filter((owner: any) => owner.owner_type === 'training_course_cover').length).toBeGreaterThanOrEqual(2)
})
test('already verified conflict refreshes authority instead of resubmitting', async ({ page }) => {
  const record = await setup(page, { alreadyVerified: true }); await page.goto('/#/pages/identity/index'); await collect(page); await page.locator('#identity-submit').click()
  await expect(page.getByText('实名认证成功', { exact: true })).toBeVisible(); expect(record.creates).toBe(1)
})
test('create errors clear the selected slot from structured data', async ({ page }) => {
  await setup(page, { createError: true }); await page.goto('/#/pages/identity/index'); await collect(page); await page.locator('#identity-submit').click()
  await expect(page.getByText('请重拍人像面', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '身份证人像面', exact: true })).toContainText('拍照 / 相册选择')
  await expect(page.getByRole('button', { name: '身份证国徽面', exact: true })).toContainText('已上传')
  await expect(page.getByRole('button', { name: '本人正脸照片', exact: true })).toContainText('已上传')
})
test('leaving during an upload discards its late response and releases the unused asset', async ({ page }) => {
  const record = await setup(page)
  let finish: (() => Promise<void>) | undefined
  await page.route('**/me/identity-verification/images', async route => { finish = () => route.fulfill({ json: envelope({ asset_id: 'late-face', image_type: 'face', scan_status: 'safe', processed_preview: null }) }); await new Promise<void>(resolve => { const done = finish!; finish = async () => { await done(); resolve() } }) })
  await page.goto('/#/pages/identity/index'); await page.getByRole('button', { name: '本人正脸照片', exact: true }).click()
  const chooser = page.waitForEvent('filechooser'); await page.locator('#identity-live-face').click(); await (await chooser).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tiny })
  await expect.poll(() => !!finish).toBe(true)
  await page.getByRole('button', { name: '返回', exact: true }).click(); await expect(page).toHaveURL(/pages\/profile\/index$/)
  await finish!(); await expect.poll(() => record.deleted).toContain('late-face')
  await page.getByText('实名认证', { exact: true }).click(); await expect(page.getByText('已上传 · 重新拍摄', { exact: true })).toHaveCount(0)
})
test('large synthetic camera material is reduced to a 1600-pixel local preview', async ({ page }) => {
  await setup(page); await page.goto('/#/pages/identity/index')
  await expect(page.getByText('照片仅用于本人身份核验，请确保清晰。', { exact: true })).toBeVisible()
  const data = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1800; canvas.getContext('2d')!.fillRect(0, 0, 2400, 1800); return canvas.toDataURL('image/png').split(',')[1] })
  await page.getByRole('button', { name: '本人正脸照片', exact: true }).click()
  const chooser = page.waitForEvent('filechooser'); await page.locator('#identity-live-face').click()
  const input = await chooser; expect(await input.element().getAttribute('capture')).toBe('camera')
  await input.setFiles({ name: 'synthetic-large.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })
  await expect(page.getByText('已上传 · 重新拍摄', { exact: true })).toBeVisible()
  const size = await page.locator('.capture__face-preview img').evaluate((img: HTMLImageElement) => ({ width: img.naturalWidth, height: img.naturalHeight }))
  expect(size).toEqual({ width: 1600, height: 1200 })
})
test('public branding renders all published banners without private tickets', async ({ page }) => {
  const record = await setup(page); const assets: string[] = []
  await page.route('**/api/v1/me/home?**', route => route.fulfill({ json: envelope({ site_config: { logo_asset_id: 'public-logo', banners: [{ asset_id: 'public-banner-1', sort: 0 }, { asset_id: 'public-banner-2', sort: 1 }] }, courses: { items: [], total: 0, page: 1, page_size: 4 } }) }))
  await page.route('**/api/v1/site-config/assets/*/content', route => { assets.push(new URL(route.request().url()).pathname.split('/').at(-2)!); return route.fulfill({ contentType: 'image/png', body: tiny }) })
  await page.goto('/#/pages/home/index')
  await expect(page.locator('.home-brand__logo img')).toHaveAttribute('src', `${new URL(page.url()).origin}/api/v1/site-config/assets/public-logo/content`)
  await expect.poll(() => assets).toContain('public-banner-2')
  expect(assets).toContain('public-logo'); expect(assets).toContain('public-banner-1'); expect(record.ticketOwners).toEqual([])
})
