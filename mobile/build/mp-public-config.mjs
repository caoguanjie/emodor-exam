/** This module consumes public VITE_* values only; it never reads environment files. */
function validOrigin(value) {
  if (typeof value !== 'string' || !/^https:\/\/[^\s/\\?#@]+$/.test(value)) return false
  try { return new URL(value).origin === value } catch { return false }
}
function validPrefix(value) {
  return typeof value === 'string' && /^ruleexam\/[A-Za-z0-9_-]+\/media\/$/.test(value)
}
function validCosOrigin(value) {
  return typeof value === 'string' && /^https:\/\/[a-z0-9][a-z0-9-]*-\d+\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(value)
}
export function inspectMpPublicConfig(env) {
  const errors = [], requestDomains = [], uploadDomains = [], downloadDomains = []
  const api = env.VITE_API_ORIGIN, cos = env.VITE_COS_MEDIA_ORIGIN, prefix = env.VITE_COS_MEDIA_PREFIX
  if (!api) errors.push('缺少 VITE_API_ORIGIN：小程序业务请求需要明确的 HTTPS 服务域名。')
  else if (!validOrigin(api)) errors.push('VITE_API_ORIGIN 必须是无路径、凭据、查询参数或结尾斜杠的 HTTPS origin。')
  else { requestDomains.push(api); uploadDomains.push(api); downloadDomains.push(api) }
  if (!!cos !== !!prefix) errors.push('VITE_COS_MEDIA_ORIGIN 与 VITE_COS_MEDIA_PREFIX 必须同时配置。')
  if (cos && !validCosOrigin(cos)) errors.push('VITE_COS_MEDIA_ORIGIN 必须是已批准 COS 桶的 HTTPS origin，不能包含路径或结尾斜杠。')
  if (prefix && !validPrefix(prefix)) errors.push('VITE_COS_MEDIA_PREFIX 必须是 ruleexam/<scope>/media/ 对象目录，不得包含空段、转义或路径穿越。')
  if (cos && validCosOrigin(cos) && prefix && validPrefix(prefix) && !downloadDomains.includes(cos)) downloadDomains.push(cos)
  return { ready: errors.length === 0, errors, requestDomains, uploadDomains, downloadDomains }
}
