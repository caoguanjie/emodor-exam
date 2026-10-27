import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../src/stores/session'
import { useLearnerStore } from '../src/stores/learner'
import { getMediaTicket, getMediaTickets, uploadAvatar } from '../src/api/media'
import { uploadIdentityImage } from '../src/api/identity'
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
beforeEach(() => { setActivePinia(createPinia()); useSessionStore().$patch({ accessToken: 'old', initialized: true }) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('private media transport', () => {
  it('does not enter the H5 transfer after the account changes while choosing the direct-upload branch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const limits = { image_max_bytes: 10485760, allowed_image_types: ['image/jpeg'], get upload_mode() {
      useSessionStore().expireSession(); useSessionStore().$patch({ accessToken: 'replacement-account-fixture' }); return 'direct'
    } }
    vi.stubGlobal('uni', { request: (wire: { success(value: unknown): void }) => wire.success(ok(limits)), reLaunch: vi.fn() })
    await expect(uploadAvatar({ tempFilePath: `blob:${window.location.origin}/picked`, size: 20 })).rejects.toMatchObject({ code: 40107 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps MP avatars and identity materials on the controlled upload endpoint', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubEnv('VITE_API_ORIGIN', 'https://training.example.test')
    const fetch = vi.fn(); const uploaded: { url: string; formData: unknown }[] = []
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('uni', { uploadFile: (wire: { url: string; formData: unknown; success(value: unknown): void }) => { uploaded.push(wire); wire.success({ statusCode: 200, data: JSON.stringify({ code: 0, message: 'ok', data: { asset_id: '91', status: 'ready', duration_ms: null } }) }) } })
    await uploadAvatar({ tempFilePath: 'wxfile://picked', size: 20 })
    await uploadIdentityImage('face', { tempFilePath: 'wxfile://face', size: 20 })
    expect(uploaded.map(item => [item.url, item.formData])).toEqual([['https://training.example.test/api/v1/media/upload', { purpose: 'avatar' }], ['https://training.example.test/api/v1/me/identity-verification/images', { image_type: 'face' }]])
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps duplicate assets separate by exact item and retains per-item denial', async () => {
    const items = [{ asset_id: '901', owner_type: 'exam_record_question', owner_id: '101' }, { asset_id: '901', owner_type: 'exam_record_question', owner_id: '102' }]
    let sent: unknown
    vi.stubGlobal('uni', { request: (wire: { data: unknown; success(value: unknown): void }) => { sent = wire.data; wire.success(ok(items.map((item, index) => ({ ...item, index, ticket: index === 0 ? { content_url: '/api/v1/media/tickets/allowed/content', expires_at: '2099-01-01' } : null, error: index === 1 ? { code: 40302, message: 'wrong item' } : null })))) } })
    const result = await getMediaTickets(items)
    expect(sent).toEqual({ items }); expect(result).toHaveLength(2)
    expect(result[0].ticket?.content_url).toContain('allowed'); expect(result[1].ticket).toBeNull(); expect(result[1].error?.code).toBe(40302)
  })
  it('rejects oversized batches before sending and refuses mismatched owner replies', async () => {
    const request = vi.fn(); vi.stubGlobal('uni', { request })
    const item = { asset_id: '901', owner_type: 'exam_record_question', owner_id: '101' }
    await expect(getMediaTickets(Array.from({ length: 51 }, () => item))).rejects.toMatchObject({ code: 40001 }); expect(request).not.toHaveBeenCalled()
    request.mockImplementation((wire: { success(value: unknown): void }) => wire.success(ok([{ ...item, owner_id: '102', index: 0, ticket: { content_url: '/api/v1/media/tickets/foreign/content', expires_at: '2099-01-01' }, error: null }])))
    await expect(getMediaTickets([item])).rejects.toMatchObject({ code: -2 })
  })
  it('refreshes a 401 upload once and does not send a bearer token inside form data', async () => {
    const uploads: { header: unknown; formData: unknown }[] = []
    vi.stubGlobal('uni', { request: (o: { success: (v: unknown) => void }) => o.success(ok({ access_token: 'new', expires_in: 900, user: { id: 1 } })), uploadFile: (o: { header: unknown; formData: unknown; success: (v: unknown) => void }) => { uploads.push(o); o.success({ statusCode: uploads.length === 1 ? 401 : 200, data: JSON.stringify({ code: uploads.length === 1 ? 40101 : 0, message: 'ok', data: { asset_id: 'avatar-1', status: 'ready', duration_ms: null } }) }) }, reLaunch: vi.fn() })
    expect(await uploadAvatar({ tempFilePath: 'blob:test', size: 20 })).toMatchObject({ asset_id: 'avatar-1' })
    expect(uploads.map(o => o.header)).toEqual([{ Authorization: 'Bearer old' }, { Authorization: 'Bearer new' }])
    expect(uploads[1].formData).toEqual({ purpose: 'avatar' })
  })
  it('rejects an offsite media URL and signs the registered owner policy', async () => {
    let sent: unknown
    vi.stubGlobal('uni', { request: (o: { data: unknown; success: (v: unknown) => void }) => { sent = o.data; o.success(ok({ content_url: 'https://foreign.example/photo', expires_at: '2030-01-01' })) } })
    await expect(getMediaTicket('cover-1', 'training_course_cover', 'course-1')).rejects.toMatchObject({ code: -2 })
    expect(sent).toEqual({ owner_type: 'training_course_cover', owner_id: 'course-1' })
  })
  it('saves the uploaded avatar only through the profile whitelist', async () => {
    let sent: unknown
    vi.stubGlobal('uni', { request: (o: { data: unknown; success: (v: unknown) => void }) => { sent = o.data; o.success(ok({ id: '1', avatar_id: 'avatar-1' })) } })
    await useLearnerStore().updateProfile({ avatar_id: 'avatar-1' } as never)
    expect(sent).toEqual({ avatar_id: 'avatar-1' })
  })
})
