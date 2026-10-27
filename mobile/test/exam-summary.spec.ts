import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useExamStore } from '../src/stores/exam'
import { useLearnerStore } from '../src/stores/learner'
import { useSessionStore } from '../src/stores/session'

type Wire = { url: string; method: string; data?: unknown; success(value: unknown): void; fail(value: unknown): void }
const calls: Wire[] = []
const summary = {
  paper_id: '901', title: '120 分冻结考试', mode: 'fixed', status: 'published', source: 'external', category_id: '3', difficulty: 'easy',
  total_score: 120, pass_score: 72, duration_minutes: 35, question_count: 24, active_record_id: null, latest_record_id: null,
  learning: { required_learning_minutes: 30, credited_seconds: 900, remaining_seconds: 900, courses: [{ id: '8', title: '消防基础', available: true }] },
}
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
function install(handler: (wire: Wire) => unknown) {
  vi.stubGlobal('uni', { request(wire: Wire) { calls.push(wire); Promise.resolve().then(() => handler(wire)).then(wire.success, wire.fail) }, reLaunch: vi.fn() })
}
beforeEach(() => {
  setActivePinia(createPinia()); calls.length = 0
  useLearnerStore().$patch({ user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: 3, identity_status: 'verified' } })
  useSessionStore().$patch({ accessToken: 'memory', initialized: true })
  install(() => ok(summary))
})

describe('learner exam summaries', () => {
  it('loads a direct-link summary independently from the paginated exam list', async () => {
    const store = useExamStore() as any
    await store.loadSummary?.('901')
    expect(store.summary).toEqual(summary)
    expect(calls.map(call => call.url)).toEqual(['/api/v1/me/exams/901'])
    expect(store.list.items).toEqual([])
  })
  it('sends the selected state to the server before pagination and clears prior filter rows', async () => {
    const store = useExamStore() as any
    install(wire => ok({ items: wire.url.includes('state=ended') ? [] : [summary], total: 1, page: 1, page_size: 10 }))
    await store.loadList(1, 'published')
    await store.loadList(1, 'ended')
    expect(calls[0].url).toContain('state=published')
    expect(calls[1].url).toContain('state=ended')
    expect(store.list.items).toEqual([])
  })
  it('does not retain a prior learner summary when a refresh fails', async () => {
    const store = useExamStore() as any
    await store.loadSummary?.('901')
    install(() => { throw new Error('offline') })
    await store.loadSummary?.('901').catch(() => {})
    expect(store.summary).toBeNull()
    expect(store.summaryError).toContain('网络')
  })
  it('discards a summary that arrives after switching learner sessions', async () => {
    const store = useExamStore() as any
    let finish: (value: unknown) => void = () => {}
    install(() => new Promise(resolve => { finish = resolve }))
    const pending = store.loadSummary?.('901').catch(() => {})
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    useSessionStore().expireSession()
    finish(ok(summary)); await pending
    expect(store.summary).toBeNull()
  })
  it('refreshes the summary after a structured learning rejection without replaying start', async () => {
    const store = useExamStore() as any
    install(wire => wire.url.endsWith('/start')
      ? { statusCode: 409, data: { code: 40901, message: '还需学习15分钟后可开始考试', data: { reason_code: 'LEARNING_REQUIRED', required_learning_minutes: 30, credited_seconds: 900, remaining_seconds: 900, course_ids: ['8'] } } }
      : ok(summary))
    await expect(store.start('901')).rejects.toMatchObject({ code: 40901 })
    expect(store.summary?.learning.remaining_seconds).toBe(900)
    expect(calls.filter(call => call.url.endsWith('/start'))).toHaveLength(1)
    expect(calls.some(call => call.url.endsWith('/exams/901'))).toBe(true)
  })
  it('rejects malformed learning amounts instead of treating them as satisfied', async () => {
    const store = useExamStore() as any
    install(() => ok({ ...summary, learning: { ...summary.learning, remaining_seconds: -1 } }))
    await expect(store.loadSummary('901')).rejects.toMatchObject({ code: -2 })
    expect(store.summary).toBeNull()
  })
  it('does not replace the requested paper with another summary', async () => {
    const store = useExamStore() as any
    install(() => ok({ ...summary, paper_id: '902' }))
    await expect(store.loadSummary('901')).rejects.toMatchObject({ code: -2 })
    expect(store.summary).toBeNull()
  })
})
