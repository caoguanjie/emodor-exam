import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import rich from '../../tests/fixtures/question-authoring-v3/rich-content.json'
import { getAttempt, getExamResult, getWrongQuestions, startExam, submitExam } from '../src/api/exams'
import { useSessionStore } from '../src/stores/session'
import { useLearnerStore } from '../src/stores/learner'
import { useExamStore } from '../src/stores/exam'

type Wire = { url: string; method: string; header: Record<string, string>; withCredentials: boolean; data?: any; success(value: unknown): void; fail(error: unknown): void }
const requests: Wire[] = [], storage = new Map<string, any>()
const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧题' }] }] }
const oldQuestion = { item_id: '101', type: 'single', score: 5, stem: plain, options: [{ id: 'A', content: plain }, { id: 'B', content: plain }] }
const richQuestion = { ...oldQuestion, content_schema_version: 3, stem: rich.stem, options: rich.options }
const active = (questions: any[] = [oldQuestion]) => ({ status: 'in_progress', record_id: '81', paper_id: '41', release_id: '51', deadline_at: '2026-10-23T10:01:00Z', server_now: '2026-10-23T10:00:00Z', questions })
const review = (question: any = richQuestion) => ({ ...question, selected_option_ids: ['B'], correct_option_ids: ['A'], analysis: rich.analysis, gained_score: 0 })
const result = (items: any[] = [review()]) => ({ record_id: '81', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false, submitted_at: '2026-10-23T10:00:10Z', graded_at: '2026-10-23T10:00:10Z', score: 0, passed: false, correct_rate: 0, items })
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
const upgrade = () => ({ statusCode: 409, data: { code: 40901, message: 'opaque detail', data: { reason_code: 'CONTENT_VERSION_REQUIRED', required_content_version: 3 } } })
function install(handler: (wire: Wire) => unknown) {
  vi.stubGlobal('uni', { request: (wire: Wire) => { requests.push(wire); Promise.resolve().then(() => handler(wire)).then(wire.success, wire.fail) }, reLaunch: vi.fn(),
    getStorage: (o: any) => storage.has(o.key) ? o.success({ data: structuredClone(storage.get(o.key)) }) : o.fail({}),
    setStorage: (o: any) => { storage.set(o.key, structuredClone(o.data)); o.success({}) }, removeStorage: (o: any) => { storage.delete(o.key); o.success({}) },
  })
}
beforeEach(() => {
  setActivePinia(createPinia()); requests.length = 0; storage.clear(); vi.useRealTimers()
  useLearnerStore().$patch({ user: { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'verified' } })
  useSessionStore().$patch({ accessToken: 'memory', initialized: true })
})
describe('exam schema capability at the real transport boundary', () => {
  it('sends the same capability on start, read, result, wrong and submit without changing the body or auth', async () => {
    install(wire => ok(wire.url.includes('wrong-questions') ? { items: [{ ...review(), record_id: '81', submitted_at: '2026-10-23T10:00:10Z', legacy: false }], page: 1, page_size: 10, total: 1 } : /result|submit/.test(wire.url) ? result() : active([richQuestion])))
    await startExam('41'); await getAttempt('81'); await getExamResult('81'); await getWrongQuestions()
    const body = { record_id: '81', answers: [{ item_id: '101', option_ids: ['B'] }] }
    await submitExam(body)
    expect(requests).toHaveLength(5)
    for (const request of requests) expect(request).toMatchObject({ header: { 'X-Question-Content-Version': '3', Authorization: 'Bearer memory' }, withCredentials: true })
    expect(requests[4].data).toEqual(body)
  })
  it('reads unmarked legacy schema 2 but rejects a schema 3 document falsely marked 2', async () => {
    install(() => ok(active()))
    await expect(getAttempt('81')).resolves.toMatchObject({ questions: [{ stem: plain }] })
    install(() => ok(active([{ ...richQuestion, content_schema_version: 2 }])))
    await expect(getAttempt('81')).rejects.toMatchObject({ code: -2 })
  })
  it.each([4, '3', null])('rejects unknown response version %s on every content reader', async version => {
    const bad = { ...richQuestion, content_schema_version: version }
    install(wire => ok(wire.url.includes('wrong-questions') ? { items: [{ ...review(bad), record_id: '81' }], page: 1, page_size: 10, total: 1 } : /result|submit/.test(wire.url) ? result([review(bad)]) : active([bad])))
    await expect(getAttempt('81')).rejects.toMatchObject({ code: -2 })
    await expect(getExamResult('81')).rejects.toMatchObject({ code: -2 })
    await expect(getWrongQuestions()).rejects.toMatchObject({ code: -2 })
    await expect(submitExam({ record_id: '81', answers: [] })).rejects.toMatchObject({ code: -2 })
  })
  it('shows a stable upgrade message and never replays start', async () => {
    install(upgrade)
    await expect(startExam('41')).rejects.toMatchObject({ code: 40901, message: '请更新学员端后再打开此试卷', data: { reason_code: 'CONTENT_VERSION_REQUIRED' } })
    expect(requests).toHaveLength(1)
  })
  it.each(['start', 'recover'] as const)('preserves an active attempt, draft and running clock when %s reports upgrade', async action => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T10:00:00Z'))
    install(() => ok(active()))
    const store = useExamStore(); await store.recover('81'); store.choose('101', 'B'); await store.persistDraft()
    const draft = structuredClone(storage.get('ruleexam:mobile:17:exam-draft:81'))
    vi.setSystemTime(new Date('2026-10-23T10:00:05Z')); await store.tick()
    install(upgrade)
    await expect(store[action](action === 'start' ? '41' : '81')).rejects.toMatchObject({ code: 40901 })
    expect(store.attempt?.record_id).toBe('81'); expect(store.answers).toEqual({ '101': ['B'] }); expect(store.remaining).toBe(55)
    expect(storage.get('ruleexam:mobile:17:exam-draft:81')).toEqual(draft)
    vi.setSystemTime(new Date('2026-10-23T10:00:08Z')); await store.tick(); expect(store.remaining).toBe(52)
  })
  it('submit upgrade preserves the draft and deadline without retrying submission', async () => {
    install(() => ok(active()))
    const store = useExamStore(); await store.recover('81'); store.choose('101', 'A'); await store.persistDraft()
    const before = store.remaining, deadline = store.attempt?.deadline_at
    install(upgrade); await store.submit()
    expect(requests.filter(wire => wire.url.endsWith('/submit'))).toHaveLength(1)
    expect(store.answers).toEqual({ '101': ['A'] }); expect(store.attempt?.deadline_at).toBe(deadline); expect(store.remaining).toBe(before)
    expect(storage.has('ruleexam:mobile:17:exam-draft:81')).toBe(true)
    expect(store.submitError).toBe('请更新学员端后再打开此试卷')
  })
})
