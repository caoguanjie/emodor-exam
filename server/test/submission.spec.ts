import { describe, expect, it, vi } from 'vitest';
import type { RuleSnapshot } from '../src/common/training-contracts';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { SubmissionService, gradeSubmissionSnapshot } from '../src/modules/exams/submission.service';
import { LegacyExamAdapter } from '../src/modules/exams/legacy-exam-adapter';
import { projectFinalResult } from '../src/modules/exams/exam-history.service';

const RULE: RuleSnapshot = {
  totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
  rules: [
    { type: 'single', count: 1, scoreCents: 2500 },
    { type: 'multiple', count: 1, scoreCents: 2500 },
    { type: 'judgment', count: 1, scoreCents: 2500 },
    { type: 'image', count: 1, scoreCents: 2500 },
  ],
};

const SNAPSHOT: any = {
  recordId: '41', rule: RULE,
  items: [
    { itemId: '501', questionId: '101', type: 'single', stem: '单选', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [1], analysis: 'a1', rubric: null, scoreCents: 2500, displayToOriginal: [1, 0], position: 0 },
    { itemId: '502', questionId: '102', type: 'multiple', stem: '多选', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }], answer: [0, 1], analysis: 'a2', rubric: null, scoreCents: 2500, displayToOriginal: [0, 1, 2], position: 1 },
    { itemId: '503', questionId: '103', type: 'judgment', stem: '判断', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0], analysis: 'a3', rubric: null, scoreCents: 2500, displayToOriginal: [0, 1], position: 2 },
    { itemId: '504', questionId: '104', type: 'image', stem: '图片', options: [], answer: [], analysis: null, rubric: 'rubric', scoreCents: 2500, displayToOriginal: [], position: 3 },
  ],
};

describe('submission grading', () => {
  it('grades objective answers in cents and leaves a saved image answer pending manual grading', () => {
    const graded = gradeSubmissionSnapshot(SNAPSHOT, [
      { recordQuestionId: '501', selected: [1], assetIds: null },
      { recordQuestionId: '502', selected: [0], assetIds: null },
      { recordQuestionId: '503', selected: [1], assetIds: null },
      { recordQuestionId: '504', selected: null, assetIds: ['701'] },
    ] as any);

    expect(graded).toMatchObject({ totalCents: 3750, pendingManual: true, fullScoreCount: 1 });
    expect(graded.details).toEqual([
      { itemId: '501', selected: [1], isCorrect: 1, gainedCents: 2500, pendingManual: false },
      { itemId: '502', selected: [0], isCorrect: 0, gainedCents: 1250, pendingManual: false },
      { itemId: '503', selected: [1], isCorrect: 0, gainedCents: 0, pendingManual: false },
      { itemId: '504', selected: null, isCorrect: null, gainedCents: null, pendingManual: true },
    ]);
  });

  it('does not create pending manual work for an unanswered image item', () => {
    const graded = gradeSubmissionSnapshot(SNAPSHOT, [
      { recordQuestionId: '501', selected: [1], assetIds: null },
    ] as any);
    expect(graded.pendingManual).toBe(false);
    expect(graded.totalCents).toBe(2500);
    expect(graded.details[3]).toMatchObject({ itemId: '504', gainedCents: 0, pendingManual: false });
  });
});

function submissionFixture(overrides: Record<string, unknown> = {}) {
  const record: any = {
    id: '41', paperId: '11', regulationId: '2', userId: '9', assignmentId: '31', activeAssignmentId: '31',
    status: 'in_progress', ruleSnapshot: RULE, deadlineAt: new Date('2099-10-22T09:00:00.000Z'),
    draftRevision: 0, gradingState: 'not_submitted', gradingRevision: 0,
    submissionMethod: null, submittedAt: null, gradedAt: null, score: null, switchCount: 0,
    ...overrides,
  };
  const answers: any[] = [{
    id: '1', examRecordId: '41', recordQuestionId: '501', questionId: '101', selected: [1], assetIds: null,
    isCorrect: null, gainedScore: null, comment: null, gradingVersion: 0,
  }];
  let saves = 0;
  const recordRepo: any = {
    findOne: vi.fn(async () => record),
    save: vi.fn(async (value: any) => { saves += 1; return Object.assign(record, value); }),
  };
  const answerRepo: any = {
    find: vi.fn(async () => answers),
    create: vi.fn((value: any) => ({ ...value })),
    save: vi.fn(async (values: any[]) => {
      for (const value of values) {
        const existing = answers.find((answer) => String(answer.recordQuestionId) === String(value.recordQuestionId));
        if (existing) Object.assign(existing, value);
        else answers.push({ id: String(answers.length + 1), ...value });
      }
      return values;
    }),
  };
  const repositories = new Map<any, any>([
    [ExamRecord, recordRepo], [ExamAnswer, answerRepo],
    [SysUser, { findOne: vi.fn(async () => ({ id: '9', status: 1, username: 'student9' })) }],
  ]);
  const manager: any = { getRepository: (entity: any) => repositories.get(entity) };
  const events: string[] = [];
  const dataSource: any = { transaction: vi.fn(async (work: any) => {
    const value = await work(manager);
    events.push('commit');
    return value;
  }) };
  const drafts: any = {
    saveInTransaction: vi.fn(async () => ({ revision: 1, saved_at: '2026-10-22T00:00:00.000Z', answered_count: 1 })),
    releaseUnconfirmedReferences: vi.fn(async () => undefined),
  };
  const reader: any = { forGrading: vi.fn(async () => structuredClone(SNAPSHOT)) };
  const history: any = {
    resultInTransaction: vi.fn(async (_manager: any, current: any, suppliedSnapshot?: any, suppliedRows?: any[]) => (
      projectFinalResult(current, suppliedSnapshot || structuredClone(SNAPSHOT), suppliedRows || answers)
    )),
  };
  const statistics: any = {
    invalidateRegulationCache: vi.fn(async () => { events.push('cache'); }),
  };
  const audit: any = { log: vi.fn(() => { events.push('audit'); }) };
  const redis: any = { setNx: vi.fn(async () => true) };
  history.result = vi.fn(async (_userId: string, _recordId: string) => history.resultInTransaction(manager, record));
  const service = new (SubmissionService as any)(dataSource, drafts, reader, history, statistics, audit, redis) as SubmissionService;
  return {
    service, record, answers, drafts, recordRepo, statistics, audit, redis, events,
    get saves() { return saves; },
  };
}

describe('SubmissionService idempotent finalizer', () => {
  it('saves an optional latest draft and finalizes it inside the same transaction', async () => {
    const fixture = submissionFixture();
    const result = await fixture.service.submit('9', '41', { revision: 1, answers: [{ item_id: '501', selected: [0] }] });

    expect(fixture.drafts.saveInTransaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      record_id: '41', grading_state: 'finalized', grading_revision: 0,
      submission_method: 'manual', score: 25, passed: false, correct_rate: 0.25,
    });
    expect(fixture.record).toMatchObject({
      status: 'failed', gradingState: 'finalized', submissionMethod: 'manual', activeAssignmentId: null,
    });
    expect(fixture.drafts.releaseUnconfirmedReferences).toHaveBeenCalledWith(expect.anything(), '41', []);
    expect(fixture.statistics.invalidateRegulationCache).toHaveBeenCalledWith('2');
    expect(fixture.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: 9, actor_name: 'student9', action: 'exam.submit', object_id: '41',
      detail: expect.objectContaining({ timeout: false, status: 'failed', score: 25 }),
    }));
    expect(fixture.events.slice(-3)).toEqual(['commit', 'cache', 'audit']);
  });

  it('returns the first terminal result on retries without finalizing twice', async () => {
    const fixture = submissionFixture();
    const first = await fixture.service.submit('9', '41');
    const saveCount = fixture.saves;
    const retried = await fixture.service.submit('9', '41');

    expect(retried).toEqual(first);
    expect(fixture.saves).toBe(saveCount);
    expect(fixture.statistics.invalidateRegulationCache).toHaveBeenCalledTimes(1);
    expect(fixture.audit.log).toHaveBeenCalledTimes(1);
  });

  it('ignores a late manual payload and records timeout against the last confirmed draft', async () => {
    const fixture = submissionFixture({ deadlineAt: new Date('2000-01-01T00:00:00.000Z') });
    const result = await fixture.service.submit('9', '41', { revision: 1, answers: [{ item_id: '501', selected: [1] }] });

    expect(fixture.drafts.saveInTransaction).not.toHaveBeenCalled();
    expect(result.submission_method).toBe('timeout');
    expect(fixture.record.submissionMethod).toBe('timeout');
    expect(fixture.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ timeout: true }),
    }));
  });

  it('keeps score and pass fields null while a saved image answer awaits grading', async () => {
    const fixture = submissionFixture();
    fixture.answers.push({
      id: '2', examRecordId: '41', recordQuestionId: '504', questionId: '104', selected: null, assetIds: ['701'],
      isCorrect: null, gainedScore: null, comment: null, gradingVersion: 0,
    });

    const result = await fixture.service.submit('9', '41');

    expect(result).toMatchObject({ grading_state: 'pending_manual', score: null, passed: null, correct_rate: null, graded_at: null });
    expect(fixture.record).toMatchObject({ status: 'submitted', gradingState: 'pending_manual', score: null, gradedAt: null });
    expect(fixture.drafts.releaseUnconfirmedReferences).toHaveBeenCalledWith(expect.anything(), '41', ['701']);
  });

  it.each(['heartbeat', 'reportSwitch'] as const)('%s expiry finalizes once and publishes effects after commit', async (entry) => {
    const fixture = submissionFixture({ deadlineAt: new Date('2000-01-01T00:00:00.000Z') });

    await expect(entry === 'heartbeat'
      ? fixture.service.heartbeat('9', '41')
      : fixture.service.reportSwitch('9', '41')).rejects.toMatchObject({ code: 40905 });

    expect(fixture.record.submissionMethod).toBe('timeout');
    expect(fixture.statistics.invalidateRegulationCache).toHaveBeenCalledTimes(1);
    expect(fixture.audit.log).toHaveBeenCalledTimes(1);
    expect(fixture.events.slice(-3)).toEqual(['commit', 'cache', 'audit']);
  });

  it('uses the shared one-second switch debounce after ownership and state checks', async () => {
    const fixture = submissionFixture();
    fixture.redis.setNx.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await fixture.service.reportSwitch('9', '41');
    const duplicate = await fixture.service.reportSwitch('9', '41');

    expect(first).toEqual({ switch_count: 1 });
    expect(duplicate).toEqual({ switch_count: 1 });
    expect(fixture.redis.setNx).toHaveBeenNthCalledWith(1, 'exam:switch:deb:41', '1', 1);
    expect(fixture.record.switchCount).toBe(1);

    await expect(fixture.service.reportSwitch('8', '41')).rejects.toMatchObject({ code: 40302 });
    expect(fixture.redis.setNx).toHaveBeenCalledTimes(2);
  });
});

describe('legacy fixed-client result bridge', () => {
  it('uses record_question_id as the snapshot item domain after migration 010', async () => {
    const record: any = {
      id: '41', paperId: '11', userId: '9', assignmentId: '31', status: 'passed', score: '25.00',
      ruleSnapshot: RULE, switchCount: 0, submittedAt: new Date('2026-10-22T00:00:00.000Z'),
    };
    const recordRepo: any = { find: vi.fn(async () => [record]), findOne: vi.fn(async () => record) };
    const paperRepo: any = { findOne: vi.fn(async () => ({ id: '11', title: '固定卷', passScore: '60.00' })) };
    const answerRepo: any = { find: vi.fn(async () => [{
      examRecordId: '41', questionId: '101', recordQuestionId: '501', selected: [1], isCorrect: 1, gainedScore: '25.00',
    }]) };
    const itemRepo: any = { find: vi.fn(async () => SNAPSHOT.items.map((item: any) => ({ id: item.itemId, questionId: item.questionId }))) };
    const adapter = new LegacyExamAdapter(
      recordRepo, paperRepo, answerRepo, itemRepo, {} as any,
      { forGrading: vi.fn(async () => structuredClone(SNAPSHOT)) } as any,
      { manager: {} } as any,
    );

    const summary = await adapter.submitResult(record);
    const detail = await adapter.result('41', '9', 'employee');

    expect(summary.answer_summary).toEqual([{ question_id: 101, is_correct: true, gained_score: 25 }]);
    expect(detail.questions[0]).toMatchObject({ question_id: 101, selected: [1], gained_score: 25 });
  });
});
