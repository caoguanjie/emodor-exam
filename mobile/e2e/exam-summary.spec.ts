import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
async function screenshot(page: Page, name: string) {
  const directory = '../gui-test-screenshots/h5-exam-alignment-ui'
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}
function exam(extra: Record<string, unknown> = {}) {
  return { paper_id: '901', title: '120 分冻结考试', mode: 'fixed', status: 'published', source: 'external', category_id: '3', difficulty: 'easy', total_score: 120, pass_score: 72, duration_minutes: 35, question_count: 24, active_record_id: null, latest_record_id: null, ...extra }
}
async function setup(page: Page) {
  const calls: { path: string; method: string; state: string | null }[] = []
  let remaining = 900, failSummary = false, unknownScores = false, rows = [exam()]
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    calls.push({ path, method: route.request().method(), state: url.searchParams.get('state') })
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'summary-browser-memory', expires_in: 900, user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: 3, identity_status: 'verified' } }) })
    if (path.endsWith('/me/profile')) return route.fulfill({ json: envelope({ id: '17', username: 'learner', real_name: '学员', phone: null, email: null, avatar_id: null, occupation: null, gender: null, birthday: null, source: 'external', category_id: '3', category_name: '消防工种', role: 'employee', status: 1 }) })
    if (path.endsWith('/me/identity-verification')) return route.fulfill({ json: envelope({ status: 'verified', real_name: '学员', id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }) })
    if (path.endsWith('/me/exams')) return route.fulfill({ json: envelope({ items: rows, total: rows.length, page: 1, page_size: 10 }) })
    if (path.endsWith('/me/exams/901')) {
      if (failSummary) return route.abort('failed')
      return route.fulfill({ json: envelope({ ...exam(), learning: { required_learning_minutes: 30, credited_seconds: 1800 - remaining, remaining_seconds: remaining, courses: [{ id: '8', title: '消防安全基础', available: true }, { id: '9', title: '已下架课程', available: false }] } }) })
    }
    if (path.endsWith('/me/courses/8')) return route.fulfill({ json: envelope({ id: '8', title: '消防安全基础', category_id: '3', cover_asset_id: null, description: '', status: 'published', required_lesson_count: 1, chapters: [{ id: '11', title: '第一章', sort_order: 1, lessons: [{ id: '12', title: '消防视频', lesson_type: 'video', required: true, sort_order: 1, current_version: null }] }] }) })
    if (path.endsWith('/me/courses/8/progress')) return route.fulfill({ json: envelope({ required: 1, completed: 0, completion_rate: 0, lessons: [] }) })
    if (path.endsWith('/exam-records/82/result')) return route.fulfill({ json: envelope({ record_id: '82', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: '2026-10-27T06:00:00Z', graded_at: '2026-10-27T06:00:00Z', score: 95, passed: true, correct_rate: null, items: [], total_score: unknownScores ? null : 120, pass_score: unknownScores ? null : 72, duration_minutes: unknownScores ? null : 35 }) })
    return route.fulfill({ status: 404, json: { code: 40401, message: '未预期的请求', data: null } })
  })
  return { calls, completeLearning() { remaining = 0 }, failSummary(value: boolean) { failSummary = value }, rows(value: ReturnType<typeof exam>[]) { rows = value }, unknownScores() { unknownScores = true } }
}

test('direct instructions show frozen metadata, guide required learning and refresh on return', async ({ page }) => {
  const control = await setup(page)
  await page.goto('/#/pages/exam/instructions?paper_id=901')
  await expect(page.getByText('满分 120 分', { exact: true })).toBeVisible()
  await expect(page.getByText('及格线 72 分', { exact: true })).toBeVisible()
  await expect(page.getByText('还需学习 15 分钟', { exact: true })).toBeVisible()
  await expect(page.getByText('暂不可学习', { exact: true })).toBeVisible()
  await screenshot(page, 'learning-required')
  expect(control.calls.some(call => call.path.endsWith('/me/exams'))).toBe(false)
  await page.getByText('去学习', { exact: true }).click()
  await expect(page).toHaveURL(/course\/detail\?id=8&from_exam=901/)
  control.completeLearning()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/exam\/instructions\?paper_id=901/)
  await expect(page.getByText('考前学习已达标', { exact: true })).toBeVisible()
  await expect(page.getByText('开始答题', { exact: true })).toBeVisible()
  await screenshot(page, 'learning-ready')
  expect(control.calls.filter(call => call.path.endsWith('/exams/901'))).toHaveLength(2)
  control.failSummary(true)
  await page.getByText('刷新学习进度', { exact: true }).click()
  await expect(page.getByText('考试信息加载失败', { exact: true })).toBeVisible()
  await expect(page.getByText('考前学习已达标', { exact: true })).toHaveCount(0)
})

test('ended exams open records and state filters are sent to the server', async ({ page }) => {
  const control = await setup(page)
  control.rows([exam({ status: 'archived', latest_record_id: '82' })])
  await page.goto('/#/pages/exam/index')
  await expect(page.getByText('已归档', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '已结束', exact: true }).click()
  await expect.poll(() => control.calls.filter(call => call.path.endsWith('/me/exams')).at(-1)?.state).toBe('ended')
  await screenshot(page, 'archived')
  await page.getByText('查看记录', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/result\?record_id=82/)
  await expect(page.getByText('/ 120 分', { exact: true })).toBeVisible()
  await expect(page.getByText('及格线 72 分', { exact: true })).toBeVisible()
  await screenshot(page, 'result')
  expect(control.calls.some(call => call.path.endsWith('/start'))).toBe(false)
})

test('course playback keeps the exam return context through detail and rejects arbitrary targets', async ({ page }) => {
  await setup(page)
  await page.goto('/#/pages/course/detail?id=8&from_exam=901')
  await page.getByRole('button', { name: '消防视频', exact: true }).click()
  await expect(page).toHaveURL(/course\/player\?course_id=8&lesson_id=12&from_exam=901/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/course\/detail\?id=8&from_exam=901/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/exam\/instructions\?paper_id=901/)
  await expect(page.getByText('还需学习 15 分钟', { exact: true })).toBeVisible()
  await page.goto('/#/pages/course/detail?id=8&from_exam=%2Fpages%2Fprofile%2Finfo')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/pages\/course\/index/)
})

test('unknown historical score rules show placeholders without inventing a 100 point scale', async ({ page }) => {
  const control = await setup(page); control.unknownScores()
  await page.goto('/#/pages/exam/result?record_id=82')
  await expect(page.getByText('/ — 分', { exact: true })).toBeVisible()
  await expect(page.getByText('及格线 — 分', { exact: true })).toBeVisible()
  await expect(page.getByText('/ 100 分', { exact: true })).toHaveCount(0)
})

test('a withdrawn exam with an active record keeps its resume entry', async ({ page }) => {
  const control = await setup(page)
  control.rows([exam({ status: 'withdrawn', active_record_id: '81', latest_record_id: '81' })])
  await page.goto('/#/pages/exam/index')
  await expect(page.getByText('已撤回 · 答题中', { exact: true })).toBeVisible()
  await page.getByText('继续答题', { exact: true }).click()
  await expect(page).toHaveURL(/exam\/take\?record_id=81/)
  expect(control.calls.some(call => call.path.endsWith('/start'))).toBe(false)
})
