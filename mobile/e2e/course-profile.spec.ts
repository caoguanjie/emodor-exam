import { expect, test, type Page } from '@playwright/test'

const user = { id: 17, username: 'learner-17', real_name: '会话旧姓名', phone_masked: '138****0000', role: 'employee', source: 'institution', category_id: 3, identity_status: 'unverified' }
const profile = { id: '17', username: 'learner-17', real_name: '真实学员姓名', phone: '13900000000', email: null, avatar_id: null, occupation: '电工', gender: 'female', birthday: '2000-03-04', source: 'external', category_id: '9007199254740993', role: 'employee', status: 1 }
const first = { id: '9007199254740995', title: '接口推荐课程', category_id: '9007199254740993', cover_asset_id: null, status: 'published', required_lesson_count: 2 }
const second = { ...first, id: '9007199254740996', title: '接口第二门课程' }
function envelope(data: unknown) { return { code: 0, message: 'ok', data } }
async function auth(page: Page) {
  await page.route('**/api/v1/mobile/auth/refresh', route => route.fulfill({ json: envelope({ access_token: 'course-browser-access', expires_in: 900, user }) }))
}
async function courses(page: Page) {
  await auth(page)
  await page.route('**/api/v1/me/home?**', route => route.fulfill({ json: envelope({ site_config: { logo_asset_id: null, banners: [] }, courses: { items: [first], total: 2, page: 1, page_size: 4 } }) }))
  await page.route('**/api/v1/me/courses?**', route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'))
    return route.fulfill({ json: envelope({ items: [pageNumber === 1 ? first : second], total: 2, page: pageNumber, page_size: 1 }) })
  })
  await page.route('**/api/v1/me/courses/*', route => route.fulfill({ json: envelope({ ...first, description: '接口课程介绍', chapters: [{ id: 'chapter-1', title: '接口第一章', sort_order: 1, lessons: [{ id: 'lesson-9007199254740995', title: '接口第一课', lesson_type: 'video', required: true, sort_order: 1, current_version: null }] }] }) }))
  await page.route('**/api/v1/me/courses/*/progress', route => route.fulfill({ json: envelope({ required: 2, completed: 2, completion_rate: 0.375, lessons: [] }) }))
}

test('home, paged course list, detail, folding, and return use real string IDs', async ({ page }) => {
  const listPages: string[] = []
  page.on('request', request => { if (/\/me\/courses\?/.test(request.url())) listPages.push(new URL(request.url()).searchParams.get('page') || '') })
  await courses(page)
  await page.goto('/#/pages/home/index')
  await expect(page.getByRole('button', { name: '接口推荐课程', exact: true })).toBeVisible()
  await expect(page.getByText('现场隐患排查与整改实训', { exact: true })).toHaveCount(0)
  await page.getByText('更多课程 ›', { exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/course\/index$/)
  await expect(page.getByText('已学习 38%', { exact: true })).toBeVisible()
  await page.getByText('加载更多', { exact: true }).click()
  await expect(page.getByRole('button', { name: '接口第二门课程', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '接口推荐课程', exact: true }).click()
  await expect(page).toHaveURL(/id=9007199254740995$/)
  await expect(page.getByText('接口课程介绍', { exact: true })).toBeVisible()
  const chapter = page.getByRole('button', { name: '接口第一章', exact: true })
  await expect(chapter).toHaveAttribute('aria-expanded', 'true')
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-expanded', 'false')
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/course\/index$/)
  await expect(page.getByText('加载更多', { exact: true })).toBeVisible()
  expect(listPages).toEqual(['1', '2', '1'])
})

test('course load error retries and an empty response stays empty without fixtures', async ({ page }) => {
  await auth(page)
  let attempts = 0
  await page.route('**/api/v1/me/courses?**', route => {
    attempts++
    return attempts === 1 ? route.abort('internetdisconnected') : route.fulfill({ json: envelope({ items: [], total: 0, page: 1, page_size: 10 }) })
  })
  await page.goto('/#/pages/course/index')
  await expect(page.getByText('网络连接失败，请检查网络后重试', { exact: true })).toBeVisible()
  await page.getByText('重新加载', { exact: true }).click()
  await expect(page.getByText('暂无课程', { exact: true })).toBeVisible()
  await expect(page.locator('.course-card')).toHaveCount(0)
})

test('API lesson titles receive chapter.lesson codes without changing stable selection IDs', async ({ page }) => {
  await courses(page)
  await page.route('**/api/v1/me/courses/9007199254740995', route => route.fulfill({ json: envelope({ ...first, description: '目录测试', chapters: [
    { id: '101', title: '第一章 安全教育', sort_order: 3, lessons: [
      { id: '201', title: '安全防护', lesson_type: 'video', required: true, sort_order: 5, current_version: null },
      { id: '202', title: '班前会', lesson_type: 'video', required: true, sort_order: 8, current_version: null },
    ] },
    { id: '102', title: '第二章 应急处置', sort_order: 8, lessons: [
      { id: '203', title: '消防演练', lesson_type: 'video', required: false, sort_order: 2, current_version: null },
    ] },
  ] }) }))
  await page.goto('/#/pages/course/detail?id=9007199254740995')
  await expect(page.locator('.chapter-list__name')).toHaveText(['1.1 安全防护', '1.2 班前会', '2.1 消防演练'])
  await expect(page.locator('.chapter-list__section-count')).toHaveText(['2节', '1节'])
  await expect(page.locator('.chapter-list__number')).toHaveText(['1', '2', '3'])
  await page.getByRole('button', { name: '消防演练', exact: true }).click()
  await expect(page).toHaveURL(/course_id=9007199254740995&lesson_id=203$/)
})

test('returning to a populated list retries the first-page failure as page one', async ({ page }) => {
  await courses(page)
  const requestedPages: string[] = []
  await page.route('**/api/v1/me/courses?**', route => {
    const requested = new URL(route.request().url()).searchParams.get('page') || ''
    requestedPages.push(requested)
    if (requestedPages.length === 3) return route.abort('internetdisconnected')
    return route.fulfill({ json: envelope({ items: [requested === '1' ? first : second], total: 2, page: Number(requested), page_size: 1 }) })
  })
  await page.goto('/#/pages/course/index')
  await expect(page.getByRole('button', { name: first.title, exact: true })).toBeVisible()
  await page.getByText('加载更多', { exact: true }).click()
  await expect(page.getByRole('button', { name: second.title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: first.title, exact: true }).click()
  await expect(page.getByText('接口课程介绍', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('网络连接失败，请检查网络后重试', { exact: true })).toBeVisible()
  await page.getByText('重新加载', { exact: true }).click()
  await expect(page.getByText('加载更多', { exact: true })).toBeVisible()
  expect(requestedPages).toEqual(['1', '2', '1', '1'])
})

test('profile saves only editable fields, preserves failed input, and accepts authoritative response', async ({ page }) => {
  await auth(page)
  let saves = 0
  await page.route('**/api/v1/me/profile', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: envelope(profile) })
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ occupation: '班组长', gender: 'female', birthday: '2000-03-04' })
    saves++
    return saves === 1 ? route.abort('internetdisconnected') : route.fulfill({ json: envelope({ ...profile, real_name: '实名权威姓名', occupation: '班组长', phone: '13900001111' }) })
  })
  await page.goto('/#/pages/profile/index')
  await expect(page.getByText('真实学员姓名', { exact: true })).toBeVisible()
  await expect(page.getByText('电工 · 社会学员', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看个人资料', exact: true }).click()
  const name = page.getByRole('textbox').nth(0), phone = page.getByRole('textbox').nth(1)
  await expect(name).toHaveValue('真实学员姓名')
  await expect(phone).toHaveValue('13900000000')
  await expect(name).not.toBeEditable()
  await expect(phone).not.toBeEditable()
  await page.getByRole('button', { name: '工种', exact: true }).click()
  await page.getByRole('button', { name: '选择班组长', exact: true }).click()
  await page.getByText('保存资料', { exact: true }).click()
  await expect(page.getByText('网络连接失败，请检查网络后重试', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '工种', exact: true })).toContainText('班组长')
  await page.getByText('保存资料', { exact: true }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  await expect(name).toHaveValue('实名权威姓名')
  await expect(phone).toHaveValue('13900001111')
})

test('an in-flight profile save locks all choices and cannot overwrite a later user selection', async ({ page }) => {
  await auth(page)
  let finishSave: () => Promise<void> = async () => {}
  let saves = 0
  await page.route('**/api/v1/me/profile', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: envelope(profile) })
    saves++
    expect(route.request().postDataJSON()).toEqual({ occupation: '班组长', gender: 'female', birthday: '2000-03-04' })
    finishSave = () => route.fulfill({ json: envelope({ ...profile, occupation: '班组长' }) })
  })
  await page.goto('/#/pages/profile/info')
  await expect(page.getByRole('textbox').first()).toHaveValue('真实学员姓名')
  await page.getByRole('button', { name: '工种', exact: true }).click()
  await page.getByRole('button', { name: '选择班组长', exact: true }).click()
  await page.getByText('保存资料', { exact: true }).click()
  await expect.poll(() => saves).toBe(1)
  for (const label of ['工种', '性别', '生日']) {
    const field = page.getByRole('button', { name: label, exact: true })
    await expect(field).toHaveAttribute('aria-disabled', 'true')
    await field.dispatchEvent('click')
  }
  await expect(page.locator('.profile-picker')).toBeHidden()
  await expect(page.getByText('选择生日', { exact: true })).toBeHidden()
  // A late click from an already-rendered picker must be ignored by the handler too.
  await page.locator('.profile-picker__choice').first().dispatchEvent('click')
  await expect(page.getByRole('button', { name: '工种', exact: true })).toContainText('班组长')
  await expect(page.getByRole('button', { name: '性别', exact: true })).toContainText('女')
  await expect(page.getByText('已保存', { exact: true })).toHaveCount(0)
  await finishSave()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '性别', exact: true })).toHaveAttribute('aria-disabled', 'false')
  await page.getByRole('button', { name: '性别', exact: true }).click()
  await page.getByRole('button', { name: '选择男', exact: true }).click()
  await expect(page.getByRole('button', { name: '性别', exact: true })).toContainText('男')
  await expect(page.getByText('已保存', { exact: true })).toHaveCount(0)
})

test('a rounded 100 percent card is not marked complete before the server rate reaches one', async ({ page }) => {
  await auth(page)
  await page.route('**/api/v1/me/courses?**', route => route.fulfill({ json: envelope({ items: [first, second], total: 2, page: 1, page_size: 10 }) }))
  await page.route('**/api/v1/me/courses/*/progress', route => route.fulfill({ json: envelope({ required: 200, completed: 199, completion_rate: route.request().url().includes(first.id) ? 0.995 : 1, lessons: [] }) }))
  await page.goto('/#/pages/course/index')
  await expect(page.getByRole('button', { name: first.title, exact: true })).toContainText('已学习 100%')
  await expect(page.getByRole('button', { name: first.title, exact: true })).not.toContainText('已完成')
  await expect(page.getByRole('button', { name: second.title, exact: true })).toContainText('已完成')
})
