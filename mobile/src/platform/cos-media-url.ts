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
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  const rawPath = value.slice(origin.length).split('?')[0];
  const segments = url.pathname.slice(1).split('/');
  if (url.origin !== origin || url.username || url.password || url.hash || url.pathname !== rawPath
    || !url.pathname.startsWith(`/${prefix}`) || url.pathname.length <= prefix.length + 1
    || !/^[A-Za-z0-9_./-]+$/.test(url.pathname)
    || segments.some(segment => !segment || segment === '.' || segment === '..' || segment === 'identity' || segment === 'staging')) return fail();
  const seen = new Set<string>();
  for (const [key, entry] of url.searchParams) {
    if (!queryKeys.has(key) || seen.has(key) || entry.length > 4096 || /[\x00-\x1f\x7f]/.test(entry)
      || /bearer(?:\s|$)/i.test(entry) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(entry)) return fail();
    seen.add(key);
  }
  if (signatureKeys.some(key => !seen.has(key)) || url.searchParams.get('q-sign-algorithm') !== 'sha1'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(url.searchParams.get('q-ak') || '')
    || !/^[a-f0-9]{40}$/i.test(url.searchParams.get('q-signature') || '')) return fail();
  for (const key of ['q-sign-time', 'q-key-time']) {
    const times = /^(\d{1,12});(\d{1,12})$/.exec(url.searchParams.get(key) || '');
    if (!times || Number(times[1]) >= Number(times[2])) return fail();
  }
  const headers = url.searchParams.get('q-header-list') || '';
  if (headers && !/^[a-z0-9-]+(?:;[a-z0-9-]+)*$/.test(headers)) return fail();
  const params = url.searchParams.get('q-url-param-list') || '';
  if (params && (!/^[a-z0-9-]+(?:;[a-z0-9-]+)*$/.test(params) || params.split(';').some(key => !queryListKeys.has(key)))) return fail();
  return value;
}
