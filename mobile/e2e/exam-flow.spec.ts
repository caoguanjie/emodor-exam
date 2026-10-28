import { expect, test, type Page } from '@playwright/test'

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const questions = [
  { item_id: '101', type: 'single', score: 25, stem: doc('接口单选题'), options: [{ id: 'stable-b', content: doc('第一展示选项') }, { id: 'stable-a', content: doc('第二展示选项') }] },
  { item_id: '102', type: 'multiple', score: 25, stem: doc('接口多选题'), options: [{ id: 'choice-y', content: doc('多选一') }, { id: 'choice-x', content: doc('多选二') }] },
  { item_id: '103', type: 'judgment', score: 25, stem: doc('接口判断题'), options: [{ id: 'true-id', content: doc('正确') }, { id: 'false-id', content: doc('错误') }] },
  { item_id: '104', type: 'single', score: 25, stem: doc('接口图片题'), options: [{ id: 'image-option-7', content: { type: 'doc', content: [{ type: 'image', attrs: { asset_id: '901' } }] } }, { id: 'image-option-3', content: { type: 'doc', content: [{ type: 'image', attrs: { asset_id: '902' } }] } }] },
]
const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
type TicketItem = { asset_id: string; owner_type: string; owner_id: string }
function batchTickets(items: TicketItem[], url: (item: TicketItem) => string) {
  return items.map((item, index) => ({ ...item, index, ticket: { content_url: url(item), expires_at: new Date(Date.now() + 300000).toISOString() }, error: null }))
}
type SetupOptions = { identity?: string; deadlineMs?: number; submit?: 'lost-success' | 'unknown' | 'legacy'; offlineRead?: boolean }
async function setup(page: Page, options: SetupOptions = {}) {
  const calls: { path: string; method: string; data: any }[] = []
  let status = 'in_progress', deadline = new Date(Date.now() + (options.deadlineMs ?? 600000)).toISOString()
  let resultStatus = 'passed', offlineRead = options.offlineRead || false, submitted: any = null
  const attempt = () => ({ status, record_id: '81', paper_id: '41', release_id: '51', deadline_at: deadline, server_now: new Date().toISOString(), questions: status === 'in_progress' ? questions : [] })
  const result = () => ({ record_id: '81', status: resultStatus, grading_state: resultStatus === 'passed' ? 'finalized' : 'not_submitted', submission_method: resultStatus === 'passed' ? 'manual' : null, legacy: resultStatus === 'submitted', submitted_at: resultStatus === 'passed' ? new Date().toISOString() : null, graded_at: resultStatus === 'passed' ? new Date().toISOString() : null, score: resultStatus === 'submitted' ? null : resultStatus === 'timeout' ? 0 : 75, passed: resultStatus === 'passed', correct_rate: resultStatus === 'passed' ? 0.75 : null, items: resultStatus === 'passed' ? questions.map(q => ({ ...q, selected_option_ids: submitted?.answers.find((a: any) => a.item_id === q.item_id)?.option_ids || [], correct_option_ids: [q.options[0].id], analysis: doc('接口冻结解析'), gained_score: submitted?.answers.find((a: any) => a.item_id === q.item_id)?.option_ids.length ? 25 : 0 })) : [] })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname, data = route.request().postDataJSON(), method = route.request().method()
    calls.push({ path, method, data })
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'exam-browser-memory', expires_in: 900, user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'verified' } }) })
    if (path.endsWith('/me/profile')) return route.fulfill({ json: envelope({ id: '17', username: 'learner', real_name: '学员', phone: null, email: null, avatar_id: null, occupation: null, gender: null, birthday: null, source: 'external', category_id: '3', category_name: '接口培训工种', role: 'employee', status: 1 }) })
    if (path.endsWith('/me/identity-verification')) return route.fulfill({ json: envelope({ status: 'verified', real_name: '学员', id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }) })
    if (path.endsWith('/me/exams')) return route.fulfill({ json: envelope({ items: [{ paper_id: '41', title: '接口安全培训考试', mode: 'fixed', status: 'published', source: 'external', category_id: null, difficulty: 'easy' }], total: 1, page: 1, page_size: 10 }) })
    if (path.endsWith('/me/exams/41')) return route.fulfill({ json: envelope({ paper_id: '41', title: '接口安全培训考试', mode: 'fixed', status: 'published', source: 'external', category_id: null, difficulty: 'easy', total_score: 100, pass_score: 60, duration_minutes: 10, question_count: 4, active_record_id: null, latest_record_id: null, learning: { required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] } }) })
    if (path.endsWith('/41/start')) {
      if (options.identity) return route.fulfill({ status: 403, json: { code: 40302, message: 'opaque provider detail', data: { reason_code: options.identity } } })
      return route.fulfill({ json: envelope(attempt()) })
    }
    if (path.endsWith('/81/submit')) {
      submitted = data
      if (options.submit === 'lost-success') { status = 'passed'; return route.abort('failed') }
      if (options.submit === 'legacy') { status = 'submitted'; resultStatus = 'submitted'; return route.abort('failed') }
      if (options.submit === 'unknown') return route.abort('failed')
      status = 'passed'; return route.fulfill({ json: envelope(result()) })
    }
    if (path.endsWith('/exam-records/81')) {
      if (offlineRead) return route.abort('internetdisconnected')
      if (Date.now() >= Date.parse(deadline) && status === 'in_progress') { status = 'timeout'; resultStatus = 'timeout' }
      return route.fulfill({ json: envelope(attempt()) })
    }
    if (path.endsWith('/81/result')) return route.fulfill({ json: envelope(result()) })
    if (path.endsWith('/me/exam-records')) return route.fulfill({ json: envelope({ items: [{ record_id: '81', paper_id: '41', paper_title: '接口安全培训考试', attempt_no: 1, status: 'timeout', grading_state: 'not_submitted', submission_method: null, legacy: false, source: 'external', difficulty: 'easy', score: 0, started_at: new Date().toISOString(), submitted_at: null, graded_at: null }], total: 1, page: 1, page_size: 10 }) })
    if (path.endsWith('/me/wrong-questions')) return route.fulfill({ json: envelope({ items: [{ ...questions[0], record_id: '81', submitted_at: new Date().toISOString(), legacy: false, selected_option_ids: ['stable-a'], correct_option_ids: ['stable-b'], analysis: doc('错题冻结解析'), gained_score: 0 }], total: 1, page: 1, page_size: 10 }) })
    if (path.endsWith('/media/tickets/batch')) return route.fulfill({ json: envelope(batchTickets(data.items, item => `/api/v1/media/tickets/item-${item.asset_id}/content`)) })
    if (path.endsWith('/content')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="blue"/></svg>' })
    return route.fulfill({ status: 404, json: { code: 40401, message: 'unexpected request', data: null } })
  })
  return { calls, setOfflineRead(value: boolean) { offlineRead = value }, expire() { deadline = new Date(Date.now() - 1000).toISOString() } }
}
async function jump(page: Page, number: number) { await page.getByRole('button', { name: '打开答题卡', exact: true }).click(); await page.getByRole('button', { name: `跳转第 ${number} 题`, exact: true }).click() }
async function enter(page: Page) { await page.goto('/#/pages/exam/index'); await page.getByText('进入考试', { exact: true }).click(); await page.getByText('开始答题', { exact: true }).click(); await expect(page.getByText('接口单选题', { exact: true })).toBeVisible() }
async function submit(page: Page) { await page.getByRole('button', { name: '交卷', exact: true }).click(); await page.getByText('确定交卷', { exact: true }).click() }

test('real pages use stable IDs for single/multiple/judgment/image choices and submit every item including blanks', async ({ page }) => {
  const { calls } = await setup(page); await enter(page)
  await page.getByRole('radio', { name: '选项 B', exact: true }).click()
  await jump(page, 2); await page.getByRole('checkbox', { name: '选项 A', exact: true }).click(); await page.getByRole('checkbox', { name: '选项 B', exact: true }).click(); await page.getByRole('checkbox', { name: '选项 A', exact: true }).click()
  await jump(page, 3); await expect(page.getByRole('radio', { name: '选项 ✓', exact: true })).toBeVisible()
  await jump(page, 4); await expect(page.locator('.readonly-content__image').first()).toBeVisible()
  expect(calls.filter(c => c.path.endsWith('/tickets/batch')).map(c => c.data)).toEqual([{ items: [{ asset_id: '901', owner_type: 'exam_record_question', owner_id: '104' }, { asset_id: '902', owner_type: 'exam_record_question', owner_id: '104' }] }])
  await page.getByRole('radio', { name: '选项 A', exact: true }).click(); await submit(page)
  await expect(page.getByText('75', { exact: true })).toBeVisible()
  expect(calls.find(c => c.path.endsWith('/submit'))?.data).toEqual({ record_id: '81', answers: [{ item_id: '101', option_ids: ['stable-a'] }, { item_id: '102', option_ids: ['choice-x'] }, { item_id: '103', option_ids: [] }, { item_id: '104', option_ids: ['image-option-7'] }] })
  expect(calls.some(c => /draft|heartbeat/.test(c.path))).toBe(false)
  await page.getByText('查看答案解析', { exact: true }).click(); await expect(page.getByText('接口冻结解析', { exact: true })).toBeVisible()
})
test('page-local offline answers save, exit requires confirmation, and same record restores the draft', async ({ page, context }) => {
  const { calls } = await setup(page); await enter(page)
  await context.setOffline(true); await page.getByRole('radio', { name: '选项 B', exact: true }).click()
  await expect(page.getByText('草稿已保存', { exact: false })).toBeVisible(); const count = calls.length
  await jump(page, 2); await page.getByRole('checkbox', { name: '选项 B', exact: true }).click(); expect(calls.length).toBe(count)
  await context.setOffline(false)
  await page.getByRole('button', { name: '退出答题', exact: true }).click(); await expect(page.getByText('确定退出答题？')).toBeVisible(); await page.getByText('继续答题', { exact: true }).click()
  await page.goBack(); await expect(page.getByText('确定退出答题？')).toBeVisible(); await page.getByText('退出', { exact: true }).last().click()
  await page.getByText('进入考试', { exact: true }).click(); await page.getByText('开始答题', { exact: true }).click()
  await expect(page.getByText('已恢复本人本机草稿', { exact: false })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '选项 B', exact: true })).toHaveAttribute('aria-checked', 'true')
  await jump(page, 1); await expect(page.getByRole('radio', { name: '选项 B', exact: true })).toHaveAttribute('aria-checked', 'true')
  expect(new Set(calls.filter(c => /exam-records\/\d+$/.test(c.path)).map(c => c.path))).toEqual(new Set(['/api/v1/me/exam-records/81']))
})
test('an offline refresh cannot render questions from a local answer draft', async ({ page }) => {
  const control = await setup(page); await enter(page); await page.getByRole('radio', { name: '选项 A', exact: true }).click(); await expect(page.getByText('草稿已保存', { exact: false })).toBeVisible()
  control.setOfflineRead(true); page.on('dialog', dialog => dialog.accept()); await page.reload()
  await expect(page.getByText('题目加载失败', { exact: true })).toBeVisible(); await expect(page.getByRole('radio')).toHaveCount(0)
  control.setOfflineRead(false); await page.getByText('重新加载', { exact: true }).click(); await expect(page.getByRole('radio', { name: '选项 A', exact: true })).toHaveAttribute('aria-checked', 'true')
})
test('deadline checks authority and presents pure timeout without a submit or review', async ({ page }) => {
  const { calls } = await setup(page, { deadlineMs: 1500 }); await page.goto('/#/pages/exam/take?record_id=81')
  await expect(page.getByText('超时未交卷', { exact: true })).toBeVisible({ timeout: 10000 })
  expect(calls.some(c => c.path.endsWith('/submit'))).toBe(false)
  await expect(page.getByText('查看答案解析', { exact: true })).toHaveCount(0)
})
for (const mode of ['lost-success', 'unknown', 'legacy'] as const) {
  test(`uncertain ${mode} response queries before retrying the frozen payload`, async ({ page }) => {
    const { calls } = await setup(page, { submit: mode }); await enter(page); await page.getByRole('radio', { name: '选项 B', exact: true }).click(); await submit(page)
    if (mode === 'lost-success') await expect(page.getByText('75', { exact: true })).toBeVisible()
    else if (mode === 'legacy') await expect(page.getByText('历史结果待确认', { exact: true })).toBeVisible()
    else await expect(page.getByText('结果确认中', { exact: true })).toBeVisible()
    const posts = calls.filter(c => c.path.endsWith('/submit'))
    expect(posts).toHaveLength(mode === 'unknown' ? 2 : 1)
    if (mode === 'unknown') {
      expect(posts[1].data).toEqual(posts[0].data)
      const first = calls.indexOf(posts[0]), second = calls.indexOf(posts[1])
      expect(calls.slice(first + 1, second).some(c => c.path === '/api/v1/me/exam-records/81' && c.method === 'GET')).toBe(true)
      await expect(page.getByRole('radio', { name: '选项 A', exact: true })).toHaveAttribute('aria-disabled', 'true')
    }
  })
}
test('history preserves timeout and wrong book renders only the returned frozen review', async ({ page }) => {
  await setup(page); await page.goto('/#/pages/profile/exam-history'); await expect(page.getByText('超时未交卷', { exact: true })).toBeVisible()
  await page.goto('/#/pages/profile/wrong-book'); await expect(page.getByText('错题冻结解析', { exact: true })).toBeVisible(); await expect(page.getByText('你的选择 · 选错', { exact: false })).toBeVisible()
})
test('history distinguishes an already graded legacy timeout and opens its authoritative passed result', async ({ page }) => {
  const { calls } = await setup(page)
  const time = '2026-10-21T10:00:00.000Z'
  const pure = { record_id: '81', paper_id: '41', paper_title: '本次未交卷考试', attempt_no: 1, status: 'timeout', grading_state: 'not_submitted', submission_method: null, legacy: false, source: 'external', difficulty: 'easy', score: 0, started_at: time, submitted_at: null, graded_at: null }
  const historical = { ...pure, record_id: '82', paper_title: '历史已评分考试', grading_state: 'finalized', submission_method: 'timeout', legacy: true, score: 73, submitted_at: time, graded_at: time }
  await page.route('**/api/v1/me/exam-records?*', route => route.fulfill({ json: envelope({ items: [pure, historical], total: 2, page: 1, page_size: 10 }) }))
  await page.route('**/api/v1/me/exam-records/82/result', route => {
    calls.push({ path: '/api/v1/me/exam-records/82/result', method: 'GET', data: null })
    return route.fulfill({ json: envelope({ record_id: '82', status: 'passed', grading_state: 'finalized', submission_method: 'timeout', legacy: true, submitted_at: time, graded_at: time, score: 73, passed: true, correct_rate: 1, items: [{ ...questions[0], selected_option_ids: ['stable-b'], correct_option_ids: ['stable-b'], analysis: null, gained_score: 25 }] }) })
  })
  await page.goto('/#/pages/profile/exam-history')
  const old = page.getByRole('button', { name: '查看历史已评分考试结果', exact: true }), current = page.getByRole('button', { name: '查看本次未交卷考试结果', exact: true })
  await expect(old.getByText('历史超时交卷', { exact: true })).toBeVisible(); await expect(old.getByText('73', { exact: true })).toBeVisible()
  await expect(current.getByText('超时未交卷', { exact: true })).toBeVisible(); await expect(current.getByText('—', { exact: true })).toBeVisible()
  await old.click(); await expect(page).toHaveURL(/record_id=82/); await expect(page.getByText('已通过', { exact: true })).toBeVisible(); await expect(page.getByText('73', { exact: true })).toBeVisible()
  expect(calls.some(call => call.path === '/api/v1/me/exam-records/82/result')).toBe(true)
})
test('a failed exam image visibly offers a fresh per-item ticket retry', async ({ page }) => {
  await setup(page)
  let tickets = 0
  await page.route('**/api/v1/media/tickets/batch', route => route.fulfill({ json: envelope(batchTickets(route.request().postDataJSON().items, item => item.asset_id === '901' ? `/api/v1/media/tickets/retry-${++tickets}/content` : `/api/v1/media/tickets/item-${item.asset_id}/content`)) }))
  await page.route('**/api/v1/media/tickets/retry-1/content', route => route.abort('failed'))
  await enter(page); await jump(page, 4)
  await page.getByRole('button', { name: '图片加载失败，点击重试', exact: true }).click()
  await expect.poll(() => tickets).toBe(2)
  await expect(page.getByRole('button', { name: '图片加载失败，点击重试', exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '选项 A', exact: true })).toHaveAttribute('aria-checked', 'false')
})
for (const rejection of [
  { code: 40902, message: '补考次数已用尽' },
  { code: 40903, message: '已通过该考试，无需再次作答' },
  { code: 40904, message: '考试正在等待批改，暂不能补考' },
]) {
test(`start rejection ${rejection.code} replaces and disables the start button`, async ({ page }) => {
  await setup(page)
  let starts = 0
  await page.route('**/api/v1/me/exams/41/start', route => {
    starts++
    return route.fulfill({ status: 409, json: { ...rejection, data: null } })
  })
  await page.goto('/#/pages/exam/instructions?paper_id=41')
  await page.getByText('开始答题', { exact: true }).click()
  const footer = page.locator('.paper-footer')
  const blocked = footer.locator('.wd-button')
  await expect(blocked).toBeVisible()
  await expect(blocked).toHaveText('暂时无法开始考试')
  await expect(blocked).toHaveClass(/is-disabled/)
  await expect(footer.getByText(rejection.message, { exact: true })).toBeVisible()
  await expect(page.getByText('开始答题', { exact: true })).toHaveCount(0)
  await blocked.click({ force: true })
  expect(starts).toBe(1)
})
}

test('a temporary start error keeps the start action retryable', async ({ page }) => {
  await setup(page)
  await page.route('**/api/v1/me/exams/41/start', route => route.fulfill({ status: 503, json: { code: 50001, message: '服务暂不可用，请重试', data: null } }))
  await page.goto('/#/pages/exam/instructions?paper_id=41')
  await page.getByText('开始答题', { exact: true }).click()
  await expect(page.getByText('服务暂不可用，请重试', { exact: true })).toBeVisible()
  const start = page.locator('.paper-footer .wd-button')
  await expect(start).toHaveText('开始答题')
  await expect(start).not.toHaveClass(/is-disabled/)
})

for (const reason of ['IDENTITY_REQUIRED', 'IDENTITY_PENDING']) {
  test(`start uses structured ${reason} to offer the identity entry`, async ({ page }) => {
    await setup(page, { identity: reason }); await page.goto('/#/pages/exam/instructions?paper_id=41'); await page.getByText('开始答题', { exact: true }).click()
    await expect(page.getByText(reason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证', { exact: true })).toBeVisible(); await expect(page.getByText('opaque provider detail')).toHaveCount(0)
  })
}

for (const location of ['stem', 'option', 'analysis'] as const) {
  test(`review ${location} image content failure signs a fresh ticket on retry`, async ({ page }) => {
    await setup(page)
    const imageDoc = { type: 'doc', content: [{ type: 'image', attrs: { asset_id: '901' } }] }
    const item = { ...questions[0], stem: location === 'stem' ? imageDoc : doc('复盘题面'), options: location === 'option' ? [{ id: 'stable-b', content: imageDoc }, questions[0].options[1]] : questions[0].options, selected_option_ids: ['stable-b'], correct_option_ids: ['stable-b'], analysis: location === 'analysis' ? imageDoc : doc('复盘解析'), gained_score: 25 }
    await page.route('**/api/v1/me/exam-records/81/result', route => route.fulfill({ json: envelope({ record_id: '81', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: new Date().toISOString(), graded_at: new Date().toISOString(), score: 25, passed: true, correct_rate: 1, items: [item] }) }))
    let tickets = 0
    await page.route('**/api/v1/media/tickets/batch', route => route.fulfill({ json: envelope(batchTickets(route.request().postDataJSON().items, () => `/api/v1/media/tickets/review-${location}-${++tickets}/content`)) }))
    await page.route(`**/api/v1/media/tickets/review-${location}-1/content`, route => route.abort('failed'))
    await page.goto('/#/pages/exam/review?record_id=81')
    await page.getByRole('button', { name: '图片加载失败，点击重试', exact: true }).click()
    await expect.poll(() => tickets).toBe(2)
    await expect(page.getByRole('button', { name: '图片加载失败，点击重试', exact: true })).toHaveCount(0)
  })
}

test('review sorts correct and selected answer labels by displayed options', async ({ page }) => {
  await setup(page)
  const item = {
    ...questions[1], options: ['option-z', 'option-a', 'option-m', 'option-b'].map(id => ({ id, content: doc(id) })),
    correct_option_ids: ['option-z', 'option-m', 'option-a'], selected_option_ids: ['option-m', 'option-z', 'option-a'],
    analysis: null, gained_score: 25,
  }
  await page.route('**/api/v1/me/exam-records/81/result', route => route.fulfill({ json: envelope({ record_id: '81', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: new Date().toISOString(), graded_at: new Date().toISOString(), score: 25, passed: true, correct_rate: 1, items: [item] }) }))
  await page.goto('/#/pages/exam/review?record_id=81')
  const summaries = page.locator('.review-analysis__answers > uni-view')
  await expect(summaries.nth(0)).toHaveText('正确答案A B C')
  await expect(summaries.nth(1)).toHaveText('你的答案A B C')
  await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
})

test('partial multiple-choice credit stays wrong in the review, answer card, and result metrics', async ({ page }) => {
  await setup(page)
  const partial = { ...questions[1], selected_option_ids: ['choice-y'], correct_option_ids: ['choice-y', 'choice-x'], analysis: doc('多选漏选会获得部分分'), gained_score: 10 }
  const zeroScoreCorrect = { ...questions[0], score: 0, selected_option_ids: ['stable-b'], correct_option_ids: ['stable-b'], analysis: doc('零分题依然按答案判对'), gained_score: 0 }
  await page.route('**/api/v1/me/exam-records/81/result', route => route.fulfill({ json: envelope({ record_id: '81', status: 'failed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: new Date().toISOString(), graded_at: new Date().toISOString(), score: 10, passed: false, correct_rate: 0.5, items: [partial, zeroScoreCorrect] }) }))
  await page.goto('/#/pages/exam/review?record_id=81')
  await expect(page.getByText('回答错误', { exact: true })).toBeVisible(); await expect(page.getByText('得 10 / 25', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开解析卡', exact: true }).click(); await expect(page.getByText('对 1 · 错 1 · 未答 0', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '跳转第 1 题', exact: true })).toHaveClass(/answer-card__cell--wrong/)
  await page.getByRole('button', { name: '跳转第 2 题', exact: true }).click(); await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
  await page.goto('/#/pages/exam/result?record_id=81')
  await expect(page.locator('.result-summary__metrics > uni-view').filter({ hasText: '答对' }).locator('uni-text').first()).toHaveText('1')
  await expect(page.locator('.result-summary__metrics > uni-view').filter({ hasText: '答错' }).locator('uni-text').first()).toHaveText('1')
  await expect(page.getByText('50%', { exact: true })).toBeVisible()
})
