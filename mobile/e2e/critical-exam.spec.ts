import { expect, test, type Page } from '@playwright/test'

const base = () => process.env.MOBILE_E2E_BASE_URL!
const route = (path: string) => `${base()}/#${path}`
const api = (path: string) => `${new URL(path, `${base()}/`).origin}${path}`
const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`missing ${name}`)
  return value
}

async function debugLogin(page: Page, phone: string) {
  const response = await page.request.post(api('/api/v1/mobile/auth/debug-login'), { data: { phone } })
  expect(response.status(), await response.text()).toBe(200)
  const body = await response.json()
  expect(body.data.user.role).toBe('employee')
  return body.data
}

async function verifyIdentity(page: Page, accessToken: string) {
  const images = JSON.parse(requireEnv('MOBILE_H5_IDENTITY_IMAGES_B64')) as Record<string, string>
  const assets: Record<string, string> = {}
  for (const type of ['id_card_portrait', 'id_card_emblem', 'face']) {
    const response = await page.request.post(api('/api/v1/me/identity-verification/images'), {
      headers: { Authorization: `Bearer ${accessToken}` },
      multipart: { image_type: type, file: { name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(images[type], 'base64') } },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json()
    expect(body.data.scan_status).toBe('safe')
    assets[type] = body.data.asset_id
  }
  const created = await page.request.post(api('/api/v1/me/identity-verification/sessions'), {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { id_card_portrait_asset_id: assets.id_card_portrait, id_card_emblem_asset_id: assets.id_card_emblem, face_asset_id: assets.face },
  })
  const createdText = await created.text()
  expect(created.status(), createdText).toBe(200)
  const createdBody = JSON.parse(createdText)
  expect(createdBody.data.status, createdText).toBe('verified')
  const refreshed = await page.request.post(api('/api/v1/mobile/auth/refresh'))
  expect(refreshed.status(), await refreshed.text()).toBe(200)
  expect((await refreshed.json()).data.user.identity_status).toBe('verified')
}

type LiveQuestion = { item_id: string; type: 'single' | 'multiple' | 'judgment'; options: { id: string }[] }
function selectionFor(question: LiveQuestion) {
  if (question.type === 'multiple') return question.options.slice(0, 2).map(option => option.id)
  if (question.type === 'judgment') return [question.options.at(-1)?.id || question.options[0].id]
  return [question.options[0].id]
}
async function chooseCurrent(page: Page, question: LiveQuestion, selected: string[]) {
  const options = page.locator('.option-card')
  await expect.poll(() => options.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  for (const optionId of selected) {
    const index = question.options.findIndex(option => option.id === optionId)
    expect(index).toBeGreaterThanOrEqual(0)
    await options.nth(index).click()
  }
}

test('critical learner H5 chain uses real API, local draft and explicit submission', async ({ page }) => {
  const phone = requireEnv('MOBILE_H5_PHONE')
  const paper = requireEnv('MOBILE_H5_PAPER_ID')
  const course = requireEnv('MOBILE_H5_COURSE_ID')
  const lesson = requireEnv('MOBILE_H5_LESSON_ID')
  const courseTitle = requireEnv('MOBILE_H5_COURSE_TITLE')
  const pageRequests: string[] = []
  const mediaRequests: { origin: string; path: string }[] = []
  const mediaResponses: { origin: string; path: string; status: number; type: string; length: number }[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    pageRequests.push(url.pathname)
    if (/\/media\/tickets\/.*\/content$/.test(url.pathname)) mediaRequests.push({ origin: url.origin, path: url.pathname })
  })
  page.on('response', response => {
    const url = new URL(response.url())
    if (!/\/media\/tickets\/.*\/content$/.test(url.pathname)) return
    const location = { origin: url.origin, path: url.pathname }
    void response.body().then(body => mediaResponses.push({ ...location, status: response.status(), type: response.headers()['content-type'] || '', length: body.length })).catch(() => mediaResponses.push({ ...location, status: response.status(), type: 'unreadable', length: -1 }))
  })
  const login = await debugLogin(page, phone)
  const accessToken = login.access_token as string

  await page.goto(route('/pages/home/index'))
  await expect(page.getByText('推荐课程', { exact: true })).toBeVisible()
  await page.goto(route(`/pages/course/detail?id=${course}`))
  await expect(page.getByText(courseTitle, { exact: true }).first()).toBeVisible()

  // The same learner can browse the course, but video start is identity-gated.
  await page.goto(route(`/pages/course/player?course_id=${course}&lesson_id=${lesson}`))
  await expect(page.getByText('点击播放课程视频', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '播放课程视频', exact: true }).click()
  await expect(page.getByText('完成实名认证后即可学习视频课程', { exact: true })).toBeVisible()

  // Exam start is gated by the same authoritative identity state.
  await page.goto(route(`/pages/exam/instructions?paper_id=${paper}`))
  await expect(page.getByText('开始答题', { exact: true })).toBeVisible()
  await page.getByText('开始答题', { exact: true }).click()
  await expect(page.getByText('完成实名认证后即可参加考试', { exact: true })).toBeVisible()

  await verifyIdentity(page, accessToken)
  await page.reload()
  await page.goto(route(`/pages/exam/instructions?paper_id=${paper}`))
  const start = page.waitForResponse(response => response.url().includes(`/me/exams/${paper}/start`) && response.request().method() === 'POST')
  await page.getByText('开始答题', { exact: true }).click()
  const startBody = await (await start).json()
  expect(startBody.code).toBe(0)
  const recordId = startBody.data.record_id as string
  expect(recordId).toMatch(/^\d+$/)
  await expect(page).toHaveURL(/#\/pages\/exam\/take\?record_id=/)

  const authHeaders = { Authorization: `Bearer ${accessToken}` }
  const attemptResponse = await page.request.get(api(`/api/v1/me/exam-records/${recordId}`), { headers: authHeaders })
  expect(attemptResponse.status(), await attemptResponse.text()).toBe(200)
  const attempt = (await attemptResponse.json()).data
  expect(attempt.status).toBe('in_progress')
  expect(new Set(attempt.questions.map((item: { type: string }) => item.type))).toEqual(new Set(['single', 'multiple', 'judgment']))
  const firstAsset = JSON.stringify(attempt.questions).match(/"asset_id":"(\d+)"/)?.[1]
  expect(firstAsset).toBeTruthy()
  const itemId = attempt.questions[0].item_id as string
  const ticket = await page.request.post(api(`/api/v1/media/${firstAsset}/tickets`), { headers: authHeaders, data: { owner_type: 'exam_record_question', owner_id: itemId } })
  expect(ticket.status(), await ticket.text()).toBe(200)

  const questions = attempt.questions as LiveQuestion[]
  const expected = new Map<string, string[]>()
  const firstSelection = selectionFor(questions[0])
  expected.set(questions[0].item_id, firstSelection)
  // Answer one item, refresh once, and prove the browser restores local-only draft
  // by stable option IDs (not just the visible letter).
  await chooseCurrent(page, questions[0], firstSelection)
  for (const optionId of firstSelection) {
    const index = questions[0].options.findIndex(option => option.id === optionId)
    await expect(page.locator('.option-card').nth(index)).toHaveAttribute('aria-checked', 'true')
  }
  await page.reload()
  await expect(page.getByText('已恢复本人本机草稿', { exact: false })).toBeVisible()
  for (const optionId of firstSelection) {
    const index = questions[0].options.findIndex(option => option.id === optionId)
    await expect(page.locator('.option-card').nth(index)).toHaveAttribute('aria-checked', 'true')
  }
  for (let index = 1; index < questions.length; index += 1) {
    await page.getByText('下一题 ›', { exact: true }).click()
    const selected = selectionFor(questions[index])
    expected.set(questions[index].item_id, selected)
    await chooseCurrent(page, questions[index], selected)
    expect(await page.locator('.option-card[aria-checked="true"]').count()).toBe(selected.length)
  }

  await expect.poll(() => mediaResponses.length, { timeout: 5_000 }).toBeGreaterThan(0)
  expect(mediaResponses.some(response => response.origin === new URL(base()).origin && /^\/api\/v1\/media\/tickets\/[^/]+\/content$/.test(response.path) && response.status === 200 && response.type.startsWith('image/') && response.length > 100), JSON.stringify(mediaResponses)).toBe(true)
  expect(mediaResponses.every(response => response.status === 200 && response.type.startsWith('image/') && response.length > 100), JSON.stringify(mediaResponses)).toBe(true)
  const failedImage = page.getByText('图片加载失败，点击重试', { exact: true })
  if (await failedImage.count()) {
    await failedImage.first().click()
  }
  await expect(page.locator('.readonly-content__image').first()).toBeVisible()
  const naturalSize = await page.locator('.readonly-content__image').first().evaluate(element => {
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    return { naturalWidth: image?.naturalWidth || 0, naturalHeight: image?.naturalHeight || 0 }
  })
  expect(naturalSize.naturalWidth).toBeGreaterThan(0)
  expect(naturalSize.naturalHeight).toBeGreaterThan(0)

  const expectedAnswers = questions.map(question => ({ item_id: question.item_id, option_ids: expected.get(question.item_id) || [] }))
  const resultPromise = page.waitForResponse(response => response.url().includes(`/me/exam-records/${recordId}/result`) && response.request().method() === 'GET')
  const submitRequest = page.waitForRequest(request => request.url().includes(`/me/exam-records/${recordId}/submit`) && request.method() === 'POST')
  const submitResponse = page.waitForResponse(response => response.url().includes(`/me/exam-records/${recordId}/submit`) && response.request().method() === 'POST')
  await page.getByRole('button', { name: '交卷', exact: true }).click()
  await page.getByText('确定交卷', { exact: true }).click()
  const submitted = await (await submitResponse).json()
  expect(submitted.code).toBe(0)
  expect((await submitRequest).postDataJSON()).toEqual({ record_id: recordId, answers: expectedAnswers })
  expect(['passed', 'failed']).toContain(submitted.data.status)
  await expect(page).toHaveURL(new RegExp(`#/pages/exam/result\\?record_id=${recordId}`))
  await expect(page.getByText('考试结果', { exact: true })).toBeVisible()
  await expect(page.getByText('查看答案解析', { exact: true })).toBeVisible()
  const resultBody = await (await resultPromise).json()
  expect(resultBody.data.items.map((item: { item_id: string; selected_option_ids: string[] }) => ({ item_id: item.item_id, option_ids: item.selected_option_ids }))).toEqual(expectedAnswers)

  const terminal = await page.request.get(api(`/api/v1/me/exam-records/${recordId}`), { headers: authHeaders })
  expect((await terminal.json()).data.questions).toEqual([])
  await page.getByText('查看答案解析', { exact: true }).click()
  await expect(page.getByText('解析', { exact: true })).toBeVisible()
  await page.goto(route('/pages/profile/exam-history'))
  await expect(page.getByText('考试记录', { exact: true })).toBeVisible()
  await expect(page.getByText(/未通过|已通过/)).toBeVisible()
  await page.goto(route('/pages/profile/wrong-book'))
  await expect(page.getByText('我的错题本', { exact: true })).toBeVisible()
  await expect(page.getByText(/解析|暂无错题/).first()).toBeVisible()
  expect(pageRequests.filter(path => /\/(?:draft|heartbeat)(?:\/|$)/.test(path)), 'the full browser flow must not issue draft or heartbeat requests with any HTTP method').toEqual([])
  expect(mediaRequests.length).toBeGreaterThan(0)
  expect(mediaRequests.every(request => request.origin === new URL(base()).origin && /^\/api\/v1\/media\/tickets\/[^/]+\/content$/.test(request.path)), JSON.stringify(mediaRequests)).toBe(true)
})
