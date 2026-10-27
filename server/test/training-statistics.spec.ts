import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { RuleSnapshot } from '../src/common/training-contracts';
import {
  buildDashboardTrend,
  buildExamSummary,
  buildRankingRows,
  computeCourseCompletion,
  type StatisticsRecord,
} from '../src/modules/statistics/ranking';
import { TrainingStatisticsService } from '../src/modules/statistics/training-statistics.service';
import { StatisticsService } from '../src/modules/statistics/statistics.service';
import { AdminDashboardController, TrainingStatisticsController } from '../src/modules/statistics/training-statistics.controller';
import { TrainingStatisticsOverviewQueryDto, TrainingStatisticsQueryDto } from '../src/modules/statistics/training-statistics.dto';

const RULE: RuleSnapshot = {
  totalCents: 10000,
  passCents: 6000,
  durationMinutes: 30,
  maxAttempts: 3,
  partialCreditRatio: 0.5,
  rules: [{ type: 'single', count: 1, scoreCents: 10000 }],
};

function record(overrides: Partial<StatisticsRecord> & Pick<StatisticsRecord, 'id' | 'userId' | 'difficulty'>): StatisticsRecord {
  return {
    paperId: '10', releaseId: '20', categoryId: '7', source: 'institution',
    ruleSnapshot: RULE, status: 'passed', gradingState: 'finalized', score: 80,
    startedAt: new Date('2026-10-20T00:00:00.000Z'),
    submittedAt: new Date('2026-10-20T00:10:00.000Z'),
    deadlineAt: new Date('2026-10-20T00:30:00.000Z'), submissionMethod: 'manual',
    gradedAt: new Date('2026-10-20T01:00:00.000Z'),
    ...overrides,
  };
}

describe('training statistics aggregation', () => {
  it('uses the frozen 120-point target for score distribution boundaries including full marks', () => {
    const rule = { ...RULE, totalCents: 12000, passCents: 7200, rules: [{ type: 'single' as const, count: 1, scoreCents: 12000 }] };
    const summary = buildExamSummary({
      records: [71, 72, 84, 96, 108, 120].map((score, index) => record({ id: String(index + 1), userId: String(index + 1), difficulty: 'easy', score, ruleSnapshot: rule })),
      eligibleUserIds: new Set(), scoringReleaseId: '20', scoringRule: rule,
      course: { eligible_users: 0, required_lessons: 0, completed_users: 0, completion_rate: null },
    });
    expect(summary.score_groups[0].distribution).toEqual([
      { lower: 0, upper: 72, count: 1 }, { lower: 72, upper: 84, count: 1 },
      { lower: 84, upper: 96, count: 1 }, { lower: 96, upper: 108, count: 1 },
      { lower: 108, upper: 120, count: 2 },
    ]);
  });

  const rows: StatisticsRecord[] = [
    record({ id: '101', userId: '1', difficulty: 'easy', score: 50, status: 'failed', gradedAt: new Date('2026-10-20T01:00:00.000Z') }),
    record({ id: '102', userId: '1', difficulty: 'easy', score: 80, gradedAt: new Date('2026-10-20T05:00:00.000Z') }),
    record({ id: '103', userId: '2', difficulty: 'easy', score: 80, gradedAt: new Date('2026-10-20T02:00:00.000Z') }),
    record({
      id: '104', userId: '3', difficulty: 'hard', source: 'external', score: 90,
      submissionMethod: 'timeout', submittedAt: new Date('2026-10-20T00:35:00.000Z'),
      gradedAt: new Date('2026-10-20T06:00:00.000Z'),
    }),
    record({
      id: '105', userId: '4', difficulty: 'hard', source: 'external', status: 'submitted',
      gradingState: 'pending_manual', score: null, gradedAt: null,
    }),
    record({
      id: '106', userId: '5', difficulty: 'easy', status: 'in_progress',
      gradingState: 'not_submitted', score: null, submittedAt: null, gradedAt: null,
    }),
  ];

  it('keeps current participation separate from historical starts without exposing removed pending metrics', () => {
    const summary = buildExamSummary({
      records: rows,
      eligibleUserIds: new Set(['1', '2', '3', '4']),
      scoringReleaseId: '20',
      scoringRule: RULE,
      course: { eligible_users: 2, required_lessons: 2, completed_users: 1, completion_rate: 0.5 },
    });

    expect(summary).toMatchObject({
      release_id: '20',
      eligible_count: 4,
      eligible_started_count: 4,
      historical_started_count: 5,
      historical_only_started_count: 1,
      submitted_attempts: 5,
      submitted_users: 4,
      finalized_users: 3,
      participation_rate: 1,
    });
    expect(summary).not.toHaveProperty('pending_attempts');
    expect(summary).not.toHaveProperty('pending_users');
    expect(summary.score_groups).toEqual([
      {
        difficulty: 'easy', finalized_users: 2, average_score: 80, pass_rate: 1,
        highest_score: 80, lowest_score: 80, passed_users: 2, average_duration_seconds: 600, excellent_users: null,
        distribution: [
          { lower: 0, upper: 60, count: 0 }, { lower: 60, upper: 70, count: 0 },
          { lower: 70, upper: 80, count: 0 }, { lower: 80, upper: 90, count: 2 },
          { lower: 90, upper: 100, count: 0 },
        ],
      },
      {
        difficulty: 'hard', finalized_users: 1, average_score: 90, pass_rate: 1,
        highest_score: 90, lowest_score: 90, passed_users: 1, average_duration_seconds: 1800, excellent_users: null,
        distribution: [
          { lower: 0, upper: 60, count: 0 }, { lower: 60, upper: 70, count: 0 },
          { lower: 70, upper: 80, count: 0 }, { lower: 80, upper: 90, count: 0 },
          { lower: 90, upper: 100, count: 1 },
        ],
      },
    ]);
    expect(summary.difficulty_composition).toEqual([
      { difficulty: 'easy', users: 3 },
      { difficulty: 'hard', users: 2 },
    ]);
  });

  it('returns a null participation rate for a zero denominator', () => {
    expect(buildExamSummary({
      records: [], eligibleUserIds: new Set(), scoringReleaseId: null, scoringRule: null,
      course: { eligible_users: 0, required_lessons: 0, completed_users: 0, completion_rate: null },
    }).participation_rate).toBeNull();
  });

  it('ranks an explicit difficulty with standard competition ranks and stable record selection', () => {
    const ranked = buildRankingRows(rows, new Map([
      ['1', '学员A'], ['2', '学员B'], ['3', '学员C'], ['4', '学员D'], ['5', '调离E'],
    ]), 'easy', '20', RULE);

    expect(ranked.map((item) => [item.rank, item.user_id, item.record_id])).toEqual([
      [1, '2', '103'],
      [1, '1', '102'],
    ]);
    expect(ranked.map((item) => item.rank)).toEqual([1, 1]);
    expect(ranked[1].duration_seconds).toBe(600);
  });

  it('uses deadline for timeout duration and keeps legacy unknown grading times as a stable id fallback', () => {
    const legacy = [
      record({ id: '9', userId: '8', releaseId: null, ruleSnapshot: null, difficulty: 'unknown', gradedAt: null, score: 70 }),
      record({ id: '7', userId: '8', releaseId: null, ruleSnapshot: null, difficulty: 'unknown', gradedAt: null, score: 70 }),
      record({ id: '5', userId: '9', releaseId: null, ruleSnapshot: RULE, difficulty: 'unknown', gradedAt: null, score: 100 }),
    ];
    const legacyRows = buildRankingRows(legacy, new Map([['8', '遗留学员']]), 'unknown', null, null);
    expect(legacyRows).toHaveLength(1);
    expect(legacyRows[0]).toMatchObject({ record_id: '7', difficulty: 'unknown', score: 70 });
    expect(buildRankingRows(rows, new Map([['3', '学员C']]), 'hard', '20', RULE)[0].duration_seconds).toBe(1800);
  });

  it('does not merge a prior release or a different frozen scoring rule into the current release ranking', () => {
    const otherRule = { ...RULE, passCents: 7000 };
    const contaminated = [
      ...rows,
      record({ id: '201', userId: '6', releaseId: '19', difficulty: 'easy', score: 100 }),
      record({ id: '202', userId: '7', releaseId: '20', ruleSnapshot: otherRule, difficulty: 'easy', score: 99 }),
    ];
    const ranked = buildRankingRows(contaminated, new Map([['6', '旧发布'], ['7', '异规则']]), 'easy', '20', RULE);
    expect(ranked.map((item) => item.user_id)).toEqual(['2', '1']);
  });

  it('sorts displayed scores and durations without changing competition ranks or selected attempts', () => {
    const inputs = [
      record({ id: '301', userId: '1', difficulty: 'easy', score: 90, submittedAt: new Date('2026-10-20T00:15:00.000Z') }),
      record({ id: '302', userId: '2', difficulty: 'easy', score: 70, submittedAt: new Date('2026-10-20T00:05:00.000Z') }),
      record({ id: '303', userId: '3', difficulty: 'easy', score: 90, submittedAt: new Date('2026-10-20T00:10:00.000Z') }),
      record({ id: '304', userId: '1', difficulty: 'easy', score: 60, submittedAt: new Date('2026-10-20T00:01:00.000Z') }),
    ];
    const names = new Map([['1', '甲'], ['2', '乙'], ['3', '丙']]);
    const userGenders = new Map([['1', 'male' as const], ['2', 'female' as const]]);
    const byDuration = buildRankingRows(inputs, names, 'easy', '20', RULE, {
      sort_by: 'duration', sort_order: 'asc', userGenders,
    });
    expect(byDuration.map((row) => [row.user_id, row.rank, row.record_id, row.gender])).toEqual([
      ['2', 3, '302', 'female'], ['3', 1, '303', null], ['1', 1, '301', 'male'],
    ]);
    expect(buildRankingRows(inputs, names, 'easy', '20', RULE, {
      sort_by: 'score', sort_order: 'asc',
    }).map((row) => [row.user_id, row.rank])).toEqual([['2', 3], ['1', 1], ['3', 1]]);
    expect(buildRankingRows(inputs, names, 'easy', '20', RULE, {
      sort_by: 'duration', sort_order: 'desc',
    }).map((row) => row.user_id)).toEqual(['1', '3', '2']);
  });

  it('computes extra metrics from finalized personal bests and leaves excellence undefined', () => {
    const summary = buildExamSummary({
      records: [
        record({ id: '401', userId: '1', difficulty: 'easy', score: 20, status: 'failed' }),
        record({ id: '402', userId: '1', difficulty: 'easy', score: 50, status: 'failed', submittedAt: new Date('2026-10-20T00:03:01.000Z') }),
        record({ id: '403', userId: '2', difficulty: 'easy', score: 89.5, submittedAt: new Date('2026-10-20T00:06:00.000Z') }),
        record({ id: '404', userId: '3', difficulty: 'easy', score: 0, status: 'timeout', gradingState: 'not_submitted', submittedAt: null }),
      ],
      eligibleUserIds: new Set(['1', '2', '3']), scoringReleaseId: '20', scoringRule: RULE,
      course: { eligible_users: 0, required_lessons: 0, completed_users: 0, completion_rate: null },
    });
    expect(summary.score_groups[0]).toMatchObject({
      finalized_users: 2, average_score: 69.75, highest_score: 89.5, lowest_score: 50,
      passed_users: 1, pass_rate: 0.5, average_duration_seconds: 270.5, excellent_users: null,
    });
  });
});

describe('course completion and dashboard trend', () => {
  it('uses only current required lesson versions and only institution learners in the denominator', () => {
    expect(computeCourseCompletion({
      eligibleUsers: [
        { id: '1', source: 'institution' }, { id: '2', source: 'institution' }, { id: '3', source: 'external' },
      ],
      requiredVersionIds: ['31', '32'],
      completedPairs: new Set(['1:31', '1:32', '2:31', '3:31', '3:32']),
    })).toEqual({
      eligible_users: 2, required_lessons: 2, completed_users: 1, completion_rate: 0.5,
      incomplete_user_ids: ['2'],
    });
    expect(computeCourseCompletion({
      eligibleUsers: [{ id: '1', source: 'institution' }], requiredVersionIds: [], completedPairs: new Set(),
    }).completion_rate).toBeNull();
  });

  it('groups exam starts by Asia/Shanghai calendar day', () => {
    expect(buildDashboardTrend([
      new Date('2026-10-20T15:59:59.000Z'),
      new Date('2026-10-20T16:00:00.000Z'),
      new Date('2026-10-21T15:30:00.000Z'),
    ], ['2026-10-20', '2026-10-21'])).toEqual([
      { date: '2026-10-20', count: 1 },
      { date: '2026-10-21', count: 2 },
    ]);
  });
});

function repository(rows: any[] = []) {
  return {
    find: async () => rows,
    findOne: async ({ where }: any) => rows.find((row) => Object.entries(where || {})
      .every(([key, value]) => String(row[key]) === String(value))) || null,
    count: async ({ where }: any = {}) => rows.filter((row) => Object.entries(where || {})
      .every(([key, value]) => String(row[key]) === String(value))).length,
  } as any;
}

function serviceFixture(permissions: string[] = ['statistics:read', 'statistics:export']) {
  const users = [
    { id: '1', realName: '学员A', gender: 'male', role: 'employee', status: 1, categoryId: '7', source: 'institution' },
    { id: '2', realName: '学员B', gender: 'female', role: 'employee', status: 1, categoryId: '7', source: 'institution' },
    { id: '3', realName: '学员C', role: 'employee', status: 1, categoryId: '7', source: 'external' },
    { id: '4', realName: '学员D', role: 'employee', status: 1, categoryId: '7', source: 'external' },
    { id: '5', realName: '调离E', role: 'employee', status: 0, categoryId: '7', source: 'institution' },
  ];
  const examRows = [
    record({ id: '101', userId: '1', difficulty: 'easy', score: 50, status: 'failed' }),
    record({ id: '102', userId: '1', difficulty: 'easy', score: 80 }),
    record({ id: '103', userId: '2', difficulty: 'easy', score: 80, gradedAt: new Date('2026-10-20T00:30:00.000Z') }),
    record({ id: '104', userId: '3', difficulty: 'hard', source: 'external', score: 90 }),
    record({ id: '105', userId: '4', difficulty: 'hard', source: 'external', status: 'submitted', gradingState: 'pending_manual', score: null, gradedAt: null }),
    record({ id: '106', userId: '5', difficulty: 'easy', status: 'in_progress', gradingState: 'not_submitted', score: null, submittedAt: null, gradedAt: null }),
  ];
  const service = new TrainingStatisticsService(
    repository([{ id: '10', title: '安全考试', businessScope: 'training', mode: 'random', categoryId: '7', status: 'published', totalScore: '1', passScore: '1', durationMinutes: 99 }]),
    repository([{ id: '20', paperId: '10', versionNo: 1, businessScope: 'training', mode: 'random', categoryId: '7', ruleSnapshot: RULE }]),
    repository([]),
    repository(examRows),
    repository(users),
    repository([{ userId: '1' }]),
    repository([{ id: '41', categoryId: '7', status: 'published' }]),
    repository([
      { id: '51', courseId: '41', required: 1, lessonType: 'video', currentVersionId: '31' },
      { id: '52', courseId: '41', required: 1, lessonType: 'video', currentVersionId: '32' },
    ]),
    repository([
      { userId: '1', lessonVersionId: '31', completed: 1 },
      { userId: '1', lessonVersionId: '32', completed: 1 },
      { userId: '2', lessonVersionId: '31', completed: 1 },
    ]),
    repository([{ id: '1' }, { id: '2' }]),
    repository([{ id: '7', name: '危化培训', status: 1 }]),
    { permissions: async () => permissions } as any,
  );
  return { service };
}

describe('TrainingStatisticsService', () => {
  it('applies current learner scope, frozen historical facts, current video versions, and reason groups', async () => {
    const { service } = serviceFixture();
    const summary = await service.examSummary({ paperId: '10', page: 1, pageSize: 20 });

    expect(summary).toMatchObject({
      exam: { paper_id: '10', title: '安全考试', category_id: '7', total_score: 100, duration_minutes: 30, pass_score: 60, excellent_score: null },
      eligible_count: 4, eligible_started_count: 4, historical_started_count: 5,
      historical_only_started_count: 1, participation_rate: 1,
      course_completion: { eligible_users: 2, required_lessons: 2, completed_users: 1, completion_rate: 0.5 },
    });
    expect(summary.uncompleted_reasons).toEqual([
      { reason: 'learning_incomplete', users: 1 },
      { reason: 'not_started', users: 0 },
      { reason: 'not_passed', users: 1 },
    ]);
  });

  it('derives exam completion reasons from the same release and frozen rule as the score group', () => {
    const { service } = serviceFixture();
    const otherRule = { ...RULE, passCents: 7000 };
    const reasons = (service as any).uncompletedReasons(
      [{ id: '1' }],
      [
        record({ id: '301', userId: '1', difficulty: 'easy', ruleSnapshot: otherRule, score: 99, status: 'passed' }),
        record({ id: '302', userId: '1', difficulty: 'easy', ruleSnapshot: RULE, score: 50, status: 'failed' }),
      ],
      '20',
      RULE,
      [],
    );
    expect(reasons).toContainEqual({ reason: 'not_passed', users: 1 });
  });

  it('requires a difficulty for ranking and exports exactly the queried page', async () => {
    const { service } = serviceFixture();
    await expect(service.ranking({ paperId: '10', page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ code: 40001 });

    const filter = { paperId: '10', difficulty: 'easy' as const, sort_by: 'score' as const, sort_order: 'asc' as const, page: 1, pageSize: 1 };
    const screen = await service.ranking(filter);
    const exported = await service.export(filter);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported);
    const sheet = workbook.getWorksheet('难度排名')!;
    const exportedRows = sheet.getRows(2, sheet.rowCount - 1)!.map((row) => ({
      rank: row.getCell(1).value,
      user_id: String(row.getCell(2).value),
      name: row.getCell(3).value,
      score: row.getCell(6).value,
      record_id: String(row.getCell(8).value),
      gender: row.getCell(9).value,
    }));
    expect(exportedRows).toEqual(screen.items.map((row) => ({
      rank: row.rank, user_id: row.user_id, name: row.name, score: row.score, record_id: row.record_id,
      gender: row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '未填写',
    })));
    expect(screen).toMatchObject({ total: 2, page: 1, page_size: 1 });
    expect(screen.items[0].gender).toBe('female');
  });

  it('applies duration sorting before pagination and exports the same ordered page', async () => {
    const { service } = serviceFixture();
    Object.assign(service, { recordRepo: repository([
      record({ id: '501', userId: '1', difficulty: 'easy', score: 90, submittedAt: new Date('2026-10-20T00:15:00.000Z') }),
      record({ id: '502', userId: '2', difficulty: 'easy', score: 70, submittedAt: new Date('2026-10-20T00:05:00.000Z') }),
    ]) });
    const filter = { paperId: '10', difficulty: 'easy' as const, sort_by: 'duration' as const, sort_order: 'asc' as const, page: 1, pageSize: 1 };
    const screen = await service.ranking(filter);
    expect(screen.items[0]).toMatchObject({ user_id: '2', rank: 2, duration_seconds: 300 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.export(filter));
    expect(workbook.getWorksheet('难度排名')!.getRow(2).getCell(2).value).toBe('2');
    expect(workbook.getWorksheet('难度排名')!.getRow(2).getCell(9).value).toBe('女');
  });

  it('counts all latest-release starters but scores only matching rules without loading learner or course context', async () => {
    const { service } = serviceFixture();
    const latest = { id: '20', paperId: '10', categoryId: '7', ruleSnapshot: RULE };
    const paper = { id: '10', title: '安全考试', categoryId: '99', status: 'published', statisticsRelease: latest };
    const query: any = {};
    for (const key of ['leftJoinAndMapOne', 'where', 'andWhere', 'orderBy', 'skip', 'take']) query[key] = vi.fn(() => query);
    query.getManyAndCount = async () => [[paper], 3];
    const records = [
      record({ id: '601', userId: '1', difficulty: 'easy', score: 40, status: 'failed' }),
      record({ id: '602', userId: '1', difficulty: 'hard', score: 96 }),
      record({ id: '603', userId: '2', difficulty: 'easy', score: 90 }),
      record({ id: '604', userId: '3', difficulty: 'easy', score: 0, status: 'timeout', gradingState: 'not_submitted', submittedAt: null }),
      record({ id: '605', userId: '4', difficulty: 'easy', score: 100, releaseId: '19' }),
      record({ id: '606', userId: '5', difficulty: 'easy', score: 100, ruleSnapshot: { ...RULE, passCents: 7000 } }),
      record({ id: '607', userId: '6', difficulty: 'easy', score: 100, categoryId: '8' }),
      record({ id: '608', userId: '7', difficulty: 'easy', score: 30, status: 'failed' }),
    ];
    const recordFind = vi.fn(async () => records);
    const forbidden = { find: async () => { throw new Error('overview must not load learner or course context'); } };
    Object.assign(service, {
      paperRepo: { createQueryBuilder: () => query }, recordRepo: { find: recordFind },
      userRepo: forbidden, courseRepo: forbidden,
    });
    const result = await service.overview({ keyword: '安全', categoryId: '7', page: 2, pageSize: 1 });
    expect(result).toEqual({
      items: [{ paper_id: '10', title: '安全考试', category_id: '7', category_name: '危化培训', status: 'published', release_id: '20',
        total_score: 100, duration_minutes: 30, pass_score: 60, participant_count: 5, finalized_users: 3, average_score: 72 }],
      total: 3, page: 2, page_size: 1,
    });
    expect(query.andWhere).toHaveBeenCalledWith('paper.status = :status', { status: 'published' });
    expect(query.andWhere).toHaveBeenCalledWith('release.id IS NOT NULL');
    expect(query.skip).toHaveBeenCalledWith(1);
    expect(query.take).toHaveBeenCalledWith(1);
    expect(query.andWhere).toHaveBeenCalledWith(expect.any(String), { keyword: '%安全%' });
    expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('release.categoryId'), { categoryId: '7' });
    expect(recordFind).toHaveBeenCalledWith(expect.objectContaining({ where: { releaseId: expect.anything() } }));
  });

  it('keeps frozen totals for published exams without participants', async () => {
    const { service } = serviceFixture();
    const query: any = {};
    for (const key of ['leftJoinAndMapOne', 'where', 'andWhere', 'orderBy', 'skip', 'take']) query[key] = () => query;
    query.getManyAndCount = async () => [[{ id: '10', title: '已发布试卷', totalScore: '80.00', categoryId: '7', status: 'published', statisticsRelease: {id:'20',categoryId:'7',ruleSnapshot:RULE} }], 1];
    Object.assign(service, {
      paperRepo: { createQueryBuilder: () => query },
      recordRepo: { find: async () => [] },
    });
    const result = await service.overview({ page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({
      release_id: '20', total_score: 100, duration_minutes: 30, pass_score: 60,
      participant_count: 0, finalized_users: 0, average_score: null,
    });
  });

  it('returns only dashboard metrics allowed by the caller and groups trend in Shanghai time', async () => {
    const { service } = serviceFixture(['students:read', 'statistics:read']);
    const dashboard = await service.dashboard('99', new Date('2026-10-22T02:00:00.000Z'));
    expect(dashboard.metrics).toEqual({ learner_count: 3 });
    expect(dashboard).not.toHaveProperty('metrics.question_count');
    expect(dashboard).not.toHaveProperty('metrics.paper_count');
    expect(dashboard).not.toHaveProperty('metrics.pending_grading_count');
    expect(dashboard.timezone).toBe('Asia/Shanghai');
    expect(dashboard.exam_trend?.find((item) => item.date === '2026-10-20')?.count).toBe(6);
  });

  it('does not revive the removed pending-grading metric for legacy permissions', async () => {
    const { service } = serviceFixture(['exam_records:review']);
    const dashboard = await service.dashboard('99', new Date('2026-10-22T02:00:00.000Z'));
    expect(dashboard.metrics).not.toHaveProperty('pending_grading_count');
  });
});

describe('legacy statistics compatibility', () => {
  it('keeps the old report readable without returning removed switch-monitor data', async () => {
    const service = Object.create(StatisticsService.prototype) as StatisticsService & Record<string, any>;
    Object.assign(service, {
      userRepo: { findOne: async () => ({
        id: '1', username: 'student', realName: '学员', employeeNo: null, departmentId: null, role: 'employee',
      }) },
      learningRepo: { find: async () => [] },
      regRepo: { find: async () => [] },
      examRepo: { find: async () => [{
        id: '11', paperId: '21', attemptNo: 1, status: 'passed', score: '80.00', switchCount: 9,
        startedAt: new Date('2026-10-20T00:00:00.000Z'), submittedAt: new Date('2026-10-20T00:10:00.000Z'),
      }] },
      paperRepo: { find: async () => [{ id: '21', title: '历史试卷' }] },
    });

    const report = await service.personal('1');
    expect(report.exams[0].records[0]).not.toHaveProperty('switch_count');
  });
});

describe('TrainingStatisticsController', () => {
  it('checks unknown query keys against the untouched request after global DTO transformation', () => {
    const controller = new TrainingStatisticsController({} as any, {} as any);
    const query = Object.assign(new TrainingStatisticsQueryDto(), { paper_id: '10' });
    expect(() => controller.summary(query, { query: { paper_id: '10', unknown: '1' } } as any))
      .toThrowError('统计查询包含不支持的字段：unknown');
    const dashboard = new AdminDashboardController({} as any);
    expect(() => dashboard.dashboard({ id: 1 } as any, { query: { unknown: '1' } } as any))
      .toThrowError('统计查询包含不支持的字段：unknown');
  });

  it('rejects unknown overview query keys before invoking the service', () => {
    const controller = new TrainingStatisticsController({} as any, {} as any);
    const query = Object.assign(new TrainingStatisticsOverviewQueryDto(), { keyword: '安全' });
    expect(() => controller.overview(query, { query: { keyword: '安全', paper_id: '10' } } as any))
      .toThrowError('统计查询包含不支持的字段：paper_id');
  });

  it('validates sort enums and maps overview filters with pagination defaults', () => {
    const invalid = plainToInstance(TrainingStatisticsQueryDto, { paper_id: '10', sort_by: 'name', sort_order: 'sideways' });
    expect(validateSync(invalid).map((error) => error.property).sort()).toEqual(['sort_by', 'sort_order']);
    const valid = plainToInstance(TrainingStatisticsQueryDto, { paper_id: '10', sort_by: 'duration', sort_order: 'asc' });
    expect(validateSync(valid)).toEqual([]);
    expect(valid.toFilter()).toMatchObject({ sort_by: 'duration', sort_order: 'asc' });
    const overview = plainToInstance(TrainingStatisticsOverviewQueryDto, { keyword: '安全', category_id: '7' });
    expect(validateSync(overview)).toEqual([]);
    expect(overview.toFilter()).toEqual({ keyword: '安全', categoryId: '7', page: 1, pageSize: 20 });
    expect(validateSync(plainToInstance(TrainingStatisticsOverviewQueryDto, { page: '0', page_size: '101', category_id: '0' }))
      .map((error) => error.property).sort()).toEqual(['category_id', 'page', 'page_size']);
  });
});
