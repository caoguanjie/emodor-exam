import type { ReadonlyContentDoc } from './content'
export type QuestionType = 'single' | 'multiple' | 'judgment'
export type ExamAnswers = Record<string, string[]>
export interface ExamOption { id: string; content: ReadonlyContentDoc }
export interface ExamTakeItem { id: string; type: QuestionType; score: number; stem: ReadonlyContentDoc; options: ExamOption[]; imageOptions?: boolean; content_schema_version?: 2 | 3 }
// Review data is deliberately separate from the in-exam payload.
export interface ExamReviewItem { item: ExamTakeItem; correctOptionIds: string[]; selectedOptionIds: string[]; earnedScore: number; analysis: ReadonlyContentDoc; source: string }
export const questionTypeLabels: Record<QuestionType, string> = { single: '单选题', multiple: '多选题', judgment: '判断题' }
export function toggleOption(answers: ExamAnswers, itemId: string, optionId: string, type: QuestionType): ExamAnswers {
  if (!itemId || !optionId) return answers
  const previous = answers[itemId] || []
  return { ...answers, [itemId]: type === 'multiple'
    ? previous.includes(optionId) ? previous.filter(id => id !== optionId) : [...previous, optionId]
    : [optionId] }
}
export const selectOption = toggleOption
export function countAnswered(answers: ExamAnswers): number { return Object.values(answers).filter(ids => ids.length > 0).length }
/** Scores may include partial credit; only equal stable-ID sets are fully correct. */
export function areOptionIdsCorrect(selected: string[], correct: string[]): boolean {
  return selected.length > 0 && selected.length === correct.length && new Set(selected).size === selected.length
    && new Set(correct).size === correct.length && selected.every(id => correct.includes(id))
}

export interface AttemptQuestionV2 { item_id: string; type: QuestionType; score: number; stem: ReadonlyContentDoc; options: ExamOption[]; content_schema_version?: 2 | 3 }
export type AttemptTerminalStatus = 'submitted' | 'passed' | 'failed' | 'timeout'
export interface AttemptRecordViewV2 { status: 'in_progress' | AttemptTerminalStatus; record_id: string; paper_id: string; release_id: string | null; deadline_at: string; server_now: string; questions: AttemptQuestionV2[] }
export interface SubmitAttemptRequest { record_id: string; answers: { item_id: string; option_ids: string[] }[] }
export interface FinalResultItemV2 extends AttemptQuestionV2 { selected_option_ids: string[]; correct_option_ids: string[]; analysis: ReadonlyContentDoc | null; gained_score: number }
export interface FinalResultView { record_id: string; status: AttemptTerminalStatus; grading_state: 'finalized' | 'not_submitted'; submission_method: 'manual' | 'timeout' | null; legacy: boolean; submitted_at: string | null; graded_at: string | null; score: number | null; passed: boolean | null; correct_rate: number | null; items: FinalResultItemV2[] }
export interface ExamListItem { paper_id: string; title: string; mode: string; status: string; source: 'institution' | 'external' | null; category_id: string | null; difficulty: string }
export interface ExamHistoryItemV2 { record_id: string; paper_id: string; paper_title: string | null; attempt_no: number; status: 'in_progress' | AttemptTerminalStatus; grading_state: 'not_submitted' | 'finalized'; submission_method: 'manual' | 'timeout' | null; legacy: boolean; source: 'institution' | 'external' | null; difficulty: string; score: number | null; started_at: string; submitted_at: string | null; graded_at: string | null }
export interface WrongItemV2 extends FinalResultItemV2 { record_id: string; submitted_at: string; legacy: boolean }
function hasImage(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const value = node as { type?: string; content?: unknown[] }
  return value.type === 'image' || !!value.content?.some(hasImage)
}
export function takeItem(item: AttemptQuestionV2): ExamTakeItem { return { id: item.item_id, type: item.type, score: item.score, stem: item.stem, options: item.options, content_schema_version: item.content_schema_version ?? 2, imageOptions: item.options.length > 0 && item.options.every(option => hasImage(option.content)) } }
export function reviewItem(item: FinalResultItemV2): ExamReviewItem { return { item: takeItem(item), correctOptionIds: item.correct_option_ids, selectedOptionIds: item.selected_option_ids, earnedScore: item.gained_score, analysis: item.analysis || { type: 'doc', content: [] }, source: '' } }
export const attemptStatusLabels: Record<'in_progress' | AttemptTerminalStatus, string> = { in_progress: '答题中', submitted: '历史结果待确认', passed: '已通过', failed: '未通过', timeout: '超时未交卷' }
export function examHistoryStatusLabel(record: Pick<ExamHistoryItemV2, 'status' | 'grading_state' | 'submitted_at' | 'score'>): string {
  if (record.status === 'timeout' && record.grading_state === 'finalized' && typeof record.submitted_at === 'string'
    && Number.isFinite(Date.parse(record.submitted_at)) && typeof record.score === 'number' && Number.isFinite(record.score)) return '历史超时交卷'
  return attemptStatusLabels[record.status]
}
