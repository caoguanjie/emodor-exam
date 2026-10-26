/** Leaf module: URL validation must not import API clients, stores or UI components. */
import { assertCosMediaUrl } from './cos-media-url'
type MediaPlatform = 'h5' | 'mp-weixin'
class MediaUrlError extends Error {
  readonly code = -2
  constructor(message: string) { super(message); this.name = 'MediaUrlError' }
}

export function safeMediaUrl(url: string): string {
  const match = typeof url === 'string' ? /^\/api\/v1\/media\/tickets\/([A-Za-z0-9._~-]+)\/content$/.exec(url) : null
  // An unreserved single segment is normalization-stable except for these two dot segments.
  // Percent escapes, backslashes, separators and controls are excluded by the whitelist.
  if (match && match[1] !== '.' && match[1] !== '..') return url
  return assertCosMediaUrl(url, import.meta.env.VITE_COS_MEDIA_ORIGIN || '', import.meta.env.VITE_COS_MEDIA_PREFIX || '')
}

function absoluteUrl(path: string, platform: MediaPlatform, origin = ''): string {
  if (platform === 'h5') {
    const pageOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    if (!/^https?:\/\/[^/?#@\s\\]+$/.test(pageOrigin)) throw new MediaUrlError('当前网页域名不可用')
    return `${pageOrigin}${path}`
  }
  if (!/^https:\/\/(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(?::\d{1,5})?\/?$/.test(origin)) throw new MediaUrlError('微信媒体需要配置合法 HTTPS 域名')
  return `${origin.replace(/\/$/, '')}${path}`
}

export function mediaContentUrl(url: string, platform: MediaPlatform, origin = ''): string {
  const safe = safeMediaUrl(url)
  return safe.startsWith('https://') ? safe : absoluteUrl(safe, platform, origin)
}

function platformUrl(path: string): string {
  // #ifdef H5
  if (typeof window !== 'undefined') return absoluteUrl(path, 'h5')
  // #endif
  return absoluteUrl(path, 'mp-weixin', import.meta.env.VITE_API_ORIGIN || '')
}

/** Absolute H5 URLs prevent uni-h5 from prefixing /mobile/ to protected API paths. */
export function resolveMediaUrl(url: string): string {
  const safe = safeMediaUrl(url)
  return safe.startsWith('https://') ? safe : platformUrl(safe)
}

/** Public branding has a separate fixed route; it never accepts arbitrary media URLs. */
export function resolvePublicBrandingUrl(assetId: string): string {
  if (typeof assetId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(assetId)) throw new MediaUrlError('公开品牌资源地址无效')
  return platformUrl(`/api/v1/site-config/assets/${assetId}/content`)
}
