import { describe, expect, it, vi } from 'vitest';
import type { RuleSnapshot } from '../src/common/training-contracts';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { ExamReviewEvent } from '../src/entities/exam-review-event.entity';
import { ManualGradingService } from '../src/modules/exams/manual-grading.service';
import { projectFinalResult } from '../src/modules/exams/exam-history.service';

const RULE: RuleSnapshot = {
  totalCents: 10000,
  passCents: 6000,
  durationMinutes: 30,
  maxAttempts: 3,
  partialCreditRatio: 0.5,
  rules: [
    { type: 'single', count: 1, scoreCents: 5000 },
    { type: 'image', count: 2, scoreCents: 2500 },
  ],
};

const SNAPSHOT: any = {
  recordId: '41',
  rule: RULE,
  items: [
    {
      itemId: '501', questionId: '101', type: 'single', stem: '客观题',
      options: [{ key: 'A', text: '甲' }], answer: [0], analysis: '解析', rubric: null,
      scoreCents: 5000, displayToOriginal: [0], position: 0,
    },
    {
      itemId: '502', questionId: '102', type: 'image', stem: '图片一', options: [], answer: [],
      analysis: null, rubric: '参考一', scoreCents: 2500, displayToOriginal: [], position: 1,
    },
    {
      itemId: '503', questionId: '103', type: 'image', stem: '图片二', options: [], answer: [],
      analysis: null, rubric: '参考二', scoreCents: 2500, displayToOriginal: [], position: 2,
    },
  ],
};

function gradingFixture() {
  const record: any = {
    id: '41', regulationId: '9', userId: '7', status: 'submitted', score: null,
    submittedAt: new Date('2026-10-22T02:00:00.000Z'), submissionMethod: 'manual',
    gradingState: 'pending_manual', gradingRevision: 0, gradedAt: null,
  };
  const rows: any[] = [
    { id: '1', examRecordId: '41', recordQuestionId: '501', questionId: '101', selected: [0], assetIds: null, isCorrect: 0, gainedScore: '50.00', comment: null, gradingVersion: 0 },
    { id: '2', examRecordId: '41', recordQuestionId: '502', questionId: '102', selected: null, assetIds: ['701'], isCorrect: null, gainedScore: null, comment: null, gradingVersion: 0 },
    { id: '3', examRecordId: '41', recordQuestionId: '503', questionId: '103', selected: null, assetIds: ['702'], isCorrect: null, gainedScore: null, comment: null, gradingVersion: 0 },
  ];
  const events: any[] = [];
  const recordRepo: any = {
    findOne: vi.fn(async () => record),
    save: vi.fn(async (value: any) => Object.assign(record, value)),
  };
  const answerRepo: any = {
    findOne: vi.fn(async ({ where }: any) => rows.find((row) => String(row.examRecordId) === String(where.examRecordId)
      && String(row.recordQuestionId) === String(where.recordQuestionId)) || null),
    find: vi.fn(async () => rows),
    save: vi.fn(async (value: any) => value),
  };
  const itemRepo: any = {
    findOne: vi.fn(async ({ where }: any) => SNAPSHOT.items.find((item: any) => String(item.itemId) === String(where.id))
      ? { id: String(where.id), recordId: '41', type: SNAPSHOT.items.find((item: any) => String(item.itemId) === String(where.id)).type }
      : null),
  };
  const eventRepo: any = {
    create: vi.fn((value: any) => ({ ...value })),
    save: vi.fn(async (value: any) => { events.push(value); return value; }),
  };
  const repositories = new Map<any, any>([
    [ExamRecord, recordRepo], [ExamAnswer, answerRepo], [ExamRecordQuestion, itemRepo], [ExamReviewEvent, eventRepo],
  ]);
  const manager: any = { getRepository: (entity: any) => repositories.get(entity) };
  const order: string[] = [];
  const dataSource: any = { transaction: vi.fn(async (work: any) => {
    const value = await work(manager);
    order.push('commit');
    return value;
  }) };
  const reader: any = { forGrading: vi.fn(async () => structuredClone(SNAPSHOT)) };
  const history: any = { resultInTransaction: vi.fn(async (_manager: any, current: any) => ({
    record_id: String(current.id), grading_state: current.gradingState, grading_revision: current.gradingRevision,
    score: current.score === null ? null : Number(current.score), passed: current.gradingState === 'finalized' ? current.status === 'passed' : null,
  })) };
  const access: any = { permissions: vi.fn(async () => ['exam_records:review']) };
  const statistics: any = { invalidateRegulationCache: vi.fn(async () => { order.push('cache'); }) };
  const audit: any = { log: vi.fn(() => { order.push('audit'); }) };
  const service = new ManualGradingService(recordRepo, dataSource, reader, history, access, statistics, audit);
  return { service, record, rows, events, order, statistics, audit };
}

describe('ManualGradingService', () => {
  it('uses item versions, keeps corrections auditable, and finalizes only after the last answered image', async () => {
    const fixture = gradingFixture();

    const pending = await fixture.service.score('8', '41', '502', {
      scoreCents: 1000, comment: '第一阅', expectedVersion: 0,
    });
    expect(pending).toMatchObject({ grading_state: 'pending_manual', grading_revision: 1, score: null });
    expect(fixture.rows[1]).toMatchObject({ gainedScore: '10.00', comment: '第一阅', gradingVersion: 1 });
    expect(fixture.events[0]).toMatchObject({ beforeScore: null, afterScore: '10.00', gradingVersion: 1, reviewerId: '8' });

    await expect(fixture.service.score('9', '41', '502', {
      scoreCents: 1500, comment: '旧版本覆盖', expectedVersion: 0,
    })).rejects.toMatchObject({ code: 40905, httpStatus: 409 });

    const finalized = await fixture.service.score('9', '41', '503', {
      scoreCents: 2500, comment: '满分', expectedVersion: 0,
    });
    expect(finalized).toMatchObject({ grading_state: 'finalized', grading_revision: 2, score: 85, passed: true });
    expect(fixture.record).toMatchObject({ status: 'passed', gradingState: 'finalized', score: '85.00' });
    expect(fixture.statistics.invalidateRegulationCache).toHaveBeenCalledTimes(1);
    expect(fixture.audit.log).toHaveBeenCalledTimes(1);
    expect(fixture.order.slice(-3)).toEqual(['commit', 'cache', 'audit']);

    await expect(fixture.service.score('8', '41', '503', {
      scoreCents: 2000, comment: '终态修改', expectedVersion: 1,
    })).rejects.toMatchObject({ code: 40905, httpStatus: 409 });
  });

  it('rejects objective items and scores outside the frozen item maximum', async () => {
    const fixture = gradingFixture();
    await expect(fixture.service.score('8', '41', '501', {
      scoreCents: 100, comment: '', expectedVersion: 0,
    })).rejects.toMatchObject({ code: 40001 });
    await expect(fixture.service.score('8', '41', '502', {
      scoreCents: 2501, comment: '', expectedVersion: 0,
    })).rejects.toMatchObject({ code: 40001 });
  });
});

describe('snapshot result projection', () => {
  it('computes correctness from frozen full score instead of stale is_correct flags', () => {
    const record: any = {
      id: '41', status: 'passed', score: '75.00', submittedAt: new Date('2026-10-22T02:00:00.000Z'),
      submissionMethod: 'manual', gradingState: 'finalized', gradingRevision: 2,
      gradedAt: new Date('2026-10-22T03:00:00.000Z'),
    };
    const rows: any[] = [
      { recordQuestionId: '501', selected: [0], gainedScore: '50.00', isCorrect: 0, gradingVersion: 0 },
      { recordQuestionId: '502', assetIds: ['701'], gainedScore: '25.00', isCorrect: null, gradingVersion: 1 },
      { recordQuestionId: '503', assetIds: ['702'], gainedScore: '0.00', isCorrect: 1, gradingVersion: 1 },
    ];

    const result = projectFinalResult(record, SNAPSHOT, rows);
    expect(result.correct_rate).toBe(2 / 3);
    expect(result.items.map((item) => item.gained_score)).toEqual([50, 25, 0]);
  });
});
