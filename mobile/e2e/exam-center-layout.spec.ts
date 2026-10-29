import { expect, test, type Page } from '@playwright/test'
import type { ExamLearningSummary, ExamQuestionTypeSummary } from '../src/types/exam'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const title = 'Web前端工程师基础：HTML5 + CSS3 结业考试'
const papers = [
  { paper_id: '901', title, status: 'published', duration_minutes: 35, question_count: 20, total_score: 120, pass_score: 72, active_record_id: null, latest_record_id: null },
  { paper_id: '902', title: '继续本人进行中的考试', status: 'withdrawn', duration_minutes: 30, question_count: 20, total_score: 120, pass_score: 72, active_record_id: '82', active_deadline_at: '2030-01-01T10:05:00Z', latest_record_id: '82' },
  { paper_id: '903', title: '历史信息不完整的已发布考试', status: 'published', duration_minutes: null, question_count: null, total_score: null, pass_score: null, active_record_id: null, latest_record_id: null },
]
const questionTypes: ExamQuestionTypeSummary[] = [
  { type: 'single', count: 10, score_per_question: 6, total_score: 60 },
  { type: 'multiple', count: 5, score_per_question: 8, total_score: 40 },
  { type: 'judgment', count: 5, score_per_question: 4, total_score: 20 },
]
async function setup(page: Page, options: { empty?: boolean; paginated?: boolean; learning?: boolean; learningDetails?: Partial<ExamLearningSummary>; questionTypes?: ExamQuestionTypeSummary[] | null } = {}) {
  const queries: string[] = [], calls: string[] = []
  let learningReady = false
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname
    calls.push(`${route.request().method()} ${path}`)
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'exam-cards-fixture', expires_in: 900, user: { id: 17, username: 'learner', real_name: '测试学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: 3, identity_status: 'verified' } }) })
    if (path.endsWith('/me/profile')) return route.fulfill({ json: envelope({ id: '17', username: 'learner', real_name: '测试学员', phone: null, avatar_id: null, category_id: '3', category_name: '安全培训', source: 'external', role: 'employee', status: 1 }) })
    if (path.endsWith('/me/identity-verification')) return route.fulfill({ json: envelope({ status: 'verified', real_name: '测试学员', id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }) })
    if (path.endsWith('/me/exams')) {
      queries.push(url.search)
      const pageNumber = Number(url.searchParams.get('page') || 1)
      const items = options.empty ? [] : options.paginated ? [papers[pageNumber - 1]].filter(Boolean) : papers
      return route.fulfill({ json: envelope({ items, total: options.empty ? 0 : options.paginated ? 2 : papers.length, page: pageNumber, page_size: options.paginated ? 1 : 10 }) })
    }
    if (path.endsWith('/me/exams/901')) return route.fulfill({ json: envelope({ ...papers[0], mode: 'fixed', source: 'external', category_id: '3', difficulty: 'easy', question_types: 'questionTypes' in options ? options.questionTypes : questionTypes, learning: { required_learning_minutes: options.learning ? 30 : null, credited_seconds: options.learning ? learningReady ? 1800 : 900 : null, remaining_seconds: options.learning ? learningReady ? 0 : 900 : null, courses: options.learning ? [{ id: '8', title: '消防基础', available: true }] : [], ...options.learningDetails } }) })
    return route.fulfill({ status: 404, json: { code: 40401, message: 'fixture route not provided', data: null } })
  })
  return { queries, calls, finishLearning() { learningReady = true } }
}

test('N4rck exam center shows a large heading, filters and real card metadata', async ({ page }) => {
  const { queries } = await setup(page)
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.locator('.center-heading__title')).toHaveText('考试')
  await expect(page.locator('.center-heading__count')).toHaveText('03 场')
  await expect(page.locator('.center-tabs .wd-tabs__nav-item')).toHaveCount(4)
  await expect(page.getByText('考试记录', { exact: true })).toHaveCount(0)
  await expect(page.locator('.exam-card')).toHaveCount(3)
  const normal = page.locator('.exam-card').nth(0), active = page.locator('.exam-card').nth(1), incomplete = page.locator('.exam-card').nth(2)
  await expect(normal.locator('.exam-card__meta')).toContainText('35 分钟')
  await expect(normal.locator('.exam-card__meta')).toContainText('20 题')
  await expect(normal.locator('.exam-card__meta')).toContainText('满分 120 分')
  await expect(normal.locator('.exam-card__status')).toHaveText('待考试')
  await expect(normal.locator('.exam-card__title')).toHaveCSS('-webkit-line-clamp', '2')
  await expect(active).toHaveClass(/exam-card--active/)
  await expect(active.locator('.exam-card__status')).toHaveText('答题中')
  await expect(active.locator('.exam-card__caption')).toHaveText('截止 01-01 18:05')
  await expect(normal.locator('.exam-card__caption')).toHaveText('开考后限时 35 分钟')
  await expect(page.getByText(/^(已撤回|已归档|已发布)$/)).toHaveCount(0)
  await expect(incomplete.locator('.exam-card__meta')).toContainText('满分 — 分')
  await expect(page.getByText('没有更多了', { exact: true })).toBeVisible()
  expect(queries.every(query => new URLSearchParams(query).get('state') === 'all')).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/ruleexam-exam-cards-list.png', fullPage: true })
})

test('whole exam cards and buttons navigate once to instructions or active resume', async ({ page }) => {
  const { calls } = await setup(page)
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.locator('.exam-card')).toHaveCount(3)
  await page.evaluate(() => {
    ;(window as any).__examDestinations = []
    uni.navigateTo = options => { (window as any).__examDestinations.push(options.url); return undefined as any }
  })
  await page.locator('.exam-card').nth(0).locator('.exam-card__title').click()
  await page.locator('.exam-card').nth(1).click({ position: { x: 5, y: 5 } })
  await page.locator('.exam-card').nth(0).locator('.exam-card__meta').click()
  await page.locator('.exam-card').nth(0).getByText('进入考试', { exact: true }).click()
  await page.locator('.exam-card').nth(1).getByText('继续答题', { exact: true }).click()
  expect(await page.evaluate(() => (window as any).__examDestinations)).toEqual(['/pages/exam/instructions?paper_id=901', '/pages/exam/take?record_id=82', '/pages/exam/instructions?paper_id=901', '/pages/exam/instructions?paper_id=901', '/pages/exam/take?record_id=82'])
  expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
})

test('loading more preserves server pagination and all-state query without client filtering', async ({ page }) => {
  const { queries } = await setup(page, { paginated: true })
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.locator('.exam-card')).toHaveCount(1)
  await page.getByText('加载更多', { exact: true }).click()
  await expect(page.locator('.exam-card')).toHaveCount(2)
  expect(queries.some(query => new URLSearchParams(query).get('page') === '2')).toBe(true)
  expect(queries.every(query => new URLSearchParams(query).get('state') === 'all')).toBe(true)
})

test('N4rck filters request the selected server state and retain the matching list', async ({ page }) => {
  const { queries, calls } = await setup(page)
  await page.route('**/api/v1/me/exams?**', route => {
    const params = new URL(route.request().url()).searchParams
    const state = params.get('state')
    queries.push(new URL(route.request().url()).search)
    const items = papers.filter(exam => state === 'all' || (state === 'active' ? !!exam.active_record_id : state === 'published' ? !exam.active_record_id && exam.status === 'published' : !exam.active_record_id && exam.status !== 'published'))
    return route.fulfill({ json: envelope({ items, total: items.length, page: 1, page_size: 10 }) })
  })
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.locator('.exam-card')).toHaveCount(3)
  const tabs = page.locator('.center-tabs .wd-tabs__nav-item')
  for (const [label, state, count] of [['进行中', 'active', 1], ['待考试', 'published', 2], ['已结束', 'ended', 0], ['全部', 'all', 3]] as const) {
    await tabs.filter({ hasText: label }).click()
    await expect(page.locator('.exam-card')).toHaveCount(count)
    await expect(tabs.filter({ hasText: label })).toHaveClass(/is-active/)
    expect(new URLSearchParams(queries.at(-1)).get('state')).toBe(state)
  }
  expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
})

test('ended includes completed published exams and opens their results instead of starting again', async ({ page }) => {
  const { calls } = await setup(page)
  await page.route('**/api/v1/me/exams?**', route => {
    return route.fulfill({ json: envelope({ items: [{ ...papers[0], latest_record_id: '99', attempts_remaining: 2 }], total: 1, page: 1, page_size: 10 }) })
  })
  await page.goto('/mobile/#/pages/exam/index')
  await page.locator('.center-tabs .wd-tabs__nav-item').filter({ hasText: '已结束' }).click()
  await expect(page.locator('.exam-card__status')).toHaveText('已结束')
  await expect(page.locator('.exam-card__caption')).toHaveCount(0)
  await page.locator('.exam-card').getByText('查看结果', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/exam\/result\?record_id=99/)
  expect(calls.some(call => call.endsWith('/start'))).toBe(false)
})

test('formal and practice tab indicators stay centered on the selected label', async ({ page }) => {
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 })
    for (const [path, scenario] of [['index', 'exam-center'], ['practice', 'exam-practice']]) {
      await page.goto(`/mobile/#/pages/exam/${path}?scenario=${scenario}`)
      const tabs = page.locator('.center-tabs .wd-tabs__nav-item')
      for (const label of ['全部', '进行中', '待考试', '已结束', '待考试', '进行中', '全部']) {
        const selected = tabs.filter({ hasText: label })
        await selected.click()
        await expect(selected).toHaveClass(/is-active/)
        await expect.poll(async () => {
          const text = await selected.locator('.wd-tabs__nav-item-text').boundingBox()
          const line = await page.locator('.center-tabs .wd-tabs__line').boundingBox()
          return text && line ? Math.abs(text.x + text.width / 2 - line.x - line.width / 2) : Infinity
        }).toBeLessThan(2)
      }
    }
  }
})

test('N4rck static cards filter, disable future exams and fit narrow screens', async ({ page }, testInfo) => {
  for (const width of [414, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('about:blank')
    await page.goto('/mobile/#/pages/exam/index?scenario=exam-center')
    await expect(page.locator('.exam-card')).toHaveCount(4)
    await expect(page.locator('.exam-card__progress')).toHaveAttribute('style', /width:\s*30%/)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`N4rck-${width}.png`), fullPage: true })
    const tabs = page.locator('.center-tabs .wd-tabs__nav-item')
    await tabs.filter({ hasText: '待考试' }).click()
    await expect(page.locator('.exam-card')).toHaveCount(1)
    await expect(page.locator('.exam-card .wd-button')).toHaveClass(/is-disabled/)
    await page.locator('.exam-card__title').click()
    await expect(page).toHaveURL(/scenario=exam-center/)
    await tabs.filter({ hasText: '进行中' }).click()
    await expect(page.locator('.exam-card')).toHaveCount(2)
    await tabs.filter({ hasText: '已结束' }).click()
    await expect(page.locator('.exam-card')).toHaveCount(1)
    await page.locator('.exam-card__action').click()
    await expect(page).toHaveURL(/exam\/result\?scenario=exam-result/)
  }
})

test('empty list keeps its illustration and N4rck heading', async ({ page }) => {
  await setup(page, { empty: true })
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.locator('.center-heading__title')).toHaveText('考试')
  await expect(page.locator('.empty-state__image')).toBeVisible()
  await expect(page.getByText('考试发布后将显示在这里。', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/ruleexam-exam-cards-empty.png', fullPage: true })
})

test('instructions match rMONE with a three-column summary and four rules without starting', async ({ page }) => {
  const { calls } = await setup(page)
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  await expect(page.locator('.top-bar__title')).toHaveText('考试须知')
  await expect(page.locator('.paper-intro__title')).toHaveText(title)
  await expect(page.locator('.paper-stat')).toHaveCount(3)
  await expect(page.locator('.paper-intro__description')).toHaveText('满分 120 分 · 请在开始前核对考试信息。')
  await expect(page.locator('.paper-intro__total')).toHaveCount(0)
  await expect(page.getByText('及格', { exact: true })).toHaveCount(1)
  await expect(page.locator('.paper-stats')).toContainText('35')
  await expect(page.locator('.paper-stats')).toContainText('20')
  await expect(page.locator('.paper-stats')).toContainText('72')
  await expect(page.locator('.paper-rule')).toHaveCount(4)
  await expect(page.locator('.paper-rule').nth(0)).toContainText('不会暂停')
  await expect(page.locator('.paper-rule').nth(1)).toContainText('本人本机草稿')
  await expect(page.locator('.paper-rule').nth(1)).toContainText('联网核验再恢复')
  await expect(page.locator('.paper-rule').nth(2)).toContainText('不自动交卷')
  await expect(page.locator('.paper-rule').nth(2)).toContainText('不评分')
  await expect(page.locator('.paper-rule').nth(3)).toContainText('不可修改')
  await expect(page.getByText('题型构成', { exact: true })).toBeVisible()
  const rows = page.locator('.paper-composition__row')
  await expect(rows).toHaveCount(3)
  for (const [index, expected] of ['单选题|10 题 × 6 分|60 分', '多选题|5 题 × 8 分|40 分', '判断题|5 题 × 4 分|20 分'].entries()) {
    const [label, detail, score] = expected.split('|')
    await expect(rows.nth(index).locator('.paper-composition__type')).toHaveText(label)
    await expect(rows.nth(index).locator('.paper-composition__detail')).toHaveText(detail)
    await expect(rows.nth(index).locator('.paper-composition__score')).toHaveText(score)
  }
  await expect(page.locator('.paper-intro__kicker')).toHaveText('PAPER · NO.0901')
  expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/ruleexam-exam-cards-instructions.png', fullPage: true })
})

test('mixed scores show actual type totals without inventing a per-question score', async ({ page }) => {
  const { calls } = await setup(page, { questionTypes: [{ type: 'single', count: 10, score_per_question: null, total_score: 60 }, ...questionTypes.slice(1)] })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  const mixed = page.locator('.paper-composition__row').first()
  await expect(mixed.locator('.paper-composition__type')).toHaveText('单选题')
  await expect(mixed.locator('.paper-composition__detail')).toHaveText('10 题')
  await expect(mixed.locator('.paper-composition__score')).toHaveText('60 分')
  await expect(mixed).not.toContainText('×')
  expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
})

for (const [description, value] of [['null', null], ['omitted', undefined]] as const) {
  test(`legacy ${description} type summary remains explicit and does not block start`, async ({ page }) => {
    const { calls } = await setup(page, { questionTypes: value })
    await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
    await expect(page.getByText('题型信息暂不可用', { exact: true })).toBeVisible()
    await expect(page.locator('.paper-composition__row')).toHaveCount(0)
    const start = page.locator('.paper-footer .wd-button')
    await expect(start).toHaveText('开始答题')
    await expect(start).not.toHaveClass(/is-disabled/)
    expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
    await start.click()
    await expect.poll(() => calls.filter(call => call.endsWith('/start'))).toEqual(['POST /api/v1/me/exams/901/start'])
  })
}

test('zero-count question types do not produce placeholder rows', async ({ page }) => {
  await setup(page, { questionTypes: [{ type: 'single', count: 20, score_per_question: 6, total_score: 120 }, { type: 'multiple', count: 0, score_per_question: null, total_score: 0 }] })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  await expect(page.locator('.paper-composition__row')).toHaveCount(1)
  await expect(page.locator('.paper-composition__type')).toHaveText('单选题')
})

test('instructions retain learning links and refresh until learning is satisfied', async ({ page }) => {
  const state = await setup(page, { learning: true })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  const card = page.locator('.learning-section'), footer = page.locator('.paper-footer')
  await expect(page.getByText('考前学习要求', { exact: true })).toBeVisible()
  await expect(page.getByText('还需学习 15 分钟', { exact: true })).toBeVisible()
  await expect(card.locator('.learning-section__summary')).toHaveText('已有效学习 15 分钟 · 要求 30 分钟')
  await expect(card.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '50')
  const statsBox = await page.locator('.paper-stats').boundingBox(), cardBox = await card.boundingBox(), compositionBox = await page.locator('.paper-composition').boundingBox()
  expect(cardBox!.y).toBeGreaterThanOrEqual(statsBox!.y + statsBox!.height)
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(compositionBox!.y)
  const studyButton = card.locator('.learning-course .wd-button')
  await expect(studyButton).toHaveText('去学习')
  expect((await studyButton.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.evaluate(() => {
    ;(window as any).__learningDestinations = []
    uni.navigateTo = options => { (window as any).__learningDestinations.push(options.url); return undefined as any }
  })
  await studyButton.click()
  expect(await page.evaluate(() => (window as any).__learningDestinations)).toEqual(['/pages/course/detail?id=8&from_exam=901'])
  await page.screenshot({ path: '/tmp/ruleexam-learning-card-required.png', fullPage: true })
  await footer.getByText('刷新学习进度', { exact: true }).click()
  expect(state.calls.filter(call => call.endsWith('/start'))).toEqual([])
  state.finishLearning()
  await footer.getByText('刷新学习进度', { exact: true }).click()
  await expect(page.getByText('考前学习已达标', { exact: true })).toBeVisible()
  await expect(card).toHaveClass(/learning-section--ready/)
  await expect(card.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100')
  await expect(footer.getByText('开始答题', { exact: true })).toBeVisible()
  await expect(page.getByText('刷新学习进度', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/ruleexam-learning-card-ready.png', fullPage: true })
})

test('unknown learning progress stays explicit without a fabricated zero progress bar', async ({ page }) => {
  const state = await setup(page, { learning: true, learningDetails: { credited_seconds: null, remaining_seconds: null } })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  await expect(page.getByText('学习进度暂未确认', { exact: true })).toBeVisible()
  await expect(page.locator('.learning-section__summary')).toHaveText('已有效学习 — 分钟 · 要求 30 分钟')
  await expect(page.locator('.learning-section [role="progressbar"]')).toHaveCount(0)
  await page.locator('.paper-footer').getByText('刷新学习进度', { exact: true }).click()
  expect(state.calls.filter(call => call.endsWith('/start'))).toEqual([])
})

test('learning courses support long names and clearly disable unavailable courses', async ({ page }) => {
  const longTitle = '建筑施工现场消防安全基础与突发事故应急处置培训课程：安全生产责任与实际操作规范'
  await setup(page, { learning: true, learningDetails: { courses: [{ id: '8', title: longTitle, available: true }, { id: '9', title: '暂不可访问的历史培训课程', available: false }] } })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  const courses = page.locator('.learning-course')
  await expect(courses).toHaveCount(2)
  await expect(courses.first()).toContainText(longTitle)
  await expect(courses.nth(1).locator('.wd-button')).toHaveText('暂不可学习')
  await expect(courses.nth(1).locator('.wd-button')).toHaveClass(/is-disabled/)
  expect((await courses.nth(1).locator('.wd-button').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const { credited, remaining, expected } of [{ credited: 2400, remaining: 0, expected: '100' }, { credited: 0, remaining: 1800, expected: '0' }]) {
  test(`learning progress clamps server credited seconds ${credited} to ${expected} percent`, async ({ page }) => {
    await setup(page, { learning: true, learningDetails: { credited_seconds: credited, remaining_seconds: remaining } })
    await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
    await expect(page.locator('.learning-section [role="progressbar"]')).toHaveAttribute('aria-valuenow', expected)
  })
}

test('static list and instructions use the same hierarchy without API requests', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) requests.push(request.url()) })
  await page.goto('/mobile/#/pages/exam/index?scenario=exam-center')
  await expect(page.locator('.exam-card')).toHaveCount(4)
  await expect(page.locator('.exam-card__status')).toHaveCount(4)
  await expect(page.locator('.exam-card__draft')).toContainText('已答 6 / 20')
  await page.goto('/mobile/#/pages/exam/instructions?scenario=exam-instructions')
  await expect(page.locator('.paper-rule')).toHaveCount(4)
  await expect(page.getByText('题型构成', { exact: true })).toBeVisible()
  await expect(page.locator('.paper-composition__row')).toHaveCount(3)
  await expect(page.locator('.paper-stat')).toHaveCount(3)
  await expect(page.locator('.paper-intro__description')).toHaveText('满分 120 分 · 请在开始前核对考试信息。')
  await expect(page.locator('.paper-intro__kicker')).toHaveText('PAPER · NO.0016')
  expect(requests).toEqual([])
})
