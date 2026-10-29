import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const question = { item_id: '101', type: 'single', score: 10, stem: doc('模拟考本次冻结题目'), options: [{ id: 'a', content: doc('甲') }, { id: 'b', content: doc('乙') }] }
const review = { ...question, selected_option_ids: ['a'], correct_option_ids: ['a'], gained_score: 10, analysis: doc('本次模拟的解析') }
const practice = {
  paper_id: '901', title: '独立模拟试卷', mode: 'random', status: 'published', source: 'external', category_id: null, difficulty: 'hard',
  exam_purpose: 'practice', release_id: '71', attempt_limit_kind: 'unlimited', attempts_used: 100, max_attempts: null, attempts_remaining: null,
  total_score: 10, pass_score: 6, duration_minutes: 30, question_count: 1, active_record_id: null, latest_record_id: '81',
  learning: { required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] },
}

async function setup(page: Page, options: { conflict?: boolean; timeout?: boolean; missingPaper?: boolean; withdrawnActive?: boolean; zero?: boolean } = {}) {
  const starts: unknown[] = [], calls: string[] = []
  let release = '71'
  const summary = () => ({ ...practice, release_id: release, ...(release === '72' ? { question_count: 2, total_score: 20, duration_minutes: 45 } : {}),
    ...(options.withdrawnActive ? { status: 'withdrawn', active_record_id: '82' } : {}) })
  const attempt = () => ({ status: 'in_progress', record_id: '82', paper_id: '901', exam_purpose: 'practice', release_id: options.withdrawnActive ? '71' : release,
    deadline_at: new Date(Date.now() + 3_600_000).toISOString(), server_now: new Date().toISOString(), questions: release === '72' ? [question, { ...question, item_id: '102' }] : [question] })
  const finalResult: Record<string, unknown> = { record_id: '81', paper_id: '901', exam_purpose: 'practice', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false,
    submitted_at: '2026-10-28T08:00:00Z', graded_at: '2026-10-28T08:00:00Z', score: 10, passed: true, correct_rate: 1, total_score: 10, pass_score: 6, items: [review] }
  if (options.timeout) Object.assign(finalResult, { status: 'timeout', grading_state: 'not_submitted', submission_method: null, submitted_at: null, graded_at: null, score: null, passed: null, correct_rate: null, items: [] })
  if (options.zero) Object.assign(finalResult, { status: 'failed', score: 0, passed: false, correct_rate: 0, items: [{ ...review, selected_option_ids: [], gained_score: 0 }] })
  if (options.missingPaper) delete finalResult.paper_id
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    calls.push(`${route.request().method()} ${path}`)
    const respond = (data: unknown) => route.fulfill({ json: envelope(data) })
    if (path.endsWith('/auth/refresh')) return respond({ access_token: 'practice-browser-fixture', expires_in: 900, user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'verified' } })
    if (path.endsWith('/me/profile')) return respond({ id: '17', username: 'learner', real_name: '学员', phone: null, email: null, avatar_id: null, source: 'external', category_id: null, category_name: null, role: 'employee', status: 1 })
    if (path.endsWith('/me/identity-verification')) return respond({ status: 'verified', real_name: '学员', id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null })
    if (path.endsWith('/me/exams')) {
      const purpose = new URL(route.request().url()).searchParams.get('exam_purpose')
      const items = [summary(), { ...practice, paper_id: '902', title: '正式历史上限未知', exam_purpose: 'formal', attempt_limit_kind: 'unknown', release_id: null, attempts_used: 8 }].filter(item => !purpose || item.exam_purpose === purpose)
      return respond({ items, page: 1, page_size: 10, total: items.length })
    }
    if (path.endsWith('/me/exams/901')) return respond(summary())
    if (path.endsWith('/me/exams/901/start')) {
      starts.push(route.request().postDataJSON())
      if (options.conflict && starts.length === 1) {
        release = '72'
        return route.fulfill({ status: 409, json: { code: 40970, message: '模拟考试配置已更新，请刷新须知后再开始', data: null } })
      }
      return respond(attempt())
    }
    if (path.endsWith('/me/exam-records/82')) return respond(attempt())
    if (path.endsWith('/me/exam-records/81/result')) return respond(finalResult)
    if (path.endsWith('/me/exam-records')) return respond({ items: [{ record_id: '81', paper_id: '901', paper_title: '模拟考历史发布版本', exam_purpose: 'practice', attempt_no: 101, status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false, source: 'external', difficulty: 'hard', score: 10, started_at: '2026-10-28T07:59:00Z', submitted_at: finalResult.submitted_at, graded_at: finalResult.graded_at }], page: 1, page_size: 10, total: 1 })
    if (path.endsWith('/me/wrong-questions')) return respond({ items: [{ ...review, gained_score: 0, selected_option_ids: ['b'], record_id: '81', paper_id: '901', paper_title: '模拟考历史发布版本', exam_purpose: 'practice', submitted_at: '2026-10-28T08:00:00Z', legacy: false }], page: 1, page_size: 10, total: 1 })
    return route.fulfill({ status: 404, json: { code: 40401, message: '未预期的请求', data: null } })
  })
  return { starts, calls }
}

test('formal and practice lists stay separate and retain their own attempt limits', async ({ page }) => {
  const { starts } = await setup(page)
  await page.goto('/mobile/#/pages/exam/index')
  await expect(page.locator('.exam-card')).toHaveCount(1)
  await expect(page.getByText('独立模拟试卷', { exact: true })).toHaveCount(0)
  const formalCard = page.locator('.exam-card').filter({ hasText: '正式历史上限未知' })
  await expect(formalCard.getByText('正式考试', { exact: true })).toBeVisible()
  await expect(formalCard.getByText('已用 8 次 · 次数上限待确认', { exact: true })).toBeVisible()
  await expect(formalCard.getByText('不限次数', { exact: true })).toHaveCount(0)
  await expect(formalCard.locator('.exam-card__caption')).toHaveText('开考后限时 30 分钟')
  await page.goto('/mobile/#/pages/exam/practice')
  await expect(page.locator('.top-bar__title')).toHaveText('模拟考试')
  const practiceCard = page.locator('.exam-card').filter({ hasText: '独立模拟试卷' })
  await expect(practiceCard.getByText('模拟考', { exact: true })).toBeVisible()
  await expect(practiceCard.getByText('不限次数', { exact: true })).toBeVisible()
  await expect(practiceCard.getByText('及格 6 分', { exact: true })).toBeVisible()
  await expect(page.getByText('正式历史上限未知', { exact: true })).toHaveCount(0)
  await practiceCard.getByText('进入考试', { exact: true }).click()
  await expect(page.getByText('不限次数', { exact: true })).toBeVisible()
  expect(starts).toEqual([])
})

test('profile places practice above personal details and opens the practice-only page', async ({ page }, testInfo) => {
  const { starts } = await setup(page)
  await page.goto('/mobile/#/pages/profile/index')
  const rows = page.locator('.profile-menu .wd-cell__title')
  await expect(rows.nth(0)).toHaveText('模拟考试')
  await expect(rows.nth(1)).toHaveText('个人资料')
  await expect(page.locator('.profile-menu .wd-cell').first().locator('.app-icon')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('profile-practice-entry.png'), fullPage: true })
  await page.locator('.profile-menu').getByText('模拟考试', { exact: true }).click()
  await expect(page).toHaveURL(/pages\/exam\/practice$/)
  await expect(page.locator('.exam-card')).toHaveCount(1)
  await expect(page.locator('.exam-card__title')).toHaveText('独立模拟试卷')
  await expect(page.locator('.top-bar__title')).toHaveText('模拟考试')
  await expect(page.locator('.center-heading__title')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('practice-list.png'), fullPage: true })
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/pages\/profile\/index$/)
  expect(starts).toEqual([])
})

test('40970 reloads changed instructions and requires another explicit confirmation', async ({ page }) => {
  const { starts } = await setup(page, { conflict: true })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  await page.getByText('开始答题', { exact: true }).click()
  await expect(page.getByText('模拟考试配置已更新，请确认后再开始', { exact: true })).toBeVisible()
  await expect(page.locator('.paper-stat').first()).toContainText('45')
  expect(starts).toEqual([{ expected_release_id: '71' }])
  await page.getByText('开始答题', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/take\?record_id=82/)
  await expect(page.getByText('模拟考本次冻结题目', { exact: true })).toBeVisible()
  await expect(page.locator('.take-header')).toContainText('模拟考')
  expect(starts).toEqual([{ expected_release_id: '71' }, { expected_release_id: '72' }])
})

test('retaking a passed practice result only returns to instructions', async ({ page }) => {
  const { starts } = await setup(page)
  await page.goto('/mobile/#/pages/exam/result?record_id=81')
  await expect(page.locator('.result-hero')).toContainText('模拟考')
  await page.getByText('再考一次', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/instructions\?paper_id=901/)
  await expect(page.getByText('开始答题', { exact: true })).toBeVisible()
  expect(starts).toEqual([])
})

test('result layout keeps zero upright and separates answer statistics from earned scores', async ({ page }) => {
  await setup(page, { zero: true })
  await page.goto('/mobile/#/pages/exam/result?record_id=81')
  const score = page.locator('.result-hero__number')
  await expect(score).toHaveText('0')
  await expect(score).toHaveCSS('font-style', 'normal')
  await expect(score).toHaveCSS('font-weight', '700')
  await expect(score).toHaveCSS('font-size', '72px')
  await expect(score).toHaveCSS('font-family', '"Times New Roman", Times, serif')
  await expect(page.locator('.result-hero__status')).toContainText('未通过 · 及格线 6 分')
  await expect(page.locator('.result-summary__metric--correct .result-summary__value')).toHaveCSS('color', 'rgb(7, 193, 96)')
  await expect(page.locator('.result-summary__metric--wrong .result-summary__value')).toHaveCSS('color', 'rgb(238, 10, 36)')
  await expect(page.locator('.result-summary__metric--unanswered')).toContainText('1')
  await expect(page.locator('.result-types__count')).toHaveText('对 0/1')
  await expect(page.locator('.result-types__score')).toHaveText('0 / 10')
  for (const width of [390, 414]) {
    await page.setViewportSize({ width, height: 844 })
    const ratio = await page.locator('.result-summary__ratio').boundingBox()
    const unanswered = await page.locator('.result-summary__segment--unanswered').boundingBox()
    expect(unanswered?.width).toBe(ratio?.width)
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).map(node => ({ tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right })).slice(0, 8))
    expect(overflow).toEqual([])
    await expect(page.getByText('再考一次', { exact: true })).toBeVisible()
    await page.screenshot({ path: `../gui-test-screenshots/exam-result-zero-${width}.png`, scale: 'css' })
  }
})

test('a pure timeout offers an explicit instructions return without grading or automatically starting', async ({ page }) => {
  const { starts, calls } = await setup(page, { timeout: true })
  await page.goto('/mobile/#/pages/exam/result?record_id=81')
  await expect(page.getByText('超时未交卷', { exact: true })).toBeVisible()
  await expect(page.locator('.result-hero')).toHaveCount(0)
  await expect(page.getByText('查看答案解析', { exact: true })).toHaveCount(0)
  await page.getByText('返回模拟考须知', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/instructions\?paper_id=901/)
  expect(starts).toEqual([])
  expect(calls.some(call => call.endsWith('/submit'))).toBe(false)
})

test('a malformed practice result does not guess a retry paper', async ({ page }) => {
  const { starts } = await setup(page, { missingPaper: true })
  await page.goto('/mobile/#/pages/exam/result?record_id=81')
  await expect(page.getByText('考试结果暂不可用', { exact: true })).toBeVisible()
  await expect(page.getByText('再考一次', { exact: true })).toHaveCount(0)
  expect(starts).toEqual([])
})

test('history, wrong questions and review keep the record purpose and source', async ({ page }) => {
  const { starts, calls } = await setup(page)
  await page.goto('/mobile/#/pages/profile/exam-history')
  await expect(page.locator('.history-record')).toContainText('模拟考')
  await page.goto('/mobile/#/pages/profile/wrong-book')
  await expect(page.locator('.wrong-card__source')).toHaveText('模拟考 · 模拟考历史发布版本')
  await page.goto('/mobile/#/pages/exam/review?record_id=81')
  await expect(page.locator('.review-source')).toHaveText('模拟考 · 试卷 #901')
  expect(starts).toEqual([])
  expect(calls.some(call => call.endsWith('/exams/901'))).toBe(false)
})

test('a withdrawn practice with an active record continues that record', async ({ page }) => {
  const { starts, calls } = await setup(page, { withdrawnActive: true })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  await page.getByText('继续答题', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/take\?record_id=82/)
  await expect(page.getByText('模拟考本次冻结题目', { exact: true })).toBeVisible()
  expect(starts).toEqual([])
  expect(calls).toContain('GET /api/v1/me/exam-records/82')
})
