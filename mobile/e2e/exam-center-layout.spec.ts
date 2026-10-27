import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const papers = [
  { paper_id: '41', title: '班组长班前会与现场管理安全培训考试', status: 'published', duration_minutes: 35, active_record_id: null, latest_record_id: null },
  { paper_id: '42', title: '继续本人进行中的考试', status: 'withdrawn', duration_minutes: 30, active_record_id: '82', latest_record_id: '82' },
  { paper_id: '43', title: '已经结束的安全考试', status: 'archived', duration_minutes: 20, active_record_id: null, latest_record_id: '83' },
]
async function mockList(page: Page, empty = false, paginated = false) {
  const listQueries: string[] = []
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'exam-layout-fixture', expires_in: 900, user: { id: 17, username: 'learner', real_name: '测试学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: 3, identity_status: 'verified' } }) })
    if (path.endsWith('/me/profile')) return route.fulfill({ json: envelope({ id: '17', username: 'learner', real_name: '测试学员', phone: null, avatar_id: null, category_id: '3', category_name: '安全培训', source: 'external', role: 'employee', status: 1 }) })
    if (path.endsWith('/me/identity-verification')) return route.fulfill({ json: envelope({ status: 'verified', real_name: '测试学员', id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }) })
    if (path.endsWith('/me/exams')) {
      listQueries.push(url.search)
      const pageNumber = Number(url.searchParams.get('page') || 1)
      const items = empty ? [] : paginated ? [papers[pageNumber - 1]].filter(Boolean) : papers
      return route.fulfill({ json: envelope({ items, total: empty ? 0 : paginated ? 2 : papers.length, page: pageNumber, page_size: paginated ? 1 : 10 }) })
    }
    return route.fulfill({ status: 404, json: { code: 40401, message: 'fixture route not provided', data: null } })
  })
  return listQueries
}

test('compact exam list has a white heading, no filter tabs or record shortcut, and retains all entries', async ({ page }) => {
  const queries = await mockList(page)
  await page.goto('/#/pages/exam/index')
  await expect(page.locator('.top-bar__title')).toHaveText('考试')
  await expect(page.locator('.top-bar')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.center-tabs, .center-heading')).toHaveCount(0)
  await expect(page.getByText('考试记录', { exact: true })).toHaveCount(0)
  await expect(page.locator('.exam-card')).toHaveCount(3)
  await expect(page.locator('.exam-card__meta').first()).toContainText('35 分钟')
  await expect(page.getByText('没有更多了', { exact: true })).toBeVisible()
  expect(queries.every(query => new URLSearchParams(query).get('state') === 'all')).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/ruleexam-exam-list-compact.png', fullPage: true })
})

test('entry buttons preserve instructions, active resume and ended result destinations', async ({ page }) => {
  await mockList(page)
  await page.goto('/#/pages/exam/index')
  await expect(page.locator('.exam-card')).toHaveCount(3)
  await page.evaluate(() => {
    ;(window as any).__examDestinations = []
    uni.navigateTo = options => { (window as any).__examDestinations.push(options.url); return undefined as any }
  })
  await page.locator('.exam-card').nth(0).getByText('进入考试', { exact: true }).click()
  await page.locator('.exam-card').nth(1).getByText('继续答题', { exact: true }).click()
  await page.locator('.exam-card').nth(2).getByText('查看记录', { exact: true }).click()
  expect(await page.evaluate(() => (window as any).__examDestinations)).toEqual(['/pages/exam/instructions?paper_id=41', '/pages/exam/take?record_id=82', '/pages/exam/result?record_id=83'])
})

test('loading more retains the all-state query and appends entries', async ({ page }) => {
  const queries = await mockList(page, false, true)
  await page.goto('/#/pages/exam/index')
  await expect(page.locator('.exam-card')).toHaveCount(1)
  await page.getByText('加载更多', { exact: true }).click()
  await expect(page.locator('.exam-card')).toHaveCount(2)
  expect(queries.some(query => new URLSearchParams(query).get('page') === '2')).toBe(true)
  expect(queries.every(query => new URLSearchParams(query).get('state') === 'all')).toBe(true)
  await expect(page.getByText('没有更多了', { exact: true })).toBeVisible()
})

test('empty list uses the illustration and no obsolete filter explanation', async ({ page }) => {
  await mockList(page, true)
  await page.goto('/#/pages/exam/index')
  await expect(page.locator('.top-bar__title')).toHaveText('考试')
  await expect(page.locator('.empty-state__image')).toBeVisible()
  await expect(page.getByText('考试发布后将显示在这里。', { exact: true })).toBeVisible()
  await expect(page.getByText('当前筛选下暂无考试。', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/ruleexam-exam-list-empty.png', fullPage: true })
})

test('static exam preview shares the compact heading and list without issuing APIs', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) requests.push(request.url()) })
  await page.goto('/#/pages/exam/index?scenario=exam-center')
  await expect(page.locator('.top-bar__title')).toHaveText('考试')
  await expect(page.locator('.center-tabs, .center-heading')).toHaveCount(0)
  await expect(page.locator('.exam-card')).toHaveCount(4)
  await expect(page.getByText('进入考试', { exact: true })).toBeVisible()
  expect(requests).toEqual([])
})
