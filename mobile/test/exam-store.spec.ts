import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLearnerStore } from '../src/stores/learner'
import { useSessionStore } from '../src/stores/session'
const path = '../src/stores/' + 'exam.ts'
const user = { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee' as const, source: 'external' as const, category_id: null, identity_status: 'verified' as const }
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const questions = [
  { item_id: '101', type: 'single', score: 5, stem: doc('单选'), options: [{ id: 'stable-b', content: doc('B') }, { id: 'stable-a', content: doc('A') }] },
  { item_id: '102', type: 'multiple', score: 5, stem: doc('多选'), options: [{ id: 'x', content: doc('X') }, { id: 'y', content: doc('Y') }] },
  { item_id: '103', type: 'judgment', score: 5, stem: doc('判断'), options: [{ id: 'yes', content: doc('正确') }, { id: 'no', content: doc('错误') }] },
]
function active() { return { status: 'in_progress', record_id: '81', paper_id: '41', release_id: '51', server_now: new Date().toISOString(), deadline_at: new Date(Date.now() + 60000).toISOString(), questions: structuredClone(questions) } }
const result = { record_id: '81', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: '2026-10-22T10:00:00Z', graded_at: '2026-10-22T10:00:00Z', score: 5, passed: true, correct_rate: 1 / 3, items: questions.map(q => ({ ...q, selected_option_ids: [], correct_option_ids: [q.options[0].id], analysis: null, gained_score: 0 })) }
type Wire = { url: string; method: string; data?: any; success(value: unknown): void; fail(value: unknown): void }
const storage = new Map<string, any>()
const calls: Wire[] = []
function ok(data: unknown) { return { statusCode: 200, data: { code: 0, message: 'ok', data } } }
function install(handler: (o: Wire) => unknown) {
  vi.stubGlobal('uni', { request: (o: Wire) => { calls.push(o); Promise.resolve().then(() => handler(o)).then(o.success, o.fail) }, reLaunch: vi.fn(),
    getStorage: (o: any) => storage.has(o.key) ? o.success({ data: structuredClone(storage.get(o.key)) }) : o.fail({}),
    setStorage: (o: any) => { storage.set(o.key, structuredClone(o.data)); o.success({}) }, removeStorage: (o: any) => { storage.delete(o.key); o.success({}) },
  })
}
beforeEach(() => { setActivePinia(createPinia()); storage.clear(); calls.length = 0; vi.useRealTimers(); useLearnerStore().$patch({ user }); useSessionStore().$patch({ accessToken: 'memory', initialized: true }); install(o => ok(o.url.endsWith('/result') ? result : active())) })
describe('mobile exam authority and local answering', () => {
  it('restores only after fetching the original attempt and retains stable option IDs in full submission', async () => {
    const { useExamStore = () => ({}) } = await import(path).catch(() => ({})); const store: any = useExamStore()
    storage.set('ruleexam:mobile:17:exam-draft:81', { answers: { '101': ['stable-a'] }, currentIndex: 1, savedAt: '2026-10-22T10:00:00Z' })
    await store.recover('81')
    expect(store.answers).toEqual({ '101': ['stable-a'], '102': [], '103': [] }); expect(store.currentIndex).toBe(1)
    store.choose('102', 'x'); store.choose('102', 'y'); store.choose('102', 'x')
    install(o => ok(o.url.endsWith('/submit') ? result : active()))
    await store.submit()
    expect(calls.find(o => o.url.endsWith('/submit'))?.data).toEqual({ record_id: '81', answers: [{ item_id: '101', option_ids: ['stable-a'] }, { item_id: '102', option_ids: ['y'] }, { item_id: '103', option_ids: [] }] })
    expect(store.result.status).toBe('passed'); expect(storage.has('ruleexam:mobile:17:exam-draft:81')).toBe(false)
  })
  it('a corrupt draft resets the whole sheet and offline answering needs no API', async () => {
    const { useExamStore } = await import(path); const store = useExamStore()
    storage.set('ruleexam:mobile:17:exam-draft:81', { answers: { '101': ['stable-a'], '102': ['unknown'] }, currentIndex: 0, savedAt: '2026-10-22T10:00:00Z' })
    await store.recover('81'); const count = calls.length
    store.choose('101', 'stable-b'); await store.persistDraft()
    expect(store.answers).toEqual({ '101': ['stable-b'], '102': [], '103': [] }); expect(calls.length).toBe(count)
    expect(storage.get('ruleexam:mobile:17:exam-draft:81').answers['101']).toEqual(['stable-b'])
    install(() => { throw new Error('offline') }); await expect(store.recover('81')).rejects.toThrow()
    expect(store.questions).toEqual([]); expect(store.loadError).toContain('网络')
  })
  it('deadline only locks and queries status without submitting or extending time', async () => {
    const { useExamStore } = await import(path); const store = useExamStore()
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T10:00:00Z'))
    install(() => ok({ ...active(), deadline_at: '2026-10-22T10:00:02Z' }))
    await store.recover('81'); store.choose('101', 'stable-a')
    vi.setSystemTime(new Date('2026-10-22T10:00:03Z'))
    await store.tick()
    expect(store.locked).toBe(true); expect(store.remaining).toBe(0)
    expect(calls.some(o => o.url.endsWith('/submit'))).toBe(false)
    expect(calls.filter(o => o.url.endsWith('/81'))).toHaveLength(2)
    store.choose('101', 'stable-b'); expect(store.answers['101']).toEqual(['stable-a'])
  })
  it('unknown submission queries authority before one identical retry and never unlocks answers', async () => {
    const { useExamStore } = await import(path); const store = useExamStore(); await store.recover('81'); store.choose('101', 'stable-a')
    let attempts = 0
    install(o => { if (o.url.endsWith('/submit')) { attempts++; throw new Error('unknown') } return ok(active()) })
    await store.submit()
    expect(calls.slice(1).map(o => o.url)).toEqual(['/api/v1/me/exam-records/81/submit', '/api/v1/me/exam-records/81', '/api/v1/me/exam-records/81/submit', '/api/v1/me/exam-records/81'])
    expect(attempts).toBe(2); expect(store.phase).toBe('uncertain'); expect(store.locked).toBe(true)
    const frozen = structuredClone(calls.find(o => o.url.endsWith('/submit'))?.data)
    store.choose('101', 'stable-b'); expect(store.answers['101']).toEqual(['stable-a'])
    expect(calls.filter(o => o.url.endsWith('/submit')).every(o => JSON.stringify(o.data) === JSON.stringify(frozen))).toBe(true)
  })
  it.each(['submitted', 'timeout', 'passed'])('uncertain response resolved as %s never retries submission', async status => {
    const { useExamStore } = await import(path); const store = useExamStore(); await store.recover('81')
    install(o => { if (o.url.endsWith('/submit')) throw new Error('lost response'); if (o.url.endsWith('/result')) return ok({ ...result, status, items: status === 'passed' ? result.items : [] }); return ok({ ...active(), status, questions: [] }) })
    await store.submit()
    expect(calls.filter(o => o.url.endsWith('/submit'))).toHaveLength(1); expect(store.result?.status).toBe(status)
    expect(storage.has('ruleexam:mobile:17:exam-draft:81')).toBe(false)
  })
  it('401 clears in-memory questions and image URLs but keeps the user draft; explicit logout clears it', async () => {
    const { useExamStore } = await import(path); const store = useExamStore(); await store.recover('81'); store.choose('101', 'stable-a'); await store.persistDraft()
    useSessionStore().expireSession(); expect(store.questions).toEqual([]); expect(store.assets).toEqual({})
    expect(storage.has('ruleexam:mobile:17:exam-draft:81')).toBe(true)
    useLearnerStore().$patch({ user }); useSessionStore().$patch({ accessToken: 'again' }); install(() => ok(null))
    await useSessionStore().logout(); expect(storage.has('ruleexam:mobile:17:exam-draft:81')).toBe(false)
  })
  it('uses structured identity reasons and rejects in-exam answer leakage and unsafe content', async () => {
    const { useExamStore } = await import(path); const store = useExamStore()
    install(() => ({ statusCode: 403, data: { code: 40302, message: 'opaque', data: { reason_code: 'IDENTITY_PENDING' } } }))
    await expect(store.start('41')).rejects.toThrow(); expect(store.identityReason).toBe('IDENTITY_PENDING')
    install(() => ok({ ...active(), questions: [{ ...questions[0], correct: ['stable-a'] }] }))
    await expect(store.recover('81')).rejects.toThrow(); expect(store.questions).toEqual([])
    install(() => ok({ ...active(), questions: [{ ...questions[0], stem: { type: 'doc', content: [{ type: 'image', attrs: { asset_id: 'fake' } }] } }] }))
    await expect(store.recover('81')).rejects.toThrow(); expect(store.questions).toEqual([])
  })
  it('fetches exact per-item media tickets and discards late account responses', async () => {
    const { useExamStore } = await import(path); const store = useExamStore()
    let finish: (value: unknown) => void = () => {}, began = false
    install(o => { if (o.url.includes('/tickets')) { began = true; return new Promise(resolve => { finish = resolve }) }; return ok({ ...active(), questions: [{ ...questions[0], stem: { type: 'doc', content: [{ type: 'image', attrs: { asset_id: '901' } }] } }] }) })
    await store.recover('81'); const media = store.loadItemMedia('101')
    await vi.waitFor(() => expect(began).toBe(true))
    expect(calls.find(o => o.url.includes('/tickets'))?.data).toEqual({ owner_type: 'exam_record_question', owner_id: '101' })
    useSessionStore().expireSession(); finish(ok({ content_url: '/api/v1/media/tickets/old-ticket/content', expires_at: '2026-10-22T12:00:00Z' })); await media
    expect(store.assets).toEqual({}); expect(store.questions).toEqual([])
  })
  it('terminal timeout invalidates an older in-flight in-exam media ticket', async () => {
    const { useExamStore } = await import(path); const store = useExamStore()
    let finish: (value: unknown) => void = () => {}, began = false, terminal = false
    install(o => {
      if (o.url.includes('/tickets')) { began = true; return new Promise(resolve => { finish = resolve }) }
      if (o.url.endsWith('/result')) return ok({ ...result, status: 'timeout', grading_state: 'not_submitted', submission_method: null, submitted_at: null, graded_at: null, score: 0, passed: false, correct_rate: null, items: [] })
      return ok({ ...active(), status: terminal ? 'timeout' : 'in_progress', questions: terminal ? [] : [{ ...questions[0], stem: { type: 'doc', content: [{ type: 'image', attrs: { asset_id: '901' } }] } }] })
    })
    await store.recover('81'); const media = store.loadItemMedia('101'); await vi.waitFor(() => expect(began).toBe(true))
    terminal = true; await store.queryStatus()
    finish(ok({ content_url: '/api/v1/media/tickets/late-ticket/content', expires_at: '2026-10-22T12:00:00Z' })); await media
    expect(store.assets).toEqual({}); expect(store.mediaErrors).toEqual({})
  })
  it('a response for another record cannot replace or finalize the active attempt', async () => {
    const { useExamStore } = await import(path); const store = useExamStore()
    install(() => ok({ ...active(), record_id: '82' }))
    await expect(store.recover('81')).rejects.toThrow(); expect(store.questions).toEqual([])
    install(() => ok(active())); await store.recover('81')
    install(o => o.url.endsWith('/submit') ? ok({ ...result, record_id: '82' }) : ok(active()))
    await store.submit(); expect(store.result).toBeNull(); expect(store.phase).toBe('uncertain')
  })
  it('a pending status request for A does not swallow the real status query for newly opened B', async () => {
    const { useExamStore } = await import(path); const store = useExamStore(); await store.recover('81')
    let releaseA: (value: unknown) => void = () => {}, aStarted = false
    const b = { ...active(), record_id: '82', paper_id: '42' }
    install(o => o.url.endsWith('/81') ? new Promise(resolve => { aStarted = true; releaseA = resolve }) : ok(b))
    const old = store.queryStatus(); await vi.waitFor(() => expect(aStarted).toBe(true))
    await store.recover('82')
    const queryB = store.queryStatus()
    try { await vi.waitFor(() => expect(calls.filter(o => o.url.endsWith('/82'))).toHaveLength(2)) }
    finally { releaseA(ok({ ...active(), status: 'timeout', questions: [] })); await Promise.all([old, queryB]) }
    expect(store.attempt?.record_id).toBe('82'); expect(store.phase).toBe('answering')
  })
  it('a pending submission for A does not swallow the real submission and frozen sheet for B', async () => {
    const { useExamStore } = await import(path); const store = useExamStore(); await store.recover('81')
    let releaseA: (value: unknown) => void = () => {}, aStarted = false
    install(o => {
      if (o.url.endsWith('/81/submit')) return new Promise(resolve => { aStarted = true; releaseA = resolve })
      return ok(o.url.endsWith('/82/submit') ? { ...result, record_id: '82' } : { ...active(), record_id: '82', paper_id: '42' })
    })
    store.choose('101', 'stable-a'); const old = store.submit(); await vi.waitFor(() => expect(aStarted).toBe(true))
    await store.recover('82'); store.choose('102', 'y'); const submitB = store.submit()
    try { await vi.waitFor(() => expect(calls.find(o => o.url.endsWith('/82/submit'))?.data).toEqual({ record_id: '82', answers: [{ item_id: '101', option_ids: [] }, { item_id: '102', option_ids: ['y'] }, { item_id: '103', option_ids: [] }] })) }
    finally { releaseA(ok(result)); await Promise.all([old, submitB]) }
    expect(store.result?.record_id).toBe('82'); expect(store.phase).toBe('terminal')
  })
  it('a later successful asset cannot erase the earlier failed asset on the same question', async () => {
    const { useExamStore } = await import(path); const store = useExamStore()
    vi.stubEnv('VITE_API_ORIGIN', 'https://exam.test')
    let releaseSuccess: (value: unknown) => void = () => {}, successStarted = false
    install(o => {
      if (o.url.includes('/901/tickets')) return { statusCode: 403, data: { code: 40302, message: '第一张图片不可用', data: null } }
      if (o.url.includes('/902/tickets')) { successStarted = true; return new Promise(resolve => { releaseSuccess = resolve }) }
      return ok({ ...active(), questions: [{ ...questions[0], stem: { type: 'doc', content: [{ type: 'image', attrs: { asset_id: '901' } }, { type: 'image', attrs: { asset_id: '902' } }] } }] })
    })
    try {
      await store.recover('81'); const media = store.loadItemMedia('101'); await vi.waitFor(() => expect(successStarted).toBe(true))
      await vi.waitFor(() => expect(store.mediaErrors['101']?.['901']).toBe('第一张图片不可用'))
      releaseSuccess(ok({ content_url: '/api/v1/media/tickets/success-902/content', expires_at: '2026-10-22T12:00:00Z' })); await media
      expect(store.mediaErrors['101']).toEqual({ '901': '第一张图片不可用' }); expect(store.assets['101']['902']).toBe(`${window.location.origin}/api/v1/media/tickets/success-902/content`)
    } finally { vi.unstubAllEnvs() }
  })
})
