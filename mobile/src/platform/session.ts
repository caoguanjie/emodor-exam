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

/** H5 uses the browser's HttpOnly mobile Cookie; no token is read from storage. */
export function sendSessionRequest(config: SessionWireRequest): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: config.url,
      method: config.method,
      data: config.data as UniApp.RequestOptions['data'],
      header: config.headers,
      withCredentials: true,
      timeout: 15000,
      success: response => resolve({ status: response.statusCode, data: response.data }),
      fail: reject,
    })
  })
}

export function enterMobileLogin() {
  if (typeof getCurrentPages === 'function' && getCurrentPages().at(-1)?.route === 'pages/auth/login') return
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
