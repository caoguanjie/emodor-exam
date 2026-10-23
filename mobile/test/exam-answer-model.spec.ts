import { describe, expect, it } from 'vitest'
import type { RouteScenario } from '../src/fixtures/types'

const modelPath = '../src/types/' + 'exam.ts'
const fixturePath = '../src/fixtures/ui-scenarios/' + 'exam.ts'
const catalogPath = '../src/fixtures/route-catalog/' + 'exam.ts'

describe('stable learner answer identities', () => {
  it('replaces single and judgment answers without mutating the previous sheet', async () => {
    const { toggleOption = () => ({}) } = await import(modelPath).catch(() => ({}))
    const previous = { 'item-19': ['opt-false'] }
    expect(toggleOption(previous, 'item-19', 'opt-true', 'judgment')).toEqual({ 'item-19': ['opt-true'] })
    expect(toggleOption({ 'item-1': ['asset-option-c'] }, 'item-1', 'asset-option-a', 'single')).toEqual({ 'item-1': ['asset-option-a'] })
    expect(previous).toEqual({ 'item-19': ['opt-false'] })
  })

  it('toggles multiple identities and counts answered items rather than selections', async () => {
    const { toggleOption = () => ({}), countAnswered = () => 0 } = await import(modelPath).catch(() => ({}))
    expect(toggleOption({ 'item-11': ['fire-pin'] }, 'item-11', 'fire-root', 'multiple')).toEqual({ 'item-11': ['fire-pin', 'fire-root'] })
    expect(toggleOption({ 'item-11': ['fire-pin', 'fire-root'] }, 'item-11', 'fire-pin', 'multiple')).toEqual({ 'item-11': ['fire-root'] })
    expect(countAnswered({ 'item-11': ['fire-pin', 'fire-root'], 'item-12': [] })).toBe(1)
  })

  it('ignores an empty identity instead of creating an unusable answer', async () => {
    const { toggleOption = () => ({ invalid: [] }) } = await import(modelPath).catch(() => ({}))
    expect(toggleOption({}, '', 'opt-a', 'single')).toEqual({})
    expect(toggleOption({}, 'item-1', '', 'single')).toEqual({})
  })

  it('uses the image grid for controlled paragraph-image options without changing their stable IDs', async () => {
    const { takeItem } = await import(modelPath)
    const item = takeItem({ item_id: '101', type: 'single', score: 5, stem: { type: 'doc', content: [] }, options: ['901', '902'].map(asset => ({ id: `choice-${asset}`, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: asset } }] }] } })) })
    expect(item.imageOptions).toBe(true)
    expect(item.options.map((option: { id: string }) => option.id)).toEqual(['choice-901', 'choice-902'])
  })

  it('judges a multiple-choice omission as wrong even when the backend awards partial points', async () => {
    const { areOptionIdsCorrect = () => true } = await import(modelPath).catch(() => ({}))
    expect(areOptionIdsCorrect(['stable-a'], ['stable-a', 'stable-c'])).toBe(false)
    expect(areOptionIdsCorrect(['stable-c', 'stable-a'], ['stable-a', 'stable-c'])).toBe(true)
    expect(areOptionIdsCorrect([], [])).toBe(false)
    expect(areOptionIdsCorrect(['stable-a', 'stable-a'], ['stable-a', 'stable-c'])).toBe(false)
  })

  it('distinguishes scored historical timeout from a new unsubmitted timeout, including a zero score', async () => {
    const { examHistoryStatusLabel = () => '超时未交卷' } = await import(modelPath).catch(() => ({}))
    expect(examHistoryStatusLabel({ status: 'timeout', grading_state: 'finalized', submitted_at: '2026-10-21T10:00:00Z', score: 73 })).toBe('历史超时交卷')
    expect(examHistoryStatusLabel({ status: 'timeout', grading_state: 'finalized', submitted_at: '2026-10-21T10:00:00Z', score: 0 })).toBe('历史超时交卷')
    expect(examHistoryStatusLabel({ status: 'timeout', grading_state: 'not_submitted', submitted_at: null, score: 0 })).toBe('超时未交卷')
    expect(examHistoryStatusLabel({ status: 'passed', grading_state: 'finalized', submitted_at: '2026-10-21T10:00:00Z', score: 73 })).toBe('已通过')
  })
})

describe('exam static scenario boundary', () => {
  it('keeps in-exam fixtures free of scoring keys and review content', async () => {
    const { examTakeItems = [] } = await import(fixturePath).catch(() => ({}))
    expect(examTakeItems.length).toBe(20)
    const forbidden = ['correct', 'checked', 'correctOptionIds', 'analysis', 'answer', 'explanation']
    function collectKeys(value: unknown): string[] {
      if (!value || typeof value !== 'object') return []
      return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)])
    }
    expect(collectKeys(examTakeItems).filter(key => forbidden.includes(key))).toEqual([])
    expect(new Set(examTakeItems.map((item: { id: string }) => item.id)).size).toBe(20)
  })

  it('registers every exam page and all critical static states in its own fragment', async () => {
    const { examRouteCatalog = [] } = await import(catalogPath).catch(() => ({}))
    expect([...new Set(examRouteCatalog.map((item: RouteScenario) => item.path))]).toEqual(expect.arrayContaining([
      '/pages/exam/index', '/pages/exam/instructions', '/pages/exam/take', '/pages/exam/result',
      '/pages/exam/review', '/pages/profile/exam-history', '/pages/profile/wrong-book',
    ]))
    expect(examRouteCatalog.map((item: RouteScenario) => item.scenario)).toEqual(expect.arrayContaining([
      'exam-multiple', 'exam-timeout', 'exam-submit-failed', 'exam-draft-recover', 'exam-draft-invalid',
      'exam-load-failed', 'exam-review-images', 'exam-review-card', 'exam-wrong-empty',
    ]))
    expect(examRouteCatalog.every((item: RouteScenario) => item.pencilBoard && item.expectedText)).toBe(true)
    expect(examRouteCatalog.some((item: RouteScenario) => ['xvllX', 'qFwJa', 'Mgvnr', 'T4aj0'].includes(item.pencilBoard))).toBe(false)
  })

  it('keeps review grading, result totals and the answer-card summary on one frozen result', async () => {
    const { examReviewItems = [], examReviewSummary = {} } = await import(fixturePath).catch(() => ({}))
    for (const review of examReviewItems) {
      const selected = [...review.selectedOptionIds].sort()
      const correct = [...review.correctOptionIds].sort()
      const expectedScore = selected.length > 0 && selected.join('|') === correct.join('|') ? review.item.score : 0
      expect(review.earnedScore).toBe(expectedScore)
    }
    expect(examReviewSummary).toMatchObject({
      score: 79,
      totalScore: 100,
      correct: 16,
      wrong: 3,
      unanswered: 1,
      accuracy: 80,
    })
    expect(examReviewSummary.typeRows).toEqual([
      { type: 'single', title: '单选题', correct: 9, count: 10, score: 45, totalScore: 50 },
      { type: 'multiple', title: '多选题', correct: 3, count: 5, score: 18, totalScore: 30 },
      { type: 'judgment', title: '判断题', correct: 4, count: 5, score: 16, totalScore: 20 },
    ])
    for (const review of examReviewItems.filter((row: { item: { type: string } }) => row.item.type === 'judgment')) {
      const analysisText = JSON.stringify(review.analysis)
      expect(analysisText).toContain('“√”')
      expect(analysisText).not.toContain('正确答案：B')
    }
  })

  it('returns a fresh scenario copy after a page mutates its retry state', async () => {
    const { resolveExamScenario = () => undefined } = await import(fixturePath).catch(() => ({}))
    const first = resolveExamScenario('exam-result-unavailable', 'exam-result')
    first.state = undefined
    const second = resolveExamScenario('exam-result-unavailable', 'exam-result')
    expect(second).not.toBe(first)
    expect(second.state).toBe('unavailable')
  })
})
