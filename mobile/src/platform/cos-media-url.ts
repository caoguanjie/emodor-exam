class CosMediaUrlError extends Error { readonly code = -2; }

const signatureKeys = ['q-sign-algorithm', 'q-ak', 'q-sign-time', 'q-key-time', 'q-header-list', 'q-url-param-list', 'q-signature'];
const queryKeys = new Set([...signatureKeys, 'x-cos-security-token', 'versionId', 'response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding']);
const queryListKeys = new Set([...queryKeys].map(key => key.toLowerCase()));

/** 只消费后端签发的正式媒体地址，不按客户端输入拼接对象键。 */
export function assertCosMediaUrl(value: string, configuredOrigin: string, configuredPrefix: string): string {
  const fail = () => { throw new CosMediaUrlError('媒体地址无效'); };
  const origin = String(configuredOrigin || '').trim(), prefix = String(configuredPrefix || '').trim();
  if (!/^https:\/\/[a-z0-9][a-z0-9-]*-\d+\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(origin)
    || !/^ruleexam\/[A-Za-z0-9_-]+\/media\/$/.test(prefix)
    || typeof value !== 'string' || value.length > 8192 || /[\s\x00-\x1f\x7f\\]/.test(value) || !value.startsWith(`${origin}/`)) return fail();
  // This grammar intentionally covers only our signed media URLs. Mini-program
  // runtimes do not guarantee the browser URL / URLSearchParams globals.
  const suffix = value.slice(origin.length), queryStart = suffix.indexOf('?');
  if (queryStart < 0 || suffix.includes('#')) return fail();
  const pathname = suffix.slice(0, queryStart), query = suffix.slice(queryStart + 1);
  const segments = pathname.slice(1).split('/');
  if (!pathname.startsWith(`/${prefix}`) || pathname.length <= prefix.length + 1
    || !/^[A-Za-z0-9_./-]+$/.test(pathname)
    || segments.some(segment => !segment || segment === '.' || segment === '..' || segment === 'identity' || segment === 'staging')) return fail();
  const seen = new Set<string>();
  const paramsByKey = new Map<string, string>();
  for (const pair of query.split('&')) {
    // URLSearchParams ignores empty separators; keep that behavior while
    // rejecting malformed percent sequences instead of silently replacing them.
    if (!pair) continue;
    const equals = pair.indexOf('=');
    let key: string, entry: string;
    try {
      key = decodeURIComponent((equals < 0 ? pair : pair.slice(0, equals)).replace(/\+/g, ' '));
      entry = decodeURIComponent((equals < 0 ? '' : pair.slice(equals + 1)).replace(/\+/g, ' '));
    } catch { return fail(); }
    if (!queryKeys.has(key) || seen.has(key) || entry.length > 4096 || /[\x00-\x1f\x7f]/.test(entry)
      || /bearer(?:\s|$)/i.test(entry) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(entry)) return fail();
    seen.add(key);
    paramsByKey.set(key, entry);
  }
  if (signatureKeys.some(key => !seen.has(key)) || paramsByKey.get('q-sign-algorithm') !== 'sha1'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(paramsByKey.get('q-ak') || '')
    || !/^[a-f0-9]{40}$/i.test(paramsByKey.get('q-signature') || '')) return fail();
  for (const key of ['q-sign-time', 'q-key-time']) {
    const times = /^(\d{1,12});(\d{1,12})$/.exec(paramsByKey.get(key) || '');
    if (!times || Number(times[1]) >= Number(times[2])) return fail();
  }
  const headers = paramsByKey.get('q-header-list') || '';
  if (headers && !/^[a-z0-9-]+(?:;[a-z0-9-]+)*$/.test(headers)) return fail();
  const params = paramsByKey.get('q-url-param-list') || '';
  if (params && (!/^[a-z0-9-]+(?:;[a-z0-9-]+)*$/.test(params) || params.split(';').some(key => !queryListKeys.has(key)))) return fail();
  return value;
}
