import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';

describe('dashboard DTO boundary', () => {
  it('defaults to seven days and permits only scalar seven or thirty', async () => {
    const { DashboardTrendQueryDto } = await import('../src/modules/statistics/admin-dashboard.dto');
    const pipe = new StrictDtoValidationPipe(['days']);
    const parse = (value: unknown) => pipe.transform(value, { type: 'query', metatype: DashboardTrendQueryDto });
    expect(await parse({})).toMatchObject({ days: 7 });
    expect(await parse({ days: '30' })).toMatchObject({ days: 30 });
    for (const days of ['14', '', null, ['7'], ['7', '30'], {}, true]) {
      await expect(parse({ days })).rejects.toMatchObject({ status: 400 });
    }
    await expect(parse({ days: '7', difficulty: 'easy' })).rejects.toMatchObject({ status: 400 });
  });

  it('validates learning pagination and preserves string IDs', async () => {
    const { DashboardLearningOptionsQueryDto, DashboardLearningSummaryQueryDto } = await import('../src/modules/statistics/admin-dashboard.dto');
    const optionsPipe = new StrictDtoValidationPipe(['keyword', 'page', 'page_size']);
    const options = (value: unknown) => optionsPipe.transform(value, { type: 'query', metatype: DashboardLearningOptionsQueryDto });
    expect((await options({})).toFilter()).toEqual({ keyword: undefined, page: 1, pageSize: 20 });
    expect((await options({ keyword: '培训', page: '2', page_size: '100' })).toFilter()).toEqual({ keyword: '培训', page: 2, pageSize: 100 });
    for (const value of [{ page: '0' }, { page: '1.2' }, { page_size: '101' }, { page_size: ['20'] }, { keyword: {} }, { keyword: 'x'.repeat(129) }, { page: null }]) {
      await expect(options(value)).rejects.toMatchObject({ status: 400 });
    }
    const summaryPipe = new StrictDtoValidationPipe(['paper_id', 'release_id']);
    const summary = (value: unknown) => summaryPipe.transform(value, { type: 'query', metatype: DashboardLearningSummaryQueryDto });
    expect(await summary({ paper_id: '9007199254740993', release_id: '21' })).toMatchObject({ paper_id: '9007199254740993', release_id: '21' });
    for (const value of [{}, { paper_id: '0', release_id: '21' }, { paper_id: ['11'], release_id: '21' }, { paper_id: '11', release_id: 21 }, { paper_id: '11', release_id: '21', difficulty: 'easy' }]) {
      await expect(summary(value)).rejects.toMatchObject({ status: 400 });
    }
  });
});
