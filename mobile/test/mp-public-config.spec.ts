// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inspectMpPublicConfig } from '../build/mp-public-config.mjs'

describe('MP public configuration preflight', () => {
  it('requires development mode and explicit opt-in for loopback HTTP', () => {
    const env = { VITE_API_ORIGIN: 'http://127.0.0.1:3000', VITE_MP_LOCAL_HTTP: 'true' }
    expect(inspectMpPublicConfig(env).ready).toBe(false)
    expect(inspectMpPublicConfig(env, { allowLocalHttp: true }).ready).toBe(true)
    expect(inspectMpPublicConfig({ ...env, VITE_MP_LOCAL_HTTP: 'false' }, { allowLocalHttp: true }).ready).toBe(false)
    for (const api of ['http://192.168.1.2:3000', 'http://example.test', 'http://localhost:70000', 'http://localhost:3000/api/v1']) {
      expect(inspectMpPublicConfig({ ...env, VITE_API_ORIGIN: api }, { allowLocalHttp: true }).ready).toBe(false)
    }
  })
  it('reports missing API configuration while permitting a separate static preview compile', () => {
    expect(inspectMpPublicConfig({})).toEqual({ ready: false, errors: ['缺少 VITE_API_ORIGIN：小程序业务请求需要明确的 HTTPS 服务域名。'], requestDomains: [], uploadDomains: [], downloadDomains: [] })
  })

  it('reports exact API and COS HTTPS origins for the developer tool domain allowlists', () => {
    expect(inspectMpPublicConfig({ VITE_API_ORIGIN: 'https://api.example.test', VITE_COS_MEDIA_ORIGIN: 'https://example-1250000000.cos.ap-shanghai.myqcloud.com', VITE_COS_MEDIA_PREFIX: 'ruleexam/demo/media/' }))
      .toEqual({ ready: true, errors: [], requestDomains: ['https://api.example.test'], uploadDomains: ['https://api.example.test'], downloadDomains: ['https://api.example.test', 'https://example-1250000000.cos.ap-shanghai.myqcloud.com'] })
  })

  it.each(['http://api.example.test', 'https://api.example.test/api/v1', 'https://user:pass@api.example.test', 'https://api.example.test?debug=1', 'https://api.example.test#fragment', 'https://api.example.test/'])('rejects an invalid API origin %s', origin => {
    expect(inspectMpPublicConfig({ VITE_API_ORIGIN: origin }).ready).toBe(false)
  })

  it('requires the COS origin and object prefix together and rejects traversal prefixes', () => {
    expect(inspectMpPublicConfig({ VITE_API_ORIGIN: 'https://api.example.test', VITE_COS_MEDIA_ORIGIN: 'https://media.example.test' }).errors).toContain('VITE_COS_MEDIA_ORIGIN 与 VITE_COS_MEDIA_PREFIX 必须同时配置。')
    expect(inspectMpPublicConfig({ VITE_API_ORIGIN: 'https://api.example.test', VITE_COS_MEDIA_ORIGIN: 'https://media.example.test', VITE_COS_MEDIA_PREFIX: 'ruleexam/../media/' }).ready).toBe(false)
  })

  it('rejects an arbitrary media host which the signed COS reader cannot consume', () => {
    expect(inspectMpPublicConfig({ VITE_API_ORIGIN: 'https://api.example.test', VITE_COS_MEDIA_ORIGIN: 'https://media.example.test', VITE_COS_MEDIA_PREFIX: 'ruleexam/demo/media/' }).ready).toBe(false)
  })
})
