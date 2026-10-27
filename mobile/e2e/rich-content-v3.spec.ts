import { expect, test, type Page } from '@playwright/test'
import rich from '../../tests/fixtures/question-authoring-v3/rich-content.json'

const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
async function setup(page: Page, upgrade = false) {
  const stem = structuredClone(rich.stem) as any
  for (const row of stem.content[6].content) for (const cell of row.content) cell.attrs.colwidth = cell.attrs.colwidth.map((width: number) => width * 2)
  const question = { item_id: '101', type: 'single', score: 5, content_schema_version: 3, stem, options: rich.options }
  const review = { ...question, selected_option_ids: ['B'], correct_option_ids: ['A'], analysis: rich.analysis, gained_score: 0 }
  const calls: { path: string; header: string | undefined; data: unknown }[] = []
  const tickets: Record<string, number> = {}
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    calls.push({ path, header: request.headers()['x-question-content-version'], data: request.postDataJSON() })
    if (path.endsWith('/auth/refresh')) return route.fulfill({ json: envelope({ access_token: 'browser-memory', expires_in: 900, user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'verified' } }) })
    if (path.endsWith('/me/exams/41')) return route.fulfill({ json: envelope({ paper_id: '41', title: '富文本培训考试', mode: 'fixed', status: 'published', source: 'external', category_id: null, difficulty: 'easy', total_score: 5, pass_score: 3, duration_minutes: 10, question_count: 1, active_record_id: null, latest_record_id: null, learning: { required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] } }) })
    if (path.endsWith('/41/start') || path.endsWith('/exam-records/81')) {
      if (upgrade) return route.fulfill({ status: 409, json: { code: 40901, message: 'opaque detail', data: { reason_code: 'CONTENT_VERSION_REQUIRED', required_content_version: 3 } } })
      return route.fulfill({ json: envelope({ status: 'in_progress', record_id: '81', paper_id: '41', release_id: '51', deadline_at: new Date(Date.now() + 600000).toISOString(), server_now: new Date().toISOString(), questions: [question] }) })
    }
    if (path.endsWith('/81/result')) return route.fulfill({ json: envelope({ record_id: '81', status: 'failed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: new Date().toISOString(), graded_at: new Date().toISOString(), score: 0, passed: false, correct_rate: 0, items: [review] }) })
    if (path.endsWith('/wrong-questions')) return route.fulfill({ json: envelope({ items: [{ ...review, record_id: '81', submitted_at: new Date().toISOString(), legacy: false }], total: 1, page: 1, page_size: 10 }) })
    if (path.endsWith('/media/tickets/batch')) {
      return route.fulfill({ json: envelope(request.postDataJSON().items.map((item: { asset_id: string; owner_type: string; owner_id: string }, index: number) => {
        const asset = item.asset_id; tickets[asset] = (tickets[asset] || 0) + 1
        return { ...item, index, ticket: { content_url: `/api/v1/media/tickets/${asset}-${tickets[asset]}/content`, expires_at: new Date(Date.now() + 300000).toISOString() }, error: null }
      })) })
    }
    if (/\/42-1\/content$/.test(path)) return route.fulfill({ status: 404, body: '' })
    if (path.endsWith('/content')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="green"/></svg>' })
    return route.fulfill({ status: 404, json: { code: 40401, message: 'unexpected request', data: null } })
  })
  return { calls, tickets }
}
test('schema 3 renders merged cells, safe formats, local image retries, result and wrong book on a narrow screen', async ({ page }) => {
  const { calls, tickets } = await setup(page)
  await page.goto('/#/pages/exam/take?record_id=81')
  await expect(page.getByText('安全操作', { exact: true })).toBeVisible()
  await expect(page.getByText('C.', { exact: true })).toBeVisible()
  await expect(page.getByText('标记', { exact: true }).locator('..')).toHaveCSS('vertical-align', 'super')
  await expect(page.getByText('下标', { exact: true }).locator('..')).toHaveCSS('vertical-align', 'sub')
  await expect(page.getByText('按要求选择。', { exact: true })).toHaveCSS('font-family', 'SimSun, "Songti SC", serif')
  const list = page.locator('.rich-node--orderedList').first()
  await expect(list.locator('.rich-node__list-body > .rich-node--paragraph').first()).toHaveText('检查')
  await expect(list.locator('.rich-node--bulletList .rich-node__marker')).toHaveText('•')
  await expect(list.locator('.rich-node--bulletList .rich-node--paragraph')).toHaveText('设备')
  const table = page.locator('.rich-node__table').first()
  await expect(table).toBeVisible()
  await expect(table.locator('.rich-node--tableHeader').first()).toHaveCSS('grid-row', '1 / span 2')
  await expect(table.locator(':scope > .rich-node--tableHeader')).toHaveCount(2)
  await expect(table.locator(':scope > .rich-node--tableCell')).toHaveCount(2)
  await expect(table.locator('.rich-node--tableHeader').nth(1)).toHaveCSS('grid-column', '2 / span 2')
  await expect(table.locator('.rich-node--tableCell').first()).toHaveCSS('grid-row', '2 / span 1')
  const scroll = page.locator('.rich-node__table-scroll .uni-scroll-view[style*="overflow"]').first()
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '图片加载失败，点击重试', exact: true }).first().click()
  await expect.poll(() => tickets['42']).toBe(2)
  await expect(page.getByRole('button', { name: '图片加载失败，点击重试', exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '选项 A', exact: true }).getByText('先通风检测', { exact: true })).toHaveCSS('font-weight', '700')
  page.on('dialog', dialog => dialog.accept())
  await page.goto('/#/pages/exam/review?record_id=81')
  await expect(page.getByText('先通风检测。', { exact: true })).toBeVisible()
  await expect(page.locator('.rich-node__table')).toHaveCount(1)
  await page.goto('/#/pages/profile/wrong-book')
  await expect(page.getByText('先通风检测。', { exact: true })).toBeVisible()
  await expect(page.locator('.rich-node__table')).toHaveCount(1)
  expect(calls.filter(call => /exam-records\/81$|\/result$|wrong-questions$/.test(call.path)).every(call => call.header === '3')).toBe(true)
  const batches = calls.filter(call => call.path.endsWith('/tickets/batch'))
  expect(batches.length).toBeGreaterThan(0)
  expect(batches.every(call => (call.data as { items: { owner_type: string; owner_id: string }[] }).items.every(item => item.owner_type === 'exam_record_question' && item.owner_id === '101'))).toBe(true)
})
test('a capability upgrade appears as an explicit message without creating a retry loop', async ({ page }) => {
  const { calls } = await setup(page, true)
  await page.goto('/#/pages/exam/take?record_id=81')
  await expect(page.getByText('请更新学员端后再打开此试卷', { exact: true })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/exam-records/81'))).toHaveLength(1)
  expect(calls.some(call => call.path.endsWith('/submit'))).toBe(false)
})
