import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../src/stores/session'
import { useLearnerStore } from '../src/stores/learner'
import { getMediaTicket, uploadAvatar } from '../src/api/media'
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
beforeEach(() => { setActivePinia(createPinia()); useSessionStore().$patch({ accessToken: 'old', initialized: true }) })
describe('private media transport', () => {
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
