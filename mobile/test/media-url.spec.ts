import { afterEach, describe, expect, it, vi } from 'vitest'
const path = '../src/platform/' + 'media-url.ts'
const ticket = '/api/v1/media/tickets/eyJ-test.signature/content'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('controlled media URL resolution', () => {
  it('uses the H5 page origin and preserves the root API path under the /mobile/ base', async () => {
    const { mediaContentUrl = (value: string) => value, resolveMediaUrl = (value: string) => value } = await import(path).catch(() => ({}))
    vi.stubGlobal('window', { location: { origin: 'https://learn.example', href: 'https://learn.example/mobile/#/pages/exam/take' } })
    expect(mediaContentUrl(ticket, 'h5', 'https://ignored.example')).toBe('https://learn.example/api/v1/media/tickets/eyJ-test.signature/content')
    expect(resolveMediaUrl(ticket)).toBe('https://learn.example/api/v1/media/tickets/eyJ-test.signature/content')
  })
  it('requires an explicit HTTPS origin for MP and has no browser-origin fallback', async () => {
    const { mediaContentUrl = (value: string) => value, resolveMediaUrl = (value: string) => value } = await import(path).catch(() => ({}))
    vi.stubGlobal('window', undefined); vi.stubEnv('VITE_API_ORIGIN', 'https://mp.example/')
    expect(resolveMediaUrl(ticket)).toBe('https://mp.example/api/v1/media/tickets/eyJ-test.signature/content')
    expect(mediaContentUrl(ticket, 'mp-weixin', 'https://mp.example:8443')).toBe('https://mp.example:8443/api/v1/media/tickets/eyJ-test.signature/content')
    vi.stubEnv('VITE_API_ORIGIN', '')
    expect(() => resolveMediaUrl(ticket)).toThrow('HTTPS')
    for (const origin of ['', 'http://mp.example', '//mp.example', 'https://mp.example/mobile', 'https://user@mp.example', 'https://mp.example?x=1']) expect(() => mediaContentUrl(ticket, 'mp-weixin', origin)).toThrow()
  })
  it.each(['https://foreign.example/api/v1/media/tickets/a/content', '//foreign.example/a', '/mobile/api/v1/media/tickets/a/content', '/api/v1/media/tickets/a/content?token=x', '/api/v1/media/tickets/a/content#x', '/api/v1/media/tickets/a\\evil/content', '/api/v1/media/tickets/%2f/content', 'javascript:alert(1)'])('rejects an unsafe URL before resolving its platform origin: %s', async unsafe => {
    const { mediaContentUrl = (value: string) => value } = await import(path).catch(() => ({}))
    expect(() => mediaContentUrl(unsafe, 'h5')).toThrow('媒体地址无效')
    expect(() => mediaContentUrl(unsafe, 'mp-weixin', '')).toThrow('媒体地址无效')
  })
  it.each(['.', '..'])('rejects the %s token segment before the browser can normalize it outside the ticket route', async token => {
    const { safeMediaUrl, mediaContentUrl, resolveMediaUrl } = await import(path)
    const unsafe = `/api/v1/media/tickets/${token}/content`
    expect(() => safeMediaUrl(unsafe)).toThrow('媒体地址无效')
    expect(() => mediaContentUrl(unsafe, 'h5')).toThrow('媒体地址无效')
    expect(() => resolveMediaUrl(unsafe)).toThrow('媒体地址无效')
  })
  it('preserves legal dotted tokens and rejects every tested path-changing normalization form', async () => {
    const { safeMediaUrl } = await import(path)
    for (const token of ['eyJ.header.signature', 'a.b', 'a..b', '...', '.-_~']) {
      const value = `/api/v1/media/tickets/${token}/content`
      expect(safeMediaUrl(value)).toBe(value)
      expect(new URL(safeMediaUrl(value), 'https://learn.example/mobile/').pathname).toBe(value)
    }
    for (const token of ['%2e', '%2e%2e', '.%2e', '%2e.', '%2E%2E', '../a', 'a/../b', 'a\\..\\b', '']) {
      expect(() => safeMediaUrl(`/api/v1/media/tickets/${token}/content`)).toThrow('媒体地址无效')
    }
  })
  it('keeps public branding in its separate whitelist on H5 and MP without accepting ticket URLs as asset IDs', async () => {
    const { resolvePublicBrandingUrl = (value: string) => value } = await import(path).catch(() => ({}))
    vi.stubGlobal('window', { location: { origin: 'https://learn.example', href: 'https://learn.example/mobile/' } })
    expect(resolvePublicBrandingUrl('901')).toBe('https://learn.example/api/v1/site-config/assets/901/content')
    expect(resolvePublicBrandingUrl('public-logo')).toBe('https://learn.example/api/v1/site-config/assets/public-logo/content')
    for (const asset of ['../901', '901?token=x', 'https://foreign.example/logo', ticket, '']) expect(() => resolvePublicBrandingUrl(asset)).toThrow('公开品牌资源地址无效')
    vi.stubGlobal('window', undefined); vi.stubEnv('VITE_API_ORIGIN', 'https://mp.example')
    expect(resolvePublicBrandingUrl('901')).toBe('https://mp.example/api/v1/site-config/assets/901/content')
    vi.stubEnv('VITE_API_ORIGIN', '')
    expect(() => resolvePublicBrandingUrl('901')).toThrow('HTTPS')
  })
})
