import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getSiteConfig } from '../src/api/site-config'
import { useSiteConfig } from '../src/composables/useSiteConfig'
import { useSessionStore } from '../src/stores/session'

const about = {
  institution_name: '配置机构', platform_subtitle: '配置平台简介', version: '2.4.0',
  contact_email: '', wechat_account: '', contact_phone: '+86 (20) 8888-6666', service_terms: null,
}
const config = { logo_asset_id: null, banners: [], about }
type Response = { statusCode: number; data: unknown }
type WireRequest = { url: string; header: Record<string, string>; success(response: Response): void; fail(error: unknown): void }
const ok = (data: unknown): Response => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
function wire(handler: (request: WireRequest) => Response | Promise<Response>) {
  vi.stubGlobal('uni', { request: (request: WireRequest) => { Promise.resolve().then(() => handler(request)).then(request.success, request.fail) }, reLaunch: vi.fn() })
}
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => { setActivePinia(createPinia()); vi.unstubAllGlobals() })

describe('public site configuration', () => {
  it('loads published configuration without sending the current login token', async () => {
    useSessionStore().$patch({ accessToken: 'memory-access' })
    const requests: WireRequest[] = []
    wire(request => { requests.push(request); return ok(config) })
    await expect(getSiteConfig()).resolves.toEqual(config)
    expect(requests.map(request => request.url)).toEqual(['/api/v1/site-config'])
    expect(requests[0].header.Authorization).toBeUndefined()
  })

  it('does not refresh or leave the page when the public endpoint fails', async () => {
    const requests: string[] = []
    wire(request => { requests.push(request.url); return { statusCode: 401, data: { code: 40101, message: '暂不可用', data: null } } })
    await expect(getSiteConfig()).rejects.toMatchObject({ message: '暂不可用' })
    expect(requests).toEqual(['/api/v1/site-config'])
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('clears old content while refreshing and exposes retryable failure', async () => {
    const pending = deferred()
    let calls = 0
    wire(() => ++calls === 1 ? ok(config) : calls === 2 ? pending.promise : ok({ ...config, about: { ...about, version: '2.5.0' } }))
    const state = useSiteConfig()
    await state.load()
    expect(state.config.value?.about.version).toBe('2.4.0')
    const refresh = state.load()
    expect(state.loading.value).toBe(true)
    expect(state.config.value).toBeNull()
    pending.resolve({ statusCode: 503, data: { code: 50301, message: '配置暂不可用', data: null } })
    await refresh
    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBe('配置暂不可用')
    await state.load()
    expect(state.error.value).toBe('')
    expect(state.config.value?.about.version).toBe('2.5.0')
  })

  it.each([false, true])('keeps the newest response when a stale request finishes (failure=%s)', async failure => {
    const first = deferred(), second = deferred()
    let calls = 0
    wire(() => ++calls === 1 ? first.promise : second.promise)
    const state = useSiteConfig()
    const oldLoad = state.load(), newLoad = state.load()
    second.resolve(ok({ ...config, about: { ...about, version: '3.0.0' } }))
    await newLoad
    first.resolve(failure ? { statusCode: 503, data: { code: 50301, message: '旧错误', data: null } } : ok(config))
    await oldLoad
    expect(state.config.value?.about.version).toBe('3.0.0')
    expect(state.error.value).toBe('')
    expect(state.loading.value).toBe(false)
  })

  it('ignores an in-flight result after leaving the page', async () => {
    const pending = deferred()
    wire(() => pending.promise)
    const state = useSiteConfig()
    const load = state.load()
    state.invalidate()
    pending.resolve(ok(config))
    await load
    expect(state.config.value).toBeNull()
    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBe('')
  })
})
