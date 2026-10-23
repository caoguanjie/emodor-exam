import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../src/stores/session'
const view = { status: 'unverified', real_name: null, id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null }
const pending = { session_id: 'session-1', status: 'pending', reason_code: null, clear_materials: [], expires_at: '2030-01-01T00:00:00Z' }
type Wire = { url: string; method: string; data: unknown; header: Record<string, string>; success: (value: unknown) => void; fail: (error: unknown) => void }
function ok(data: unknown) { return { statusCode: 200, data: { code: 0, message: 'ok', data } } }
function install(handler: (options: Wire) => unknown) {
  vi.stubGlobal('uni', { request: (o: Wire) => { Promise.resolve(handler(o)).then(o.success, o.fail) }, uploadFile: (o: Wire) => { Promise.resolve(handler(o)).then(r => o.success({ ...(r as object), data: JSON.stringify((r as ReturnType<typeof ok>).data) }), o.fail) }, reLaunch: vi.fn() })
}
beforeEach(() => { setActivePinia(createPinia()); useSessionStore().$patch({ accessToken: 'memory', initialized: true }); install(() => ok(view)) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('identity authoritative state and material isolation', () => {
  it('does not assume unverified when the authority read fails', async () => {
    install(() => Promise.reject(new Error('offline')))
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); await store.load()
    expect(store.authority).toBeNull(); expect(store.loadError).toContain('网络')
    expect(store.canSubmit).toBe(false)
  })
  it('does not retain a verified UI after a later authority read fails', async () => {
    let fail = false
    install(() => fail ? Promise.reject(new Error('offline')) : ok({ ...view, status: 'verified' }))
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); await store.load(); expect(store.verified).toBe(true)
    fail = true; await store.load(); expect(store.verified).toBe(false); expect(store.loadError).not.toBe('')
  })
  it('requires three safe uploads, two processed previews and consent before creating a session', async () => {
    let creates = 0
    install(o => { if (o.url.endsWith('/sessions')) { creates++; return ok(pending) }; return ok(view) })
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); await store.load(); await store.createSession()
    expect(creates).toBe(0)
    store.materials.portrait = { asset_id: 'p', state: 'ready', preview: '/p' }
    store.materials.emblem = { asset_id: 'e', state: 'ready', preview: '' }
    store.materials.face = { asset_id: 'f', state: 'ready', preview: 'blob:f' }
    store.consent = true; expect(store.canSubmit).toBe(false)
    store.materials.emblem.preview = '/e'; expect(store.canSubmit).toBe(true)
  })
  it('polls immediately then every 800 ms at most twelve times and remains pending', async () => {
    vi.useFakeTimers(); let reads = 0
    install(o => { if (o.url.includes('/sessions/')) { reads++; return ok(pending) }; return ok(view) })
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); store.currentSession = pending as never
    const work = store.poll(); await vi.advanceTimersByTimeAsync(0); expect(reads).toBe(1)
    await vi.advanceTimersByTimeAsync(8799); expect(reads).toBe(11)
    await vi.advanceTimersByTimeAsync(1); await work
    expect(reads).toBe(12); expect(store.currentSession).toMatchObject({ status: 'pending' }); expect(store.polling).toBe(false)
  })
  it('does not show success until a verified session is confirmed by a fresh authoritative view', async () => {
    install(o => ok(o.url.includes('/sessions/') ? { ...pending, status: 'verified' } : view))
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); store.currentSession = pending as never; await store.poll()
    expect(store.authority?.status).toBe('unverified'); expect(store.verified).toBe(false)
  })
  it('clears only server selected materials on rejection', async () => {
    install(() => ok({ ...pending, status: 'rejected', reason_code: 'FACE_MISMATCH', clear_materials: ['face'] }))
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); store.currentSession = pending as never
    for (const kind of ['portrait', 'emblem', 'face'] as const) store.materials[kind] = { asset_id: kind, state: 'ready', preview: '/image' }
    await store.poll()
    expect(store.materials.face).toBeNull(); expect(store.materials.portrait?.asset_id).toBe('portrait'); expect(store.materials.emblem?.asset_id).toBe('emblem')
  })
  it('drops delayed reads after leaving the page or changing account', async () => {
    let done: (value: unknown) => void = () => {}
    install(() => new Promise(resolve => { done = resolve }))
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); const work = store.load(); await Promise.resolve(); store.leave()
    done(ok({ ...view, status: 'verified' })); await work; expect(store.authority).toBeNull()
    store.consent = true; useSessionStore().expireSession(); expect(store.consent).toBe(false)
  })
  it('releases unsubmitted server materials when leaving and preserves submitted sessions', async () => {
    const deleted: string[] = []
    install(o => { if (o.method === 'DELETE') deleted.push(o.url); return ok(null) })
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); store.materials.face = { asset_id: 'unused-face', state: 'ready', preview: 'blob:face' }
    store.leave(); await Promise.resolve(); expect(deleted).toContain('/api/v1/me/identity-verification/images/unused-face')
    store.materials.face = { asset_id: 'submitted-face', state: 'ready', preview: 'blob:face' }; store.currentSession = pending as never
    store.leave(); await Promise.resolve(); expect(deleted).not.toContain('/api/v1/me/identity-verification/images/submitted-face')
  })
  it('handles already-verified session conflict by reading the authority', async () => {
    install(o => o.method === 'POST' ? { statusCode: 409, data: { code: 40960, message: 'already', data: { status: 'verified' } } } : ok({ ...view, status: 'verified', real_name: '权威姓名' }))
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); store.authority = view as never; store.consent = true
    for (const kind of ['portrait', 'emblem', 'face'] as const) store.materials[kind] = { asset_id: kind, state: 'ready', preview: '/preview' }
    await store.createSession(); expect(store.verified).toBe(true)
  })
  it('clears slots from structured errors, never from display message text', async () => {
    let structured = true
    install(() => ({ statusCode: 400, data: { code: 40001, message: 'FACE_MISMATCH ignored text', data: structured ? { reason_code: 'ID_CARD_DOCUMENT_INVALID', clear_materials: ['id_card_portrait', 'id_card_emblem'] } : null } }))
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); store.authority = view as never; store.consent = true
    for (const kind of ['portrait', 'emblem', 'face'] as const) store.materials[kind] = { asset_id: kind, state: 'ready', preview: '/preview' }
    await store.createSession(); expect(store.materials.portrait).toBeNull(); expect(store.materials.emblem).toBeNull(); expect(store.materials.face?.asset_id).toBe('face')
    structured = false
    store.materials.portrait = { asset_id: 'p', state: 'ready', preview: '/p' }; store.materials.emblem = { asset_id: 'e', state: 'ready', preview: '/e' }
    await store.createSession(); expect(store.materials.face?.asset_id).toBe('face'); expect(store.materials.portrait?.asset_id).toBe('p')
  })
  it('drops an old-account upload and releases its local preview after logout', async () => {
    const revoked: string[] = []; const uploaded: string[] = []
    let complete: (v: unknown) => void = () => {}
    const { useIdentityStore } = await import('../src/stores/identity')
    vi.stubGlobal('URL', { revokeObjectURL: (url: string) => revoked.push(url) })
    vi.stubGlobal('uni', { chooseImage: (o: { success: (v: unknown) => void }) => o.success({ tempFiles: [{ path: 'blob:old-account', size: 100 }] }), uploadFile: (o: { success: (v: unknown) => void }) => { complete = o.success; uploaded.push('started') }, request: (o: Wire) => o.success(ok(null)), reLaunch: vi.fn() })
    const store = useIdentityStore(); const work = store.upload('face', 'camera'); await vi.waitFor(() => expect(uploaded).toEqual(['started']))
    useSessionStore().expireSession()
    complete({ statusCode: 200, data: JSON.stringify({ code: 0, message: 'ok', data: { asset_id: 'old-asset', image_type: 'face', scan_status: 'safe', processed_preview: null } }) })
    await work; expect(store.materials.face).toBeNull(); expect(revoked).toEqual(['blob:old-account'])
  })
  it('keeps native capture alive through a hide event but releases on actual page leave', async () => {
    let choose: (value: unknown) => void = () => {}
    install(o => ok({ asset_id: 'native-face', image_type: 'face', scan_status: 'safe', processed_preview: null }))
    const currentUni = uni
    vi.stubGlobal('uni', { ...currentUni, chooseImage: (o: { success: (v: unknown) => void }) => { choose = o.success } })
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); const work = store.upload('face', 'camera'); store.hide()
    expect(store.picking).toBe(true)
    choose({ tempFiles: [{ path: 'blob:native', size: 100, type: 'image/jpeg' }] }); await work
    expect(store.materials.face?.asset_id).toBe('native-face')
    store.leave(); expect(store.materials.face).toBeNull()
  })
  it('releases an asset when upload response validation fails after the server stored it', async () => {
    const deleted: string[] = []
    install(o => { if (o.method === 'DELETE') { deleted.push(o.url); return ok(null) }; return ok({ asset_id: 'invalid-response-asset', image_type: 'face', scan_status: 'unsafe', processed_preview: null }) })
    const currentUni = uni
    vi.stubGlobal('uni', { ...currentUni, chooseImage: (o: { success: (v: unknown) => void }) => o.success({ tempFiles: [{ path: 'blob:invalid', size: 100, type: 'image/jpeg' }] }) })
    const { useIdentityStore } = await import('../src/stores/identity')
    const store = useIdentityStore(); await store.upload('face', 'camera'); await Promise.resolve()
    expect(store.materials.face).toBeNull(); expect(deleted).toContain('/api/v1/me/identity-verification/images/invalid-response-asset')
  })
})
