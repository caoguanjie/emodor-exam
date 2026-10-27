export type ApiPlatform = 'h5' | 'mp-weixin'

/** A local address/configuration error, distinct from a failed network request. */
export class ApiUrlError extends Error {
  readonly code = -3
  constructor(message: string) { super(message); this.name = 'ApiUrlError' }
}

export function currentApiPlatform(): ApiPlatform {
  // #ifdef H5
  if (typeof window !== 'undefined') return 'h5'
  // #endif
  return 'mp-weixin'
}

/** Parse an origin without relying on browser URL globals unavailable on MP. */
export function normalizeApiOrigin(origin: string): string {
  const fail = () => { throw new ApiUrlError('微信小程序需要配置合法 HTTPS 接口域名') }
  if (typeof origin !== 'string' || /[\u0000-\u0020\u007f]/.test(origin)) return fail()
  const match = /^https:\/\/([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?\/?$/.exec(origin)
  if (!match) return fail()
  const host = match[1].toLowerCase()
  if (host.length > 253 || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return fail()
  const port = match[2] === undefined ? undefined : Number(match[2])
  if (port !== undefined && (port < 1 || port > 65535)) return fail()
  return `https://${host}${port !== undefined && port !== 443 ? `:${port}` : ''}`
}

/** Only normalized application API paths are accepted, including upload routes. */
export function apiPath(url: string): string {
  const fail = () => { throw new ApiUrlError('接口地址无效') }
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || /[\u0000-\u0020\u007f\\#]/.test(url)) return fail()
  const separator = url.indexOf('?')
  const path = separator === -1 ? url : url.slice(0, separator)
  if (path.includes('//') || (/^\/api(?:\/|$)/.test(path) && path !== '/api/v1' && !path.startsWith('/api/v1/'))) return fail()
  try {
    for (const segment of path.split('/')) {
      const decoded = decodeURIComponent(segment)
      if (decoded === '.' || decoded === '..' || /[\u0000-\u0020\u007f/%\\?#]/.test(decoded)) return fail()
    }
    if (separator !== -1 && /[\u0000-\u001f\u007f]/.test(decodeURIComponent(url.slice(separator + 1)))) return fail()
  } catch { return fail() }
  return path === '/api/v1' || path.startsWith('/api/v1/') ? url : `/api/v1${url}`
}

export function resolveApiUrl(url: string, platform: ApiPlatform = currentApiPlatform(), origin = import.meta.env.VITE_API_ORIGIN || ''): string {
  const path = apiPath(url)
  return platform === 'h5' ? path : `${normalizeApiOrigin(origin)}${path}`
}
