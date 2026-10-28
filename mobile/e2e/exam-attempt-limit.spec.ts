import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const paper = {
  paper_id: '901', title: '本人公共随机考试', mode: 'random', status: 'published', source: 'external', category_id: null, difficulty: 'hard',
  total_score: 120, pass_score: 72, duration_minutes: 35, question_count: 1, active_record_id: null, latest_record_id: '83',
  attempts_used: 3, max_attempts: 3, attempts_remaining: 0,
}

async function setup(page: Page, options: { extra?: Record<string, unknown>; legacy?: boolean } = {}) {
  const calls: string[] = []
  const summary: Record<string, unknown> = { ...paper, ...options.extra }
  if (options.legacy) for (const key of ['attempts_used', 'max_attempts', 'attempts_remaining']) delete summary[key]
  const attempt = (record: string) => ({
    status: 'in_progress', record_id: record, paper_id: '901', release_id: '31',
    deadline_at: new Date(Date.now() + 3_600_000).toISOString(), server_now: new Date().toISOString(),
    questions: [{ item_id: '51', type: 'single', score: 120, stem: doc('本人原次考试题目'), options: [{ id: 'a', content: doc('甲') }, { id: 'b', content: doc('乙') }] }],
  })
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    calls.push(`${route.request().method()} ${path}`)
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'attempt-limit-browser-fixture', expires_in: 900, user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'verified' } }) })
    if (path.endsWith('/me/profile')) return route.fulfill({ json: envelope({ id: '17', username: 'learner', real_name: '学员', phone: null, avatar_id: null, source: 'external', category_id: null, category_name: null, role: 'employee', status: 1 }) })
    if (path.endsWith('/me/identity-verification')) return route.fulfill({ json: envelope({ status: 'verified', real_name: '学员', id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }) })
    if (path.endsWith('/me/exams')) return route.fulfill({ json: envelope({ items: [summary, { ...paper, paper_id: '902', title: '另一份未开考试卷', attempts_used: 0, attempts_remaining: 3, latest_record_id: null }], total: 2, page: 1, page_size: 10 }) })
    if (path.endsWith('/me/exams/901')) return route.fulfill({ json: envelope({ ...summary, learning: { required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] } }) })
    if (path.endsWith('/me/exams/901/start')) return route.fulfill({ json: envelope(attempt('84')) })
    if (path.endsWith('/me/exam-records/81')) return route.fulfill({ json: envelope(attempt('81')) })
    if (path.endsWith('/me/exam-records/84')) return route.fulfill({ json: envelope(attempt('84')) })
    if (path.endsWith('/me/exam-records/83/result')) return route.fulfill({ json: envelope({ record_id: '83', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: '2026-10-28T06:00:00Z', graded_at: '2026-10-28T06:00:00Z', score: 95, passed: true, correct_rate: null, items: [], total_score: 120, pass_score: 72, duration_minutes: 35 }) })
    return route.fulfill({ status: 404, json: { code: 40401, message: '未预期的请求', data: null } })
  })
  return calls
}

test('exhausted direct instructions show 3/3 and open the owned result without sending start', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901&record_id=999')
  await expect(page.getByText('已用 3/3 次', { exact: true })).toBeVisible()
  await expect(page.getByText('开始答题', { exact: true })).toHaveCount(0)
  await page.getByText('查看历史成绩', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/result\?record_id=83/)
  await expect(page.getByText('/ 120 分', { exact: true })).toBeVisible()
  expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
  expect(calls.filter(call => /\/exam-records\/.*\/result$/.test(call))).toEqual(['GET /api/v1/me/exam-records/83/result'])
})

test('the exam center keeps exhausted and unused paper quotas independent', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/mobile/#/pages/exam/index')
  const exhausted = page.locator('.exam-card').filter({ hasText: '本人公共随机考试' })
  const unused = page.locator('.exam-card').filter({ hasText: '另一份未开考试卷' })
  await expect(exhausted.getByText('已用 3/3 次', { exact: true })).toBeVisible()
  await expect(unused.getByText('已用 0/3 次', { exact: true })).toBeVisible()
  await expect(unused.getByText('进入考试', { exact: true })).toBeVisible()
  await exhausted.getByText('查看历史成绩', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/result\?record_id=83/)
  expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
})

for (const route of ['instructions?paper_id=901', 'index']) {
  test(`active final attempt takes priority over exhausted quota in ${route}`, async ({ page }) => {
    const calls = await setup(page, { extra: { active_record_id: '81' } })
    await page.goto(`/mobile/#/pages/exam/${route}`)
    await expect(page.getByText('已用 3/3 次', { exact: true })).toBeVisible()
    await page.getByText('继续答题', { exact: true }).click()
    await expect(page).toHaveURL(/exam\/take\?record_id=81/)
    await expect(page.getByText('本人原次考试题目', { exact: true })).toBeVisible()
    expect(calls.filter(call => call.endsWith('/start'))).toEqual([])
    expect(calls.some(call => call === 'GET /api/v1/me/exam-records/81')).toBe(true)
    expect(calls.some(call => call.endsWith('/83/result'))).toBe(false)
  })
}

test('a passed result with remaining quota still permits another explicit start', async ({ page }) => {
  const calls = await setup(page, { extra: { attempts_used: 1, attempts_remaining: 2 } })
  await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
  await expect(page.getByText('已用 1/3 次', { exact: true })).toBeVisible()
  await page.getByText('开始答题', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/take\?record_id=84/)
  expect(calls.filter(call => call.endsWith('/start'))).toEqual(['POST /api/v1/me/exams/901/start'])
})

for (const variant of ['omitted', 'unknown'] as const) {
  test(`${variant} historical quota remains usable without a default limit of three`, async ({ page }) => {
    const calls = await setup(page, variant === 'omitted' ? { legacy: true } : { extra: { attempts_used: 8, max_attempts: null, attempts_remaining: null } })
    await page.goto('/mobile/#/pages/exam/instructions?paper_id=901')
    await expect(page.getByText(/已用.*\/3 次/)).toHaveCount(0)
    await page.getByText('开始答题', { exact: true }).click()
    await expect(page).toHaveURL(/exam\/take\?record_id=84/)
    expect(calls.filter(call => call.endsWith('/start'))).toEqual(['POST /api/v1/me/exams/901/start'])
  })
}
