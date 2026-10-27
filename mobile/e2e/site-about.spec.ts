import { expect, test, type Locator, type Page } from '@playwright/test'

const about = {
  institution_name: '网站配置培训中心', platform_subtitle: '网站配置平台简介', version: '2.4.0',
  contact_email: 'study@example.com', wechat_account: 'study-official', contact_phone: '+86 (20) 8888-6666',
  service_terms: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '已发布服务条款' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '请妥善保管账号。', marks: [{ type: 'bold' }] }] },
  ] },
}
const config = () => ({ logo_asset_id: '901', banners: [], about: structuredClone(about) })
const envelope = (data: unknown) => ({ code: 0, message: 'ok', data })
async function mockPublicAssets(page: Page) {
  await page.route('**/api/v1/site-config/assets/*/content', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>' }))
}

test('about loads public branding and contact actions, then refreshes when returning from terms', async ({ page }) => {
  const current = config()
  const requests: { path: string; authorization?: string }[] = []
  await mockPublicAssets(page)
  await page.route('**/api/v1/site-config', route => {
    requests.push({ path: new URL(route.request().url()).pathname, authorization: route.request().headers().authorization })
    return route.fulfill({ json: envelope(current) })
  })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/mobile/#/pages/profile/about')
  await expect(page.locator('.about-brand__title')).toHaveText('网站配置培训中心')
  await expect(page.locator('.about-brand__subtitle')).toHaveText('网站配置平台简介')
  await expect(page.getByText('2.4.0', { exact: true })).toBeVisible()
  await expect(page.locator('.about-brand__logo img')).toHaveAttribute('src', /\/api\/v1\/site-config\/assets\/901\/content$/)
  await expect(page.locator('a[href="mailto:study@example.com"]')).toBeVisible()
  await page.getByText('study-official', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('study-official')
  await expect(page.locator('a[href="tel:+862088886666"]')).toHaveText('+86 (20) 8888-6666')
  await page.getByText('服务条款', { exact: true }).click()
  await expect(page.getByText('已发布服务条款', { exact: true })).toBeVisible()
  await expect(page.getByText('请妥善保管账号。', { exact: true })).toHaveCSS('font-weight', '700')
  current.about.version = '2.5.0'
  current.about.contact_email = ''; current.about.wechat_account = ''; current.about.contact_phone = ''
  current.about.service_terms = null as any
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('2.5.0', { exact: true })).toBeVisible()
  await expect(page.getByText('联系邮箱', { exact: true })).toHaveCount(0)
  await expect(page.getByText('公众号', { exact: true })).toHaveCount(0)
  await expect(page.getByText('联系电话', { exact: true })).toHaveCount(0)
  await expect(page.getByText('服务条款', { exact: true })).toHaveCount(0)
  await expect(page.getByText('待配置', { exact: true })).toHaveCount(0)
  expect(requests).toHaveLength(3)
  expect(requests.every(request => !request.authorization)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const [contact_phone, dialNumber] of [
  ['13800138000', '13800138000'],
  ['020-88886666', '02088886666'],
  ['+86 (20) 8888-6666', '+862088886666'],
] as const) {
  test(`contact phone ${contact_phone} opens a dial link instead of a copy action`, async ({ page }) => {
    await mockPublicAssets(page)
    await page.route('**/api/v1/site-config', route => route.fulfill({ json: envelope({ ...config(), about: { ...about, contact_phone } }) }))
    await page.goto('/mobile/#/pages/profile/about')
    await expect(page.getByText('联系电话', { exact: true })).toBeVisible()
    await expect(page.locator(`a[href="tel:${dialNumber}"]`)).toHaveText(contact_phone)
  })
}

test('direct terms entry shows loading and retry without presenting old static terms as published', async ({ page }) => {
  let release: (() => Promise<void>) | undefined
  let calls = 0
  await page.route('**/api/v1/site-config', route => {
    calls++
    if (calls === 1) {
      release = () => route.fulfill({ status: 503, json: { code: 50301, message: '配置暂不可用', data: null } })
      return
    }
    return route.fulfill({ json: envelope(config()) })
  })
  await page.goto('/mobile/#/pages/profile/terms')
  await expect(page.getByText('正在加载服务条款', { exact: true })).toBeVisible()
  await expect(page.getByText('一、服务内容', { exact: true })).toHaveCount(0)
  await expect.poll(() => typeof release).toBe('function')
  await release!()
  await expect(page.getByText('配置暂不可用', { exact: true })).toBeVisible()
  await page.getByText('重新加载', { exact: true }).click()
  await expect(page.getByText('已发布服务条款', { exact: true })).toBeVisible()
  expect(calls).toBe(2)
})

test('editable terms keep the original protocol typography and preserve rich text structure', async ({ page }) => {
  const typography = (locator: Locator) => locator.evaluate(element => {
    const style = getComputedStyle(element)
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, textAlign: style.textAlign, color: style.color }
  })
  const gap = async (before: Locator, after: Locator) => {
    const first = await before.boundingBox(), second = await after.boundingBox()
    return second!.y - first!.y - first!.height
  }
  await page.goto('/mobile/#/pages/profile/terms?scenario=terms-default')
  await expect(page.locator('.terms-paper__title')).toBeVisible()
  const reference = {
    title: await typography(page.locator('.terms-paper__title')),
    intro: await typography(page.locator('.terms-paper__intro')),
    heading: await typography(page.locator('.terms-paper__heading').first()),
    body: await typography(page.locator('.terms-paper__section').first().locator('uni-text').last()),
  }
  expect(reference.title).toMatchObject({ fontSize: '18px', fontWeight: '600', lineHeight: '27px', textAlign: 'center', color: 'rgb(50, 50, 51)' })
  expect(reference.heading).toMatchObject({ fontSize: '14px', fontWeight: '600', lineHeight: '25.2px' })
  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const title = { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '后台编辑的服务协议' }] }
  const service_terms = { type: 'doc', content: [
    title,
    paragraph('欢迎使用后台编辑的协议。'),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '一、服务内容' }] },
    paragraph('正文继续来自网站配置。'),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '二、其他约定' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: '保留强调', marks: [{ type: 'bold' }] },
      { type: 'text', text: '保留作者字体', marks: [{ type: 'italic' }, { type: 'textStyle', attrs: { fontFamily: 'SimSun', fontSize: '12pt' } }] },
    ] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('列表正文'), { type: 'blockquote', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '列表中的小标题' }] },
      paragraph('列表嵌套正文'),
    ] }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '表格中的小标题' }] },
      paragraph('表格正文'),
    ] }] }] },
  ] }
  await page.route('**/api/v1/site-config', route => route.fulfill({ json: envelope({ ...config(), about: { ...about, service_terms } }) }))
  await page.goto('/mobile/#/pages/profile/terms')
  await page.reload()
  const content = page.locator('.terms-paper .readonly-content')
  const headings = content.locator(':scope > .rich-node--heading')
  const paragraphs = content.locator(':scope > .rich-node--paragraph')
  await expect(headings.first()).toHaveText('后台编辑的服务协议')
  expect(await typography(headings.first())).toEqual(reference.title)
  expect(await typography(paragraphs.first())).toEqual(reference.intro)
  expect(await typography(headings.nth(1))).toEqual(reference.heading)
  expect(await typography(paragraphs.nth(1))).toEqual(reference.body)
  expect(await gap(headings.first(), paragraphs.first())).toBeCloseTo(20, 0)
  expect(await gap(paragraphs.first(), headings.nth(1))).toBeCloseTo(20, 0)
  expect(await gap(headings.nth(1), paragraphs.nth(1))).toBeCloseTo(8, 0)
  expect(await gap(paragraphs.nth(1), headings.nth(2))).toBeCloseTo(20, 0)
  await expect(page.getByText('保留强调', { exact: true })).toHaveCSS('font-weight', '700')
  await expect(page.getByText('保留作者字体', { exact: true })).toHaveCSS('font-size', '16px')
  await expect(page.getByText('保留作者字体', { exact: true })).toHaveCSS('font-family', 'SimSun, "Songti SC", serif')
  await expect(page.getByText('保留作者字体', { exact: true })).toHaveCSS('font-style', 'italic')
  for (const text of ['列表中的小标题', '表格中的小标题']) {
    const heading = page.getByText(text, { exact: true }).locator('..')
    await expect(heading).toHaveCSS('font-size', '14px')
    await expect(heading).toHaveCSS('font-weight', '600')
    await expect(heading).toHaveCSS('text-align', 'start')
  }
  await expect(content.locator('.rich-node__marker')).toHaveText('•')
  await expect(content.locator('.rich-node__table')).toHaveCount(1)
  await expect(page.getByText('表格正文', { exact: true })).toBeVisible()
  title.attrs.level = 2
  await page.reload()
  await expect(headings.first()).toHaveCSS('font-size', '14px')
  await expect(headings.first()).toHaveCSS('text-align', 'start')
})

for (const [name, service_terms] of [['unpublished', null], ['blank', { type: 'doc', content: [{ type: 'paragraph' }] }]] as const) {
  test(`${name} terms show an empty state`, async ({ page }) => {
    await page.route('**/api/v1/site-config', route => route.fulfill({ json: envelope({ ...config(), about: { ...about, service_terms } }) }))
    await page.goto('/mobile/#/pages/profile/terms')
    await expect(page.getByText('暂未发布服务条款', { exact: true })).toBeVisible()
    await expect(page.getByText('一、服务内容', { exact: true })).toHaveCount(0)
  })
}

test('explicit about and terms previews retain their API-free navigation', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) requests.push(request.url()) })
  await page.goto('/mobile/#/pages/profile/about?scenario=about-default')
  await expect(page.getByText('版本信息', { exact: true })).toBeVisible()
  await page.getByText('服务条款', { exact: true }).click()
  await expect(page).toHaveURL(/scenario=terms-default$/)
  await expect(page.getByText('一、服务内容', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/scenario=about-default$/)
  expect(requests).toEqual([])
})

test('returning from public about to the profile still requires a login', async ({ page }) => {
  let refreshes = 0
  await mockPublicAssets(page)
  await page.route('**/api/v1/site-config', route => route.fulfill({ json: envelope(config()) }))
  await page.route('**/api/v1/mobile/auth/refresh', route => {
    refreshes++
    return route.fulfill({ status: 401, json: { code: 40107, message: '请先登录', data: null } })
  })
  await page.goto('/mobile/#/pages/profile/about')
  await expect(page.locator('.about-brand__title')).toHaveText('网站配置培训中心')
  expect(refreshes).toBe(0)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('手机号验证码登录', { exact: true })).toBeVisible()
  expect(refreshes).toBe(1)
})
