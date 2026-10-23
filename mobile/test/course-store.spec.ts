import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLearnerStore } from '../src/stores/learner'
import { useSessionStore } from '../src/stores/session'

const user = { id: 17, username: 'learner-17', real_name: '旧姓名', phone_masked: '138****0000', role: 'employee' as const, source: 'institution' as const, category_id: 3, identity_status: 'unverified' as const }
const profile = { id: '17', username: 'learner-17', real_name: '服务端姓名', phone: '13900000000', email: null, avatar_id: null, occupation: '电工', gender: 'female' as const, birthday: '2000-03-04', source: 'external' as const, category_id: '9007199254740993', role: 'employee' as const, status: 1 }
const summary = { id: '9007199254740995', title: '真实课程', category_id: '9007199254740993', cover_asset_id: null, status: 'published' as const, required_lesson_count: 4 }
const page1 = { items: [summary], total: 2, page: 1, page_size: 1 }
type Wire = { url: string; method: string; data?: unknown; header: Record<string, string>; success: (value: unknown) => void; fail: (error: unknown) => void }
function ok(data: unknown) { return { statusCode: 200, data: { code: 0, message: 'ok', data } } }
function install(handler: (options: Wire) => unknown) {
  vi.stubGlobal('uni', { request: (options: Wire) => { Promise.resolve().then(() => handler(options)).then(options.success, options.fail) }, reLaunch: vi.fn() })
}
beforeEach(() => {
  setActivePinia(createPinia()); vi.unstubAllGlobals()
  useLearnerStore().$patch({ user })
  useSessionStore().$patch({ accessToken: 'memory-token', initialized: true })
})

describe('course module read model', () => {
  it('matches historical lesson progress by stable IDs instead of response order across course reloads', async () => {
    const detail = { ...summary, description: null, chapters: [{ id: '51', title: '课程目录', sort_order: 1, lessons: [{ id: '61', title: '已完成课时', lesson_type: 'video', required: true, sort_order: 1, current_version: { version_id: '71', asset_id: '91', duration_ms: 120000 } }, { id: '62', title: '未完成课时', lesson_type: 'video', required: true, sort_order: 2, current_version: { version_id: '72', asset_id: '92', duration_ms: 120000 } }] }] }
    install(options => ok(options.url.includes('/progress') ? { required: 2, completed: 1, completion_rate: 0.5, lessons: [{ lesson_id: '62', version_id: '72', confirmed_position_ms: 12000, credited_ms: 9000, coverage_ms: 9000, duration_ms: 120000, completed: false, last_seq: 4 }, { lesson_id: '61', version_id: '71', confirmed_position_ms: 120000, credited_ms: 120000, coverage_ms: 120000, duration_ms: 120000, completed: true, last_seq: 8 }] } : detail))
    const { useCourseStore } = await import('../src/stores/course'); const store = useCourseStore()
    await store.loadDetail(summary.id)
    expect(store.chapters[0].lessons.map(lesson => ({ id: lesson.id, completed: lesson.completed, text: lesson.progressText }))).toEqual([{ id: '61', completed: true, text: '已完成' }, { id: '62', completed: false, text: '已学 00:12' }])
    await store.loadDetail(summary.id)
    expect(store.lessonProgress[summary.id]['61'].completed).toBe(true)
    expect(store.chapters[0].lessons[1].progressText).toBe('已学 00:12')
  })
  it('keeps authoritative session progress per lesson without deriving course completion locally', async () => {
    install(() => ok(null))
    const { useCourseStore } = await import('../src/stores/course'); const store = useCourseStore()
    store.acceptLessonProgress('41', '61', '71', { confirmed_position_ms: 12000, credited_ms: 9000, coverage_ms: 9000, duration_ms: 120000, completed: false, last_seq: 4 })
    store.acceptLessonProgress('41', '62', '72', { confirmed_position_ms: 120000, credited_ms: 120000, coverage_ms: 120000, duration_ms: 120000, completed: true, last_seq: 8 })
    expect(store.lessonProgress['41']['61'].confirmed_position_ms).toBe(12000)
    expect(store.lessonProgress['41']['62'].completed).toBe(true)
    expect(store.progressPercent['41']).toBeUndefined()
    useSessionStore().expireSession(); expect(store.lessonProgress).toEqual({})
  })
  it('loads home and uses only server completion_rate for card percentages, preserving string IDs', async () => {
    install(options => {
      if (options.url.startsWith('/api/v1/me/home?')) return ok({ site_config: { logo_asset_id: null, banners: [] }, courses: page1 })
      if (options.url.endsWith(`/${summary.id}/progress`)) return ok({ required: 4, completed: 4, completion_rate: 0.375, lessons: [] })
      throw new Error(`Unexpected ${options.url}`)
    })
    const { useCourseStore } = await import('../src/stores/course')
    const store = useCourseStore()
    await store.loadHome()
    expect(store.home.items[0].id).toBe('9007199254740995')
    expect(store.progressPercent[summary.id]).toBe(38)
    expect(store.home.total).toBe(2)
  })

  it('loads further pages once, keeps the current page on failure, and retries the failed page', async () => {
    let failNext = true
    install(options => {
      if (options.url.includes('/progress')) return ok({ required: 0, completed: 0, completion_rate: null, lessons: [] })
      const url = new URL(options.url, 'http://localhost')
      if (url.searchParams.get('page') === '1') return ok(page1)
      if (failNext) throw new Error('offline')
      return ok({ items: [{ ...summary, id: '9007199254740996', title: '第二门课' }], total: 2, page: 2, page_size: 1 })
    })
    const { useCourseStore } = await import('../src/stores/course')
    const store = useCourseStore()
    await store.loadList(1)
    await expect(store.loadMore()).rejects.toMatchObject({ code: -1 })
    expect(store.list.items.map(item => item.title)).toEqual(['真实课程'])
    expect(store.list.page).toBe(1)
    expect(store.listError).toContain('网络连接失败')
    failNext = false
    await store.loadMore()
    expect(store.list.items.map(item => item.title)).toEqual(['真实课程', '第二门课'])
    expect(store.hasMore).toBe(false)
    expect(store.progressPercent[summary.id]).toBe(0)
  })

  it('clears old detail before loading another course and leaves errors retryable', async () => {
    let failed = false
    install(options => {
      if (options.url.includes('/progress')) return ok({ required: 0, completed: 0, completion_rate: null, lessons: [] })
      if (failed) return { statusCode: 404, data: { code: 40401, message: '课程不存在', data: null } }
      return ok({ ...summary, description: '课程说明', chapters: [{ id: 'chapter-1', title: '第一章', sort_order: 1, lessons: [{ id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1, current_version: null }] }] })
    })
    const { useCourseStore } = await import('../src/stores/course')
    const store = useCourseStore()
    await store.loadDetail(summary.id)
    expect(store.detail?.chapters[0].lessons[0].id).toBe('lesson-1')
    failed = true
    await expect(store.loadDetail('another')).rejects.toMatchObject({ code: 40401 })
    expect(store.detail).toBeNull()
    expect(store.detailError).toBe('课程不存在')
  })

  it('clears per-account course data when the session changes', async () => {
    install(options => ok(options.url.includes('/progress') ? { required: 0, completed: 0, completion_rate: null, lessons: [] } : page1))
    const { useCourseStore } = await import('../src/stores/course')
    const store = useCourseStore()
    await store.loadList(1)
    useSessionStore().expireSession()
    expect(store.list.items).toEqual([])
    expect(store.progressPercent).toEqual({})
  })

  it('does not mark a rounded 100 percent complete until the raw server rate is exactly one', async () => {
    install(options => ok({ required: 200, completed: 199, completion_rate: options.url.includes('/almost/') ? 0.995 : 1, lessons: [] }))
    const { useCourseStore } = await import('../src/stores/course')
    const store = useCourseStore()
    await store.loadProgress(['almost', 'complete'])
    expect(store.progressPercent).toEqual({ almost: 100, complete: 100 })
    expect(store.progressComplete).toEqual({ almost: false, complete: true })
  })
})

describe('authoritative learner profile', () => {
  it('loads profile and accepts server identity/source/category after an editable-field save', async () => {
    install(options => ok(options.method === 'POST' ? { ...profile, occupation: '班组长' } : profile))
    const learner = useLearnerStore()
    await learner.loadProfile()
    await learner.updateProfile({ occupation: '班组长', gender: 'female', birthday: '2000-03-04' })
    expect(learner.profile).toEqual({ ...profile, occupation: '班组长' })
    expect(learner.profile?.source).toBe('external')
    expect(learner.profile?.category_id).toBe('9007199254740993')
  })

  it('sends platform-compatible POST with editable fields only and never overwrites identity from the form', async () => {
    let sent: Wire | undefined
    install(options => { sent = options; return ok(profile) })
    await useLearnerStore().updateProfile({ occupation: ' 电工 ', gender: 'male', birthday: '2000-01-01', real_name: '篡改', phone: '13800000000', source: 'institution', category_id: '3' } as never)
    expect(sent).toMatchObject({ url: '/api/v1/me/profile', method: 'POST', data: { occupation: '电工', gender: 'male', birthday: '2000-01-01' } })
    expect(useLearnerStore().profile?.real_name).toBe('服务端姓名')
  })

  it('rejects invalid or future birthdays before sending and preserves server profile after a failed save', async () => {
    let calls = 0
    install(() => { calls++; return ok(profile) })
    const learner = useLearnerStore()
    await learner.loadProfile()
    await expect(learner.updateProfile({ birthday: '2100-01-01' })).rejects.toMatchObject({ code: 40001 })
    await expect(learner.updateProfile({ birthday: '2025-02-29' })).rejects.toMatchObject({ code: 40001 })
    expect(calls).toBe(1)
    install(() => { throw new Error('offline') })
    await expect(learner.updateProfile({ occupation: '班组长' })).rejects.toMatchObject({ code: -1 })
    expect(learner.profile?.occupation).toBe('电工')
    expect(learner.profileError).toContain('网络连接失败')
  })

  it('discards previous account profile as soon as the session user is cleared', async () => {
    install(() => ok(profile))
    const learner = useLearnerStore()
    await learner.loadProfile()
    learner.user = null
    expect(learner.profile).toBeNull()
  })

  it('does not let an older profile read overwrite a newer successful save', async () => {
    let finishRead: (value: unknown) => void = () => {}
    let readStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { readStarted = resolve })
    install(options => {
      if (options.method === 'GET') { readStarted(); return new Promise(resolve => { finishRead = resolve }) }
      return ok({ ...profile, occupation: '班组长' })
    })
    const learner = useLearnerStore()
    const read = learner.loadProfile()
    await started
    await learner.updateProfile({ occupation: '班组长' })
    finishRead(ok(profile))
    await read
    expect(learner.profile?.occupation).toBe('班组长')
  })
})
