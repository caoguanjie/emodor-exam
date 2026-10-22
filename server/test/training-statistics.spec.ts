import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
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
import { TrainingStatisticsQueryDto } from '../src/modules/statistics/training-statistics.dto';

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
        distribution: [
          { lower: 0, upper: 60, count: 0 }, { lower: 60, upper: 70, count: 0 },
          { lower: 70, upper: 80, count: 0 }, { lower: 80, upper: 90, count: 2 },
          { lower: 90, upper: 100, count: 0 },
        ],
      },
      {
        difficulty: 'hard', finalized_users: 1, average_score: 90, pass_rate: 1,
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
    { id: '1', realName: '学员A', role: 'employee', status: 1, categoryId: '7', source: 'institution' },
    { id: '2', realName: '学员B', role: 'employee', status: 1, categoryId: '7', source: 'institution' },
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
    repository([{ id: '10', title: '安全考试', businessScope: 'training', mode: 'random', categoryId: '7', status: 'published' }]),
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

    const filter = { paperId: '10', difficulty: 'easy' as const, page: 1, pageSize: 1 };
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
    }));
    expect(exportedRows).toEqual(screen.items.map((row) => ({
      rank: row.rank, user_id: row.user_id, name: row.name, score: row.score, record_id: row.record_id,
    })));
    expect(screen).toMatchObject({ total: 2, page: 1, page_size: 1 });
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
});
