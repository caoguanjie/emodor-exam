import { describe, expect, it } from 'vitest';
import { resolveAttemptLimit } from '../src/modules/exams/exam-purpose';
import { TrainingPaperDtoValidationPipe, CreateTrainingPaperDto, UpdateTrainingPaperDto, PAPER_CREATE_KEYS, PAPER_UPDATE_KEYS } from '../src/modules/exams/paper.dto';

describe('exam purpose and attempt limit contract', () => {
  it('distinguishes unlimited practice from unknown formal history', () => {
    expect(resolveAttemptLimit('practice', null)).toEqual({ kind: 'unlimited', maxAttempts: null });
    expect(resolveAttemptLimit('practice', 100)).toEqual({ kind: 'unlimited', maxAttempts: null });
    for (const value of [null, undefined, 0, -1, NaN, Infinity, 1.5]) {
      expect(resolveAttemptLimit('formal', value)).toEqual({ kind: 'unknown', maxAttempts: null });
    }
    expect(resolveAttemptLimit('formal', 3)).toEqual({ kind: 'limited', maxAttempts: 3 });
    expect(resolveAttemptLimit('formal', 10000)).toEqual({ kind: 'limited', maxAttempts: 10000 });
  });

  const pipe = new TrainingPaperDtoValidationPipe(PAPER_CREATE_KEYS);
  const create = (body: object) => pipe.transform(body, { type: 'body', metatype: CreateTrainingPaperDto });
  const practice = { title: '模拟', mode: 'random', pool_scope: 'public', exam_purpose: 'practice', category_id: null };
  it('accepts practice null or omitted max attempts and formal default', async () => {
    await expect(create(practice)).resolves.toMatchObject({ exam_purpose: 'practice' });
    await expect(create({ ...practice, max_attempts: null })).resolves.toMatchObject({ max_attempts: null });
    await expect(create({ title: '正式', mode: 'random', pool_scope: 'public' })).resolves.toMatchObject({ title: '正式' });
  });
  it('rejects unsupported practice combinations and explicit formal null', async () => {
    for (const patch of [{ mode: 'fixed' }, { pool_scope: 'category', category_id: '7' }, { max_attempts: 3 }]) {
      await expect(create({ ...practice, ...patch })).rejects.toBeDefined();
    }
    await expect(create({ title: '正式', mode: 'random', pool_scope: 'public', max_attempts: null })).rejects.toBeDefined();
    await expect(new TrainingPaperDtoValidationPipe(PAPER_UPDATE_KEYS).transform({ exam_purpose: 'practice' }, { type: 'body', metatype: UpdateTrainingPaperDto })).rejects.toBeDefined();
  });
});
