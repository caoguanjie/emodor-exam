import { describe, expect, it } from 'vitest'
import { formatExamAnswer, type ExamTakeItem } from '../src/types/exam'

const item: ExamTakeItem = {
  id: '17', type: 'multiple', score: 5, stem: { type: 'doc', content: [] },
  options: ['choice-z', 'choice-a', 'choice-m', 'choice-b'].map(id => ({ id, content: { type: 'doc', content: [] } })),
}

describe('exam review answer labels', () => {
  it('formats both correct and selected IDs in frozen display order without changing the answers', () => {
    const correct = ['choice-z', 'choice-m', 'choice-a']
    const selected = ['choice-m', 'choice-z', 'choice-a']
    expect(formatExamAnswer(item, correct)).toBe('A B C')
    expect(formatExamAnswer(item, selected)).toBe('A B C')
    expect(correct).toEqual(['choice-z', 'choice-m', 'choice-a'])
    expect(selected).toEqual(['choice-m', 'choice-z', 'choice-a'])
    expect(formatExamAnswer(item, ['choice-b', 'choice-a'])).toBe('B D')
  })
  it('preserves single-choice, judgment and unanswered labels', () => {
    expect(formatExamAnswer({ ...item, type: 'single' }, ['choice-m'])).toBe('C')
    expect(formatExamAnswer({ ...item, type: 'judgment' }, ['choice-z'])).toBe('正确')
    expect(formatExamAnswer({ ...item, type: 'judgment' }, ['choice-a'])).toBe('错误')
    expect(formatExamAnswer(item, [])).toBe('未作答')
  })
})
