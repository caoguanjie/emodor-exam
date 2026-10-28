import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ExamAssignment } from '../src/entities/exam-assignment.entity';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { LearnerIdentity } from '../src/entities/learner-identity.entity';
import { IdentityVerificationSession } from '../src/entities/identity-verification-session.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { TrainingCategory } from '../src/entities/training-category.entity';
import { AttemptService, decideAttemptTransition } from '../src/modules/exams/attempt.service';
import { AttemptReaderService } from '../src/modules/exams/attempt-reader.service';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { ShuffleService } from '../src/modules/exams/shuffle.service';
import { TrainingExamsController } from '../src/modules/exams/training-exams.controller';

function fixture() {
  const user: any = { id: '9', username: 'learner', role: 'employee', status: 1, categoryId: null, source: 'institution' };
  const paper: any = { id: '11', title: '公共考试', businessScope: 'training', mode: 'random', poolScope: 'public', examPurpose: 'practice', categoryId: null, regulationId: null, status: 'published' };
  const release: any = { examPurpose: 'practice', id: '21', paperId: '11', businessScope: 'training', mode: 'random', poolScope: 'public', categoryId: null,
    requiresLearning: false, requiredLearningMinutes: null, courseIds: [],
    rule: { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: null, partialCreditRatio: 0.5, rules: [{ type: 'single', count: 2, scoreCents: 5000 }] },
    pool: ['easy', 'hard'].flatMap((difficulty, d) => Array.from({ length: 6 }, (_, i) => ({
      questionId: String(101 + d * 10 + i), versionId: String(201 + d * 10 + i), revision: 1,
      categoryId: i % 2 ? '7' : '8', difficulty, type: 'single', stem: `题目${d}-${i}`, options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
      answer: [0], analysis: '服务端解析', scoreCents: 5000, source: 'manual', approvedBy: null, approvedAt: null,
    }))),
  };
  const assignments: any[] = [], records: any[] = [], items: any[] = [], answers: any[] = [];
  const releases = new Map([['21', release]]);
  let latest = '21', identity = true, failMedia = false;
  const userRepo = { findOne: vi.fn(async () => user) };
  const recordRepo = {
    create: (row: any) => structuredClone(row),
    save: async (row: any) => {
      const saved = { id: row.id ?? String(41 + records.length), ...row }, index = records.findIndex(item => item.id === saved.id);
      if (index < 0) records.push(saved); else records[index] = saved;
      return saved;
    },
    findOne: async ({ where }: any) => records.find(row => row.id === where.id) ?? null,
    find: async () => records,
    createQueryBuilder: () => {
      const qb: any = { getMany: async () => records };
      for (const method of ['setLock', 'where', 'orderBy', 'addOrderBy']) qb[method] = () => qb;
      return qb;
    },
  };
  const itemRepo = {
    create: (row: any) => structuredClone(row),
    save: async (rows: any[]) => { const saved = rows.map((row, i) => ({ id: String(501 + items.length + i), ...row })); items.push(...saved); return saved; },
    find: async ({ where }: any) => items.filter(row => row.recordId === where.recordId),
  };
  const assignmentRepo = {
    findOne: async () => assignments[0] ?? null, find: async () => assignments,
    create: (row: any) => structuredClone(row),
    save: async (row: any) => { const saved = { id: '31', ...row }; assignments.push(saved); return saved; },
  };
  const categoryRepo = { findOne: vi.fn(async () => ({ id: '7', status: 1 })) };
  const paperRepo = {
    findOne: async () => paper,
    find: vi.fn(async ({ where }: any) => (where.categoryId === undefined || where.categoryId === paper.categoryId) && (where.status === undefined || where.status === paper.status) ? [paper] : []),
  };
  const manager: any = { getRepository(entity: unknown) {
    if (entity === SysUser) return userRepo;
    if (entity === ExamPaper) return paperRepo;
    if (entity === ExamAssignment) return assignmentRepo;
    if (entity === ExamRecord) return recordRepo;
    if (entity === ExamRecordQuestion) return itemRepo;
    if (entity === TrainingCategory) return categoryRepo;
    if (entity === LearnerIdentity) return { findOne: async () => identity ? { id: '1', userId: user.id } : null };
    if (entity === IdentityVerificationSession) return { findOne: async () => null };
    if (entity === PaperRelease) return { find: async () => [...releases.values()].map(row => ({ ...row, versionNo: Number(row.id), ruleSnapshot: row.rule })) };
    if (entity === ExamAnswer) return { delete: async () => { answers.splice(0); return { affected: 0 }; } };
    throw new Error(`unexpected entity ${(entity as any).name}`);
  } };
  // Model the transaction's held user lock; the real MySQL race is covered by root's isolated suite.
  let pending: Promise<any> = Promise.resolve();
  const dataSource: any = { manager, transaction: (...args: any[]) => {
    const work = args.at(-1), task = pending.then(async () => {
      const backup = structuredClone({ assignments, records, items, answers });
      try { return await work(manager); }
      catch (error) {
        for (const [target, source] of [[assignments, backup.assignments], [records, backup.records], [items, backup.items], [answers, backup.answers]]) target.splice(0, target.length, ...source);
        throw error;
      }
    });
    pending = task.catch(() => undefined);
    return task;
  } };
  const reader = Object.create(AttemptReaderService.prototype);
  Object.assign(reader, { dataSource });
  const sampling = new SamplingService(), draw = vi.spyOn(sampling, 'draw');
  const service = Object.create(AttemptService.prototype) as AttemptService;
  Object.assign(service, {
    userRepo, paperRepo, assignmentRepo, recordRepo, dataSource, sampling, reader,
    releases: { latestForPaper: async () => structuredClone(releases.get(latest)), get: async (id: string) => structuredClone(releases.get(id)) },
    shuffle: new ShuffleService({ examShuffleSecret: randomBytes(32).toString('hex') } as any),
    redis: { set: async () => undefined }, audit: { log: vi.fn() }, media: { bind: async () => { if (failMedia) throw new Error('media unavailable'); } },
  });
  return { service, user, paper, release, releases, assignments, records, items, answers, draw, userRepo, categoryRepo,
    setLatest: (id: string) => { latest = id; }, setIdentity: (value: boolean) => { identity = value; }, setFailMedia: (value: boolean) => { failMedia = value; } };
}

describe('practice latest release and unlimited attempts', () => {
  const start = (f: ReturnType<typeof fixture>, releaseId?: string) => f.service.start('9', '11', true, 2, releaseId);
  it.each([3, 100, 10000])('remains unlimited at %i attempts including passed outcomes', last => {
    expect(decideAttemptTransition({ nowMs: 0, active: null, records: [{ attemptNo: last, status: 'passed' }], maxAttempts: null, examPurpose: 'practice' })).toEqual({ kind: 'create', attemptNo: last + 1 });
  });
  it.each([null, undefined, 0, -1, NaN])('never treats unknown formal limit %s as unlimited', maxAttempts => {
    expect(() => decideAttemptTransition({ nowMs: 0, active: null, records: [], maxAttempts })).toThrow(expect.objectContaining({ code: 40970 }));
  });
  it('rejects missing or stale expectation before all writes', async () => {
    const f = fixture();
    for (const expected of [undefined, '20']) await expect(start(f, expected)).rejects.toMatchObject({ code: 40970 });
    expect(f.records).toEqual([]); expect(f.assignments).toEqual([]); expect(f.items).toEqual([]);
  });
  it('uses latest release rules for each retake while preserving first assignment source and difficulty', async () => {
    const f = fixture();
    expect(await start(f, '21')).toMatchObject({ exam_purpose: 'practice', release_id: '21' });
    const firstAssignment = structuredClone(f.assignments[0]), firstItems = structuredClone(f.items);
    f.records[0].status = 'passed'; f.records[0].activeAssignmentId = null; f.user.source = 'external';
    const next = structuredClone(f.release); next.id = '22'; next.rule.durationMinutes = 45;
    next.rule.totalCents = 12000; next.rule.passCents = 7200; next.rule.rules = [{ type: 'single', count: 3, scoreCents: 4000 }];
    next.pool.forEach((q: any) => { q.scoreCents = 4000; q.stem = 'v2'; });
    f.releases.set('22', next); f.setLatest('22');
    const summary = await f.service.detail('9', '11');
    expect(summary).toMatchObject({ release_id: '22', total_score: 120, duration_minutes: 45, question_count: 3, attempt_limit_kind: 'unlimited', max_attempts: null, attempts_remaining: null });
    await expect(start(f, '21')).rejects.toMatchObject({ code: 40970 });
    const view = await start(f, '22');
    expect(view).toMatchObject({ exam_purpose: 'practice', release_id: '22' });
    expect(view.questions).toHaveLength(3);
    expect(f.records[1]).toMatchObject({ releaseId: '22', source: 'institution', difficulty: 'easy', ruleSnapshot: next.rule });
    expect(f.assignments[0]).toEqual(firstAssignment);
    expect(f.items.filter(row => row.recordId === '41')).toEqual(firstItems);
    expect(f.items.filter(row => row.recordId === '42').every(row => row.snapshotJson.stem === 'v2')).toBe(true);
  });
  it('recovers active v1 despite stale expectation, republish, withdrawal and source change', async () => {
    const f = fixture(); const original = await start(f, '21');
    const next = structuredClone(f.release); next.id = '22'; next.rule.durationMinutes = 45;
    next.rule.totalCents = 12000; next.rule.rules[0].scoreCents = 6000;
    f.releases.set('22', next); f.setLatest('22'); f.paper.status = 'draft'; f.user.source = 'external';
    const recovered = await start(f, '22');
    expect(recovered).toMatchObject({ record_id: original.record_id, release_id: '21', deadline_at: original.deadline_at, questions: original.questions });
    expect(await f.service.detail('9', '11')).toMatchObject({ release_id: '21', total_score: 100, duration_minutes: 30, active_record_id: original.record_id });
    expect(f.records).toHaveLength(1); expect(f.draw).toHaveBeenCalledTimes(1);
    f.records[0].status = 'passed'; f.records[0].activeAssignmentId = null;
    await expect(start(f, '22')).rejects.toBeDefined(); expect(f.records).toHaveLength(1);
  });
  it('expires the old attempt without starting another, and creates only on later explicit request', async () => {
    const f = fixture(); await start(f, '21'); f.records[0].deadlineAt = new Date(Date.now() - 1);
    expect(await start(f)).toMatchObject({ status: 'timeout', questions: [] });
    expect(f.records).toHaveLength(1); expect(f.answers).toHaveLength(0);
    expect(await start(f, '21')).toMatchObject({ record_id: '42' });
  });
  it('rolls back new assignments, records and items when media binding fails', async () => {
    const f = fixture(); f.release.pool.forEach((row: any) => { row.stem = '<p>v1<img data-media-id="801"></p>'; }); f.setFailMedia(true);
    await expect(start(f, '21')).rejects.toThrow('media unavailable');
    expect(f.assignments).toEqual([]); expect(f.records).toEqual([]); expect(f.items).toEqual([]);
  });
  it('serializes repeated start requests to one frozen record', async () => {
    const f = fixture(); const views = await Promise.all([start(f, '21'), start(f, '21')]);
    expect(views[0]).toEqual(views[1]); expect(f.records).toHaveLength(1); expect(f.draw).toHaveBeenCalledTimes(1);
  });
});
