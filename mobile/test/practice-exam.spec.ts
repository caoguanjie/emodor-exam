import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getAttempt, getExamHistory, getExamResult, getExamSummary, getExams, getWrongQuestions, startExam, submitExam } from '../src/api/exams'
import { useExamStore } from '../src/stores/exam'
import { useLearnerStore } from '../src/stores/learner'
import { useSessionStore } from '../src/stores/session'
import { reviewItem } from '../src/types/exam'
import { practiceRetryUrl } from '../src/utils/exam-summary'

type Wire = { url: string; method: string; data?: unknown; success(value: unknown): void; fail(value: unknown): void }
const calls: Wire[] = [], storage = new Map<string, unknown>()
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本次模拟题' }] }] }
const question = { item_id: '101', type: 'single' as const, score: 10, stem: doc, options: [{ id: 'a', content: doc }, { id: 'b', content: doc }] }
const review = { ...question, selected_option_ids: ['b'], correct_option_ids: ['a'], gained_score: 0, analysis: null }
const practice = {
  paper_id: '901', title: '模拟考 · 公共随机考试', mode: 'random', status: 'published', source: 'external', category_id: null, difficulty: 'hard',
  exam_purpose: 'practice', release_id: '71', attempt_limit_kind: 'unlimited', attempts_used: 100, max_attempts: null, attempts_remaining: null,
  total_score: 10, pass_score: 6, duration_minutes: 30, question_count: 1, active_record_id: null, latest_record_id: '80',
  learning: { required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] },
}
const active = () => ({
  status: 'in_progress', record_id: '81', paper_id: '901', exam_purpose: 'practice', release_id: '71',
  deadline_at: new Date(Date.now() + 60_000).toISOString(), server_now: new Date().toISOString(), questions: [question],
})
const result = {
  record_id: '81', paper_id: '901', exam_purpose: 'practice', status: 'failed', grading_state: 'finalized', submission_method: 'manual', legacy: false,
  submitted_at: '2026-10-28T08:00:00Z', graded_at: '2026-10-28T08:00:00Z', score: 0, passed: false, correct_rate: 0, items: [review], total_score: 10, pass_score: 6,
}
const wrong = { ...review, record_id: '81', paper_id: '901', paper_title: '模拟考 v1 冻结题单', exam_purpose: 'practice', submitted_at: result.submitted_at, legacy: false }
const history = { record_id: '81', paper_id: '901', paper_title: practice.title, exam_purpose: 'practice', attempt_no: 101, status: 'failed', grading_state: 'finalized', submission_method: 'manual', legacy: false, source: 'external', difficulty: 'hard', score: 0, started_at: '2026-10-28T07:59:00Z', submitted_at: result.submitted_at, graded_at: result.graded_at }
const page = <T>(item: T) => ({ items: [item], total: 1, page: 1, page_size: 10 })
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
function install(handler: (wire: Wire) => unknown) {
  vi.stubGlobal('uni', {
    request(wire: Wire) { calls.push(wire); Promise.resolve().then(() => handler(wire)).then(wire.success, wire.fail) }, reLaunch: vi.fn(),
    getStorage: (o: any) => storage.has(o.key) ? o.success({ data: structuredClone(storage.get(o.key)) }) : o.fail({}),
    setStorage: (o: any) => { storage.set(o.key, structuredClone(o.data)); o.success({}) },
    removeStorage: (o: any) => { storage.delete(o.key); o.success({}) },
  })
}
beforeEach(() => {
  setActivePinia(createPinia()); calls.length = 0; storage.clear()
  useLearnerStore().user = { id: 17, username: 'learner', real_name: '学员', phone_masked: '138****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'verified' }
  useSessionStore().$patch({ accessToken: 'memory', initialized: true })
})

describe('practice exam release confirmation and record contracts', () => {
  it('sends the displayed release on an explicit start and retains the practice record purpose', async () => {
    install(() => ok(active()))
    const store = useExamStore()
    await store.start('901', '71')
    expect(calls[0]?.data).toEqual({ expected_release_id: '71' })
    expect(store.attempt).toMatchObject({ record_id: '81', release_id: '71', exam_purpose: 'practice' })
    store.choose('101', 'b'); await store.persistDraft()
    expect(storage.has('ruleexam:mobile:17:exam-draft:81')).toBe(true)
    expect(storage.has('ruleexam:mobile:17:exam-draft:901')).toBe(false)
  })

  it('refreshes outdated instructions after 40970 without replaying start', async () => {
    const store = useExamStore(); let release = '71'
    install(wire => wire.url.endsWith('/start')
      ? { statusCode: 409, data: { code: 40970, message: '配置冲突', data: null } }
      : ok({ ...practice, release_id: release }))
    await store.loadSummary('901'); release = '72'
    await expect(store.start('901', '71')).rejects.toMatchObject({ code: 40970 })
    expect(store.summary).toMatchObject({ release_id: '72' })
    expect(store.loadError).toBe('模拟考试配置已更新，请确认后再开始')
    expect(store.attempt).toBeNull()
    expect(calls.filter(wire => wire.url.endsWith('/start'))).toHaveLength(1)
  })

  it('clears the stale instructions when their conflict refresh fails', async () => {
    const store = useExamStore()
    install(() => ok(practice)); await store.loadSummary('901')
    install(wire => {
      if (wire.url.endsWith('/start')) return { statusCode: 409, data: { code: 40970, message: '配置冲突', data: null } }
      throw new Error('offline')
    })
    await expect(store.start('901', '71')).rejects.toMatchObject({ code: 40970 })
    expect(store.summary).toBeNull(); expect(store.summaryError).toContain('网络')
    expect(calls.filter(wire => wire.url.endsWith('/start'))).toHaveLength(1)
  })

  it('a late practice conflict cannot replace the newer instructions for another paper', async () => {
    let finishStart: (value: unknown) => void = () => {}
    const otherPaper = { ...practice, paper_id: '902', release_id: '91', title: 'B 卷当前须知' }
    install(wire => wire.url.endsWith('/start') ? new Promise(resolve => { finishStart = resolve })
      : ok(wire.url.endsWith('/exams/902') ? otherPaper : practice))
    const store = useExamStore()
    await store.loadSummary('901')
    const pending = store.start('901', '71')
    await vi.waitFor(() => expect(calls.filter(wire => wire.url.endsWith('/start'))).toHaveLength(1))
    await store.loadSummary('902')
    const rejected = expect(pending).rejects.toMatchObject({ code: 40970 })
    finishStart({ statusCode: 409, data: { code: 40970, message: 'A 卷配置已更新', data: null } })
    await rejected
    expect(store.summary).toEqual(otherPaper)
    expect(calls.filter(wire => wire.url.endsWith('/exams/901'))).toHaveLength(1)
    expect(calls.filter(wire => wire.url.endsWith('/start'))).toHaveLength(1)
  })

  it('a late practice conflict does not reload instructions after their page has left', async () => {
    let finishStart: (value: unknown) => void = () => {}, pageActive = true
    install(wire => wire.url.endsWith('/start') ? new Promise(resolve => { finishStart = resolve })
      : ok(wire.url.includes('/exams?') ? page(practice) : practice))
    const store = useExamStore()
    await store.loadSummary('901')
    const pending = store.start('901', '71', () => pageActive)
    await vi.waitFor(() => expect(calls.filter(wire => wire.url.endsWith('/start'))).toHaveLength(1))
    pageActive = false
    await store.loadList()
    const rejected = expect(pending).rejects.toMatchObject({ code: 40970 })
    finishStart({ statusCode: 409, data: { code: 40970, message: 'A 卷配置已更新', data: null } })
    await rejected
    expect(calls.filter(wire => wire.url.endsWith('/exams/901'))).toHaveLength(1)
    expect(calls.filter(wire => wire.url.endsWith('/start'))).toHaveLength(1)
    expect(store.list.items).toMatchObject([{ paper_id: '901' }])
  })

  it('accepts recovery of the active release even when the expected new release differs', async () => {
    install(() => ok(active()))
    const store = useExamStore()
    await store.start('901', '72')
    expect(store.attempt?.release_id).toBe('71')
    expect(calls).toHaveLength(1)
  })

  it('drops a pending practice response after switching learner sessions', async () => {
    let finish: (value: unknown) => void = () => {}
    install(() => new Promise(resolve => { finish = resolve }))
    const store = useExamStore(), pending = store.start('901', '71')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    useSessionStore().expireSession()
    useLearnerStore().user = { id: 18, username: 'other', real_name: '另一学员', phone_masked: '139****0000', role: 'employee', source: 'external', category_id: null, identity_status: 'verified' }
    useSessionStore().accessToken = 'other-memory'
    const rejected = expect(pending).rejects.toMatchObject({ code: 40107 })
    finish(ok(active())); await rejected
    expect(store.attempt).toBeNull(); expect(store.questions).toEqual([]); expect(storage.size).toBe(0)
  })

  it.each(['passed', 'timeout'] as const)('returns a %s practice result to the instructions without a start request', async status => {
    const view = { ...result, status, ...(status === 'timeout' ? { grading_state: 'not_submitted', submission_method: null, submitted_at: null, graded_at: null, score: null, passed: null, correct_rate: null, items: [] } : {}) }
    install(() => ok(view))
    const store = useExamStore(); await store.loadResult('81')
    expect(practiceRetryUrl(store.result)).toBe('/pages/exam/instructions?paper_id=901')
    expect(calls.map(wire => wire.url)).toEqual(['/api/v1/me/exam-records/81/result'])
    expect(store.attempt).toBeNull()
  })

  it('maps wrong-question source from its own record instead of a current summary', async () => {
    install(() => ok(page(wrong)))
    const store = useExamStore(); await store.loadWrong()
    expect(reviewItem(store.wrong.items[0]).source).toBe('模拟考 · 模拟考 v1 冻结题单')
    expect(store.wrong.items[0]).toMatchObject({ record_id: '81', paper_id: '901', exam_purpose: 'practice' })
  })

  it('rejects a practice result without its paper ID rather than guessing a retry destination', async () => {
    const { paper_id: _paper, ...incomplete } = result
    install(() => ok(incomplete))
    await expect(getExamResult('81')).rejects.toMatchObject({ code: -2 })
    await expect(submitExam({ record_id: '81', answers: [] })).rejects.toMatchObject({ code: -2 })
  })

  it.each(['paper_id', 'paper_title'])('rejects practice wrong questions missing %s', async field => {
    const incomplete: Record<string, unknown> = { ...wrong }; delete incomplete[field]
    install(() => ok(page(incomplete)))
    await expect(getWrongQuestions()).rejects.toMatchObject({ code: -2 })
  })

  it('rejects unknown purposes on every exam reader', async () => {
    install(wire => {
      const body = wire.url.includes('wrong-questions') ? page(wrong) : /result|submit/.test(wire.url) ? result
        : wire.url.includes('/me/exam-records?') ? page(history) : wire.url.includes('/me/exams?') ? page(practice)
          : wire.url.endsWith('/exams/901') ? practice : active()
      return ok('items' in body && !('record_id' in body) ? { ...body, items: body.items.map(item => ({ ...item, exam_purpose: 'invalid' })) } : { ...body, exam_purpose: 'invalid' })
    })
    for (const read of [() => startExam('901'), () => getAttempt('81'), () => getExamResult('81'), () => getWrongQuestions(), () => getExamSummary('901'), () => getExams(), () => getExamHistory()]) {
      await expect(read()).rejects.toMatchObject({ code: -2 })
    }
  })

  it.each([
    { attempt_limit_kind: 'limited' }, { max_attempts: 100 }, { attempts_remaining: 0 }, { release_id: undefined }, { attempt_limit_kind: 'invalid' },
  ])('rejects an inconsistent practice summary %j', async fields => {
    install(() => ok({ ...practice, ...fields }))
    await expect(getExamSummary('901')).rejects.toMatchObject({ code: -2 })
  })
})
