import { normalizeApiOrigin } from './api-url'
import { isTestLoginEnabled } from './development'

const cookieName = 'ruleexam_mobile_refresh'
const cookiePath = '/api/v1/mobile/auth'
const loginPath = `${cookiePath}/sms/login`
const refreshPath = `${cookiePath}/refresh`
const logoutPath = `${cookiePath}/logout`

interface NativeCookieResponse { cookies?: unknown; header?: Record<string, unknown> }
interface AuthCookie { value: string; origin: string; expiresAt: number | null }
interface ParsedCookie { value: string; expiresAt: number | null }

function endpoint(url: string, origin: string): string | null {
  try {
    const trusted = normalizeApiOrigin(origin)
    if (!url.startsWith(`${trusted}/`)) return null
    const path = url.slice(trusted.length)
    return [loginPath, refreshPath, logoutPath, ...(isTestLoginEnabled() ? [`${cookiePath}/debug-login`] : [])].includes(path) ? path : null
  } catch { return null }
}

function parseCookie(source: string, now: number): ParsedCookie | null {
  if (source.length > 8192 || /[\u0000-\u001f\u007f]/.test(source)) return null
  const [pair, ...attributes] = source.split(';')
  const match = /^ruleexam_mobile_refresh=([A-Za-z0-9._~-]{0,4096})$/.exec(pair.trim())
  if (!match) return null
  const parsed = new Map<string, string>()
  for (const attribute of attributes) {
    const separator = attribute.indexOf('=')
    const name = (separator === -1 ? attribute : attribute.slice(0, separator)).trim().toLowerCase()
    const value = separator === -1 ? '' : attribute.slice(separator + 1).trim()
    if (!name || parsed.has(name)) return null
    parsed.set(name, value)
  }
  if (parsed.get('path') !== cookiePath || !parsed.has('httponly') || parsed.get('httponly') !== '' || parsed.has('domain')) return null
  let expiresAt: number | null = null
  if (parsed.has('max-age')) {
    const age = parsed.get('max-age')!
    if (!/^-?\d{1,10}$/.test(age)) return null
    expiresAt = Number(age) <= 0 ? 0 : now + Number(age) * 1000
  } else if (parsed.has('expires')) {
    expiresAt = Date.parse(parsed.get('expires')!)
    if (!Number.isFinite(expiresAt)) return null
  }
  if (!match[1] && (expiresAt === null || expiresAt > now)) return null
  return { value: match[1], expiresAt }
}

function responseCookies(response: NativeCookieResponse): string[] {
  const values: string[] = []
  if (Array.isArray(response.cookies)) for (const value of response.cookies) if (typeof value === 'string') values.push(value)
  for (const [name, value] of Object.entries(response.header || {})) {
    if (name.toLowerCase() !== 'set-cookie') continue
    if (typeof value === 'string') values.push(value)
    else if (Array.isArray(value)) for (const row of value) if (typeof row === 'string') values.push(row)
  }
  // An Expires date contains a comma; only split before a new cookie name=value.
  return [...new Set(values.flatMap(value => value.split(/,(?=\s*[^;,\s]+=)/)))]
}

/**
 * MP has no browser HttpOnly cookie jar. This credential stays in this closure
 * for this process only; it does not offer browser HttpOnly isolation from JS.
 */
export function createNativeAuthCookieJar() {
  let generation = 0
  let active: AuthCookie | null = null
  let logoutOnly: (AuthCookie & { generation: number }) | null = null

  function usable(cookie: AuthCookie | null, origin: string): cookie is AuthCookie {
    return !!cookie && cookie.origin === origin && (cookie.expiresAt === null || cookie.expiresAt > Date.now())
  }

  return {
    generation: () => generation,
    reset() { generation++; active = null; logoutOnly = null },
    // Preserve only a queued logout's revocation credential when switching login.
    beginLogin() { generation++; active = null },
    beginLogout() { generation++; if (active) logoutOnly = { ...active, generation }; active = null },
    finishLogout(expectedGeneration: number) {
      if (logoutOnly && logoutOnly.generation <= expectedGeneration) logoutOnly = null
      if (generation === expectedGeneration) { generation++; active = null }
    },
    headers(url: string, origin: string): Record<string, string> {
      const path = endpoint(url, origin)
      if (path !== refreshPath && path !== logoutPath) return {}
      const trusted = normalizeApiOrigin(origin)
      const candidate = path === logoutPath ? logoutOnly || active : active
      return usable(candidate, trusted) ? { Cookie: `${cookieName}=${candidate.value}` } : {}
    },
    acceptResponse(url: string, origin: string, response: NativeCookieResponse, expectedGeneration: number) {
      if (generation !== expectedGeneration) return
      const path = endpoint(url, origin)
      if (path !== loginPath && path !== refreshPath && !(isTestLoginEnabled() && path === `${cookiePath}/debug-login`)) return
      const now = Date.now()
      const candidates = responseCookies(response).map(value => parseCookie(value, now)).filter((value): value is ParsedCookie => value !== null)
      if (!candidates.length || candidates.some(value => value.value !== candidates[0].value || value.expiresAt !== candidates[0].expiresAt)) return
      const candidate = candidates[0]
      active = candidate.expiresAt !== null && candidate.expiresAt <= Date.now() ? null : { ...candidate, origin: normalizeApiOrigin(origin) }
    },
  }
}
