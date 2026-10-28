import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiPath, normalizeApiOrigin, resolveApiUrl } from '../src/platform/api-url'
import { createNativeAuthCookieJar } from '../src/platform/native-auth-cookie'

const origin = 'https://training.example.test'
const refresh = '/api/v1/mobile/auth/refresh'
const login = '/api/v1/mobile/auth/sms/login'
const logout = '/api/v1/mobile/auth/logout'
const cookie = (value: string, extra = '') => `ruleexam_mobile_refresh=${value}; Path=/api/v1/mobile/auth; HttpOnly; SameSite=Strict; Secure; Max-Age=3600${extra}`
const envelope = (data: unknown = null) => ({ code: 0, message: 'ok', data })
const user = { id: 17, username: 'native-learner', real_name: '', phone_masked: '138****0000', role: 'employee' as const, source: 'external' as const, category_id: null, identity_status: 'unverified' as const }
const sessionData = (access: string, id = 17) => ({ access_token: access, expires_in: 900, user: { ...user, id } })
const smsInput = { phone: '13800000000', challenge_id: 'native-challenge', code: '123456' }
type WireResponse = { statusCode: number; data: unknown; cookies?: string[]; header?: Record<string, string> }
type WireRequest = { url: string; header: Record<string, string>; success: (response: WireResponse) => void; fail: (error: unknown) => void }
function installNativeWire(handler: (request: WireRequest) => WireResponse | Promise<WireResponse>) {
  vi.stubGlobal('window', undefined)
  vi.stubEnv('VITE_API_ORIGIN', origin)
  vi.stubGlobal('uni', {
    request: (wire: WireRequest) => { Promise.resolve().then(() => handler(wire)).then(wire.success, wire.fail) },
    reLaunch: vi.fn(), setStorageSync: vi.fn(), setStorage: vi.fn(),
    getStorage: ({ fail }: { fail: () => void }) => fail(),
    removeStorage: ({ success }: { success: () => void }) => success(),
  })
}

beforeEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); setActivePinia(createPinia()) })

describe('platform API addresses', () => {
  it('allows loopback HTTP only in explicitly enabled development mode', () => {
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_MP_LOCAL_HTTP', 'true')
    expect(resolveApiUrl('/me/home', 'mp-weixin', 'http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/api/v1/me/home')
    expect(normalizeApiOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    for (const api of ['http://192.168.1.2:3000', 'http://localhost.evil.test', 'http://localhost:70000', 'http://localhost:3000/api']) expect(() => normalizeApiOrigin(api)).toThrow()
    vi.stubEnv('DEV', false)
    expect(() => normalizeApiOrigin('http://127.0.0.1:3000')).toThrow()
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_MP_LOCAL_HTTP', 'false')
    expect(() => normalizeApiOrigin('http://127.0.0.1:3000')).toThrow()
  })
  it('keeps H5 requests relative and resolves MP requests without browser URL globals', async () => {
    vi.stubGlobal('URL', undefined)
    expect(resolveApiUrl('/me/home', 'h5')).toBe('/api/v1/me/home')
    expect(resolveApiUrl('/api/v1/me/courses?page=2', 'mp-weixin', origin)).toBe(`${origin}/api/v1/me/courses?page=2`)
    expect(normalizeApiOrigin('https://TRAINING.example.test:443/')).toBe(origin)
  })
  it('rejects missing or unsafe native origins and routes before network transport', async () => {
    for (const value of ['', 'http://training.example.test', `${origin}/api`, `${origin}?x=1`, `${origin}#x`, `${origin}\n`, 'https://user@training.example.test', 'https://bad..example.test', 'https://example.test:0', 'https://example.test:65536']) {
      expect(() => resolveApiUrl('/me/home', 'mp-weixin', value)).toThrow(/HTTPS/)
    }
    for (const path of ['https://other.example.test/api/v1/me/home', '//other.example.test', '/api/v2/me', '/me/../admin', '/me/%2e%2e/admin', '/me/%252e%252e/admin', '/me/%2fadmin', '/me/home#fragment', '/me/\\admin', '/me/%0ahome', '/me/home?x=%0a']) {
      expect(() => resolveApiUrl(path, 'mp-weixin', origin)).toThrow()
    }
    expect(apiPath('/me/courses?keyword=%E5%AD%A6%E4%B9%A0')).toBe('/api/v1/me/courses?keyword=%E5%AD%A6%E4%B9%A0')
  })
})

describe('native authentication cookie scope', () => {
  it('only replays a host-only mobile refresh cookie to same-origin refresh and logout', async () => {
    const jar = createNativeAuthCookieJar()
    jar.acceptResponse(`${origin}${login}`, origin, { cookies: [cookie('native-a')] }, jar.generation())
    expect(jar.headers(`${origin}${refresh}`, origin)).toEqual({ Cookie: 'ruleexam_mobile_refresh=native-a' })
    expect(jar.headers(`${origin}${logout}`, origin)).toEqual({ Cookie: 'ruleexam_mobile_refresh=native-a' })
    for (const path of [login, '/api/v1/mobile/auth/sms/send', '/api/v1/me/home', '/api/v1/auth/refresh']) expect(jar.headers(`${origin}${path}`, origin)).toEqual({})
    expect(jar.headers(`https://other.example.test${refresh}`, origin)).toEqual({})
  })
  it('rejects wrong cookie names, scopes, missing HttpOnly and non-auth response injection', async () => {
    const jar = createNativeAuthCookieJar()
    for (const value of [cookie('bad').replace('ruleexam_mobile_refresh', 'ruleexam_refresh'), cookie('bad').replace('; HttpOnly', ''), cookie('bad').replace('/api/v1/mobile/auth', '/'), cookie('bad', '; Domain=training.example.test')]) {
      jar.acceptResponse(`${origin}${login}`, origin, { cookies: [value] }, jar.generation())
      expect(jar.headers(`${origin}${refresh}`, origin)).toEqual({})
    }
    jar.acceptResponse(`${origin}/api/v1/me/home`, origin, { cookies: [cookie('bad')] }, jar.generation())
    expect(jar.headers(`${origin}${refresh}`, origin)).toEqual({})
  })
  it('rotates case-insensitive Set-Cookie headers and ignores responses after reset', async () => {
    const jar = createNativeAuthCookieJar()
    jar.acceptResponse(`${origin}${login}`, origin, { header: { 'sEt-CoOkIe': cookie('first') } }, jar.generation())
    jar.acceptResponse(`${origin}${refresh}`, origin, { cookies: [cookie('second')] }, jar.generation())
    expect(jar.headers(`${origin}${refresh}`, origin)).toEqual({ Cookie: 'ruleexam_mobile_refresh=second' })
    const stale = jar.generation(); jar.reset()
    jar.acceptResponse(`${origin}${refresh}`, origin, { cookies: [cookie('stale')] }, stale)
    expect(jar.headers(`${origin}${refresh}`, origin)).toEqual({})
  })
  it('invalidates refresh at logout while preserving only the revocation request and expires cookies', async () => {
    const jar = createNativeAuthCookieJar()
    jar.acceptResponse(`${origin}${login}`, origin, { cookies: [cookie('first')] }, jar.generation())
    const stale = jar.generation(); jar.beginLogout()
    expect(jar.headers(`${origin}${refresh}`, origin)).toEqual({})
    expect(jar.headers(`${origin}${logout}`, origin)).toEqual({ Cookie: 'ruleexam_mobile_refresh=first' })
    jar.acceptResponse(`${origin}${refresh}`, origin, { cookies: [cookie('stale')] }, stale)
    jar.finishLogout(jar.generation())
    expect(jar.headers(`${origin}${logout}`, origin)).toEqual({})
    jar.acceptResponse(`${origin}${login}`, origin, { cookies: [cookie('new')] }, jar.generation())
    jar.acceptResponse(`${origin}${refresh}`, origin, { cookies: [cookie('').replace('Max-Age=3600', 'Max-Age=0')] }, jar.generation())
    expect(jar.headers(`${origin}${refresh}`, origin)).toEqual({})
  })
  it('does not let an older logout completion erase a newer logout credential', () => {
    const jar = createNativeAuthCookieJar()
    jar.acceptResponse(`${origin}${login}`, origin, { cookies: [cookie('account-a')] }, jar.generation())
    jar.beginLogout()
    const oldLogout = jar.generation()
    jar.beginLogin()
    jar.acceptResponse(`${origin}${login}`, origin, { cookies: [cookie('account-b')] }, jar.generation())
    jar.beginLogout()
    jar.finishLogout(oldLogout)
    expect(jar.headers(`${origin}${logout}`, origin)).toEqual({ Cookie: 'ruleexam_mobile_refresh=account-b' })
  })
})

describe('native JSON and upload integration', () => {
  it('sends absolute native URLs, preserves configuration errors and never persists credentials', async () => {
    vi.stubGlobal('window', undefined); vi.stubEnv('VITE_API_ORIGIN', origin)
    const seen: any[] = []
    vi.stubGlobal('uni', { request: (wire: any) => { seen.push(wire); wire.success({ statusCode: 200, data: envelope({ access_token: 'access', expires_in: 900, user: { id: 17 } }), cookies: wire.url.endsWith('/sms/login') ? [cookie('native-session')] : [] }) }, uploadFile: (wire: any) => { seen.push(wire); wire.success({ statusCode: 200, data: JSON.stringify(envelope({ asset_id: '91' })) }) }, setStorageSync: vi.fn(), reLaunch: vi.fn() })
    const { request } = await import('../src/api/client')
    const { uploadMedia } = await import('../src/api/media')
    await request({ url: '/mobile/auth/sms/login', method: 'POST', auth: false })
    await request({ url: '/mobile/auth/refresh', method: 'POST', auth: false })
    await uploadMedia('/me/identity-verification/images', { tempFilePath: 'wxfile://native-photo', size: 100 }, { image_type: 'face' })
    expect(seen.map(row => row.url)).toEqual([`${origin}${login}`, `${origin}${refresh}`, `${origin}/api/v1/me/identity-verification/images`])
    expect(seen[0].header.Cookie).toBeUndefined(); expect(seen[1].header.Cookie).toBe('ruleexam_mobile_refresh=native-session'); expect(seen[2].header.Cookie).toBeUndefined()
    expect(seen[0].withCredentials).toBeUndefined()
    expect(uni.setStorageSync).not.toHaveBeenCalled()
    vi.stubEnv('VITE_API_ORIGIN', '')
    await expect(request({ url: '/mobile/auth/sms/send', auth: false })).rejects.toMatchObject({ code: -3 })
    expect(seen).toHaveLength(3)
  })

  it('drops late refresh cookies on account switch and keeps the next login behind logout', async () => {
    let finishRefresh!: (response: WireResponse) => void
    let finishLogout!: (response: WireResponse) => void
    let markRefresh!: () => void, markLogout!: () => void
    const refreshStarted = new Promise<void>(resolve => { markRefresh = resolve })
    const logoutStarted = new Promise<void>(resolve => { markLogout = resolve })
    const seen: WireRequest[] = []
    let logins = 0, refreshes = 0
    installNativeWire(wire => {
      seen.push(wire)
      if (wire.url.endsWith(login)) {
        logins++
        return { statusCode: 200, data: envelope(sessionData(`access-${logins}`, 16 + logins)), cookies: [cookie(`refresh-${logins}`)] }
      }
      if (wire.url.endsWith(logout)) { markLogout(); return new Promise(resolve => { finishLogout = resolve }) }
      if (++refreshes === 1) { markRefresh(); return new Promise(resolve => { finishRefresh = resolve }) }
      return { statusCode: 200, data: envelope(sessionData(`renewed-${logins}`, 16 + logins)) }
    })
    const { useSessionStore } = await import('../src/stores/session')
    const session = useSessionStore()
    await session.login(smsInput)
    const oldRefresh = session.refreshAccessTokenOnce().catch(error => error)
    await refreshStarted
    const nextLogin = session.login(smsInput)
    finishRefresh({ statusCode: 200, data: envelope(sessionData('late-access')), cookies: [cookie('late-refresh')] })
    await nextLogin
    await expect(oldRefresh).resolves.toMatchObject({ code: 40107 })
    await session.refreshAccessTokenOnce()
    expect(seen.filter(wire => wire.url.endsWith(refresh)).map(wire => wire.header.Cookie)).toEqual(['ruleexam_mobile_refresh=refresh-1', 'ruleexam_mobile_refresh=refresh-2'])
    expect(JSON.stringify(session.$state)).not.toMatch(/refresh-1|refresh-2|late-refresh/)

    const exiting = session.logout()
    const thirdLogin = session.login(smsInput)
    await logoutStarted
    expect(logins).toBe(2)
    expect(seen.at(-1)?.header.Cookie).toBe('ruleexam_mobile_refresh=refresh-2')
    finishLogout({ statusCode: 200, data: envelope(), header: { 'Set-Cookie': cookie('').replace('Max-Age=3600', 'Max-Age=0') } })
    await Promise.all([exiting, thirdLogin])
    await session.refreshAccessTokenOnce()
    expect(seen.at(-1)?.header.Cookie).toBe('ruleexam_mobile_refresh=refresh-3')
    expect(seen.filter(wire => wire.url.endsWith(login)).every(wire => wire.header.Cookie === undefined)).toBe(true)
    expect(session.accessToken).toBe('renewed-3')
    expect(uni.setStorageSync).not.toHaveBeenCalled()
    expect(uni.setStorage).not.toHaveBeenCalled()
  })

  it('does not restore credentials from a login response after expiry or from process restart', async () => {
    let finishLogin!: (response: WireResponse) => void
    let markLogin!: () => void
    const loginStarted = new Promise<void>(resolve => { markLogin = resolve })
    const seen: WireRequest[] = []
    installNativeWire(wire => {
      seen.push(wire)
      if (wire.url.endsWith(login)) { markLogin(); return new Promise(resolve => { finishLogin = resolve }) }
      return { statusCode: 401, data: { code: 40107, message: '请重新登录', data: null }, cookies: [cookie('failure-injection')] }
    })
    const { useSessionStore } = await import('../src/stores/session')
    const { request } = await import('../src/api/client')
    const session = useSessionStore()
    const pending = session.login(smsInput).catch(error => error)
    await loginStarted
    session.expireSession()
    finishLogin({ statusCode: 200, data: envelope(sessionData('late-access')), cookies: [cookie('late-login')] })
    await expect(pending).resolves.toMatchObject({ code: 40107 })
    await expect(request({ url: refresh, method: 'POST', auth: false })).rejects.toMatchObject({ code: 40107 })
    expect(seen.at(-1)?.header.Cookie).toBeUndefined()
    expect(session.accessToken).toBe('')
    expect(session.user).toBeNull()
    // A new JS process has neither a native cookie nor a stored refresh fallback.
    vi.resetModules(); setActivePinia(createPinia())
    const restarted = (await import('../src/stores/session')).useSessionStore()
    await expect(restarted.bootstrap()).resolves.toBe(false)
    expect(seen.at(-1)?.header.Cookie).toBeUndefined()
    expect(restarted.accessToken).toBe('')
    expect(uni.setStorageSync).not.toHaveBeenCalled()
  })

  it('ignores non-auth cookie injection and removes caller-provided Cookie headers', async () => {
    const seen: WireRequest[] = []
    installNativeWire(wire => {
      seen.push(wire)
      return { statusCode: 200, data: envelope(null), cookies: [cookie('injected')] }
    })
    const { request } = await import('../src/api/client')
    await request({ url: '/me/home', method: 'POST', auth: false, headers: { cOoKiE: 'ruleexam_mobile_refresh=caller-input' } })
    await request({ url: refresh, method: 'POST', auth: false })
    expect(seen[0].header).not.toHaveProperty('cOoKiE')
    expect(seen[1].header.Cookie).toBeUndefined()
  })
  it('does not install authentication cookies from malformed success envelopes', async () => {
    const seen: WireRequest[] = []
    installNativeWire(wire => {
      seen.push(wire)
      return wire.url.endsWith(login)
        ? { statusCode: 200, data: { code: 0, data: null }, cookies: [cookie('malformed-login')] }
        : { statusCode: 200, data: envelope(null) }
    })
    const { request } = await import('../src/api/client')
    await expect(request({ url: login, method: 'POST', auth: false })).rejects.toMatchObject({ code: -2 })
    await request({ url: refresh, method: 'POST', auth: false })
    expect(seen[1].header.Cookie).toBeUndefined()
  })
})
