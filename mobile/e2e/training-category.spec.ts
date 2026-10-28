import { expect, test, type Page } from '@playwright/test'

const initial = { id: '17', username: 'learner', real_name: '实名权威姓名', phone: '13800000000', email: null, avatar_id: null, occupation: '旧职业不能作工种', gender: 'female', birthday: '2000-03-04', source: 'external', category_id: null as string | null, category_name: null as string | null, role: 'employee', status: 1 }
const categories = [{ id: '9007199254740993', name: '真实高处作业' }, { id: '42', name: '真实焊接作业' }]
const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
async function setup(page: Page, selected = false) {
  const state = { profile: { ...initial, ...(selected ? { category_id: '42', category_name: 'PC 已分配工种' } : {}) }, categories: [...categories], categoryPageSize: 1, writes: [] as unknown[], saves: [] as unknown[], reads: 0, readFails: false, loseResponse: false, identity: 'unverified', identityFails: false, emptyCategories: false, exams: [] as unknown[] }
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method()
    if (url.pathname.endsWith('/mobile/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'browser-memory-access', expires_in: 900, user: { id: 17, username: 'learner', real_name: '实名权威姓名', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'unverified' } }) })
    if (url.pathname.endsWith('/me/profile')) {
      if (method === 'GET') { state.reads++; if (state.readFails) return route.abort('internetdisconnected') }
      else { state.saves.push(route.request().postDataJSON()); state.profile = { ...state.profile, ...route.request().postDataJSON() } }
      return route.fulfill({ json: envelope(state.profile) })
    }
    if (url.pathname.endsWith('/me/training-categories')) {
      const pageNumber = Number(url.searchParams.get('page'))
      expect(url.searchParams.get('page_size')).toBe('100')
      return route.fulfill({ json: envelope({ items: state.emptyCategories ? [] : state.categories.slice((pageNumber - 1) * state.categoryPageSize, pageNumber * state.categoryPageSize), total: state.emptyCategories ? 0 : state.categories.length, page: pageNumber, page_size: state.categoryPageSize }) })
    }
    if (url.pathname.endsWith('/me/training-category')) {
      expect(method).toBe('PUT'); const data = route.request().postDataJSON(); state.writes.push(data)
      const category = state.categories.find(item => item.id === data.category_id)!
      state.profile = { ...state.profile, category_id: category.id, category_name: category.name }
      if (state.loseResponse) return route.abort('internetdisconnected')
      return route.fulfill({ json: envelope(state.profile) })
    }
    if (url.pathname.endsWith('/me/identity-verification')) {
      if (state.identityFails) return route.abort('internetdisconnected')
      return route.fulfill({ json: envelope({ status: state.identity, real_name: state.identity === 'verified' ? '实名权威姓名' : null, id_number_masked: null, verified_at: null, current_session_id: null, reason_code: state.identity === 'rejected' ? 'FACE_MISMATCH' : null }) })
    }
    if (url.pathname.endsWith('/me/exams')) return route.fulfill({ json: envelope({ items: state.exams, total: state.exams.length, page: 1, page_size: 10 }) })
    return route.fulfill({ json: envelope({ items: [], total: 0, page: 1, page_size: 10 }) })
  })
  return state
}
async function select(page: Page, name = '真实高处作业') {
  await page.getByRole('button', { name: '培训工种', exact: true }).click()
  await page.getByRole('button', { name: `选择${name}`, exact: true }).click()
}

test('selection and cancel are drafts; explicit confirmation saves the real ID once and locks it', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/#/pages/profile/info')
  await select(page)
  expect(state.writes).toEqual([])
  await page.locator('.category-field > .wd-button').getByText('确认培训工种', { exact: true }).click()
  await expect(page.getByText('你选择的培训工种为「真实高处作业」。确认后将用于匹配考试，学员端无法自行修改。如需调整，请联系管理员或监考人员。', { exact: true })).toBeVisible()
  await page.getByText('返回修改', { exact: true }).click()
  expect(state.writes).toEqual([])
  await page.locator('.category-field > .wd-button').getByText('确认培训工种', { exact: true }).click()
  await page.locator('.confirm-sheet__actions').getByText('确认培训工种', { exact: true }).click()
  await expect(page.getByText('培训工种已确认', { exact: true })).toBeVisible()
  expect(state.writes).toEqual([{ category_id: '9007199254740993' }])
  await expect(page.getByRole('button', { name: '培训工种', exact: true })).toHaveCount(0)
  await expect(page.locator('.category-field__value')).toHaveText('真实高处作业')
  await page.getByText('保存并去实名认证', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/identity\/index$/)
  expect(state.saves).toEqual([{ real_name: initial.real_name, gender: 'female', birthday: '2000-03-04' }])
})

test('preassigned category displays its current name and refreshes on return without losing ordinary drafts', async ({ page }) => {
  const state = await setup(page, true)
  await page.goto('/#/pages/profile/info')
  await expect(page.getByText('PC 已分配工种', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '培训工种', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '性别', exact: true }).click()
  await page.getByRole('button', { name: '选择男', exact: true }).click()
  const reads = state.reads
  await page.evaluate(() => uni.navigateTo({ url: '/pages/profile/terms' }))
  await expect(page.getByText('一、服务内容', { exact: true })).toBeVisible()
  state.profile = { ...state.profile, category_name: 'PC 改名后的工种', gender: 'female', birthday: '1999-01-01' }
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('PC 改名后的工种', { exact: true })).toBeVisible()
  await expect.poll(() => state.reads).toBeGreaterThan(reads)
  await expect(page.getByRole('button', { name: '性别', exact: true })).toContainText('男')
  await expect(page.getByRole('button', { name: '生日', exact: true })).toContainText('1999-01-01')
})

test('lost response is reconciled by GET and failed readback requires refresh before further choices', async ({ page }) => {
  const state = await setup(page); state.loseResponse = true
  await page.goto('/#/pages/profile/info'); await select(page)
  await page.locator('.category-field > .wd-button').getByText('确认培训工种', { exact: true }).click()
  state.readFails = true
  await page.locator('.confirm-sheet__actions').getByText('确认培训工种', { exact: true }).click()
  await expect(page.getByText('保存结果暂时无法确认，请刷新资料后再操作。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '培训工种', exact: true })).toHaveAttribute('aria-disabled', 'true')
  expect(state.writes).toHaveLength(1)
  state.readFails = false
  await page.getByText('刷新资料', { exact: true }).click()
  await expect(page.locator('.category-field__value')).toHaveText('真实高处作业')
  await expect(page.getByRole('button', { name: '培训工种', exact: true })).toHaveCount(0)
  expect(state.writes).toHaveLength(1)
})

test('empty enabled categories display a real empty state and do not offer confirmation', async ({ page }) => {
  const state = await setup(page); state.emptyCategories = true
  await page.goto('/#/pages/profile/info')
  await expect(page.getByText('暂无可选培训工种，请联系管理员或监考人员。', { exact: true })).toBeVisible()
  await expect(page.getByText('确认培训工种', { exact: true })).toHaveCount(0)
  expect(state.writes).toEqual([])
})

test('a failed profile refresh on return offers an in-place retry and preserves unsaved fields', async ({ page }) => {
  const state = await setup(page, true)
  await page.goto('/#/pages/profile/info')
  await expect(page.locator('.category-field__value')).toHaveText('PC 已分配工种')
  await page.getByRole('button', { name: '性别', exact: true }).click()
  await page.getByRole('button', { name: '选择男', exact: true }).click()
  await page.evaluate(() => uni.navigateTo({ url: '/pages/profile/terms' }))
  await expect(page.getByText('一、服务内容', { exact: true })).toBeVisible()
  state.readFails = true
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('网络连接失败，请检查网络后重试', { exact: true })).toBeVisible()
  await expect(page.getByText('重新加载', { exact: true })).toBeVisible()
  state.readFails = false; state.profile.category_name = '重试后的工种'
  await page.getByText('重新加载', { exact: true }).click()
  await expect(page.locator('.category-field__value')).toHaveText('重试后的工种')
  await expect(page.getByRole('button', { name: '性别', exact: true })).toContainText('男')
})

test('opening personal info during the profile tab read still initializes the form', async ({ page }) => {
  const state = await setup(page, true)
  let reads = 0, finishFirstRead: () => Promise<void> = async () => {}
  await page.route('**/api/v1/me/profile', route => {
    reads++
    if (reads === 1) { finishFirstRead = () => route.fulfill({ json: envelope(state.profile) }); return }
    return route.fulfill({ json: envelope(state.profile) })
  })
  await page.goto('/#/pages/profile/index')
  await expect.poll(() => reads).toBe(1)
  await page.getByRole('button', { name: '查看个人资料', exact: true }).click()
  await expect(page).toHaveURL(/pages\/profile\/info$/)
  // Wait until the new page is interactable while the first read is still held.
  await page.getByRole('button', { name: '性别', exact: true }).click({ force: true })
  await finishFirstRead()
  await expect(page.getByRole('textbox').first()).toHaveValue('实名权威姓名')
  await expect(page.locator('.category-field__value')).toHaveText('PC 已分配工种')
  await expect(page.getByText('保存并去实名认证', { exact: true })).toBeVisible()
})

test('a long category list scrolls to and selects the final real ID', async ({ page }) => {
  const state = await setup(page)
  state.categories = Array.from({ length: 35 }, (_, index) => ({ id: String(1000 + index), name: `接口培训工种${index + 1}` }))
  state.categoryPageSize = 100
  await page.goto('/#/pages/profile/info')
  await page.getByRole('button', { name: '培训工种', exact: true }).click()
  const scroller = page.locator('.category-picker__options .uni-scroll-view .uni-scroll-view')
  const geometry = await scroller.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }))
  expect(geometry.height).toBeGreaterThan(0)
  expect(geometry.content).toBeGreaterThan(geometry.height)
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.getByRole('button', { name: '选择接口培训工种35', exact: true }).click()
  await expect(page.locator('.category-field__value')).toHaveText('接口培训工种35')
  await page.locator('.category-field > .wd-button').getByText('确认培训工种', { exact: true }).click()
  await page.locator('.confirm-sheet__actions').getByText('确认培训工种', { exact: true }).click()
  await expect.poll(() => state.writes).toEqual([{ category_id: '1034' }])
})

test('exam guidance prioritizes the missing category while keeping visible exam entries reachable', async ({ page }) => {
  const state = await setup(page)
  state.exams = [{ paper_id: '91', title: '当前可见考试', mode: 'training', status: 'published', source: 'external', category_id: null, difficulty: 'easy' }, { paper_id: '92', title: '本人答题中考试', mode: 'training', status: 'withdrawn', source: 'external', category_id: null, difficulty: 'easy', active_record_id: '82' }]
  await page.goto('/#/pages/exam/index')
  await expect(page.locator('.exam-guidance')).toContainText('请选择培训工种，以便匹配考试。')
  await expect(page.getByText('当前可见考试', { exact: true })).toBeVisible()
  await expect(page.getByText('本人答题中考试', { exact: true })).toBeVisible()
  await expect(page.getByText('考试记录', { exact: true })).toHaveCount(0)
  await expect(page.locator('.exam-card').first().getByText('进入考试', { exact: true })).toBeVisible()
  await page.locator('.exam-guidance').getByText('去选择培训工种', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/profile\/info$/)
})

for (const status of ['unverified', 'pending', 'rejected', 'error', 'verified']) {
  test(`exam identity guidance distinguishes ${status} from the normal empty state`, async ({ page }) => {
    const state = await setup(page, true); state.identity = status === 'error' ? 'unverified' : status; state.identityFails = status === 'error'
    await page.goto('/#/pages/exam/index')
    const expected: Record<string, string> = { unverified: '完成实名认证后即可参加新的考试。', pending: '实名认证正在处理中，请查看认证进度。', rejected: '实名认证未通过，请重新核验后参加新的考试。', error: '实名认证状态加载失败，请刷新后重试。', verified: '暂无考试' }
    await expect(page.getByText(expected[status], { exact: true })).toBeVisible()
    if (status === 'verified') await expect(page.locator('.exam-guidance')).toHaveCount(0)
    else await expect(page.getByText('考试记录', { exact: true })).toHaveCount(0)
  })
}

test('static profile scenarios never request real APIs through category confirmation', async ({ page }) => {
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) calls.push(request.url()) })
  await page.goto('/#/pages/profile/info?scenario=profile-job')
  await page.getByRole('button', { name: '选择电工', exact: true }).click()
  await page.locator('.category-field > .wd-button').getByText('确认培训工种', { exact: true }).click()
  await page.locator('.confirm-sheet__actions').getByText('确认培训工种', { exact: true }).click()
  await expect(page.locator('.category-field__value')).toHaveText('电工')
  expect(calls).toEqual([])
})
