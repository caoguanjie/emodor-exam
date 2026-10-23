import { describe, expect, it, vi } from 'vitest';
import richFixture from '../../tests/fixtures/question-authoring-v3/rich-content.json';
import { ExamAssignment } from '../src/entities/exam-assignment.entity';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { LearnerIdentity } from '../src/entities/learner-identity.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { TrainingCategory } from '../src/entities/training-category.entity';
import { AttemptReaderService, attemptQuestionView, promptMediaIds, resultMediaIds } from '../src/modules/exams/attempt-reader.service';
import { AttemptService } from '../src/modules/exams/attempt.service';
import { ExamHistoryService } from '../src/modules/exams/exam-history.service';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { SubmissionService } from '../src/modules/exams/submission.service';

const RULE = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }] };
function snapshot(schema = 3, difficulty = 'easy', id = '101'): any {
  const { schema: _schema, ...content } = structuredClone(richFixture);
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const v2 = { stem: doc('v2题干'), options: [{ id: 'A', content: doc('甲') }, { id: 'B', content: doc('乙') }], analysis: doc('v2解析'), answer_option_ids: ['A'] };
  return {
    questionId: id, versionId: `5${id}`, revision: 1, categoryId: '7', difficulty, type: 'single',
    stem: '旧兼容题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0], analysis: '旧解析',
    contentSchemaVersion: schema, contentJson: schema === 3 ? content : schema === 2 ? v2 : undefined,
    scoreCents: 10000, source: 'manual', approvedBy: '1', approvedAt: null,
  };
}

/** Persistence is the external boundary; every exam service and projection is real. */
function examFixture(pool: any[] = [snapshot()], mode = 'fixed') {
  const user: any = { id: '9', status: 1, role: 'employee', username: 'student', categoryId: '7', source: 'institution' };
  const paper: any = { id: '11', businessScope: 'training', mode, status: 'published', categoryId: '7', regulationId: null };
  const release: any = { id: '21', paperId: '11', businessScope: 'training', mode, categoryId: '7', rule: RULE, pool };
  const assignments: any[] = [];
  const records: any[] = [];
  const items: any[] = [];
  const answers: any[] = [];
  const writes: string[] = [];
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: any) => String(row[key]) === String(value) || (value?._type === 'in' && value._value.map(String).includes(String(row[key]))));
  function repository(rows: any[], name: string) {
    return {
      create: (value: any) => ({ ...value }),
      findOne: async ({ where }: any) => rows.find((row) => matches(row, where)) || null,
      find: async ({ where }: any) => rows.filter((row) => matches(row, where)),
      count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
      delete: async ({ where, ...criteria }: any) => { writes.push(`${name}.delete`); for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where || criteria)) rows.splice(i, 1); },
      save: async (input: any) => {
        const saved = (Array.isArray(input) ? input : [input]).map((value: any) => {
          writes.push(`${name}.save`);
          const existing = value.id && rows.find((row) => row.id === value.id);
          if (existing) return Object.assign(existing, value);
          const row = { id: String(rows.length + 1), gradingState: 'not_submitted', ...value };
          rows.push(row);
          return row;
        });
        return Array.isArray(input) ? saved : saved[0];
      },
      createQueryBuilder: () => {
        const builder: any = {};
        for (const key of ['setLock', 'where', 'orderBy', 'addOrderBy', 'innerJoin', 'leftJoin', 'andWhere', 'select', 'addSelect', 'offset', 'limit']) builder[key] = () => builder;
        builder.getMany = async () => rows;
        builder.clone = () => builder;
        builder.getCount = async () => rows.length;
        builder.getRawMany = async () => rows.map((row) => ({ item_id: row.id, record_id: row.recordId }));
        return builder;
      },
    };
  }
  const assignmentRepo = repository(assignments, 'assignment');
  const recordRepo = repository(records, 'record');
  const itemRepo = repository(items, 'item');
  const answerRepo = repository(answers, 'answer');
  const paperRepo = repository([paper], 'paper');
  const userRepo = repository([user], 'user');
  const repos = new Map<any, any>([[ExamAssignment, assignmentRepo], [ExamRecord, recordRepo], [ExamRecordQuestion, itemRepo], [ExamAnswer, answerRepo], [ExamPaper, paperRepo], [SysUser, userRepo], [TrainingCategory, repository([{ id: '7', status: 1 }], 'category')], [LearnerIdentity, repository([{ userId: '9' }], 'identity')]]);
  const manager: any = { getRepository: (entity: any) => { if (!repos.has(entity)) throw new Error(`unexpected repository ${entity.name}`); return repos.get(entity); } };
  let tail: Promise<unknown> = Promise.resolve();
  const dataSource: any = { manager, getRepository: manager.getRepository, transaction: (...args: any[]) => {
    const work = args.at(-1);
    const task = tail.then(() => work(manager));
    tail = task.catch(() => undefined);
    return task;
  } };
  const media: any = { bind: vi.fn(async () => undefined), registerOwnerPolicy: vi.fn() };
  const access: any = { permissions: async () => [] };
  const audit: any = { log: vi.fn() };
  const reader = new AttemptReaderService(recordRepo as any, itemRepo as any, answerRepo as any, media, dataSource, access);
  const history = new ExamHistoryService(recordRepo as any, answerRepo as any, itemRepo as any, paperRepo as any, reader, access, media, dataSource);
  const attempts = new AttemptService(assignmentRepo as any, recordRepo as any, itemRepo as any, paperRepo as any, userRepo as any, dataSource,
    { latestForPaper: async () => release, get: async () => release } as any, new SamplingService(),
    { deriveSeed: () => 'seed', shuffleQuestionOrder: (values: any[]) => values, snapshotOptionMapping: () => [1, 0] } as any,
    {} as any, {} as any, reader, media, { set: async () => undefined } as any, audit);
  const submissions = new SubmissionService(dataSource, {} as any, reader, history, { invalidateRegulationCache: async () => undefined } as any, audit);
  function active(value = snapshot()) {
    assignments.push({ id: '31', paperId: '11', userId: '9', source: 'institution', difficulty: 'easy', categoryId: '7', releaseId: '21', ruleSnapshot: RULE });
    records.push({ id: '41', paperId: '11', userId: '9', assignmentId: '31', releaseId: '21', ruleSnapshot: RULE, difficulty: 'easy', status: 'in_progress', gradingState: 'not_submitted', deadlineAt: new Date('2099-01-01'), startedAt: new Date(), draftRevision: 4, draftPayloadHash: 'preserve' });
    items.push({ id: '501', recordId: '41', questionId: value.questionId, type: value.type, scoreCents: 10000, position: 0, displayToOriginal: [1, 0], snapshotJson: structuredClone(value) });
  }
  return { attempts, reader, history, submissions, assignments, records, items, answers, writes, media, user, release, active, audit };
}

const upgrade = { code: 40901, data: { reason_code: 'CONTENT_VERSION_REQUIRED', required_content_version: 3 } };

describe('schema 3 exam capability and frozen content', () => {
  it('rejects an unsupported first start before any assignment, attempt or media write', async () => {
    const f = examFixture();
    await expect(f.attempts.start('9', '11', true)).rejects.toMatchObject(upgrade);
    expect([f.assignments, f.records, f.items, f.writes]).toEqual([[], [], [], []]);
    expect(f.media.bind).not.toHaveBeenCalled();
  });

  it('checks the current source random pool, including candidates not drawn yet', async () => {
    const f = examFixture([snapshot(1), snapshot(3, 'hard', '201')], 'random');
    await expect(f.attempts.start('9', '11', true)).resolves.toMatchObject({ status: 'in_progress', questions: [{ options: [{ id: 'B' }, { id: 'A' }] }] });
    const blocked = examFixture([snapshot(1), snapshot(3, 'easy', '102')], 'random');
    await expect(blocked.attempts.start('9', '11', true)).rejects.toMatchObject(upgrade);
    expect(blocked.writes).toEqual([]);
  });

  it('does not consume a retry when the frozen assignment pool needs a newer client', async () => {
    const f = examFixture();
    f.active();
    f.records[0].status = 'failed';
    f.records[0].attemptNo = 1;
    await expect(f.attempts.start('9', '11', true)).rejects.toMatchObject(upgrade);
    expect(f.records.map((row) => row.attemptNo)).toEqual([1]);
    expect(f.writes).toEqual([]);
  });

  it('preserves the active schema 3 deadline, draft and item when an old client resumes', async () => {
    const f = examFixture();
    f.active();
    const before = structuredClone([f.records, f.items, f.answers]);
    await expect(f.attempts.start('9', '11', true)).rejects.toMatchObject(upgrade);
    await expect(f.attempts.recover('9', '41', true)).rejects.toMatchObject(upgrade);
    expect([f.records, f.items, f.answers]).toEqual(before);
    expect(f.writes).toEqual([]);
  });

  it.each([1, 2])('restores schema %s active content without a marker for old clients and with 2 for new clients', async (schema) => {
    const f = examFixture();
    f.active(snapshot(schema));
    const old = await f.attempts.recover('9', '41', true);
    expect(old.questions[0]).not.toHaveProperty('content_schema_version');
    const current = await (f.attempts.recover as any)('9', '41', true, 3);
    expect(current.questions[0]).toHaveProperty('content_schema_version', 2);
    expect(f.writes).toEqual([]);
  });

  it.each(['passed', 'failed', 'submitted', 'timeout'])('reads schema 3 terminal %s status without content capability', async (status) => {
    const f = examFixture();
    f.active();
    f.records[0].status = status;
    await expect(f.attempts.recover('9', '41', true)).resolves.toMatchObject({ status, questions: [] });
    expect(f.writes).toEqual([]);
  });

  it('returns terminal state and expires due records before checking content support', async () => {
    const f = examFixture();
    f.active();
    f.records[0].deadlineAt = new Date('2000-01-01');
    f.answers.push({ examRecordId: '41', recordQuestionId: '501', selected: [0] });
    await expect(f.attempts.recover('9', '41', true)).resolves.toMatchObject({ status: 'timeout', questions: [] });
    expect(f.records[0]).toMatchObject({ status: 'timeout', gradingState: 'not_submitted', submittedAt: null, draftRevision: 0 });
    expect(f.answers).toEqual([]);
    await expect(f.attempts.recover('9', '41', true)).resolves.toMatchObject({ status: 'timeout', questions: [] });
  });

  it('projects full schema 3 safe content and freezes it independently from the release', async () => {
    const f = examFixture();
    const view = await (f.attempts.start as any)('9', '11', true, 3);
    expect(view.questions[0]).toMatchObject({ content_schema_version: 3, options: [{ id: 'B' }, { id: 'A' }] });
    expect(view.questions[0].stem.content.at(-1).type).toBe('table');
    expect(Object.keys(view.questions[0]).sort()).toEqual(['content_schema_version', 'item_id', 'options', 'score', 'stem', 'type']);
    f.release.pool[0].contentJson.stem.content[0].content[0].text = 'changed';
    const recovered = await (f.attempts.recover as any)('9', view.record_id, true, 3);
    expect(recovered.questions[0].stem.content[0].content[0].text).toBe('安全操作');
    expect(f.media.bind.mock.calls.map((call: any[]) => call[1])).toEqual(['42', '43']);
  });

  it.each(['answer', 'analysis', 'checked', 'correct', 'src', 'onerror', 'approvedBy', 'authoring_json'])('rejects deep malicious %s at the student boundary', (key) => {
    const value = snapshot();
    value.contentJson.stem.content[6].content[1].content[0].content[0].content[0][key] = 'secret';
    expect(() => (attemptQuestionView as any)({ id: '501', snapshotJson: value, scoreCents: 10000, displayToOriginal: [1, 0] }, 3)).toThrowError(expect.objectContaining({ code: 40001 }));
  });

  it('collects nested prompt assets separately from result-only analysis assets', () => {
    expect(promptMediaIds(snapshot())).toEqual(['42', '43']);
    expect(resultMediaIds(snapshot())).toEqual(['44']);
  });

  it('grades stable IDs once under concurrent whole submissions and exposes schema 3 results and wrong items', async () => {
    const f = examFixture();
    f.active();
    const input = { record_id: '41', answers: [{ item_id: '501', option_ids: [] }] };
    const results = await Promise.all([(f.submissions.submit as any)('9', '41', input, 3), (f.submissions.submit as any)('9', '41', input, 3)]);
    expect(results.map((result) => result.score)).toEqual([0, 0]);
    expect(f.answers).toHaveLength(1);
    expect(f.records[0]).toMatchObject({ status: 'failed', gradingState: 'finalized', submissionMethod: 'manual' });
    const result = await (f.history.result as any)('9', '41', 3);
    expect(result).toMatchObject({ legacy: false, items: [{ content_schema_version: 3, correct_option_ids: ['A'], selected_option_ids: [] }] });
    const wrong = await (f.history.wrongItems as any)('9', 1, 20, 3);
    expect(wrong.items[0]).toMatchObject({ legacy: false, content_schema_version: 3, analysis: { type: 'doc' } });
    await expect(f.history.result('9', '41')).rejects.toMatchObject(upgrade);
    await expect(f.history.wrongItems('9', 1, 20)).rejects.toMatchObject(upgrade);
    expect(f.audit.log.mock.calls.filter((call: any[]) => call[0].action === 'exam.submit')).toHaveLength(1);
  });

  it('scores the correct short stable ID independently of shuffled position', async () => {
    const f = examFixture();
    f.active();
    const result = await (f.submissions.submit as any)('9', '41', { record_id: '41', answers: [{ item_id: '501', option_ids: ['A'] }] }, 3);
    expect(result).toMatchObject({ status: 'passed', score: 100, items: [{ selected_option_ids: ['A'], gained_score: 100 }] });
  });

  it('rejects old-client schema 3 submission before changing answers, final state or deadline', async () => {
    const f = examFixture();
    f.active();
    f.answers.push({ examRecordId: '41', recordQuestionId: '501', selected: [1], gainedScore: null });
    const before = structuredClone([f.records, f.answers, f.items]);
    await expect(f.submissions.submit('9', '41', { record_id: '41', answers: [{ item_id: '501', option_ids: ['A'] }] })).rejects.toMatchObject(upgrade);
    expect([f.records, f.answers, f.items]).toEqual(before);
    expect(f.writes).toEqual([]);
  });

  it('checks an old submit client before writing even an expired schema 3 active record', async () => {
    const f = examFixture();
    f.active();
    f.records[0].deadlineAt = new Date('2000-01-01');
    const before = structuredClone(f.records);
    await expect(f.submissions.submit('9', '41', { record_id: '41', answers: [{ item_id: '501', option_ids: [] }] })).rejects.toMatchObject(upgrade);
    expect(f.records).toEqual(before);
    expect(f.writes).toEqual([]);
    // Status reads retain the deadline-first pure timeout contract.
    await expect(f.attempts.recover('9', '41', true)).resolves.toMatchObject({ status: 'timeout', questions: [] });
  });
});
