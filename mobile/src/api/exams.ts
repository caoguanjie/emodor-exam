import { ApiError, request } from './client'
import { validateReadonlyDoc } from '@/types/content'
import { validateRichDocV3 } from '@/types/content-v3'
import type { Page } from './courses'
import type { AttemptQuestionV2, AttemptRecordViewV2, ExamHistoryItemV2, ExamListItem, ExamListState, LearnerExamSummary, FinalResultView, SubmitAttemptRequest, WrongItemV2 } from '@/types/exam'

const id = (value: string) => encodeURIComponent(value)
export const QUESTION_CONTENT_HEADERS = { 'X-Question-Content-Version': '3' }
function upgradeMessage(error: unknown): never {
  if (error instanceof ApiError && error.code === 40901 && object(error.data) && error.data.reason_code === 'CONTENT_VERSION_REQUIRED') {
    throw new ApiError(error.code, '请更新学员端后再打开此试卷', error.data, error.status)
  }
  throw error
}
export function getExams(page = 1, state: ExamListState = 'all') { return request<Page<ExamListItem>>({ url: `/me/exams?page=${page}&page_size=10&state=${state}` }).then(value => {
  if (!object(value) || !Array.isArray(value.items) || !value.items.every(validSummary)) throw contractError()
  return value
}) }
export function getExamSummary(paper: string) {
  return request<LearnerExamSummary>({ url: `/me/exams/${id(paper)}` }).then(value => {
    if (!validSummary(value) || value.paper_id !== paper) throw contractError()
    if (value.learning !== undefined && (!object(value.learning) || !Array.isArray(value.learning.courses)
      || !['required_learning_minutes', 'credited_seconds', 'remaining_seconds'].every(field => {
        const amount = (value.learning as unknown as Record<string, unknown>)[field]
        return amount === null || typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
      })
      || !value.learning.courses.every(course => object(course) && typeof course.id === 'string' && /^[1-9]\d*$/.test(course.id) && (course.title === null || typeof course.title === 'string') && typeof course.available === 'boolean'))) throw contractError()
    return value
  })
}
export function startExam(paper: string, expectedReleaseId?: string) { return request<AttemptRecordViewV2>({ url: `/me/exams/${id(paper)}/start`, method: 'POST', data: expectedReleaseId === undefined ? {} : { expected_release_id: expectedReleaseId }, headers: QUESTION_CONTENT_HEADERS }).then(validateAttempt).then(value => { if (value.paper_id !== paper) throw contractError(); return value }).catch(upgradeMessage) }
export function getAttempt(record: string) { return request<AttemptRecordViewV2>({ url: `/me/exam-records/${id(record)}`, headers: QUESTION_CONTENT_HEADERS }).then(validateAttempt).then(value => { if (value.record_id !== record) throw contractError(); return value }).catch(upgradeMessage) }
export function submitExam(body: SubmitAttemptRequest) { return request<FinalResultView>({ url: `/me/exam-records/${id(body.record_id)}/submit`, method: 'POST', data: body, headers: QUESTION_CONTENT_HEADERS }).then(value => matchingResult(value, body.record_id)).catch(upgradeMessage) }
export function getExamResult(record: string) { return request<FinalResultView>({ url: `/me/exam-records/${id(record)}/result`, headers: QUESTION_CONTENT_HEADERS }).then(value => matchingResult(value, record)).catch(upgradeMessage) }
export function getExamHistory(page = 1) { return request<Page<ExamHistoryItemV2>>({ url: `/me/exam-records?page=${page}&page_size=10` }).then(value => {
  if (!object(value) || !Array.isArray(value.items) || !value.items.every(item => object(item) && validRecordSource(item))) throw contractError()
  return value
}) }
export function getWrongQuestions(page = 1) { return request<Page<WrongItemV2>>({ url: `/me/wrong-questions?page=${page}&page_size=10`, headers: QUESTION_CONTENT_HEADERS }).then(value => {
  if (!object(value) || !Array.isArray(value.items) || !value.items.every(item => object(item) && validReview(item) && validRecordSource(item)
    && (item.paper_title === undefined || item.paper_title === null || typeof item.paper_title === 'string')
    && (item.exam_purpose !== 'practice' || item.paper_title === null || typeof item.paper_title === 'string'))) throw contractError()
  return value
}).catch(upgradeMessage) }
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[1-9]\d*$/.test(value) }
function validPurpose(value: Record<string, unknown>): boolean { return value.exam_purpose === undefined || value.exam_purpose === 'formal' || value.exam_purpose === 'practice' }
function validRecordSource(value: Record<string, unknown>): boolean {
  return validPurpose(value) && (value.paper_id === undefined || validId(value.paper_id)) && (value.exam_purpose !== 'practice' || validId(value.paper_id))
}
function validSummary(value: unknown): value is LearnerExamSummary {
  if (!object(value) || !validId(value.paper_id) || typeof value.title !== 'string' || typeof value.status !== 'string' || !validPurpose(value)
    || value.attempt_limit_kind !== undefined && !['limited', 'unlimited', 'unknown'].includes(value.attempt_limit_kind as string)
    || value.release_id !== undefined && value.release_id !== null && !validId(value.release_id)) return false
  if (value.exam_purpose === 'practice') return value.attempt_limit_kind === 'unlimited' && value.max_attempts === null && value.attempts_remaining === null
    && (validId(value.release_id) || value.release_id === null && value.status !== 'published' && !value.active_record_id)
  return value.attempt_limit_kind !== 'unlimited'
}
function contractError() { return new ApiError(-2, '考试数据不一致，请重新查询状态') }
function matchingResult(value: FinalResultView, record: string) {
  if (!object(value) || value.record_id !== record || !validRecordSource(value) || !['submitted', 'passed', 'failed', 'timeout'].includes(value.status) || !Array.isArray(value.items) || !value.items.every(validReview)) throw contractError()
  return value
}
function keys(v: Record<string, unknown>, fields: string[]) { return Object.keys(v).length === fields.length && Object.keys(v).every(k => fields.includes(k)) }
function contentVersion(q: Record<string, unknown>): 2 | 3 | null {
  return !Object.prototype.hasOwnProperty.call(q, 'content_schema_version') ? 2 : q.content_schema_version === 2 || q.content_schema_version === 3 ? q.content_schema_version : null
}
function validDoc(value: unknown, version: 2 | 3 | null): boolean {
  if (version === 2) return validateReadonlyDoc(value, { decimalAssetIds: true }).ok
  if (version !== 3) return false
  try { validateRichDocV3(value); return true } catch { return false }
}
function validQuestionContent(q: Record<string, unknown>): boolean {
  const version = contentVersion(q)
  return typeof q.item_id === 'string' && /^[1-9]\d*$/.test(q.item_id)
    && ['single', 'multiple', 'judgment'].includes(q.type as string) && typeof q.score === 'number' && Number.isFinite(q.score) && q.score >= 0
    && validDoc(q.stem, version) && Array.isArray(q.options) && q.options.length >= 2
    && q.options.every(o => object(o) && keys(o, ['id', 'content']) && typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) && validDoc(o.content, version))
    && new Set(q.options.map(o => o.id)).size === q.options.length
}
function validReview(q: unknown): boolean {
  return object(q) && validQuestionContent(q) && (q.analysis === null || validDoc(q.analysis, contentVersion(q)))
}
function validQuestion(q: unknown): q is AttemptQuestionV2 {
  return object(q) && keys(q, ['item_id', 'type', 'score', 'stem', 'options', ...(Object.prototype.hasOwnProperty.call(q, 'content_schema_version') ? ['content_schema_version'] : [])]) && validQuestionContent(q)
}
export function validateAttempt(value: AttemptRecordViewV2): AttemptRecordViewV2 {
  if (!object(value) || !keys(value, ['status', 'record_id', 'paper_id', 'release_id', 'deadline_at', 'server_now', 'questions', ...(Object.prototype.hasOwnProperty.call(value, 'exam_purpose') ? ['exam_purpose'] : [])]) || !validPurpose(value)
    || !['in_progress', 'submitted', 'passed', 'failed', 'timeout'].includes(value.status) || typeof value.record_id !== 'string' || !/^[1-9]\d*$/.test(value.record_id) || typeof value.paper_id !== 'string' || !/^[1-9]\d*$/.test(value.paper_id)
    || !(value.release_id === null || typeof value.release_id === 'string' && /^[1-9]\d*$/.test(value.release_id))
    || value.exam_purpose === 'practice' && value.release_id === null
    || typeof value.deadline_at !== 'string' || typeof value.server_now !== 'string' || !Number.isFinite(Date.parse(value.deadline_at)) || !Number.isFinite(Date.parse(value.server_now)) || !Array.isArray(value.questions)
    || (value.status === 'in_progress' ? !value.questions.length || !value.questions.every(validQuestion) || new Set(value.questions.map(q => q.item_id)).size !== value.questions.length : value.questions.length !== 0)) {
    throw new ApiError(-2, '考试题目数据无效，请重新加载')
  }
  return value
}
