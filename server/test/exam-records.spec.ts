import 'reflect-metadata';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { TrainingCategory } from '../src/entities/training-category.entity';
import { ExamAdminController, ExamRecordListQueryDto } from '../src/modules/exams/exam-admin.controller';
import { ExamRecordsService, recordSummaryView } from '../src/modules/exams/exam-records.service';

const ROW = {
  record_id: '41', paper_id: '11', paper_title: '安全培训考试', user_id: '9',
  username: 'student9', name: '张三', source: 'institution', category_id: '7', category_name: '安全培训', difficulty: 'medium',
  release_id: '21', attempt_no: '2', started_at: '2026-10-22T09:00:00.000Z',
  deadline_at: '2026-10-22T09:30:00.000Z', submitted_at: '2026-10-22T09:20:00.000Z',
  answered_count: '3', total_count: '3', status: 'passed', grading_state: 'finalized',
  submission_method: 'manual', score: '100.00', total_score_cents: '15000',
};

function serviceFixture(row: any = ROW) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: any = {};
  for (const method of [
    'innerJoin', 'leftJoin', 'select', 'addSelect', 'andWhere', 'where', 'orderBy', 'addOrderBy', 'offset', 'limit',
  ]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.getCount = vi.fn(async () => row ? 1 : 0);
  builder.getRawMany = vi.fn(async () => row ? [row] : []);
  builder.getRawOne = vi.fn(async () => row || null);
  const repo: any = { createQueryBuilder: vi.fn(() => builder) };
  return { service: new ExamRecordsService(repo), builder, calls };
}

describe('ExamRecordsService pure record projection', () => {
  it('returns record and scoring facts without monitoring or manual-grading fields', () => {
    const result = recordSummaryView(ROW);

    expect(result).toEqual({
      record_id: '41', paper_id: '11', paper_title: '安全培训考试', user_id: '9',
      username: 'student9', name: '张三', source: 'institution', category_id: '7', category_name: '安全培训', difficulty: 'medium',
      pool_scope: 'category',
      release_id: '21', attempt_no: 2, started_at: '2026-10-22T09:00:00.000Z',
      deadline_at: '2026-10-22T09:30:00.000Z', submitted_at: '2026-10-22T09:20:00.000Z',
      answered_count: 3, total_count: 3, status: 'passed', grading_state: 'finalized',
      submission_method: 'manual', score: 100, total_score: 150, result_status: 'passed',
    });
    for (const removed of [
      'connection_state', 'server_now', 'remaining_seconds', 'last_heartbeat_at',
      'switch_count', 'device_summary', 'grading_revision',
    ]) expect(result).not.toHaveProperty(removed);
  });

  it('uses the frozen release scope to distinguish a public exam from an unfilled historical category', async () => {
    expect(recordSummaryView({ ...ROW, pool_scope: 'public', category_id: null, category_name: null } as any))
      .toMatchObject({ pool_scope: 'public', category_id: null, category_name: '公共题库', source: 'institution', difficulty: 'medium' });
    expect(recordSummaryView({ ...ROW, category_id: null, category_name: null }))
      .toMatchObject({ pool_scope: 'category', category_id: null, category_name: null });
    const { service, calls } = serviceFixture();
    await service.list('1', {});
    expect(calls.some(({ method, args }) => method === 'leftJoin' && String(args[2]).includes('record.release_id'))).toBe(true);
    const scope = calls.find(({ method, args }) => method === 'addSelect' && args[1] === 'pool_scope');
    expect(scope?.args[0]).toContain('release.pool_scope');
    expect(scope?.args[0]).not.toContain('paper.pool_scope');
  });

  it.each([
    ['in_progress', 'not_submitted', '0.00', null, 'in_progress'],
    ['passed', 'finalized', '0.00', ROW.submitted_at, 'passed'],
    ['failed', 'finalized', '0.00', ROW.submitted_at, 'failed'],
    ['timeout', 'not_submitted', '0.00', null, 'timeout'],
    ['timeout', 'finalized', null, ROW.submitted_at, 'timeout'],
    ['timeout', 'finalized', '0.00', null, 'timeout'],
    ['timeout', 'not_submitted', '10.00', ROW.submitted_at, 'timeout'],
  ])('classifies %s/%s with score %s and submitted_at %s as %s', (status, grading_state, score, submitted_at, expected) => {
    expect(recordSummaryView({ ...ROW, status, grading_state, score, submitted_at })).toMatchObject({ status, result_status: expected });
  });

  it.each([
    ['submitted', 'not_submitted', null, ROW.submitted_at],
    ['submitted', 'finalized', '0.00', ROW.submitted_at],
    ['timeout', 'finalized', '0.00', ROW.submitted_at],
    ['timeout', 'finalized', '100.00', ROW.submitted_at],
    ['unknown', 'not_submitted', null, null],
  ])('rejects records outside the current administrator scope: %s/%s/%s/%s', (status, grading_state, score, submitted_at) => {
    expect(() => recordSummaryView({ ...ROW, status, grading_state, score, submitted_at })).toThrowError(
      expect.objectContaining({ code: 40401 }),
    );
  });

  it('excludes submitted and scored historical timeout records at the shared list/detail query boundary', async () => {
    for (const operation of ['list', 'detail'] as const) {
      const { service, calls } = serviceFixture();
      if (operation === 'list') await service.list('1', {});
      else await service.detail('1', '41');
      const conditions = calls.filter(({ method }) => method === 'andWhere').map(({ args }) => args);
      expect(conditions).toContainEqual(["record.status IN ('in_progress', 'passed', 'failed', 'timeout')"]);
      expect(conditions).toContainEqual([
        "NOT (record.status = 'timeout' AND record.grading_state = 'finalized' AND record.score IS NOT NULL AND record.submitted_at IS NOT NULL)",
      ]);
      if (operation === 'detail') {
        expect(conditions).toContainEqual(['record.id = :recordId', { recordId: '41' }]);
        expect(calls.filter(({ method }) => method === 'where')).toHaveLength(0);
      }
    }
  });

  it.each([
    { status: 'submitted', grading_state: 'not_submitted', score: null },
    { status: 'timeout', grading_state: 'finalized', score: '0.00' },
  ])('returns 404 for an out-of-scope administrator detail: %j', async (facts) => {
    const { service } = serviceFixture({ ...ROW, ...facts });
    await expect(service.detail('1', '41')).rejects.toMatchObject({ code: 40401 });
  });

  it.each([null, undefined, 'null', 'not-a-number'])('keeps unavailable frozen totals null (%s)', (total_score_cents) => {
    expect(recordSummaryView({ ...ROW, category_name: null, total_score_cents } as any)).toMatchObject({
      category_name: null, total_score: null,
    });
  });

  it('projects the frozen total and historical category without reading the current paper total', async () => {
    const { service, calls } = serviceFixture();
    await expect(service.detail('1', '41')).resolves.toMatchObject({ category_name: '安全培训', total_score: 150 });
    const selections = calls.filter(({ method }) => method === 'addSelect').map(({ args }) => args);
    expect(selections).toContainEqual([expect.stringContaining('record.rule_snapshot'), 'total_score_cents']);
    expect(selections.some(([expression]) => String(expression).includes('$.totalCents'))).toBe(true);
    expect(selections.some(([expression]) => String(expression).includes('paper.total_score'))).toBe(false);
  });

  it('filters by exact user and frozen category IDs and an inclusive Beijing date range', async () => {
    const { service, calls } = serviceFixture();
    await service.list('1', {
      user_id: '9', category_id: '7', date_from: '2026-10-22', date_to: '2026-10-23',
    } as any);
    const conditions = calls.filter(({ method }) => method === 'andWhere').map(({ args }) => args);
    expect(conditions).toContainEqual(['record.user_id = :userId', { userId: '9' }]);
    expect(conditions).toContainEqual(['record.category_id = :categoryId', { categoryId: '7' }]);
    expect(conditions).toContainEqual(['record.started_at >= :dateFrom', { dateFrom: new Date('2026-10-21T16:00:00.000Z') }]);
    expect(conditions).toContainEqual(['record.started_at < :dateTo', { dateTo: new Date('2026-10-23T16:00:00.000Z') }]);
  });

  it.each([
    [{ date_from: '2026-02-29' }], [{ date_to: '2026-04-31' }],
    [{ date_from: '2026-1-01' }], [{ date_to: '2026-10-22T00:00:00Z' }],
    [{ date_from: '2026-10-23', date_to: '2026-10-22' }],
  ])('rejects invalid or reversed calendar dates before querying: %j', async (filters) => {
    const { service, builder } = serviceFixture();
    await expect(service.list('1', filters as any)).rejects.toMatchObject({ code: 40001 });
    expect(builder.getCount).not.toHaveBeenCalled();
  });

  it.each([
    [{ date_from: '2024-02-29' }, 'record.started_at >= :dateFrom', 'dateFrom', '2024-02-28T16:00:00.000Z'],
    [{ date_to: '2026-12-31' }, 'record.started_at < :dateTo', 'dateTo', '2026-12-31T16:00:00.000Z'],
  ])('supports one-sided valid date bounds: %j', async (filters, expression, parameter, iso) => {
    const { service, calls } = serviceFixture();
    await service.list('1', filters as any);
    expect(calls.filter(({ method }) => method === 'andWhere').map(({ args }) => args))
      .toContainEqual([expression, { [String(parameter)]: new Date(String(iso)) }]);
  });

  it.each([
    ['in_progress', ['record.status = :resultStatus', { resultStatus: 'in_progress' }]],
    ['passed', ['record.status = :resultStatus', { resultStatus: 'passed' }]],
    ['failed', ['record.status = :resultStatus', { resultStatus: 'failed' }]],
    ['timeout', ['record.status = :resultStatus', { resultStatus: 'timeout' }]],
  ])('maps the business result filter %s to persisted status', async (result_status, expected) => {
    const { service, calls } = serviceFixture();
    await service.list('1', { result_status } as any);
    expect(calls.filter(({ method }) => method === 'andWhere').map(({ args }) => args)).toContainEqual(expected);
  });

  it('lists records with pagination and supported filters while counting selected answers only', async () => {
    const { service, builder, calls } = serviceFixture();

    const page = await service.list('1', {
      page: 2, page_size: 10, keyword: '张', paper_id: '11', source: 'institution',
      difficulty: 'medium', status: 'passed', grading_state: 'finalized',
    });

    expect(page).toMatchObject({ total: 1, page: 2, page_size: 10, items: [expect.objectContaining({ record_id: '41' })] });
    expect(builder.offset).toHaveBeenCalledWith(10);
    expect(builder.limit).toHaveBeenCalledWith(10);
    expect(calls.some(({ method, args }) => method === 'addSelect'
      && String(args[0]).includes('JSON_LENGTH(record_answer.selected)'))).toBe(true);
    const conditions = calls.filter(({ method }) => method === 'andWhere').map(({ args }) => args);
    expect(conditions).toContainEqual(['record.source = :source', { source: 'institution' }]);
    expect(conditions).toContainEqual(['record.status = :status', { status: 'passed' }]);
    expect(conditions).toContainEqual(['record.grading_state = :gradingState', { gradingState: 'finalized' }]);
  });

  it('returns a single record detail and reports a missing record', async () => {
    const existing = serviceFixture();
    await expect(existing.service.detail('1', '41')).resolves.toMatchObject({ record_id: '41', score: 100 });
    expect(existing.builder.andWhere).toHaveBeenCalledWith('record.id = :recordId', { recordId: '41' });

    expect(existing.builder.addSelect).toHaveBeenCalledWith('learner.avatar_id', 'avatar_id');
    await expect(existing.service.detail('1', '41')).resolves.toMatchObject({ avatar_id: null });
    const withAvatar = serviceFixture({ ...ROW, avatar_id: '88' });
    await expect(withAvatar.service.detail('1', '41')).resolves.toMatchObject({ avatar_id: '88' });

    const missing = serviceFixture(null);
    await expect(missing.service.detail('1', '404')).rejects.toMatchObject({ code: 40401 });
  });

  it('queries active options together with all historical record references', async () => {
    const paperBuilder: any = {};
    const categoryBuilder: any = {};
    for (const builder of [paperBuilder, categoryBuilder]) {
      for (const method of ['withDeleted', 'select', 'addSelect', 'where', 'orderBy', 'addOrderBy']) {
        builder[method] = vi.fn(() => builder);
      }
    }
    paperBuilder.getRawMany = vi.fn(async () => [{ id: 11, title: '当前卷' }, { id: 12, title: '历史停用卷' }]);
    categoryBuilder.getRawMany = vi.fn(async () => [{ id: 7, name: '当前类别' }, { id: 8, name: '历史停用类别' }]);
    const repo = { manager: { getRepository(entity: unknown) {
      if (entity === ExamPaper) return { createQueryBuilder: () => paperBuilder };
      if (entity === TrainingCategory) return { createQueryBuilder: () => categoryBuilder };
      throw new Error('unexpected option entity');
    } } };
    const service = new ExamRecordsService(repo as any);
    expect((service as any).options).toBeTypeOf('function');
    await expect((service as any).options('1')).resolves.toEqual({
      papers: [{ id: '11', title: '当前卷' }, { id: '12', title: '历史停用卷' }],
      categories: [{ id: '7', name: '当前类别' }, { id: '8', name: '历史停用类别' }],
    });
    expect(paperBuilder.where).toHaveBeenCalledWith(
      '(paper.status IN (:...activeStatuses) OR EXISTS (SELECT 1 FROM exam_record historical_record WHERE historical_record.paper_id = paper.id))',
      { activeStatuses: ['draft', 'published'] },
    );
    expect(categoryBuilder.where).toHaveBeenCalledWith(
      '(category.status = :activeStatus OR EXISTS (SELECT 1 FROM exam_record historical_record WHERE historical_record.category_id = category.id))',
      { activeStatus: 1 },
    );
  });
});

describe('ExamAdminController query and option boundary', () => {
  function queryPipe() {
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, ExamAdminController, 'records');
    return (Object.values(metadata) as any[]).find(value => value.pipes?.length)?.pipes[0];
  }

  it('accepts the new filters together with legacy filters through the registered strict query pipe', async () => {
    await expect(queryPipe().transform({
      user_id: '9', category_id: '7', result_status: 'timeout', date_from: '2026-10-22', date_to: '2026-10-23',
      source: 'institution', status: 'timeout', grading_state: 'finalized',
    }, { type: 'query', metatype: ExamRecordListQueryDto })).resolves.toMatchObject({ user_id: '9', category_id: '7', result_status: 'timeout' });
  });

  it.each([
    { user_id: '0' }, { user_id: '-1' }, { category_id: '7 OR 1=1' }, { category_id: ['7', '8'] },
    { result_status: 'submitted' }, { result_status: 'legacy_pending' }, { result_status: 'legacy_scored' },
    { date_from: '2026-1-01' }, { date_to: ['2026-10-22', '2026-10-23'] },
  ])('rejects malformed filter input: %j', async (query) => {
    await expect(queryPipe().transform(query, { type: 'query', metatype: ExamRecordListQueryDto }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('registers options before the ID route and requires only exam_records:read', async () => {
    const prototype = ExamAdminController.prototype as any;
    expect(prototype.options).toBeTypeOf('function');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.options)).toBe('exam-records/options');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, prototype.options)).toEqual(['exam_records:read']);
    const methods = Object.getOwnPropertyNames(prototype);
    expect(methods.indexOf('options')).toBeLessThan(methods.indexOf('record'));
    const records = { options: vi.fn(async () => ({ papers: [{ id: '11', title: '安全培训考试' }], categories: [{ id: '7', name: '安全培训' }] })) };
    const controller = new ExamAdminController(records as any, {} as any);
    await expect((controller as any).options({ id: 8 })).resolves.toEqual({
      papers: [{ id: '11', title: '安全培训考试' }], categories: [{ id: '7', name: '安全培训' }],
    });
  });
});

describe('ExamAdminController retained read-only result route', () => {
  it('delegates an administrator result read to ExamHistoryService', async () => {
    const history = { adminResult: vi.fn(async () => ({ record_id: '41', grading_state: 'finalized', score: 90 })) };
    const { service } = serviceFixture();
    const controller = new ExamAdminController(service, history as any);

    await expect((controller as any).result('41', { id: 8 })).resolves.toMatchObject({
      record_id: '41', grading_state: 'finalized', score: 90,
    });
    expect(history.adminResult).toHaveBeenCalledWith('8', '41');
  });

  it.each([
    { status: 'submitted', grading_state: 'not_submitted', score: null },
    { status: 'timeout', grading_state: 'finalized', score: '0.00' },
  ])('rejects an out-of-scope administrator result before invoking the shared reader: %j', async (facts) => {
    const { service } = serviceFixture({ ...ROW, ...facts });
    const history = { adminResult: vi.fn(async () => ({ record_id: '41' })) };
    const controller = new ExamAdminController(service, history as any);

    await expect(controller.result('41', { id: 8 } as any)).rejects.toMatchObject({ code: 40401 });
    expect(history.adminResult).not.toHaveBeenCalled();
  });
});
