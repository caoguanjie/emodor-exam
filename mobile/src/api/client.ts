import type { ApiEnvelope, ApiRequestConfig } from '@/types/api'
import { sendSessionRequest } from '@/platform/session'
import { useSessionStore } from '@/stores/session'

export class ApiError extends Error {
  constructor(public code: number, message: string, public data: unknown = null, public status = 0) { super(message); this.name = 'ApiError' }
}

function apiUrl(url: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) throw new ApiError(40001, '接口地址无效')
  return url.startsWith('/api/v1/') ? url : `/api/v1${url}`
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return !!value && typeof value === 'object' && typeof (value as ApiEnvelope<unknown>).code === 'number' && typeof (value as ApiEnvelope<unknown>).message === 'string' && 'data' in value
}

export async function request<T>(config: ApiRequestConfig): Promise<T> {
  const url = apiUrl(config.url)
  const publicAuth = /^\/api\/v1\/mobile\/auth\/(?:refresh|sms\/send|sms\/login|debug-login)(?:\?|$)/.test(url)
  const authenticated = config.auth !== false && !publicAuth
  const session = authenticated ? useSessionStore() : null
  const requestEpoch = session?.sessionEpoch

  function assertSameSession() {
    if (session && (session.sessionEpoch !== requestEpoch || session.isLoggingIn)) throw new ApiError(40107, '登录会话已切换，请重新操作')
  }

  async function perform(replayed: boolean): Promise<T> {
    assertSameSession()
    const sentToken = session?.accessToken || ''
    let response: { status: number; data: unknown }
    try {
      response = await sendSessionRequest({
        url,
        method: config.method || 'GET',
        data: config.data,
        headers: { 'Content-Type': 'application/json', ...config.headers, ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}) },
      })
    } catch {
      throw new ApiError(-1, '网络连接失败，请检查网络后重试')
    }

    assertSameSession()

    if (response.status === 401 && session) {
      if (!replayed && config.refreshOnUnauthorized !== false) {
        // A slower 401 may arrive after another request has already renewed the token.
        if (!session.accessToken || session.accessToken === sentToken) await session.refreshAccessTokenOnce()
        assertSameSession()
        return perform(true)
      }
      session.expireSession()
    }

    if (!isEnvelope(response.data)) throw new ApiError(-2, '服务器响应异常，请稍后重试', null, response.status)
    const envelope = response.data
    if (envelope.code !== 0 || response.status < 200 || response.status >= 300) {
      throw new ApiError(envelope.code || response.status, envelope.message, envelope.data, response.status)
    }
    return envelope.data as T
  }

  return perform(false)
}
