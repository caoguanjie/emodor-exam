import { describe, expect, it } from 'vitest'
import type { ExamListItem } from '../src/types/exam'
import { examAttemptsLabel, examEntry } from '../src/utils/exam-summary'

const paper: ExamListItem = {
  paper_id: '901', title: '本人随机考试', mode: 'random', status: 'published', source: 'external',
  category_id: null, difficulty: 'hard', active_record_id: null, latest_record_id: '83',
}

describe('exam attempt quota entry', () => {
  it('opens the owned latest result instead of offering a start when the quota is exhausted', () => {
    expect(examEntry({ ...paper, attempts_used: 3, max_attempts: 3, attempts_remaining: 0 })).toEqual({
      kind: 'records', label: '查看历史成绩', url: '/pages/exam/result?record_id=83',
    })
  })

  it('continues the active attempt even when the final allowed start is already counted', () => {
    expect(examEntry({ ...paper, attempts_used: 3, max_attempts: 3, attempts_remaining: 0, active_record_id: '81' })).toEqual({
      kind: 'resume', label: '继续答题', url: '/pages/exam/take?record_id=81',
    })
  })

  it('keeps another paper with its own quota available', () => {
    expect(examEntry({ ...paper, paper_id: '902', attempts_used: 0, max_attempts: 3, attempts_remaining: 3 }).kind).toBe('instructions')
  })

  it('allows the remaining retakes after a passing result', () => {
    expect(examEntry({ ...paper, attempts_used: 1, max_attempts: 3, attempts_remaining: 2 }).kind).toBe('instructions')
  })

  it('keeps pre-upgrade responses that omit quota fields usable', () => {
    expect(examEntry(paper)).toMatchObject({ kind: 'instructions', url: '/pages/exam/instructions?paper_id=901' })
  })

  it('does not invent a limit for an unknown historical snapshot', () => {
    expect(examEntry({ ...paper, attempts_used: 8, max_attempts: null, attempts_remaining: null }).kind).toBe('instructions')
  })

  it('keeps practice available after 100 attempts and displays its explicit unlimited meaning', () => {
    const practice = { ...paper, exam_purpose: 'practice' as const, attempt_limit_kind: 'unlimited' as const, attempts_used: 100, max_attempts: null, attempts_remaining: null }
    expect(examEntry(practice).kind).toBe('instructions')
    expect(examAttemptsLabel(practice)).toBe('不限次数')
    expect(examEntry({ ...practice, active_record_id: '81' }).kind).toBe('resume')
  })

  it('labels an unknown formal limit without granting unlimited meaning', () => {
    const unknown = { ...paper, exam_purpose: 'formal' as const, attempt_limit_kind: 'unknown' as const, attempts_used: 8, max_attempts: null, attempts_remaining: null }
    expect(examAttemptsLabel(unknown)).toBe('已用 8 次 · 次数上限待确认')
    const inconsistent = { ...unknown, attempt_limit_kind: 'unlimited' as const }
    expect(examAttemptsLabel(inconsistent)).not.toContain('不限')
  })
})
