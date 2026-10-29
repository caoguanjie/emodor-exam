import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';
import { RandomCapacityQueryDto } from '../src/modules/exams/paper.dto';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';

function fixture(paper?: any) {
  const enabledCandidates = vi.fn(async (_filters: unknown) => [
    { questionId: '1', type: 'single', difficulty: 'easy', answer: [0] },
    { questionId: '1', type: 'single', difficulty: 'easy', answer: [0] },
    { questionId: '2', type: 'single', difficulty: 'easy', answer: [0] },
    { questionId: '3', type: 'single', difficulty: 'hard', answer: [0] },
    { questionId: '4', type: 'multiple', difficulty: 'easy', answer: [0] },
  ]);
  const service = Object.create(PaperReleaseService.prototype) as PaperReleaseService;
  Object.assign(service, { questions: { enabledCandidates }, paperRepo: { findOne: vi.fn(async () => paper || null) } });
  return { service, enabledCandidates };
}

describe('current random paper capacity', () => {
  it('uses the publication candidate policy, deduplicates identities, and returns only capacities', async () => {
    const { service, enabledCandidates } = fixture();
    expect(await service.randomCapacities({ pool_scope: 'public' })).toEqual({ items: [
      { type: 'single', easy: 2, hard: 1, available: 1 },
      { type: 'multiple', easy: 1, hard: 0, available: 0 },
      { type: 'judgment', easy: 0, hard: 0, available: 0 },
    ] });
    const filters = enabledCandidates.mock.calls[0][0] as any;
    expect(filters).toHaveLength(6);
    expect(filters.every((filter: any) => filter.poolScope === 'public' && !filter.categoryId)).toBe(true);
    expect(new Set(filters.map((filter: any) => filter.difficulty))).toEqual(new Set(['easy', 'hard']));
  });
  it('preserves category and source filters from an existing paper', async () => {
    const { service, enabledCandidates } = fixture({ businessScope: 'training', mode: 'random', poolScope: 'category', categoryId: '7', regulationIds: ['9'] });
    await service.randomCapacities({ paper_id: '4' });
    expect((enabledCandidates.mock.calls[0][0] as any).every((filter: any) => filter.categoryId === '7' && filter.regulationIds[0] === '9')).toBe(true);
  });
  it('rejects mixing a paper identity with a different pool', async () => {
    const { service, enabledCandidates } = fixture();
    await expect(service.randomCapacities({ paper_id: '4', pool_scope: 'public' })).rejects.toMatchObject({ code: 40001 });
    expect(enabledCandidates).not.toHaveBeenCalled();
  });
  it('rejects public scope with a category and missing category scope', async () => {
    const { service } = fixture();
    await expect(service.randomCapacities({ pool_scope: 'public', category_id: '7' })).rejects.toBeDefined();
    await expect(service.randomCapacities({ pool_scope: 'category' })).rejects.toBeDefined();
  });
  it('does not expose fixed or missing paper pools', async () => {
    await expect(fixture().service.randomCapacities({ paper_id: '4' })).rejects.toMatchObject({ code: 40401 });
    await expect(fixture({ businessScope: 'training', mode: 'fixed' }).service.randomCapacities({ paper_id: '4' })).rejects.toMatchObject({ code: 40001 });
  });
  it.each([{ paper_id: 'bad' }, { pool_scope: 'bad' }, { category_id: '0' }, { extra: 'ignored' }])('validates query %j', async query => {
    await expect(new StrictDtoValidationPipe(['paper_id', 'pool_scope', 'category_id']).transform(query, { type: 'query', metatype: RandomCapacityQueryDto })).rejects.toBeDefined();
  });
});
