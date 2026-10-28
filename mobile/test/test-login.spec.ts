import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { loginWithTestPhone } from '../src/api/auth'
import { useSessionStore } from '../src/stores/session'
import { createNativeAuthCookieJar } from '../src/platform/native-auth-cookie'

beforeEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); setActivePinia(createPinia()) })

it('requires an explicit development opt-in and a valid phone before sending', () => {
  vi.stubEnv('VITE_TEST_LOGIN_ENABLED', 'true')
  vi.stubEnv('DEV', false)
  expect(() => loginWithTestPhone('13800000000')).toThrow('测试登录未开启')
  vi.stubEnv('DEV', true)
  vi.stubEnv('VITE_TEST_LOGIN_ENABLED', 'false')
  expect(() => loginWithTestPhone('13800000000')).toThrow('测试登录未开启')
  vi.stubEnv('VITE_TEST_LOGIN_ENABLED', 'true')
  expect(() => loginWithTestPhone('123')).toThrow('请输入正确的11位手机号')
})

it('serializes test login, accepts the mobile session, and blocks duplicate clicks', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_TEST_LOGIN_ENABLED', 'true')
  const result = { access_token: 'test-access', expires_in: 900, user: { id: 17, username: 'learner', real_name: '', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'unverified' } }
  const request = vi.fn((wire: any) => {
    expect(wire.url).toBe('/api/v1/mobile/auth/debug-login')
    expect(wire.data).toEqual({ phone: '13800000000' })
    queueMicrotask(() => wire.success({ statusCode: 200, data: { code: 0, message: 'ok', data: result } }))
  })
  vi.stubGlobal('uni', { request })
  const session = useSessionStore()
  const pending = session.testLogin('138 0000 0000')
  await expect(session.testLogin('13800000000')).rejects.toThrow('正在登录')
  await pending
  expect(request).toHaveBeenCalledTimes(1)
  expect(session.accessToken).toBe('test-access')
  expect(session.user?.identity_status).toBe('unverified')
  expect(session.initialized).toBe(true)
})

it('keeps a test-login cookie scoped to native refresh and logout only in development', () => {
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_TEST_LOGIN_ENABLED', 'true')
  const jar = createNativeAuthCookieJar(), origin = 'https://api.example.test'
  jar.acceptResponse(origin + '/api/v1/mobile/auth/debug-login', origin, { cookies: ['ruleexam_mobile_refresh=debug-token; Path=/api/v1/mobile/auth; HttpOnly; Max-Age=3600'] }, jar.generation())
  expect(jar.headers(origin + '/api/v1/mobile/auth/refresh', origin)).toEqual({ Cookie: 'ruleexam_mobile_refresh=debug-token' })
  expect(jar.headers(origin + '/api/v1/mobile/auth/logout', origin)).toHaveProperty('Cookie')
  expect(jar.headers(origin + '/api/v1/me/home', origin)).toEqual({})
  vi.stubEnv('DEV', false)
  const production = createNativeAuthCookieJar()
  production.acceptResponse(origin + '/api/v1/mobile/auth/debug-login', origin, { cookies: ['ruleexam_mobile_refresh=debug-token; Path=/api/v1/mobile/auth; HttpOnly; Max-Age=3600'] }, production.generation())
  expect(production.headers(origin + '/api/v1/mobile/auth/refresh', origin)).toEqual({})
})
