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
import { AttemptService } from '../src/modules/exams/attempt.service';
import { AttemptReaderService } from '../src/modules/exams/attempt-reader.service';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { ShuffleService } from '../src/modules/exams/shuffle.service';
import { TrainingExamsController } from '../src/modules/exams/training-exams.controller';

function fixture() {
  const user: any = { id: '9', username: 'learner', role: 'employee', status: 1, categoryId: null, source: 'institution' };
  const paper: any = { id: '11', title: '公共考试', businessScope: 'training', mode: 'random', poolScope: 'public', categoryId: null, regulationId: null, status: 'published' };
  const release: any = { id: '21', paperId: '11', businessScope: 'training', mode: 'random', poolScope: 'public', categoryId: null,
    requiresLearning: false, requiredLearningMinutes: null, courseIds: [],
    rule: { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [{ type: 'single', count: 2, scoreCents: 5000 }] },
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

describe('public random attempt admission and frozen ownership', () => {
  it.each([['institution', 'easy'], ['external', 'hard']])('uses database source %s for %s and allows an empty category', async (source, difficulty) => {
    const f = fixture(); f.user.source = source;
    const view = await f.service.start('9', '11', true);
    expect(f.assignments[0]).toMatchObject({ source, difficulty, categoryId: null, releaseId: '21' });
    expect(f.records[0]).toMatchObject({ attemptNo: 1, categoryId: null, difficulty });
    expect(f.items).toHaveLength(2);
    expect(f.items.every(row => row.snapshotJson.difficulty === difficulty)).toBe(true);
    expect(new Set(f.items.map(row => row.questionId)).size).toBe(2);
    expect(view.questions).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/answer|analysis|pool|correct_option_ids/);
    expect(f.userRepo.findOne).toHaveBeenCalledWith({ where: { id: '9' }, lock: { mode: 'pessimistic_write' } });
    expect(f.categoryRepo.findOne).not.toHaveBeenCalled();
  });

  it.each([null, undefined, '', 'unknown'])('rejects missing/invalid database source %s before consuming a try', async source => {
    const f = fixture(); f.user.source = source;
    await expect(f.service.start('9', '11', true)).rejects.toMatchObject({ code: 40001 });
    expect(f.assignments).toHaveLength(0); expect(f.records).toHaveLength(0); expect(f.items).toHaveLength(0);
  });

  it('allows category-scoped training releases without matching the current learner category', async () => {
    const f = fixture(); f.release.poolScope = 'category'; f.release.categoryId = '7'; f.user.categoryId = '8';
    expect(await f.service.start('9', '11', true)).toMatchObject({ record_id: '41' });
    expect(f.assignments[0].categoryId).toBe('7');
    expect(f.categoryRepo.findOne).toHaveBeenCalled();
  });

  it('keeps old fixed training question facts and mixed difficulty without a learner category', async () => {
    const f = fixture(); f.release.mode = 'fixed'; f.release.poolScope = 'category'; f.release.categoryId = '7';
    f.release.pool = [f.release.pool[0], f.release.pool[6]];
    expect(await f.service.start('9', '11', true)).toMatchObject({ record_id: '41' });
    expect(f.assignments[0]).toMatchObject({ categoryId: '7', difficulty: 'mixed' });
    expect(new Set(f.items.map(row => row.questionVersionId))).toEqual(new Set(['201', '211']));
    expect(f.draw).not.toHaveBeenCalled();
  });

  it('restores one record, original order and original deadline after lost response and concurrent start retries', async () => {
    const f = fixture();
    const views = await Promise.all([f.service.start('9', '11', true), f.service.start('9', '11', true)]);
    expect(views[0].record_id).toBe(views[1].record_id);
    expect(views[0].questions).toEqual(views[1].questions);
    const before = structuredClone(f.items), deadline = views[0].deadline_at;
    f.paper.status = 'draft'; f.user.source = 'external';
    expect(await f.service.start('9', '11', true)).toMatchObject({ record_id: '41', deadline_at: deadline, questions: views[0].questions });
    expect(f.items).toEqual(before); expect(f.records).toHaveLength(1); expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('draws on each new attempt even after passing, and refuses the fourth successful start', async () => {
    const f = fixture();
    for (let index = 0; index < 3; index++) {
      const view = await f.service.start('9', '11', true);
      expect(view.record_id).toBe(String(41 + index));
      expect(f.records[index].attemptNo).toBe(index + 1);
      f.records[index].status = 'passed'; f.records[index].activeAssignmentId = null;
    }
    await expect(f.service.start('9', '11', true)).rejects.toMatchObject({ code: 40902 });
    expect(f.assignments).toHaveLength(1); expect(f.records).toHaveLength(3); expect(f.draw).toHaveBeenCalledTimes(3);
  });

  it('expires without scoring or answers, and requires a later explicit start for a new attempt', async () => {
    const f = fixture(); await f.service.start('9', '11', true);
    f.records[0].deadlineAt = new Date(Date.now() - 1000); f.answers.push({ examRecordId: '41' });
    expect(await f.service.start('9', '11', true)).toMatchObject({ record_id: '41', status: 'timeout', questions: [] });
    expect(f.records[0]).toMatchObject({ gradingState: 'not_submitted', score: '0.00', submittedAt: null, gradedAt: null, activeAssignmentId: null });
    expect(f.records).toHaveLength(1); expect(f.answers).toHaveLength(0); expect(f.draw).toHaveBeenCalledTimes(1);
    expect(await f.service.start('9', '11', true)).toMatchObject({ record_id: '42' });
    expect(f.records[1].attemptNo).toBe(2); expect(f.draw).toHaveBeenCalledTimes(2);
  });

  it('keeps original release, rules, difficulty and attempt limit after source change and republish', async () => {
    const f = fixture(); await f.service.start('9', '11', true);
    const frozenAssignment = structuredClone(f.assignments[0]);
    f.records[0].status = 'failed'; f.user.source = 'external'; f.user.categoryId = '8';
    const next = structuredClone(f.release); next.id = '22'; next.rule.maxAttempts = 100; next.pool.forEach((q: any) => { q.stem = 'new release'; });
    f.releases.set('22', next); f.setLatest('22');
    await f.service.start('9', '11', true);
    expect(f.assignments[0]).toEqual(frozenAssignment);
    expect(f.records[1]).toMatchObject({ releaseId: '21', difficulty: 'easy', source: 'institution', ruleSnapshot: { maxAttempts: 3 } });
    expect(f.items.filter(row => row.recordId === '42').every(row => row.snapshotJson.stem !== 'new release')).toBe(true);
  });

  it('uses the latest release for a learner without an assignment', async () => {
    const f = fixture(), next = structuredClone(f.release); next.id = '22'; next.rule.maxAttempts = 2;
    f.releases.set('22', next); f.setLatest('22'); await f.service.start('9', '11', true);
    expect(f.assignments[0]).toMatchObject({ releaseId: '22', ruleSnapshot: { maxAttempts: 2 } });
  });

  it('still enforces identity, account and paper publication gates', async () => {
    for (const reason of ['identity', 'account', 'draft']) {
      const f = fixture();
      if (reason === 'identity') f.setIdentity(false);
      if (reason === 'account') f.user.status = 0;
      if (reason === 'draft') f.paper.status = 'draft';
      await expect(f.service.start('9', '11', true)).rejects.toBeDefined();
      expect(f.assignments).toHaveLength(0); expect(f.records).toHaveLength(0);
    }
  });

  it('does not use caller claims to override the database source', async () => {
    const f = fixture(); f.user.source = 'external';
    const controller = new TrainingExamsController(f.service, {} as any, {} as any);
    await controller.start('11', { id: '9', client: 'mobile', role: 'employee', source: 'institution', difficulty: 'easy' } as any);
    expect(f.assignments[0]).toMatchObject({ source: 'external', difficulty: 'hard' });
  });

  it('rolls back a failed start and leaves the first attempt number available', async () => {
    const f = fixture(); f.release.pool.forEach((row: any) => { row.stem = '<p>题干<img data-media-id="801"></p>'; });
    f.setFailMedia(true);
    await expect(f.service.start('9', '11', true)).rejects.toThrow('media unavailable');
    expect(f.assignments).toHaveLength(0); expect(f.records).toHaveLength(0); expect(f.items).toHaveLength(0);
    f.setFailMedia(false); await f.service.start('9', '11', true);
    expect(f.records[0].attemptNo).toBe(1);
  });

  it('lists published training exams without source/category/identity setup and preserves a public null in frozen summaries', async () => {
    const f = fixture(); f.user.source = null; f.setIdentity(false);
    expect(await f.service.list('9')).toMatchObject({ total: 1, items: [{ paper_id: '11', pool_scope: 'public', category_id: null, difficulty: null }] });
    f.user.source = 'institution'; f.setIdentity(true); await f.service.start('9', '11', true); f.user.categoryId = '8'; f.user.source = 'external';
    expect(await f.service.detail('9', '11')).toMatchObject({ category_id: null, pool_scope: 'public', source: 'institution', difficulty: 'easy' });
  });
});
