import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLearnerStore } from '../src/stores/learner'
import { useSessionStore } from '../src/stores/session'

const user = { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee' as const, source: 'external' as const, category_id: null, identity_status: 'unverified' as const }
const profile = { id: '17', username: 'learner', real_name: '学员', phone: null, email: null, avatar_id: null, occupation: '旧职业文本', gender: null, birthday: null, source: 'external' as const, category_id: null, category_name: null, role: 'employee' as const, status: 1 }
const chosen = { ...profile, category_id: '9007199254740993', category_name: '高处作业' }
type Wire = { url: string; method: string; data?: unknown; success: (value: unknown) => void; fail: (error: unknown) => void }
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
function install(handler: (request: Wire) => unknown) {
  vi.stubGlobal('uni', { request: (request: Wire) => { Promise.resolve().then(() => handler(request)).then(request.success, request.fail) }, reLaunch: vi.fn() })
}
async function ready() {
  const store = useLearnerStore()
  await store.loadProfile()
  await store.loadTrainingCategories()
  return store
}
const categories = { items: [{ id: '9007199254740993', name: '高处作业' }, { id: '42', name: '焊接作业' }], total: 2, page: 1, page_size: 100 }
beforeEach(() => {
  setActivePinia(createPinia()); vi.unstubAllGlobals()
  useLearnerStore().user = { ...user }
  useSessionStore().$patch({ accessToken: 'unit-memory-access', initialized: true })
})

describe('first training category confirmation', () => {
  it('saves a learner name without selecting a category or elevating controlled fields', async () => {
    const writes: unknown[] = []
    install(request => { if (request.method === 'POST') writes.push(request.data); return ok(profile) })
    const store = useLearnerStore()
    await store.loadProfile()
    await store.updateProfile({ real_name: '学员' })
    expect(writes).toEqual([{ real_name: '学员' }])
    expect(store.profile?.category_id).toBeNull()
    expect(store.profile?.role).toBe('employee')
  })
  it('keeps an ID selection and cancellation as drafts without a write, then confirms only once', async () => {
    const writes: unknown[] = []
    let finish: (value: unknown) => void = () => {}
    install(request => {
      if (request.method === 'PUT') { writes.push(request.data); return new Promise(resolve => { finish = resolve }) }
      return ok(request.url.includes('training-categories') ? categories : profile)
    })
    const store = await ready()
    store.chooseTrainingCategory('9007199254740993')
    expect(store.profile?.category_id).toBeNull()
    expect(store.categoryDraftId).toBe('9007199254740993')
    store.requestCategoryConfirmation(); store.cancelCategoryConfirmation()
    expect(writes).toEqual([])
    store.requestCategoryConfirmation()
    // ConfirmSheet closes its v-model before emitting confirm.
    store.categoryConfirmVisible = false
    const first = store.confirmTrainingCategory()
    await store.confirmTrainingCategory()
    await vi.waitFor(() => expect(writes).toEqual([{ category_id: '9007199254740993' }]))
    finish(ok(chosen)); await first
    expect(store.profile?.category_name).toBe('高处作业')
    expect(store.canChooseTrainingCategory).toBe(false)
  })

  it('requires an explicit confirmation and a real enabled option before transport', async () => {
    const writes: unknown[] = []
    install(request => { if (request.method === 'PUT') writes.push(request.data); return ok(request.url.includes('training-categories') ? categories : profile) })
    const store = await ready()
    store.chooseTrainingCategory('999'); store.requestCategoryConfirmation(); await store.confirmTrainingCategory()
    store.chooseTrainingCategory('42'); await store.confirmTrainingCategory()
    expect(writes).toEqual([])
    expect(store.profile?.category_id).toBeNull()
  })

  it('loads every category page with string IDs and does not expose a partial failed list', async () => {
    const pages: string[] = []; let fail = true
    install(request => {
      if (!request.url.includes('training-categories')) return ok(profile)
      const page = new URL(request.url, 'http://local').searchParams.get('page')!
      pages.push(page)
      if (page === '2' && fail) throw new Error('offline')
      return ok({ items: [categories.items[page === '1' ? 0 : 1]], total: 2, page: Number(page), page_size: 1 })
    })
    const store = useLearnerStore(); await store.loadProfile()
    await store.loadTrainingCategories()
    expect(store.trainingCategories).toEqual([])
    expect(store.categoryError).toContain('网络连接失败')
    fail = false; await store.loadTrainingCategories()
    expect(pages).toEqual(['1', '2', '1', '2'])
    expect(store.trainingCategories.map(item => item.id)).toEqual(['9007199254740993', '42'])
  })

  it('keeps a preassigned or PC-adjusted category readonly including a disabled current name', async () => {
    let current = chosen; const writes: unknown[] = []
    install(request => { if (request.method === 'PUT') writes.push(request.data); return ok(request.url.includes('training-categories') ? categories : current) })
    const store = await ready()
    store.chooseTrainingCategory('42'); store.requestCategoryConfirmation(); await store.confirmTrainingCategory()
    expect(writes).toEqual([])
    current = { ...chosen, category_id: '42', category_name: 'PC 调整后的停用工种' }
    await store.loadProfile()
    expect(store.profile?.category_name).toBe('PC 调整后的停用工种')
    expect(store.canChooseTrainingCategory).toBe(false)
  })

  it('resolves a lost write response by GET and never automatically repeats the write', async () => {
    let written = false; const methods: string[] = []
    install(request => {
      methods.push(request.method)
      if (request.method === 'PUT') { written = true; throw new Error('response lost') }
      return ok(request.url.includes('training-categories') ? categories : written ? chosen : profile)
    })
    const store = await ready(); methods.length = 0
    store.chooseTrainingCategory(chosen.category_id); store.requestCategoryConfirmation()
    await store.confirmTrainingCategory()
    expect(methods).toEqual(['PUT', 'GET'])
    expect(store.profile?.category_id).toBe(chosen.category_id)
    expect(store.categoryReadRequired).toBe(false)
    expect(store.canChooseTrainingCategory).toBe(false)
  })

  it('blocks blind writes after a failed readback and preserves the draft until explicit refresh', async () => {
    let fail = false; let writes = 0
    install(request => {
      if (request.method === 'PUT') { writes++; fail = true; throw new Error('lost') }
      if (fail) throw new Error('offline')
      return ok(request.url.includes('training-categories') ? categories : profile)
    })
    const store = await ready(); store.chooseTrainingCategory('42'); store.requestCategoryConfirmation()
    await store.confirmTrainingCategory()
    expect(store.categoryReadRequired).toBe(true)
    expect(store.categoryDraftId).toBe('42')
    expect(store.categoryError).toContain('刷新')
    store.requestCategoryConfirmation(); await store.confirmTrainingCategory()
    expect(writes).toBe(1)
    fail = false; await store.loadProfile()
    expect(store.canChooseTrainingCategory).toBe(true)
  })

  it('reads the authoritative category after a PC conflict instead of showing the stale null', async () => {
    let conflict = false
    install(request => {
      if (request.method === 'PUT') { conflict = true; return { statusCode: 400, data: { code: 40001, message: '已分配', data: { reason_code: 'TRAINING_CATEGORY_LOCKED' } } } }
      return ok(request.url.includes('training-categories') ? categories : conflict ? chosen : profile)
    })
    const store = await ready(); store.chooseTrainingCategory('42'); store.requestCategoryConfirmation()
    await store.confirmTrainingCategory()
    expect(store.profile?.category_name).toBe('高处作业')
    expect(store.canChooseTrainingCategory).toBe(false)
  })

  it('does not misread an initial GET failure as permission to select a category', async () => {
    install(() => { throw new Error('offline') })
    const store = useLearnerStore()
    await expect(store.loadProfile()).rejects.toMatchObject({ code: -1 })
    expect(store.canChooseTrainingCategory).toBe(false)
  })

  it('clears selection and confirmation immediately when the account changes and ignores late options', async () => {
    let finish: (value: unknown) => void = () => {}; let delayed = false
    install(request => {
      if (request.url.includes('training-categories') && delayed) return new Promise(resolve => { finish = resolve })
      return ok(request.url.includes('training-categories') ? categories : profile)
    })
    const store = await ready(); store.chooseTrainingCategory('42'); store.requestCategoryConfirmation()
    delayed = true; const pending = store.loadTrainingCategories()
    await vi.waitFor(() => expect(store.categoryLoading).toBe(true))
    await Promise.resolve()
    store.user = { ...user, id: 18 }
    expect(store.categoryConfirmVisible).toBe(false)
    expect(store.categoryDraftId).toBe('')
    finish(ok(categories)); await pending
    expect(store.trainingCategories).toEqual([])
    expect(store.profile).toBeNull()
  })
})
