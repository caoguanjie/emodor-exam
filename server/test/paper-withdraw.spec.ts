import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { PaperAdminController } from '../src/modules/exams/paper-admin.controller';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';

const NOW = new Date('2026-10-27T08:00:00.000Z');

function fixture(overrides: Partial<ExamPaper> = {}) {
  const state = {
    papers: [{
      id: '11', regulationId: null, businessScope: 'training', mode: 'fixed', categoryId: '7',
      requiresLearning: 0, requiredLearningMinutes: null, regulationIds: [], courseIds: [],
      ruleConfig: null, designerLayout: null, title: '已发布培训试卷', remark: '保留配置', sortOrder: 3,
      totalScore: '100.00', passScore: '60.00', durationMinutes: 30, maxAttempts: 3,
      partialCreditRatio: '0.50', status: 'published', createdBy: '1', updatedBy: '8',
      createdAt: new Date('2026-10-25T08:00:00.000Z'), updatedAt: new Date('2026-10-26T08:00:00.000Z'),
      ...overrides,
    }],
    releases: [{ id: '21', paperId: '11', versionNo: 1, ruleSnapshot: { durationMinutes: 30 } }],
    releaseQuestions: [{ id: '31', releaseId: '21', snapshotJson: { stem: '冻结题干', answer: [0] } }],
    paperQuestions: [{ id: '41', paperId: '11', questionId: '101', score: '100.00' }],
    assignments: [{ id: '51', paperId: '11', userId: '2', releaseId: '21' }],
    records: [
      { id: '61', paperId: '11', userId: '2', status: 'in_progress', score: null },
      { id: '62', paperId: '11', userId: '3', status: 'passed', score: '100.00' },
    ],
    recordQuestions: [{ id: '71', recordId: '61', snapshotJson: { stem: '个人冻结题干', answer: [0] } }],
    answers: [{ id: '81', examRecordId: '62', selected: [0], gainedScore: '100.00' }],
  };
  const findOne = vi.fn();
  const save = vi.fn();
  let saveError: Error | undefined;
  let commitError: Error | undefined;
  const transaction = vi.fn(async (work: (manager: any) => Promise<unknown>) => {
    const pending = structuredClone(state);
    const manager = { getRepository(entity: unknown) {
      if (entity === PaperRelease) return { existsBy: async ({ paperId }: any) => pending.releases.some(row => row.paperId === paperId) };
      if (entity !== ExamPaper) throw new Error(`withdraw must not access ${(entity as any)?.name}`);
      return {
        async findOne(options: any) {
          findOne(options);
          return pending.papers.find((paper) => paper.id === options.where.id) ?? null;
        },
        async save(paper: any) {
          save(paper);
          if (saveError) throw saveError;
          const index = pending.papers.findIndex((item) => item.id === paper.id);
          pending.papers[index] = structuredClone(paper);
          return paper;
        },
      };
    } };
    const result = await work(manager);
    if (commitError) throw commitError;
    Object.assign(state, pending);
    return result;
  });
  const audit = { log: vi.fn() };
  const service = Object.create(PaperReleaseService.prototype) as PaperReleaseService;
  Object.assign(service, {
    dataSource: { transaction }, audit,
    paperRepo: { findOne() { throw new Error('withdraw must read the paper inside its transaction'); } },
  });
  return {
    service, state, findOne, save, transaction, audit,
    failSave: (error: Error) => { saveError = error; },
    failCommit: (error: Error) => { commitError = error; },
  };
}

describe('training paper withdrawal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it.each(['fixed', 'random'])('withdraws a published %s paper under its write lock, retaining all frozen facts', async (mode) => {
    const f = fixture({ mode });
    const before = structuredClone(f.state);

    await expect(f.service.withdraw('11', '9')).resolves.toEqual({ paper_id: '11', status: 'draft' });

    expect(f.findOne).toHaveBeenCalledWith({ where: { id: '11' }, lock: { mode: 'pessimistic_write' } });
    expect(f.state).toEqual({
      ...before,
      papers: [{ ...before.papers[0], status: 'draft', updatedBy: '9', updatedAt: NOW }],
    });
    expect(f.audit.log).toHaveBeenCalledOnce();
    expect(f.audit.log).toHaveBeenCalledWith({
      actor_id: 9, actor_name: '9', action: 'paper.release.withdraw',
      object_type: 'exam_paper', object_id: '11', detail: { paper_id: '11' },
      result: 'success', source_ip: null,
    });
  });

  it('returns an already restored draft with a release without touching metadata or writing a success audit', async () => {
    const f = fixture({ status: 'draft' });
    const before = structuredClone(f.state);

    await expect(f.service.withdraw('11', '9')).resolves.toEqual({ paper_id: '11', status: 'draft' });

    expect(f.state).toEqual(before);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.audit.log).not.toHaveBeenCalled();
  });


  it('restores a historical withdrawn paper to an editable draft and retains its frozen release', async () => {
    const f = fixture({ status: 'withdrawn' });
    const before = structuredClone(f.state);
    await expect(f.service.withdraw('11', '9')).resolves.toEqual({ paper_id: '11', status: 'draft' });
    expect(f.state).toEqual({ ...before, papers: [{ ...before.papers[0], status: 'draft', updatedBy: '9', updatedAt: NOW }] });
    expect(f.audit.log).toHaveBeenCalledOnce();
  });

  it('audits only the first transition when the request is repeated by another administrator', async () => {
    const f = fixture();
    await f.service.withdraw('11', '9');
    const afterFirst = structuredClone(f.state);
    vi.advanceTimersByTime(60_000);

    await expect(f.service.withdraw('11', '10')).resolves.toEqual({ paper_id: '11', status: 'draft' });

    expect(f.state).toEqual(afterFirst);
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.audit.log).toHaveBeenCalledOnce();
  });

  it.each(['draft', 'archived'])('rejects a %s paper with a conflict and no changes or success audit', async (status) => {
    const f = fixture({ status });
    if (status === 'draft') f.state.releases = [];
    const before = structuredClone(f.state);

    await expect(f.service.withdraw('11', '9')).rejects.toMatchObject({ code: 40970, httpStatus: 409 });

    expect(f.state).toEqual(before);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it.each(['regulation', ''])('hides a non-training paper (%s) with not-found before considering its status', async (businessScope) => {
    const f = fixture({ businessScope, status: 'withdrawn' });
    const before = structuredClone(f.state);

    await expect(f.service.withdraw('11', '9')).rejects.toMatchObject({ code: 40401, httpStatus: 404 });

    expect(f.state).toEqual(before);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it('returns not-found for a missing paper without changing any data', async () => {
    const f = fixture();
    const before = structuredClone(f.state);

    await expect(f.service.withdraw('999', '9')).rejects.toMatchObject({ code: 40401, httpStatus: 404 });

    expect(f.state).toEqual(before);
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it.each(['save', 'commit'] as const)('does not audit success when the transaction fails during %s', async (phase) => {
    const f = fixture();
    const before = structuredClone(f.state);
    const error = new Error('paper update failed');
    if (phase === 'save') f.failSave(error);
    else f.failCommit(error);

    await expect(f.service.withdraw('11', '9')).rejects.toBe(error);

    expect(f.state).toEqual(before);
    expect(f.audit.log).not.toHaveBeenCalled();
  });
});

describe('paper withdrawal route', () => {
  it('registers POST /admin/papers/:id/withdraw with papers:publish and uses the authenticated administrator', async () => {
    const f = fixture();
    const controller = new PaperAdminController({} as any, f.service, {} as any, {} as any);
    expect(typeof controller.withdraw).toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, PaperAdminController)).toBe('admin/papers');
    expect(Reflect.getMetadata(PATH_METADATA, controller.withdraw)).toBe(':id/withdraw');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.withdraw)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.withdraw)).toEqual(['papers:publish']);

    await expect(controller.withdraw('11', { id: 9, username: 'paper-admin' } as any))
      .resolves.toEqual({ paper_id: '11', status: 'draft' });

    expect(f.state.papers[0].updatedBy).toBe('9');
  });

  it.each(['0', '-1', '01', '1x'])('rejects malformed paper id %s before opening a transaction', async (paperId) => {
    const f = fixture();
    const controller = new PaperAdminController({} as any, f.service, {} as any, {} as any);

    await expect(Promise.resolve().then(() => controller.withdraw(paperId, { id: 9 } as any)))
      .rejects.toMatchObject({ code: 40001 });

    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.audit.log).not.toHaveBeenCalled();
  });
});


describe('withdrawn-to-draft preview source', () => {
  it.each(['fixed', 'random'])('previews edited %s draft facts even while earlier releases exist', async mode => {
    const service: any = Object.create(PaperReleaseService.prototype);
    const paper = { id: '11', businessScope: 'training', status: 'draft', mode };
    const oldRule = { totalCents: 10000, rules: [{ type: 'single', count: 1, scoreCents: 10000 }] };
    const newRule = { totalCents: 12000, rules: [{ type: 'single', count: 1, scoreCents: 12000 }] };
    const oldPool = [{ questionId: '101', type: 'single', difficulty: 'easy', stem: 'old frozen', scoreCents: 10000 }];
    const newPool = [{ questionId: '102', type: 'single', difficulty: 'easy', stem: 'edited draft', scoreCents: 12000 }];
    const latest = vi.fn(async () => ({ id: '21', businessScope: 'training', rule: oldRule, pool: oldPool }));
    Object.assign(service, {
      paperRepo: { findOne: async () => paper }, latestForPaper: latest,
      fixedPool: vi.fn(async () => ({ rule: newRule, pool: newPool })),
      randomPool: vi.fn(async () => ({ rule: newRule, pool: newPool })),
      dataSource: { transaction: async (work: any) => work({}) },
      sampling: { draw: vi.fn(() => newPool) },
    });
    const preview = await service.preview('11', 'easy');
    expect(preview).toMatchObject({ release_id: null, rule: newRule, questions: newPool });
    expect(latest).not.toHaveBeenCalled();
  });

  it.each(['published', 'withdrawn', 'archived'])('keeps the frozen release for %s historical preview', async status => {
    const service: any = Object.create(PaperReleaseService.prototype);
    const published = { id: '21', businessScope: 'training', rule: { totalCents: 10000, rules: [] }, pool: [{ questionId: '101', stem: 'old frozen' }] };
    Object.assign(service, {
      paperRepo: { findOne: async () => ({ id: '11', businessScope: 'training', status, mode: 'fixed' }) },
      latestForPaper: async () => published,
      fixedPool: vi.fn(() => { throw new Error('historical preview must not load editable draft'); }),
    });
    expect(await service.preview('11')).toMatchObject({ release_id: '21', rule: published.rule, questions: published.pool });
  });
});
