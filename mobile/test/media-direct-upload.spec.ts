import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../src/stores/session'
import { uploadImageDirect } from '../src/platform/media-upload.h5'

type Wire = { url: string; data?: any; header?: Record<string, string>; success(value: unknown): void; fail(value: unknown): void }
const limits = { upload_mode: 'direct' as const, image_max_bytes: 10485760, allowed_image_types: ['image/jpeg'] }
const view = (state = 'uploading') => ({ session_id: 'image-session', state, mode: 'simple', expires_at: '2099-01-01T00:00:00.000Z', result: state === 'completed' ? { asset_id: '91', status: 'ready', duration_ms: null } : null })
const envelope = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
let calls: Wire[], transfers: ReturnType<typeof vi.fn>, file: { tempFilePath: string; size: number; mimeType: string }
beforeEach(() => {
  setActivePinia(createPinia()); useSessionStore().$patch({ accessToken: 'unusable-mobile-access-fixture', initialized: true })
  calls = []
  const blob = new Blob(['avatar bytes'], { type: 'image/jpeg' })
  file = { tempFilePath: `blob:${window.location.origin}/picked-avatar`, size: blob.size, mimeType: blob.type }
  transfers = vi.fn(async (url: string, options?: RequestInit) => url.startsWith('blob:') ? { ok: true, blob: async () => blob } : { ok: true, status: 200 })
  vi.stubGlobal('fetch', transfers)
  vi.stubGlobal('uni', { request: (wire: Wire) => {
    calls.push(wire)
    if (wire.url.endsWith('/credentials')) wire.success(envelope({ mode: 'simple', method: 'PUT', url: 'https://storage.example.test/temporary-signed-put', headers: { 'Content-Type': 'image/jpeg' }, expires_at: '2099-01-01T00:00:00.000Z' }))
    else if (wire.url.endsWith('/complete')) wire.success(envelope(view('completed')))
    else wire.success(envelope(view()))
  }, reLaunch: vi.fn() })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('H5 avatar direct transfer', () => {
  it('uploads the selected Blob with no business bearer or cookie sent to storage', async () => {
    expect(await uploadImageDirect(file, 'avatar', limits)).toEqual({ asset_id: '91', status: 'ready', duration_ms: null })
    const init = calls.find(call => call.url.endsWith('/upload-sessions'))!
    expect(init.data).toMatchObject({ purpose: 'avatar', size_bytes: file.size, mime_type: 'image/jpeg' })
    expect(init.data.fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/)
    const put = transfers.mock.calls.find(call => call[0].startsWith('https://storage.'))!
    expect(put[1]).toMatchObject({ method: 'PUT', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'image/jpeg' } })
    expect(put[1]?.body).toBeInstanceOf(Blob)
    expect(JSON.stringify(put[1])).not.toContain('unusable-mobile-access-fixture')
  })
  it('rejects a remote file URL before issuing any upload or reading unrelated bytes', async () => {
    await expect(uploadImageDirect({ ...file, tempFilePath: 'https://foreign.example/photo' }, 'avatar', limits)).rejects.toThrow()
    expect(transfers).not.toHaveBeenCalled(); expect(calls).toEqual([])
  })
  it('renews a rejected storage grant once without refreshing the business bearer or reopening the upload session', async () => {
    let putCount = 0
    transfers.mockImplementation(async (url: string) => url.startsWith('blob:') ? { ok: true, blob: async () => new Blob(['avatar bytes'], { type: 'image/jpeg' }) }
      : ++putCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 })
    expect((await uploadImageDirect(file, 'avatar', limits)).asset_id).toBe('91')
    expect(putCount).toBe(2); expect(calls.filter(call => call.url.endsWith('/credentials'))).toHaveLength(2)
    expect(calls.filter(call => call.url.endsWith('/upload-sessions'))).toHaveLength(1)
    expect(calls.some(call => call.url.includes('/auth/refresh'))).toBe(false)
    expect(calls[0].data).not.toHaveProperty('mode')
  })
  it('reconciles a missing complete reply through the same session status', async () => {
    const previous = (uni.request as any)
    ;(uni as any).request = (wire: Wire) => {
      if (wire.url.endsWith('/complete')) { calls.push(wire); wire.fail({}) }
      else if (wire.url.endsWith('/image-session')) { calls.push(wire); wire.success(envelope(view('completed'))) }
      else previous(wire)
    }
    expect((await uploadImageDirect(file, 'avatar', limits)).asset_id).toBe('91')
    expect(calls.filter(call => call.url.endsWith('/upload-sessions'))).toHaveLength(1)
    expect(calls.filter(call => call.url.endsWith('/complete'))).toHaveLength(1)
  })
  it('discards an upload after its session epoch changes and never binds a late result', async () => {
    let finish!: (value: unknown) => void
    const previous = uni.request as any
    ;(uni as any).request = (wire: Wire) => {
      if (wire.url.endsWith('/upload-sessions')) { calls.push(wire); finish = wire.success }
      else previous(wire)
    }
    const pending = uploadImageDirect(file, 'avatar', limits)
    const failure = pending.catch(error => error)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    useSessionStore().expireSession(); finish(envelope(view()))
    expect((await failure).code).toBe(40107)
    expect(transfers.mock.calls.some(call => call[0].startsWith('https://storage.'))).toBe(false)
  })
})
