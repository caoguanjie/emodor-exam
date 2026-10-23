import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, request } from '../src/api/client'
import { useSessionStore } from '../src/stores/session'

const user = { id: 7, username: 'learner-7', real_name: '', phone_masked: '138****0000', role: 'employee' as const, source: 'external' as const, category_id: null, identity_status: 'unverified' as const }
type WireRequest = { url: string; method: string; header: Record<string, string>; withCredentials: boolean; data?: unknown; success: (response: { statusCode: number; data: unknown }) => void; fail: (error: unknown) => void }
function installWire(handler: (options: WireRequest) => Promise<{ statusCode: number; data: unknown }> | { statusCode: number; data: unknown }) {
  vi.stubGlobal('uni', { request: (options: WireRequest) => { Promise.resolve().then(() => handler(options)).then(options.success, options.fail); return { abort() {} } }, reLaunch: vi.fn() })
}
function ok(data: unknown) { return { statusCode: 200, data: { code: 0, message: 'ok', data } } }
function unauthorized() { return { statusCode: 401, data: { code: 40101, message: '登录已失效', data: null } } }

beforeEach(() => { setActivePinia(createPinia()); vi.unstubAllGlobals() })

describe('mobile API client', () => {
  it('unwraps the envelope and sends the memory token with mobile cookie credentials', async () => {
    useSessionStore().$patch({ accessToken: 'memory-access' })
    let observed: WireRequest | undefined
    installWire(options => { observed = options; return ok({ title: '课程' }) })
    await expect(request({ url: '/me/courses' })).resolves.toEqual({ title: '课程' })
    expect(observed).toMatchObject({ url: '/api/v1/me/courses', method: 'GET', withCredentials: true, header: { Authorization: 'Bearer memory-access' } })
  })

  it('preserves business code, message and data without refreshing a HTTP 200 error', async () => {
    const paths: string[] = []
    installWire(options => { paths.push(options.url); return { statusCode: 200, data: { code: 42901, message: '请稍后重试', data: { retry_after: 18 } } } })
    await expect(request({ url: '/mobile/auth/sms/send', method: 'POST', auth: false })).rejects.toMatchObject({ code: 42901, message: '请稍后重试', data: { retry_after: 18 }, status: 200 })
    expect(paths).toEqual(['/api/v1/mobile/auth/sms/send'])
  })

  it('coalesces concurrent 401s and replays both requests with the new access token', async () => {
    useSessionStore().$patch({ accessToken: 'old-access' })
    const protectedTokens: string[] = []
    let refreshes = 0
    installWire(async options => {
      if (options.url === '/api/v1/mobile/auth/refresh') {
        refreshes++
        await new Promise(resolve => setTimeout(resolve, 10))
        return ok({ access_token: 'new-access', expires_in: 900, user })
      }
      protectedTokens.push(options.header.Authorization)
      return options.header.Authorization === 'Bearer new-access' ? ok(options.url) : unauthorized()
    })
    await expect(Promise.all([request({ url: '/me/home' }), request({ url: '/me/courses' })])).resolves.toEqual(['/api/v1/me/home', '/api/v1/me/courses'])
    expect(refreshes).toBe(1)
    expect(protectedTokens).toEqual(['Bearer old-access', 'Bearer old-access', 'Bearer new-access', 'Bearer new-access'])
    expect(useSessionStore().user).toEqual(user)
  })

  it('uses an already renewed token when a delayed old-token 401 arrives', async () => {
    useSessionStore().$patch({ accessToken: 'old-access' })
    let refreshes = 0
    installWire(async options => {
      if (options.url.endsWith('/refresh')) { refreshes++; return ok({ access_token: 'new-access', expires_in: 900, user }) }
      if (options.header.Authorization === 'Bearer new-access') return ok('success')
      if (options.url.endsWith('/slow')) await new Promise(resolve => setTimeout(resolve, 25))
      return unauthorized()
    })
    await expect(Promise.all([request({ url: '/fast' }), request({ url: '/slow' })])).resolves.toEqual(['success', 'success'])
    expect(refreshes).toBe(1)
  })

  it.each([7, 8])('never replays an old request after login establishes session for user %s', async nextUserId => {
    const session = useSessionStore()
    session.$patch({ accessToken: 'account-a-access' })
    let finishOldRequest: (response: ReturnType<typeof unauthorized>) => void = () => {}
    let oldRequestStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { oldRequestStarted = resolve })
    const sends: { path: string; token: string | undefined; data: unknown }[] = []
    installWire(options => {
      sends.push({ path: options.url, token: options.header.Authorization, data: options.data })
      if (options.url.endsWith('/sms/login')) return ok({ access_token: 'new-login-access', expires_in: 900, user: { ...user, id: nextUserId } })
      if (options.url.endsWith('/refresh')) return ok({ access_token: 'unexpected-refresh', expires_in: 900, user })
      if (sends.filter(send => send.path.endsWith('/me/submit')).length > 1) return ok('incorrectly replayed')
      oldRequestStarted()
      return new Promise(resolve => { finishOldRequest = resolve })
    })
    const oldResult = request({ url: '/me/submit', method: 'POST', data: { account_a_answer: ['option-1'] } }).catch(error => error)
    await started
    await session.login({ phone: '13800000000', challenge_id: 'new-login-challenge', code: '123456' })
    finishOldRequest(unauthorized())
    await expect(oldResult).resolves.toMatchObject({ code: 40107, message: '登录会话已切换，请重新操作' })
    expect(sends.map(send => send.path)).toEqual(['/api/v1/me/submit', '/api/v1/mobile/auth/sms/login'])
    expect(session.accessToken).toBe('new-login-access')
    expect(session.user?.id).toBe(nextUserId)
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('does not replay when login changes during an in-flight refresh', async () => {
    const session = useSessionStore()
    session.$patch({ accessToken: 'account-a-access' })
    let finishRefresh: (response: ReturnType<typeof ok>) => void = () => {}
    let refreshStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { refreshStarted = resolve })
    const paths: string[] = []
    installWire(options => {
      paths.push(options.url)
      if (options.url.endsWith('/refresh')) { refreshStarted(); return new Promise(resolve => { finishRefresh = resolve }) }
      if (options.url.endsWith('/sms/login')) return ok({ access_token: 'account-b-access', expires_in: 900, user: { ...user, id: 8 } })
      return unauthorized()
    })
    const oldResult = request({ url: '/me/home' }).catch(error => error)
    await started
    const login = session.login({ phone: '13800000000', challenge_id: 'new-login-challenge', code: '123456' })
    finishRefresh(ok({ access_token: 'old-refresh-access', expires_in: 900, user }))
    await login
    await expect(oldResult).resolves.toMatchObject({ code: 40107 })
    expect(paths).toEqual(['/api/v1/me/home', '/api/v1/mobile/auth/refresh', '/api/v1/mobile/auth/sms/login'])
    expect(session.accessToken).toBe('account-b-access')
    expect(session.user?.id).toBe(8)
  })

  it('replays each protected request only once and clears the mobile session on another 401', async () => {
    const session = useSessionStore()
    session.$patch({ accessToken: 'old-access' })
    let protectedCalls = 0
    let refreshes = 0
    installWire(options => {
      if (options.url.endsWith('/refresh')) { refreshes++; return ok({ access_token: 'new-access', expires_in: 900, user }) }
      protectedCalls++
      return unauthorized()
    })
    await expect(request({ url: '/me/home' })).rejects.toBeInstanceOf(ApiError)
    expect([refreshes, protectedCalls]).toEqual([1, 2])
    expect(session.accessToken).toBe('')
    expect(session.user).toBeNull()
  })

  it.each(['/mobile/auth/refresh', '/mobile/auth/sms/login', '/mobile/auth/sms/send'])('never refreshes recursively for %s', async url => {
    const paths: string[] = []
    installWire(options => { paths.push(options.url); return unauthorized() })
    await expect(request({ url, method: 'POST', auth: false })).rejects.toMatchObject({ code: 40101 })
    expect(paths).toEqual([`/api/v1${url}`])
  })

  it('reports a safe network failure and rejects malformed envelopes', async () => {
    installWire(() => Promise.reject({ errMsg: 'request:fail contains private transport text' }))
    await expect(request({ url: '/me/home' })).rejects.toMatchObject({ code: -1, message: '网络连接失败，请检查网络后重试' })
    installWire(() => ({ statusCode: 200, data: { access_token: 'unexpected' } }))
    await expect(request({ url: '/me/home' })).rejects.toMatchObject({ code: -2, message: '服务器响应异常，请稍后重试' })
  })
})
