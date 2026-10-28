import type { ExamListItem, FinalResultView } from '@/types/exam'

export function examNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : '—'
}
export function examAttemptsLabel(exam: ExamListItem): string | null {
  if (exam.exam_purpose === 'practice' && exam.attempt_limit_kind === 'unlimited') return '不限次数'
  const used = exam.attempts_used
  if (exam.attempt_limit_kind === 'unknown') return typeof used === 'number' && Number.isSafeInteger(used) && used >= 0 ? `已用 ${used} 次 · 次数上限待确认` : '次数上限待确认'
  return typeof used === 'number' && Number.isSafeInteger(used) && used >= 0 ? `已用 ${used}/${examNumber(exam.max_attempts)} 次` : null
}
export function examStatusLabel(exam: ExamListItem): string {
  const label = ({ published: '已发布', withdrawn: '已撤回', archived: '已归档', draft: '草稿' } as Record<string, string>)[exam.status] || '已结束'
  return exam.active_record_id ? exam.status === 'published' ? '答题中' : `${label} · 答题中` : label
}
export function examEntry(exam: ExamListItem): { kind: 'resume' | 'instructions' | 'records'; label: string; url: string } {
  if (exam.active_record_id) return { kind: 'resume', label: '继续答题', url: `/pages/exam/take?record_id=${encodeURIComponent(exam.active_record_id)}` }
  if (exam.status === 'published' && (exam.exam_purpose === 'practice' && exam.attempt_limit_kind === 'unlimited' || exam.attempts_remaining !== 0)) return { kind: 'instructions', label: '查看须知 ›', url: `/pages/exam/instructions?paper_id=${encodeURIComponent(exam.paper_id)}` }
  return { kind: 'records', label: exam.attempts_remaining === 0 ? '查看历史成绩' : '查看记录', url: exam.latest_record_id ? `/pages/exam/result?record_id=${encodeURIComponent(exam.latest_record_id)}` : '/pages/profile/exam-history' }
}
export function practiceRetryUrl(result: FinalResultView | null): string | null {
  return result?.exam_purpose === 'practice' && typeof result.paper_id === 'string' && /^[1-9]\d*$/.test(result.paper_id)
    ? `/pages/exam/instructions?paper_id=${encodeURIComponent(result.paper_id)}` : null
}
