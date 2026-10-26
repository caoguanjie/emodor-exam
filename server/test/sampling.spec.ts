import { describe, expect, it } from 'vitest';
import type { Difficulty, PoolRule, QuestionType } from '../src/common/training-contracts';
import type { QuestionVersionSnapshot } from '../src/modules/questions/question-version.service';
import { SamplingService, type RandomSource } from '../src/modules/exams/sampling.service';

function candidate(
  questionId: string,
  type: QuestionType,
  difficulty: Difficulty,
  conceptId?: string,
): QuestionVersionSnapshot {
  return Object.freeze({
    questionId,
    versionId: `v-${questionId}`,
    revision: 1,
    categoryId: '7',
    difficulty,
    type,
    stem: `题目 ${questionId}`,
    options: type === 'image' ? [] : [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
    answer: type === 'image' ? [] : [0],
    analysis: null,
    rubric: type === 'image' ? '识别风险点' : null,
    scoreCents: 100,
    conceptId,
    source: 'manual',
    approvedBy: '9',
    approvedAt: '2026-10-21T08:00:00.000Z',
  });
}

class SequenceRandom implements RandomSource {
  private cursor = 0;

  constructor(private readonly values: number[]) {}

  nextInt(maxExclusive: number): number {
    const value = this.values[this.cursor++] ?? 0;
    return value % maxExclusive;
  }
}

describe('release pool sampling', () => {
  it('counts distinct question identities even when legacy concept metadata is shared', () => {
    const service = new SamplingService();
    const variants = Array.from({ length: 10 }, (_, index) => candidate(String(index + 1), 'single', 'easy', 'concept-1'));
    const rules: PoolRule[] = [{ type: 'single', count: 2, scoreCents: 5000 }];

    expect(service.validatePool(variants, rules, 'easy')).toEqual({
      ok: true,
      deficits: [],
    });
  });

  it('draws without repeating a question identity and applies only the paper rule score', () => {
    const service = new SamplingService();
    const pool = [
      candidate('1', 'single', 'easy', 'concept-1'),
      candidate('2', 'single', 'easy', 'concept-1'),
      candidate('3', 'single', 'easy', 'concept-2'),
      candidate('4', 'single', 'easy'),
      candidate('5', 'multiple', 'easy', 'concept-3'),
      candidate('6', 'multiple', 'easy', 'concept-4'),
      candidate('7', 'single', 'hard', 'concept-hard'),
    ];
    const rules: PoolRule[] = [
      { type: 'single', count: 2, scoreCents: 2500 },
      { type: 'multiple', count: 1, scoreCents: 5000 },
    ];

    const draw = service.draw(pool, rules, 'easy', new SequenceRandom([1, 0, 1, 0, 0]));

    expect(draw).toHaveLength(3);
    expect(new Set(draw.map((item) => item.questionId)).size).toBe(draw.length);
    expect(draw.reduce((total, item) => total + item.scoreCents, 0)).toBe(10000);
    expect(draw.every((item) => item.difficulty === 'easy')).toBe(true);
    expect(draw.find((item) => item.type === 'multiple')?.scoreCents).toBe(5000);
  });

  it('allows distinct questions sharing a legacy concept but counts multiple versions of one question once', () => {
    const service = new SamplingService();
    const first = candidate('1', 'single', 'easy', 'legacy');
    const second = candidate('2', 'single', 'easy', 'legacy');
    const rules: PoolRule[] = [{ type: 'single', count: 2, scoreCents: 5000 }];
    expect(service.draw([first, second], rules, 'easy', new SequenceRandom([0])))
      .toHaveLength(2);
    expect(service.validatePool([first, { ...first, versionId: 'v-other' }], rules, 'easy'))
      .toEqual({ ok: false, deficits: [{ type: 'single', required: 2, available: 1 }] });
  });

  it('rejects a draw when the requested rules do not total exactly one hundred points', () => {
    const service = new SamplingService();
    const pool = [candidate('1', 'single', 'easy')];

    expect(() => service.draw(
      pool,
      [{ type: 'single', count: 1, scoreCents: 9999 }],
      'easy',
      new SequenceRandom([0]),
    )).toThrow('10000');
  });

  it('preserves concept grouping only when explicitly sampling an existing frozen release', () => {
    const service = new SamplingService();
    const pool = [candidate('1', 'single', 'easy', 'legacy'), candidate('2', 'single', 'easy', 'legacy')];
    const rules: PoolRule[] = [{ type: 'single', count: 2, scoreCents: 5000 }];
    expect(() => service.draw(pool, rules, 'easy', new SequenceRandom([0]), 'historical-concept')).toThrow('容量不足');
    expect(service.validatePool(pool, rules, 'easy', 'historical-concept')).toEqual({
      ok: false, deficits: [{ type: 'single', required: 2, available: 1 }],
    });
  });
});
