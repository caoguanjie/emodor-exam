import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const progress = { confirmed_position_ms: 12000, credited_ms: 9000, coverage_ms: 9000, duration_ms: 120000, completed: false, last_seq: 4 }
async function setup(page: Page, reason?: string) {
  const calls: { path: string; data: any }[] = []
  // Native decoding/device behavior is tested separately; these tests exercise our
  // uni event wiring against controlled browser media events and real page code.
  await page.addInitScript(() => {
    document.addEventListener('error', event => { if (event.isTrusted && event.target instanceof HTMLVideoElement) event.stopImmediatePropagation() }, true)
    HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event('play')); return Promise.resolve() }
    HTMLMediaElement.prototype.pause = function () { this.dispatchEvent(new Event('pause')) }
  })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname, data = route.request().postDataJSON()
    calls.push({ path, data })
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'video-browser-access', expires_in: 900, user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'unverified' } }) })
    if (path.endsWith('/courses/41')) return route.fulfill({ json: envelope({ id: '41', title: '接口视频课程', category_id: '3', cover_asset_id: null, status: 'published', required_lesson_count: 2, description: '视频课程说明', chapters: [{ id: '51', title: '接口课程目录', sort_order: 1, lessons: [{ id: '61', title: '接口第一课', required: true, sort_order: 1, lesson_type: 'video', current_version: { version_id: '999', asset_id: '888', duration_ms: 120000 } }, { id: '62', title: '接口第二课', required: true, sort_order: 2, lesson_type: 'video', current_version: { version_id: '998', asset_id: '887', duration_ms: 120000 } }] }] }) })
    if (path.endsWith('/progress')) return route.fulfill({ json: envelope({ required: 2, completed: 1, completion_rate: 0.5, lessons: [{ ...progress, lesson_id: '62', version_id: '998' }, { ...progress, lesson_id: '61', version_id: '999', completed: true, confirmed_position_ms: 120000 }] }) })
    if (path.endsWith('/video-sessions')) {
      if (reason) return route.fulfill({ status: 403, json: { code: 40302, message: 'opaque provider message', data: { reason_code: reason } } })
      return route.fulfill({ json: envelope({ session_id: data.lesson_id === '62' ? '82' : '81', version_id: '71', heartbeat_interval_ms: 30000, media: { asset_id: '91', ticket: { content_url: '/api/v1/media/tickets/video-current/content', expires_at: new Date(Date.now() + 300000).toISOString() } }, progress }) })
    }
    if (path.endsWith('/heartbeat') || path.endsWith('/close')) return route.fulfill({ json: envelope(progress) })
    if (path.endsWith('/content')) return route.fulfill({ status: 204 })
    return route.fulfill({ status: 404, json: { code: 40401, message: 'unexpected request', data: null } })
  })
  return calls
}
async function emit(page: Page, event: string, seconds?: number) {
  await page.locator('video').evaluate((video: HTMLVideoElement, args) => {
    if (args.seconds !== undefined) Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: args.seconds })
    video.dispatchEvent(new Event(args.event))
  }, { event, seconds })
}
test('entry waits for an explicit click, consumes start authority, and wires native state events', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
  await expect(page.getByText('接口视频课程', { exact: true })).toBeVisible()
  expect(calls.some(c => c.path.endsWith('/video-sessions'))).toBe(false)
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click()
  await expect(page.locator('video')).toHaveAttribute('src', `${new URL(page.url()).origin}/api/v1/media/tickets/video-current/content`)
  await emit(page, 'loadedmetadata')
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).at(-1)?.data).toMatchObject({ seq: 5, state: 'playing', position_ms: 12000 })
  await emit(page, 'waiting'); await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).at(-1)?.data.state).toBe('buffering')
  await emit(page, 'timeupdate', 13); await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).at(-1)?.data).toMatchObject({ state: 'playing', position_ms: 13000 })
  await emit(page, 'pause'); await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).at(-1)?.data.state).toBe('paused')
  await page.getByRole('button', { name: '接口第二课', exact: true }).click()
  await expect.poll(() => calls.some(c => c.path.endsWith('/81/close'))).toBe(true)
  expect(calls.filter(c => c.path.endsWith('/video-sessions'))).toHaveLength(1)
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click()
  await expect.poll(() => calls.filter(c => c.path.endsWith('/video-sessions')).at(-1)?.data).toEqual({ lesson_id: '62' })
})
test('historical progress stays attached to stable lesson IDs when selecting lessons and revisiting detail', async ({ page }) => {
  await setup(page); await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
  await expect(page.getByRole('button', { name: '接口第一课', exact: true })).toContainText('已完成')
  await expect(page.getByRole('button', { name: '接口第二课', exact: true })).toContainText('已学 7%')
  await page.getByRole('button', { name: '接口第二课', exact: true }).click()
  await expect(page.getByRole('button', { name: '接口第一课', exact: true })).toContainText('已完成')
  await expect(page.getByRole('button', { name: '接口第二课', exact: true })).toContainText('已学 7%')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('button', { name: '接口第一课', exact: true })).toContainText('已完成')
  await expect(page.getByRole('button', { name: '接口第二课', exact: true })).toContainText('已学 7%')
})
test('zero-progress playback responds immediately while server percentages and folded chapters stay authoritative', async ({ page }) => {
  await setup(page)
  const zero = { ...progress, confirmed_position_ms: 0, credited_ms: 0, coverage_ms: 0, last_seq: 0 }
  await page.route('**/api/v1/me/courses/41/progress', route => route.fulfill({ json: envelope({ required: 2, completed: 0, completion_rate: 0, lessons: [{ ...zero, lesson_id: '61', version_id: '999' }, { ...zero, lesson_id: '62', version_id: '998' }] }) }))
  await page.route('**/api/v1/me/video-sessions', route => route.fulfill({ json: envelope({ session_id: '81', version_id: '999', heartbeat_interval_ms: 30000, media: { asset_id: '91', ticket: { content_url: '/api/v1/media/tickets/video-current/content', expires_at: new Date(Date.now() + 300000).toISOString() } }, progress: zero }) }))
  let release = () => {}
  let entered = false
  const hold = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/me/video-sessions/81/heartbeat', async route => {
    entered = true
    await hold
    return route.fulfill({ json: envelope({ ...zero, confirmed_position_ms: 60000, credited_ms: 180000, coverage_ms: 30000, last_seq: 1 }) })
  })
  await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
  const first = page.getByRole('button', { name: '接口第一课', exact: true })
  const second = page.getByRole('button', { name: '接口第二课', exact: true })
  await expect(first).toContainText('0%')
  await expect(first).toHaveClass(/chapter-list__lesson--selected/)
  await expect(first).not.toContainText('正在学习')
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click()
  await expect(page.locator('video')).toBeVisible()
  await emit(page, 'loadedmetadata')
  await expect.poll(() => entered).toBe(true)
  await expect(first).toContainText('正在学习')
  await expect(first).toContainText('0%')
  const chapter = page.getByRole('button', { name: '接口课程目录', exact: true })
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-expanded', 'false')
  release()
  await expect(first).toContainText('已学 25%')
  await expect(chapter).toHaveAttribute('aria-expanded', 'false')
  await chapter.click()
  await emit(page, 'pause')
  await expect(first).not.toContainText('正在学习')
  await emit(page, 'play')
  await expect(first).toContainText('正在学习')
  await emit(page, 'waiting')
  await expect(first).not.toContainText('正在学习')
  await emit(page, 'play')
  await second.click()
  await expect(first).not.toHaveClass(/chapter-list__lesson--selected/)
  await expect(first).not.toContainText('正在学习')
  await expect(second).toHaveClass(/chapter-list__lesson--selected/)
  await expect(second).not.toContainText('正在学习')
})
test('native failure reports a non-playing state and offers explicit retry', async ({ page }) => {
  const calls = await setup(page); await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click(); await expect(page.locator('video')).toBeVisible(); await emit(page, 'loadedmetadata')
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).length).toBe(1)
  await emit(page, 'error'); await expect(page.getByText('视频加载失败，请重试', { exact: true })).toBeVisible()
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).at(-1)?.data.state).toBe('paused')
  await page.getByRole('button', { name: '重试播放', exact: true }).click()
  await expect.poll(() => calls.filter(c => c.path.endsWith('/video-sessions')).length).toBe(2)
})
test('browser background pauses once, foreground waits for a click, and leaving closes the session', async ({ page }) => {
  const calls = await setup(page); await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click(); await expect(page.locator('video')).toBeVisible(); await emit(page, 'loadedmetadata')
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).length).toBe(1)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat') && c.data.state === 'background').length).toBe(1)
  expect(calls.some(c => c.path.endsWith('/close'))).toBe(false)
  const beats = calls.filter(c => c.path.endsWith('/heartbeat')).length
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForTimeout(100)
  expect(calls.filter(c => c.path.endsWith('/heartbeat'))).toHaveLength(beats)
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play())
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).at(-1)?.data.state).toBe('playing')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect.poll(() => calls.some(c => c.path.endsWith('/81/close'))).toBe(true)
})
test('ended playback is removed and the explicit replay starts a fresh session from zero', async ({ page }) => {
  const calls = await setup(page); await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click(); await expect(page.locator('video')).toBeVisible(); await emit(page, 'loadedmetadata')
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).length).toBe(1)
  await emit(page, 'ended')
  await expect(page.locator('video')).toHaveCount(0)
  await page.getByRole('button', { name: '重新播放', exact: true }).click()
  await expect(page.locator('video')).toBeVisible(); await emit(page, 'loadedmetadata')
  await expect.poll(() => calls.filter(c => c.path.endsWith('/video-sessions')).length).toBe(2)
  await expect.poll(() => calls.filter(c => c.path.endsWith('/heartbeat')).at(-1)?.data).toEqual({ seq: 5, state: 'playing', position_ms: 0 })
})
test('a terminal heartbeat removes playback and refreshes authoritative course progress', async ({ page }) => {
  const calls = await setup(page)
  await page.route('**/api/v1/me/video-sessions/*/heartbeat', route => { calls.push({ path: new URL(route.request().url()).pathname, data: route.request().postDataJSON() }); return route.fulfill({ status: 409, json: { code: 40951, message: '课程已下架，请刷新', data: null } }) })
  await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click(); await expect(page.locator('video')).toBeVisible(); await emit(page, 'loadedmetadata')
  await expect(page.getByText('课程已下架，请刷新', { exact: true })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expect.poll(() => calls.filter(c => c.path.endsWith('/progress')).length).toBe(2)
  expect(calls.filter(c => c.path.endsWith('/video-sessions'))).toHaveLength(1)
})
for (const reason of ['IDENTITY_REQUIRED', 'IDENTITY_PENDING']) {
  test(`structured ${reason} offers the matching identity entry`, async ({ page }) => {
    await setup(page, reason); await page.goto('/#/pages/course/player?course_id=41&lesson_id=61')
    await page.getByRole('button', { name: '播放课程视频', exact: true }).click()
    await expect(page.getByText(reason === 'IDENTITY_PENDING' ? '实名认证正在处理中，请稍后查看' : '完成实名认证后即可学习视频课程', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: reason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证', exact: true })).toBeVisible()
    await expect(page.getByText('opaque provider message')).toHaveCount(0)
  })
}
