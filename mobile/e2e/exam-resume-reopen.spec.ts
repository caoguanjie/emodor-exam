import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const questions = [{ item_id: '101', type: 'single', score: 25, stem: doc('接口单选题'), options: [{ id: 'stable-a', content: doc('选项 A') }, { id: 'stable-b', content: doc('选项 B') }] }]

async function installResumeApi(context: BrowserContext) {
  let expired = false
  let active = false, startCalls = 0
  const deadline = new Date(Date.now() + 600000).toISOString()
  const recordDeadlines: string[] = []
  const recordPath = '/api/v1/me/exam-records/81'
  const activeAttempt = () => ({ status: expired ? 'timeout' : 'in_progress', record_id: '81', paper_id: '41', release_id: '51', deadline_at: deadline, server_now: new Date().toISOString(), questions: expired ? [] : questions })
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'resume-test', expires_in: 900, user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: '3', identity_status: 'verified' } }) })
    if (path.endsWith('/me/profile')) return route.fulfill({ json: envelope({ id: '17', username: 'learner', real_name: '学员', phone: null, email: null, avatar_id: null, occupation: null, gender: null, birthday: null, source: 'external', category_id: '3', category_name: '培训工种', role: 'employee', status: 1 }) })
    if (path.endsWith('/me/identity-verification')) return route.fulfill({ json: envelope({ status: 'verified', real_name: '学员', id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }) })
    if (path.endsWith('/me/exams')) return route.fulfill({ json: envelope({ items: [{ paper_id: '41', title: '接口安全培训考试', mode: 'fixed', status: 'published', source: 'external', category_id: '3', difficulty: 'easy', total_score: 100, pass_score: 60, duration_minutes: 10, question_count: 1, active_record_id: active && !expired ? '81' : null, latest_record_id: active || expired ? '81' : null }], total: 1, page: 1, page_size: 20 }) })
    if (path.endsWith('/me/exams/41')) return route.fulfill({ json: envelope({ paper_id: '41', title: '接口安全培训考试', mode: 'fixed', status: 'published', source: 'external', category_id: '3', difficulty: 'easy', total_score: 100, pass_score: 60, duration_minutes: 10, question_count: 1, active_record_id: active && !expired ? '81' : null, latest_record_id: active || expired ? '81' : null, learning: { required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] } }) })
    if (path.endsWith('/41/start')) { startCalls++; active = true; return route.fulfill({ json: envelope(activeAttempt()) }) }
    if (path.endsWith(recordPath)) { recordDeadlines.push(deadline); return route.fulfill({ json: envelope(activeAttempt()) }) }
    return route.fulfill({ status: 404, json: { code: 40401, message: 'unexpected request', data: null } })
  })
  return { getStartCalls: () => startCalls, getRecordDeadlines: () => [...recordDeadlines], getDeadline: () => deadline, expire: () => { expired = true; active = false } }
}

test('closing H5 and reopening resumes the same active record and local answer without starting again', async ({ browser }) => {
  const context = await browser.newContext()
  const api = await installResumeApi(context)
  const first = await context.newPage()
  await first.goto('/#/pages/exam/index')
  await first.getByText('进入考试', { exact: true }).click()
  await first.getByText('开始答题', { exact: true }).click()
  await expect(first).toHaveURL(/exam\/take\?record_id=81$/)
  await first.getByRole('radio', { name: '选项 B', exact: true }).click()
  await expect(first.getByText('草稿已保存', { exact: false })).toBeVisible()
  await first.close()

  const reopened = await context.newPage()
  await reopened.goto('/#/pages/exam/index')
  await reopened.getByText('继续答题', { exact: true }).click()
  await expect(reopened).toHaveURL(/exam\/take\?record_id=81$/)
  await expect(reopened.getByText('已恢复本人本机草稿', { exact: false })).toBeVisible()
  await expect(reopened.getByRole('radio', { name: '选项 B', exact: true })).toHaveAttribute('aria-checked', 'true')
  expect(api.getStartCalls()).toBe(1)
  expect(api.getRecordDeadlines().length).toBeGreaterThan(0)
  expect(new Set(api.getRecordDeadlines())).toEqual(new Set([api.getDeadline()]))
  await reopened.close()
  await context.close()
})

test('an expired record leaves the published exam visible without a continue action', async ({ browser }) => {
  const context = await browser.newContext()
  const api = await installResumeApi(context)
  api.expire()
  const page = await context.newPage()
  await page.goto('/#/pages/exam/index')
  await expect(page.getByText('接口安全培训考试', { exact: true })).toBeVisible()
  await expect(page.getByText('进入考试', { exact: true })).toBeVisible()
  await expect(page.getByText('继续答题', { exact: true })).toHaveCount(0)
  await context.close()
})
