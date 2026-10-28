import { currentApiPlatform, normalizeApiOrigin, resolveApiUrl } from './api-url'
import { createNativeAuthCookieJar } from './native-auth-cookie'
import { examEntryIntentFromRoute, saveExamEntryIntent } from '@/utils/exam-entry-intent'

// Never put the native refresh credential in a store or persistent storage.
const nativeAuthCookie = createNativeAuthCookieJar()

export function beginNativeAuthLogin() { if (currentApiPlatform() === 'mp-weixin') nativeAuthCookie.beginLogin() }
export function beginNativeAuthLogout() { if (currentApiPlatform() === 'mp-weixin') nativeAuthCookie.beginLogout() }
export function invalidateNativeAuthSession() { if (currentApiPlatform() === 'mp-weixin') nativeAuthCookie.reset() }

/** Platform transport only; token storage and refresh coordination belong to the session store. */
export interface SessionTransport {
  refresh(): Promise<string>
  logout(): Promise<void>
}

export interface SessionWireRequest {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: unknown
  headers: Record<string, string>
}

/** H5 uses its browser cookie jar; MP uses only the scoped in-memory credential. */
export function sendSessionRequest(config: SessionWireRequest): Promise<{ status: number; data: unknown }> {
  const platform = currentApiPlatform()
  const origin = platform === 'mp-weixin' ? normalizeApiOrigin(import.meta.env.VITE_API_ORIGIN || '') : ''
  const url = resolveApiUrl(config.url, platform, origin)
  const generation = nativeAuthCookie.generation()
  const native = platform === 'mp-weixin'
  const logout = native && config.method === 'POST' && url === `${origin}/api/v1/mobile/auth/logout`
  const headers = native ? Object.fromEntries(Object.entries(config.headers).filter(([name]) => name.toLowerCase() !== 'cookie')) : config.headers
  return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    uni.request({
      url,
      method: config.method,
      data: config.data as UniApp.RequestOptions['data'],
      header: { ...headers, ...(native && config.method === 'POST' ? nativeAuthCookie.headers(url, origin) : {}) },
      ...(native ? {} : { withCredentials: true }),
      timeout: 15000,
      success: response => {
        if (native && config.method === 'POST' && response.statusCode >= 200 && response.statusCode < 300
          && response.data && typeof response.data === 'object' && 'code' in response.data && response.data.code === 0
          && 'message' in response.data && typeof response.data.message === 'string' && 'data' in response.data) {
          nativeAuthCookie.acceptResponse(url, origin, response, generation)
        }
        resolve({ status: response.statusCode, data: response.data })
      },
      fail: reject,
    })
  }).finally(() => { if (logout) nativeAuthCookie.finishLogout(generation) })
}

export function enterMobileLogin(ownerId?: string, preserveExamTarget = true) {
  const current = typeof getCurrentPages === 'function' ? getCurrentPages().at(-1) : undefined
  if (preserveExamTarget) {
    const intent = examEntryIntentFromRoute(current?.route, (current as { options?: Record<string, unknown> } | undefined)?.options)
    if (intent) saveExamEntryIntent(intent, ownerId)
  }
  if (current?.route === 'pages/auth/login') return
  uni.reLaunch({ url: '/pages/auth/login' })
}

/** A scenario URL is an explicit, API-free Pencil preview. */
export function isStaticSessionPreview(query?: Record<string, unknown>): boolean {
  if (query && Object.prototype.hasOwnProperty.call(query, 'scenario')) return true
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const hashQuery = window.location.hash.split('?')[1] || ''
    return new URLSearchParams(hashQuery).has('scenario')
  }
  // #endif
  return false
}
