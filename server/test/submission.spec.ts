import { describe, expect, it, vi } from 'vitest';
import type { RuleSnapshot } from '../src/common/training-contracts';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { projectFinalResult } from '../src/modules/exams/exam-history.service';
import { LegacyExamAdapter } from '../src/modules/exams/legacy-exam-adapter';
import { SubmissionService, gradeSubmissionSnapshot } from '../src/modules/exams/submission.service';

const RULE: RuleSnapshot = {
  totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
  rules: [
    { type: 'single', count: 1, scoreCents: 2500 },
    { type: 'multiple', count: 1, scoreCents: 2500 },
    { type: 'judgment', count: 1, scoreCents: 5000 },
  ],
};

const SNAPSHOT: any = {
  recordId: '41', rule: RULE,
  items: [
    {
      itemId: '501', questionId: '101', type: 'single', stem: '单选',
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [1], analysis: 'a1',
      scoreCents: 2500, displayToOriginal: [1, 0], position: 0,
    },
    {
      itemId: '502', questionId: '102', type: 'multiple', stem: '多选',
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }],
      answer: [0, 1], analysis: 'a2', scoreCents: 2500, displayToOriginal: [0, 1, 2], position: 1,
    },
    {
      itemId: '503', questionId: '103', type: 'judgment', stem: '判断',
      options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0], analysis: 'a3',
      scoreCents: 5000, displayToOriginal: [0, 1], position: 2,
    },
  ],
};

describe('submission grading', () => {
  it('refuses an obsolete image-answer snapshot instead of creating manual-grading work', () => {
    const obsolete = structuredClone(SNAPSHOT);
    obsolete.items.push({
      itemId: '504', questionId: '104', type: 'image', stem: '历史图片作答题', options: [], answer: [],
      analysis: null, scoreCents: 1000, displayToOriginal: [], position: 3,
    });

    expect(() => gradeSubmissionSnapshot(obsolete, [] as any)).toThrow('题型不支持');
  });

  it('automatically grades all three supported objective types in cents', () => {
    const graded = gradeSubmissionSnapshot(SNAPSHOT, [
      { recordQuestionId: '501', selected: [1] },
      { recordQuestionId: '502', selected: [0] },
      { recordQuestionId: '503', selected: [1] },
    ] as any);

    expect(graded).toMatchObject({ totalCents: 3750, fullScoreCount: 1 });
    expect(graded.details).toEqual([
      { itemId: '501', selected: [1], isCorrect: 1, gainedCents: 2500 },
      { itemId: '502', selected: [0], isCorrect: 0, gainedCents: 1250 },
      { itemId: '503', selected: [1], isCorrect: 0, gainedCents: 0 },
    ]);
  });

  it('scores unanswered objective items as zero without creating a pending state', () => {
    const graded = gradeSubmissionSnapshot(SNAPSHOT, [
      { recordQuestionId: '501', selected: [1] },
    ] as any);

    expect(graded.totalCents).toBe(2500);
    expect(graded.details[1]).toEqual({ itemId: '502', selected: null, isCorrect: null, gainedCents: 0 });
    expect(graded.details[2]).toEqual({ itemId: '503', selected: null, isCorrect: null, gainedCents: 0 });
  });
});

function submissionFixture(overrides: Record<string, unknown> = {}) {
  const record: any = {
    id: '41', paperId: '11', regulationId: '2', userId: '9', assignmentId: '31', activeAssignmentId: '31',
    status: 'in_progress', ruleSnapshot: RULE, deadlineAt: new Date('2099-10-22T09:00:00.000Z'),
    draftRevision: 0, gradingState: 'not_submitted', submissionMethod: null,
    submittedAt: null, gradedAt: null, score: null, ...overrides,
  };
  const answers: any[] = [{
    id: '1', examRecordId: '41', recordQuestionId: '501', questionId: '101', selected: [1],
    isCorrect: null, gainedScore: null,
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
  };
  const reader: any = { forGrading: vi.fn(async () => structuredClone(SNAPSHOT)) };
  const history: any = {
    resultInTransaction: vi.fn(async (_manager: any, current: any, suppliedSnapshot?: any, suppliedRows?: any[]) => (
      projectFinalResult(current, suppliedSnapshot || structuredClone(SNAPSHOT), suppliedRows || answers)
    )),
  };
  const statistics: any = { invalidateRegulationCache: vi.fn(async () => { events.push('cache'); }) };
  const audit: any = { log: vi.fn(() => { events.push('audit'); }) };
  history.result = vi.fn(async () => history.resultInTransaction(manager, record));
  const service = new SubmissionService(dataSource, drafts, reader, history, statistics, audit);
  return {
    service, record, answers, drafts, recordRepo, statistics, audit, events,
    get saves() { return saves; },
  };
}

describe('SubmissionService idempotent objective finalizer', () => {
  it('saves an optional latest draft and finalizes it inside the same transaction', async () => {
    const fixture = submissionFixture();
    const result = await fixture.service.submit('9', '41', { revision: 1, answers: [{ item_id: '501', selected: [0] }] });

    expect(fixture.drafts.saveInTransaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      record_id: '41', grading_state: 'finalized', submission_method: 'manual',
      score: 25, passed: false, correct_rate: 1 / 3,
    });
    expect(result).not.toHaveProperty('grading_revision');
    expect(fixture.record).toMatchObject({
      status: 'failed', gradingState: 'finalized', submissionMethod: 'manual', activeAssignmentId: null,
    });
    expect(fixture.record.gradedAt).toBeInstanceOf(Date);
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
    expect(result.grading_state).toBe('finalized');
    expect(fixture.record.submissionMethod).toBe('timeout');
    expect(fixture.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ timeout: true }),
    }));
  });

  it('heartbeat finalizes once at expiry and otherwise returns only server timing state', async () => {
    const active = submissionFixture();
    const heartbeat = await active.service.heartbeat('9', '41');
    expect(heartbeat).toMatchObject({ draft_revision: 0, deadline_at: '2099-10-22T09:00:00.000Z' });
    expect(heartbeat).not.toHaveProperty('device_summary');
    expect(heartbeat).not.toHaveProperty('switch_count');

    const expired = submissionFixture({ deadlineAt: new Date('2000-01-01T00:00:00.000Z') });
    await expect(expired.service.heartbeat('9', '41')).rejects.toMatchObject({ code: 40905 });
    expect(expired.record.submissionMethod).toBe('timeout');
    expect(expired.statistics.invalidateRegulationCache).toHaveBeenCalledTimes(1);
    expect(expired.audit.log).toHaveBeenCalledTimes(1);
    expect(expired.events.slice(-3)).toEqual(['commit', 'cache', 'audit']);
  });
});

describe('legacy fixed-client result bridge', () => {
  it('uses record_question_id as the snapshot item domain after migration 010', async () => {
    const record: any = {
      id: '41', paperId: '11', userId: '9', assignmentId: '31', status: 'passed', score: '25.00',
      gradingState: 'finalized', ruleSnapshot: RULE, submittedAt: new Date('2026-10-22T00:00:00.000Z'),
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
