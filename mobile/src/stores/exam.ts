import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ApiError } from '@/api/client'
import { getAttempt, getExamHistory, getExamResult, getExams, getWrongQuestions, startExam, submitExam } from '@/api/exams'
import { getMediaTicket } from '@/api/media'
import type { Page } from '@/api/courses'
import { resolveMediaUrl } from '@/platform/media-url'
import { clearDraft, loadDraft, saveDraft } from '@/utils/exam-draft'
import { createServerClock } from '@/utils/server-clock'
import { countAnswered, takeItem, toggleOption, type AttemptQuestionV2, type AttemptRecordViewV2, type ExamAnswers, type ExamHistoryItemV2, type ExamListItem, type FinalResultView, type SubmitAttemptRequest, type WrongItemV2 } from '@/types/exam'
import { useSessionStore } from './session'

type Phase = 'idle' | 'loading' | 'answering' | 'submitting' | 'uncertain' | 'expired' | 'terminal' | 'error'
interface AttemptFlight { revision: number; recordId: string; promise: Promise<void> }
const emptyPage = <T>(): Page<T> => ({ items: [], total: 0, page: 0, page_size: 10 })
const message = (error: unknown) => error instanceof Error ? error.message : '加载失败，请重试'
function imageIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const node = value as { type?: string; attrs?: { asset_id?: string }; content?: unknown[] }
  return node.type === 'image' && node.attrs?.asset_id ? [node.attrs.asset_id] : (node.content || []).flatMap(imageIds)
}

export const useExamStore = defineStore('mobile-exam', () => {
  const session = useSessionStore()
  const attempt = ref<AttemptRecordViewV2 | null>(null), questions = ref<AttemptQuestionV2[]>([]), answers = ref<ExamAnswers>({})
  const currentIndex = ref(0), phase = ref<Phase>('idle'), remaining = ref(0), result = ref<FinalResultView | null>(null)
  const loadError = ref(''), submitError = ref(''), draftError = ref(''), savedAt = ref(''), draftRestored = ref(false), draftDiscarded = ref(false)
  const identityReason = ref(''), assets = ref<Record<string, Record<string, string>>>({}), mediaErrors = ref<Record<string, Record<string, string>>>({})
  const list = ref(emptyPage<ExamListItem>()), history = ref(emptyPage<ExamHistoryItemV2>()), wrong = ref(emptyPage<WrongItemV2>())
  const listLoading = ref(false), historyLoading = ref(false), wrongLoading = ref(false)
  const listError = ref(''), historyError = ref(''), wrongError = ref('')
  const items = computed(() => questions.value.map(takeItem)), answered = computed(() => countAnswered(answers.value))
  const locked = computed(() => phase.value !== 'answering' || remaining.value <= 0)
  let revision = 0, persistRevision = 0, mediaRevision = 0, ownerUser = '', clock: ReturnType<typeof createServerClock> | null = null
  let frozenPayload: SubmitAttemptRequest | null = null, submitFlight: AttemptFlight | null = null, statusFlight: AttemptFlight | null = null
  let expiredChecked = false, listRevision = 0, historyRevision = 0, wrongRevision = 0
  const mediaFlights = new Map<string, Promise<void>>()

  function resetMemory() {
    revision++; persistRevision++; mediaRevision++; listRevision++; historyRevision++; wrongRevision++
    attempt.value = null; questions.value = []; answers.value = {}; assets.value = {}; mediaErrors.value = {}; currentIndex.value = 0
    result.value = null; remaining.value = 0; phase.value = 'idle'; loadError.value = ''; submitError.value = ''; draftError.value = ''; savedAt.value = ''
    identityReason.value = ''; draftRestored.value = false; draftDiscarded.value = false; ownerUser = ''; clock = null; frozenPayload = null
    submitFlight = null; statusFlight = null; expiredChecked = false; mediaFlights.clear()
    list.value = emptyPage(); history.value = emptyPage(); wrong.value = emptyPage()
    listLoading.value = false; historyLoading.value = false; wrongLoading.value = false; listError.value = ''; historyError.value = ''; wrongError.value = ''
  }
  watch(() => session.sessionEpoch, resetMemory, { flush: 'sync' })
  async function ready() {
    if (!session.initialized && !await session.bootstrap()) throw new ApiError(40107, '请先登录')
    if (!session.accessToken || !session.user) throw new ApiError(40107, '请先登录')
  }
  function identity(error: unknown) {
    if (!(error instanceof ApiError) || error.code !== 40302 || !error.data || typeof error.data !== 'object') return
    const reason = (error.data as { reason_code?: string }).reason_code
    if (reason === 'IDENTITY_PENDING' || reason === 'IDENTITY_REQUIRED') {
      identityReason.value = reason
      loadError.value = reason === 'IDENTITY_PENDING' ? '实名认证正在处理中，请稍后查看' : '完成实名认证后即可参加考试'
    }
  }
  function same(current: number, epoch: number) { return current === revision && epoch === session.sessionEpoch }
  function currentFlight(flight: AttemptFlight | null) { return flight?.revision === revision && flight.recordId === attempt.value?.record_id }
  function calibrate(view: AttemptRecordViewV2) {
    clock = createServerClock(view.deadline_at, view.server_now)
    remaining.value = clock.remainingSeconds()
  }
  async function terminal(view: AttemptRecordViewV2, current: number, epoch: number) {
    if (!same(current, epoch)) return
    mediaRevision++; mediaFlights.clear()
    attempt.value = view; phase.value = 'terminal'; questions.value = []; answers.value = {}; assets.value = {}; mediaErrors.value = {}; frozenPayload = null; remaining.value = 0
    const user = ownerUser
    if (user) { try { await clearDraft(user, view.record_id) } catch (error) { if (same(current, epoch)) draftError.value = message(error) } }
    if (!same(current, epoch)) return
    const value = await getExamResult(view.record_id)
    if (same(current, epoch)) result.value = value
  }
  async function open(load: () => Promise<AttemptRecordViewV2>) {
    const current = ++revision
    mediaRevision++
    questions.value = []; assets.value = {}; answers.value = {}; result.value = null; attempt.value = null; currentIndex.value = 0
    phase.value = 'loading'; loadError.value = ''; identityReason.value = ''; savedAt.value = ''; draftError.value = ''; draftRestored.value = false; draftDiscarded.value = false
    frozenPayload = null; submitFlight = null; statusFlight = null; clock = null; remaining.value = 0; expiredChecked = false; mediaFlights.clear()
    let epoch = session.sessionEpoch
    try {
      await ready(); epoch = session.sessionEpoch
      if (current !== revision) return
      ownerUser = String(session.user!.id)
      const value = await load()
      if (!same(current, epoch)) return
      attempt.value = value; calibrate(value)
      if (value.status !== 'in_progress') { await terminal(value, current, epoch); return }
      const draft = await loadDraft(ownerUser, value.record_id, value.questions)
      if (!same(current, epoch)) return
      questions.value = value.questions
      answers.value = Object.fromEntries(value.questions.map(q => [q.item_id, draft?.answers[q.item_id] || []]))
      currentIndex.value = draft?.currentIndex || 0; savedAt.value = draft?.savedAt || ''; draftRestored.value = !!draft
      // A missing or corrupt snapshot follows the same safe empty-answer recovery.
      draftDiscarded.value = !draft
      phase.value = remaining.value > 0 ? 'answering' : 'expired'
      if (remaining.value === 0) await queryStatus()
    } catch (error) {
      if (same(current, epoch)) { phase.value = 'error'; loadError.value = message(error); identity(error) }
      throw error
    }
  }
  const start = (paper: string) => open(() => startExam(paper))
  const recover = (record: string) => open(() => getAttempt(record))

  async function persistDraft() {
    if (!ownerUser || !attempt.value || attempt.value.status !== 'in_progress' || !questions.value.length) return
    const current = revision, epoch = session.sessionEpoch, save = ++persistRevision, time = new Date().toISOString()
    const snapshot = { answers: Object.fromEntries(Object.entries(answers.value).map(([key, value]) => [key, [...value]])), currentIndex: currentIndex.value, savedAt: time }
    try {
      await saveDraft(ownerUser, attempt.value.record_id, snapshot)
      if (same(current, epoch) && save === persistRevision) { savedAt.value = time; draftError.value = '' }
    } catch (error) { if (same(current, epoch) && save === persistRevision) draftError.value = message(error) }
  }
  function choose(itemId: string, optionId: string) {
    if (locked.value) return
    const item = questions.value.find(q => q.item_id === itemId)
    if (!item?.options.some(o => o.id === optionId)) return
    answers.value = toggleOption(answers.value, itemId, optionId, item.type)
    void persistDraft()
  }
  function jump(index: number) {
    if (locked.value || !Number.isInteger(index) || index < 0 || index >= questions.value.length) return
    currentIndex.value = index; void persistDraft()
  }
  async function queryStatus() {
    if (currentFlight(statusFlight)) return statusFlight!.promise
    if (!attempt.value) return
    const current = revision, epoch = session.sessionEpoch, record = attempt.value.record_id
    const pending = (async () => {
      try {
        const value = await getAttempt(record)
        if (!same(current, epoch)) return
        if (value.status !== 'in_progress') await terminal(value, current, epoch)
        else {
          if (value.record_id !== record || value.deadline_at !== attempt.value?.deadline_at) throw new ApiError(-2, '考试状态不一致，请重新进入')
          calibrate(value)
          if (remaining.value === 0 && phase.value !== 'uncertain' && phase.value !== 'submitting') phase.value = 'expired'
        }
      } catch (error) {
        if (same(current, epoch)) { submitError.value = message(error); identity(error) }
        throw error
      }
    })().finally(() => { if (statusFlight?.promise === pending) statusFlight = null })
    statusFlight = { revision: current, recordId: record, promise: pending }
    return pending
  }
  async function tick() {
    if (!clock || !attempt.value || attempt.value.status !== 'in_progress') return
    remaining.value = clock.remainingSeconds()
    if (remaining.value === 0 && !expiredChecked) {
      expiredChecked = true
      if (phase.value === 'answering') phase.value = 'expired'
      try { await queryStatus() } catch { /* A visible retry is offered; no submission is triggered. */ }
    }
  }
  async function resolveUncertain(allowRetry: boolean, current: number, epoch: number) {
    if (!same(current, epoch)) return
    phase.value = 'uncertain'
    try { await queryStatus() } catch { return }
    if (!same(current, epoch) || attempt.value?.status !== 'in_progress') return
    if (attempt.value?.status === 'in_progress' && remaining.value > 0 && allowRetry && frozenPayload) {
      await sendFrozen(false, current, epoch)
    }
  }
  async function sendFrozen(allowRetry: boolean, current: number, epoch: number) {
    if (!frozenPayload || !same(current, epoch)) return
    phase.value = 'submitting'; submitError.value = ''
    try {
      const value = await submitExam(frozenPayload)
      if (!same(current, epoch)) return
      const view = { ...attempt.value!, status: value.status, questions: [] }
      // The accepted result is already authoritative; do not refetch it before cleanup.
      mediaRevision++; mediaFlights.clear()
      attempt.value = view; result.value = value; phase.value = 'terminal'; questions.value = []; answers.value = {}; assets.value = {}; mediaErrors.value = {}; frozenPayload = null
      try { await clearDraft(ownerUser, value.record_id) } catch (error) { if (same(current, epoch)) draftError.value = message(error) }
    } catch (error) {
      if (!same(current, epoch)) return
      submitError.value = message(error); identity(error)
      // Even a rejected response can follow a successful earlier request. Resolve by record.
      await resolveUncertain(allowRetry && error instanceof ApiError && (error.code < 0 || error.status >= 500), current, epoch)
    }
  }
  function submit(): Promise<void> {
    if (currentFlight(submitFlight)) return submitFlight!.promise
    if (locked.value || !attempt.value) return Promise.resolve()
    frozenPayload = { record_id: attempt.value.record_id, answers: questions.value.map(q => ({ item_id: q.item_id, option_ids: [...(answers.value[q.item_id] || [])] })) }
    const current = revision, epoch = session.sessionEpoch
    const pending = sendFrozen(true, current, epoch).finally(() => { if (submitFlight?.promise === pending) submitFlight = null })
    submitFlight = { revision: current, recordId: attempt.value.record_id, promise: pending }; return pending
  }
  function retrySubmission(): Promise<void> {
    if (currentFlight(submitFlight)) return submitFlight!.promise
    if (phase.value !== 'uncertain' || !frozenPayload) return Promise.resolve()
    const current = revision, epoch = session.sessionEpoch
    // An explicit retry still checks authority before sending the same frozen sheet.
    const pending = resolveUncertain(true, current, epoch).finally(() => { if (submitFlight?.promise === pending) submitFlight = null })
    submitFlight = { revision: current, recordId: frozenPayload.record_id, promise: pending }; return pending
  }
  async function loadResult(record: string) {
    const current = ++revision; submitFlight = null; statusFlight = null; frozenPayload = null; mediaRevision++; mediaFlights.clear(); result.value = null; attempt.value = null; questions.value = []; assets.value = {}; mediaErrors.value = {}; phase.value = 'loading'; loadError.value = ''
    let epoch = session.sessionEpoch
    try {
      await ready(); epoch = session.sessionEpoch; if (current !== revision) return
      ownerUser = String(session.user!.id)
      const value = await getExamResult(record)
      if (!same(current, epoch)) return
      result.value = value; phase.value = 'terminal'
      try { await clearDraft(ownerUser, record) } catch (error) { if (same(current, epoch)) draftError.value = message(error) }
    } catch (error) { if (same(current, epoch)) { phase.value = 'error'; loadError.value = message(error) }; throw error }
  }
  async function loadItemMedia(itemId: string, wrongRecord?: string) {
    const scope = wrongRecord ? `wrong:${wrongRecord}:${itemId}` : `${attempt.value?.record_id || result.value?.record_id}:${itemId}`
    if (mediaFlights.has(scope)) return mediaFlights.get(scope)
    const question = questions.value.find(q => q.item_id === itemId) || result.value?.items.find(q => q.item_id === itemId) || wrong.value.items.find(q => q.item_id === itemId && q.record_id === wrongRecord)
    if (!question) return
    const current = revision, epoch = session.sessionEpoch, media = mediaRevision
    const currentMedia = () => same(current, epoch) && media === mediaRevision
    const ids = [...new Set([...imageIds(question.stem), ...question.options.flatMap(o => imageIds(o.content)), ...('analysis' in question ? imageIds(question.analysis) : [])])]
    const pending = (async () => {
      await Promise.all(ids.map(async asset => {
        try {
          const ticket = await getMediaTicket(asset, 'exam_record_question', itemId)
          if (currentMedia()) {
            assets.value[itemId] = { ...assets.value[itemId], [asset]: resolveMediaUrl(ticket.content_url) }
            if (mediaErrors.value[itemId]) { delete mediaErrors.value[itemId][asset]; if (!Object.keys(mediaErrors.value[itemId]).length) delete mediaErrors.value[itemId] }
          }
        } catch (error) { if (currentMedia()) mediaErrors.value[itemId] = { ...mediaErrors.value[itemId], [asset]: message(error) } }
      }))
    })().finally(() => { if (mediaFlights.get(scope) === pending) mediaFlights.delete(scope) })
    mediaFlights.set(scope, pending); return pending
  }
  async function loadList(page = 1) {
    const current = ++listRevision; listLoading.value = true; listError.value = ''
    try { await ready(); const value = await getExams(page); if (current === listRevision) list.value = { ...value, items: page === 1 ? value.items : [...list.value.items, ...value.items] } }
    catch (error) { if (current === listRevision) listError.value = message(error); throw error }
    finally { if (current === listRevision) listLoading.value = false }
  }
  async function loadHistory(page = 1) {
    const current = ++historyRevision; historyLoading.value = true; historyError.value = ''
    try { await ready(); const value = await getExamHistory(page); if (current === historyRevision) history.value = { ...value, items: page === 1 ? value.items : [...history.value.items, ...value.items] } }
    catch (error) { if (current === historyRevision) historyError.value = message(error); throw error }
    finally { if (current === historyRevision) historyLoading.value = false }
  }
  async function loadWrong(page = 1) {
    const current = ++wrongRevision; wrongLoading.value = true; wrongError.value = ''
    try {
      await ready(); const value = await getWrongQuestions(page)
      if (current !== wrongRevision) return
      wrong.value = { ...value, items: page === 1 ? value.items : [...wrong.value.items, ...value.items] }
      for (const item of value.items) void loadItemMedia(item.item_id, item.record_id)
    } catch (error) { if (current === wrongRevision) wrongError.value = message(error); throw error }
    finally { if (current === wrongRevision) wrongLoading.value = false }
  }
  return { attempt, questions, items, answers, currentIndex, phase, remaining, result, loadError, submitError, draftError, savedAt, draftRestored, draftDiscarded, identityReason, assets, mediaErrors,
    list, history, wrong, listLoading, historyLoading, wrongLoading, listError, historyError, wrongError, locked, answered,
    start, recover, choose, jump, persistDraft, tick, queryStatus, submit, retrySubmission, loadResult, loadItemMedia, loadList, loadHistory, loadWrong }
})
