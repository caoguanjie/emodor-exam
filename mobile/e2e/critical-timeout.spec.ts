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
  return (await response.json()).data
}

test('deadline locks after an editable in-progress window without client submit and late answer is pure timeout', async ({ page }) => {
  const phone = requireEnv('MOBILE_H5_TIMEOUT_PHONE')
  const recordId = requireEnv('MOBILE_H5_TIMEOUT_RECORD_ID')
  const answers = JSON.parse(requireEnv('MOBILE_H5_TIMEOUT_ANSWERS'))
  const login = await debugLogin(page, phone)
  const authHeaders = { Authorization: `Bearer ${login.access_token as string}` }
  const submits: string[] = [], statusGets: string[] = []
  const initial = await page.request.get(api(`/api/v1/me/exam-records/${recordId}`), { headers: authHeaders })
  expect(initial.status(), await initial.text()).toBe(200)
  const initialView = (await initial.json()).data
  expect(initialView.status).toBe('in_progress')
  expect(Date.parse(initialView.deadline_at)).toBeGreaterThan(Date.now())
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/submit')) submits.push(request.url()) })
  page.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/v1/me/exam-records/${recordId}`) statusGets.push(request.url()) })
  await page.goto(route(`/pages/exam/take?record_id=${recordId}`))
  await expect(page.locator('.option-card').first()).toHaveAttribute('aria-disabled', 'false')
  const statusGetsWhileEditable = statusGets.length
  await expect(page.getByText('考试时间已到', { exact: true }).or(page.getByText('超时未交卷', { exact: true }))).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => statusGets.length, { timeout: 5_000 }).toBeGreaterThan(statusGetsWhileEditable)
  await expect.poll(async () => {
    if (await page.getByText('超时未交卷', { exact: true }).isVisible()) return true
    const optionCount = await page.locator('.option-card').count()
    return optionCount > 0 && await page.locator('.option-card[aria-disabled="true"]').count() === optionCount
  }, { timeout: 5_000 }).toBe(true)
  expect(submits).toEqual([])
  const late = await page.request.post(api(`/api/v1/me/exam-records/${recordId}/submit`), { headers: authHeaders, data: answers })
  expect(late.status(), await late.text()).toBe(200)
  const result = (await late.json()).data
  expect(result).toMatchObject({ status: 'timeout', score: 0, passed: false, grading_state: 'not_submitted', submission_method: null, submitted_at: null, graded_at: null, correct_rate: null, items: [] })
})
