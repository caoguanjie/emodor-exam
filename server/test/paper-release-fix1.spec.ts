import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { PaperReleaseQuestion } from '../src/entities/paper-release-question.entity';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import { UpdateTrainingPaperDto } from '../src/modules/exams/paper.dto';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';

function approvedVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: '701', questionId: '101', revision: 1, categoryId: null, difficulty: null,
    type: 'single', stem: '发布时制度题干', options: [{ key: 'A', text: '发布时选项' }],
    answer: [0], analysis: '发布时解析', rubric: null, scoreCents: 10000,
    conceptId: null, regulationId: '9', regulationVersionId: '19', sourcePageGroup: null,
    sourcePageStart: null, sourcePageEnd: null, source: 'manual', status: 'approved',
    approvedBy: null, approvedAt: null, reviewedBy: null, reviewedAt: null,
    reviewReason: null, createdBy: '3', legacyCapturedAt: new Date('2026-10-21T08:00:00.000Z'),
    createdAt: new Date('2026-10-21T08:00:00.000Z'), ...overrides,
  } as QuestionVersion;
}

describe('paper release fix1 transaction boundaries', () => {
  it('uses the caller manager for both category validation and candidate query', async () => {
    const row = approvedVersion({ categoryId: '7', difficulty: 'easy' });
    const qb: any = {};
    for (const method of ['innerJoin', 'where', 'andWhere', 'orderBy']) qb[method] = vi.fn(() => qb);
    qb.getMany = vi.fn(async () => [row]);
    const managerVersionRepo = { createQueryBuilder: vi.fn(() => qb) };
    const manager = { getRepository: vi.fn((entity: unknown) => {
      if (entity === QuestionVersion) return managerVersionRepo;
      throw new Error('unexpected repository');
    }) };
    const lockActive = vi.fn(async () => ({ id: '7', status: 1 }));
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
    Object.assign(service, {
      categories: { lockActive, assertActive: vi.fn(() => { throw new Error('global category lookup used'); }) },
      versionRepo: { createQueryBuilder: vi.fn(() => { throw new Error('global version repository used'); }) },
    });

    const rows = await (service.approvedCandidates as any)({
      categoryId: '7', type: 'single', difficulty: 'easy',
    }, manager);

    expect(rows).toHaveLength(1);
    expect(lockActive).toHaveBeenCalledWith(manager, '7');
    expect(managerVersionRepo.createQueryBuilder).toHaveBeenCalledWith('version');
  });

  it('captures the actual legacy question facts inside the caller transaction', async () => {
    const question: any = {
      id: '101', currentVersionId: null, categoryId: null, difficulty: null, conceptId: null,
      regulationId: '9', versionId: '19', type: 'single', stem: '实际旧题干',
      options: [{ key: 'A', text: '实际选项' }], answer: [0], analysis: null, rubric: null,
      score: '30.00', status: 'approved', source: 'manual', createdBy: '3',
    };
    const questionRepo = {
      findOne: vi.fn(async () => question),
      save: vi.fn(async (value: any) => value),
    };
    const versionRepo = {
      create: vi.fn((value: any) => ({ ...value })),
      save: vi.fn(async (value: any) => ({ id: '701', ...value })),
      findOne: vi.fn(),
    };
    const manager = { getRepository(entity: unknown) {
      if (entity === Question) return questionRepo;
      if (entity === QuestionVersion) return versionRepo;
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    } };
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;

    const captured = await service.currentOrCaptureForRelease(manager as any, '101');

    expect(captured).toMatchObject({
      id: '701', questionId: '101', categoryId: null, difficulty: null, stem: '实际旧题干',
      scoreCents: 3000, status: 'approved', approvedBy: null, approvedAt: null,
    });
    expect(captured.legacyCapturedAt).toBeInstanceOf(Date);
    expect(question.currentVersionId).toBe('701');
  });

  it('rejects a copied pinned version after the live current revision changes', async () => {
    const questionRepo = { findOne: vi.fn(async () => ({ id: '101', currentVersionId: '702', status: 'approved' })) };
    const manager = { getRepository(entity: unknown) {
      if (entity === Question) return questionRepo;
      if (entity === QuestionVersion) return { findOne: vi.fn() };
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    } };
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;

    await expect(service.currentOrCaptureForRelease(manager as any, '101', '701'))
      .rejects.toMatchObject({ code: 40970, message: expect.stringContaining('重新选题') });
  });

  it('freezes a newly published regulation paper without inventing category, difficulty, or approval facts', async () => {
    const paper: any = {
      id: '11', regulationId: '9', businessScope: 'regulation', mode: 'fixed', categoryId: null,
      requiresLearning: 1, regulationIds: ['9'], courseIds: [], ruleConfig: null,
      title: '制度考试', totalScore: '100.00', passScore: '60.00', durationMinutes: 30,
      maxAttempts: 3, partialCreditRatio: '0.50', status: 'draft', createdBy: '3',
    };
    const link: any = {
      id: '31', paperId: '11', questionId: '101', questionVersionId: null,
      conceptId: null, sort: 0, score: '100.00',
    };
    const version = approvedVersion();
    const releases: any[] = [];
    const releaseQuestions: any[] = [];
    const paperRepo = {
      findOne: vi.fn(async () => paper),
      save: vi.fn(async (value: any) => value),
    };
    const linkRepo = {
      find: vi.fn(async () => [link]),
      save: vi.fn(async (value: any) => value),
    };
    const releaseRepo = {
      create: vi.fn((value: any) => ({ ...value })),
      save: vi.fn(async (value: any) => {
        const saved = { id: String(releases.length + 21), ...value };
        releases.push(saved);
        return saved;
      }),
      findOne: vi.fn(async ({ where }: any) => {
        if (where.id) return releases.find((item) => String(item.id) === String(where.id)) || null;
        return releases.find((item) => String(item.paperId) === String(where.paperId)) || null;
      }),
    };
    const releaseQuestionRepo = {
      create: vi.fn((value: any) => ({ ...value })),
      save: vi.fn(async (values: any[]) => {
        releaseQuestions.push(...values.map((value, index) => ({ id: String(index + 1), ...value })));
        return values;
      }),
      find: vi.fn(async ({ where }: any) => releaseQuestions.filter((item) => item.releaseId === String(where.releaseId))),
    };
    const manager = { getRepository(entity: unknown) {
      if (entity === ExamPaper) return paperRepo;
      if (entity === PaperQuestion) return linkRepo;
      if (entity === PaperRelease) return releaseRepo;
      if (entity === PaperReleaseQuestion) return releaseQuestionRepo;
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    } };
    const currentOrCaptureForRelease = vi.fn(async () => version);
    const service = Object.create(PaperReleaseService.prototype) as PaperReleaseService & Record<string, any>;
    Object.assign(service, {
      paperRepo, releaseRepo, releaseQuestionRepo,
      dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
      categories: { lockActive: vi.fn() },
      questions: { currentOrCaptureForRelease },
      audit: { log: vi.fn() },
    });

    const { releaseId } = await service.publish('11', '3');
    const frozen = await service.get(releaseId);

    expect(currentOrCaptureForRelease).toHaveBeenCalledWith(manager, '101', undefined);
    expect(frozen).toMatchObject({
      businessScope: 'regulation', categoryId: null, mode: 'fixed', requiresLearning: true,
      pool: [{ versionId: '701', categoryId: null, difficulty: 'unknown', approvedBy: null, approvedAt: null,
        stem: '发布时制度题干', scoreCents: 10000 }],
    });
    expect(link.questionVersionId).toBe('701');
    expect(paper.status).toBe('published');
  });

  it('rejects regulation fixed variants that share one concept before creating a release', async () => {
    const paper: any = {
      id: '11', regulationId: '9', businessScope: 'regulation', mode: 'fixed', categoryId: null,
      requiresLearning: 1, regulationIds: ['9'], courseIds: [], ruleConfig: null,
      title: '重复考点制度卷', totalScore: '100.00', passScore: '60.00', durationMinutes: 30,
      maxAttempts: 3, partialCreditRatio: '0.50', status: 'draft', createdBy: '3',
    };
    const links: any[] = [
      { id: '31', paperId: '11', questionId: '101', questionVersionId: '701', conceptId: '81', sort: 0, score: '50.00' },
      { id: '32', paperId: '11', questionId: '102', questionVersionId: '702', conceptId: '81', sort: 1, score: '50.00' },
    ];
    const versions = new Map([
      ['101', approvedVersion({ id: '701', questionId: '101', conceptId: '81' })],
      ['102', approvedVersion({ id: '702', questionId: '102', conceptId: '81' })],
    ]);
    const paperRepo = {
      findOne: vi.fn(async () => paper),
      save: vi.fn(async (value: any) => value),
    };
    const linkRepo = { find: vi.fn(async () => links), save: vi.fn(async (value: any) => value) };
    const releaseRepo = {
      findOne: vi.fn(async () => null),
      create: vi.fn((value: any) => ({ ...value })),
      save: vi.fn(async (value: any) => ({ id: '21', ...value })),
    };
    const releaseQuestionRepo = {
      create: vi.fn((value: any) => ({ ...value })),
      save: vi.fn(async (value: any) => value),
    };
    const manager = { getRepository(entity: unknown) {
      if (entity === ExamPaper) return paperRepo;
      if (entity === PaperQuestion) return linkRepo;
      if (entity === PaperRelease) return releaseRepo;
      if (entity === PaperReleaseQuestion) return releaseQuestionRepo;
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    } };
    const service = Object.create(PaperReleaseService.prototype) as PaperReleaseService & Record<string, any>;
    Object.assign(service, {
      paperRepo, releaseRepo, releaseQuestionRepo,
      dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
      categories: { lockActive: vi.fn() },
      questions: {
        currentOrCaptureForRelease: vi.fn(async (_manager: unknown, questionId: string) => versions.get(questionId)),
      },
      audit: { log: vi.fn() },
    });

    await expect(service.publish('11', '3'))
      .rejects.toMatchObject({ code: 40972, message: expect.stringContaining('重复考点') });
    expect(releaseRepo.save).not.toHaveBeenCalled();
    expect(releaseQuestionRepo.save).not.toHaveBeenCalled();
    expect(paperRepo.save).not.toHaveBeenCalled();
    expect(paper.status).toBe('draft');
  });
});

describe('release-backed legacy paper compatibility', () => {
  function detailFixture() {
    const paper: any = {
      id: '11', regulationId: '9', businessScope: 'regulation', mode: 'fixed', categoryId: null,
      requiresLearning: 1, regulationIds: ['9'], courseIds: [], ruleConfig: null,
      title: '制度考试', totalScore: '100.00', passScore: '55.00', durationMinutes: 15,
      maxAttempts: 1, partialCreditRatio: '0.10', status: 'published', createdBy: '3',
    };
    const links: any[] = [{ id: '31', paperId: '11', questionId: '101', questionVersionId: '701', sort: 0, score: '30.00' }];
    const latest = {
      id: '21', paperId: '11', categoryId: null, businessScope: 'regulation' as const, mode: 'fixed' as const,
      requiresLearning: true,
      rule: { totalCents: 10000 as const, passCents: 6000, durationMinutes: 30, maxAttempts: 3,
        partialCreditRatio: 0.5, rules: [{ type: 'single' as const, count: 1, scoreCents: 10000 }] },
      pool: [{ ...approvedVersion(), questionId: '101', versionId: '701', categoryId: null,
        difficulty: 'unknown', scoreCents: 10000, stem: '冻结题干' }],
    };
    const release = { id: '21', paperId: '11' };
    const paperRepo = { findOne: vi.fn(async () => paper), save: vi.fn(async (value: any) => value) };
    const pqRepo = { find: vi.fn(async () => links) };
    const releaseRepo = { findOne: vi.fn(async () => release) };
    const manager = { getRepository(entity: unknown) {
      if (entity === ExamPaper) return paperRepo;
      if (entity === PaperRelease) return releaseRepo;
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    } };
    const service = Object.create(PaperService.prototype) as PaperService & Record<string, any>;
    Object.assign(service, {
      paperRepo, pqRepo, releaseRepo,
      questionRepo: { find: vi.fn(async () => [{ id: '101', type: 'single', stem: '已修改的实时题干', status: 'approved', source: 'manual' }]) },
      releaseService: { latestForPaper: vi.fn(async () => latest) },
      dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
      audit: { log: vi.fn() },
    });
    return { service, paperRepo };
  }

  it('reads frozen questions and strategy and exposes only additive release flags', async () => {
    const { service } = detailFixture();

    const detail = await service.detail('11');

    expect(detail).toMatchObject({
      id: 11, release_id: '21', rules_locked: true,
      pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5,
      sum_score: 100,
      questions: [{ paper_question_id: 31, question_id: 101, score: 100, stem: '冻结题干' }],
    });
  });

  it('rejects strategy mutation after a real release exists', async () => {
    const { service, paperRepo } = detailFixture();

    await expect(service.updateStrategy('11', { pass_score: 70 }, { id: 3, name: 'admin' }, null))
      .rejects.toMatchObject({ code: 40970 });
    expect(paperRepo.save).not.toHaveBeenCalled();
  });

  it('copies frozen question versions and scores into an editable draft without changing the source', async () => {
    const source: any = {
      id: '11', regulationId: '9', businessScope: 'regulation', mode: 'fixed', categoryId: null,
      requiresLearning: 1, regulationIds: ['9'], courseIds: [], ruleConfig: null,
      title: '制度考试', totalScore: '100.00', passScore: '55.00', durationMinutes: 15,
      maxAttempts: 1, partialCreditRatio: '0.10', status: 'published', createdBy: '3',
    };
    const papers = new Map<string, any>([['11', source]]);
    const copiedLinks: any[] = [];
    const release: any = {
      id: '21', paperId: '11', categoryId: null, businessScope: 'regulation', mode: 'fixed', requiresLearning: true,
      rule: { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3,
        partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }] },
      pool: [{ ...approvedVersion(), questionId: '101', versionId: '701', categoryId: null,
        difficulty: 'unknown', conceptId: '81', scoreCents: 10000 }],
    };
    const paperRepo = {
      findOne: vi.fn(async ({ where }: any) => papers.get(String(where.id)) || null),
      create: vi.fn((value: any) => ({ ...value })),
      save: vi.fn(async (value: any) => {
        if (!value.id) value.id = '12';
        papers.set(String(value.id), value);
        return value;
      }),
    };
    const itemRepo = {
      create: vi.fn((value: any) => ({ ...value })),
      save: vi.fn(async (values: any[]) => { copiedLinks.push(...values); return values; }),
      find: vi.fn(async () => []),
    };
    const manager = { getRepository(entity: unknown) {
      if (entity === ExamPaper) return paperRepo;
      if (entity === PaperQuestion) return itemRepo;
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    } };
    const latestForPaper = vi.fn(async (paperId: string) => paperId === '11' ? release : null);
    const service = Object.create(PaperService.prototype) as PaperService & Record<string, any>;
    Object.assign(service, {
      paperRepo,
      releaseService: { latestForPaper },
      dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
      audit: { log: vi.fn() },
    });

    const copy = await service.copy('11', { id: 3, name: 'admin' }, null);
    const edited = await service.updateStrategy('12', { pass_score: 70 }, { id: 3, name: 'admin' }, null);

    expect(copy).toMatchObject({ id: 12, status: 'draft', release_id: null, rules_locked: false, pass_score: 60 });
    expect(copiedLinks).toEqual([expect.objectContaining({
      paperId: '12', questionId: '101', questionVersionId: '701', conceptId: '81', score: '100.00',
    })]);
    expect(edited.pass_score).toBe(70);
    expect(source).toMatchObject({ id: '11', status: 'published', passScore: '55.00' });
  });
});

describe('training paper stale pre-read protection', () => {
  function staleFixture() {
    const current: any = {
      id: '11', title: '培训卷', businessScope: 'training', mode: 'fixed', categoryId: '7',
      requiresLearning: 0, regulationIds: [], courseIds: [], ruleConfig: { rules: [] },
      totalScore: '100.00', passScore: '60.00', durationMinutes: 30, maxAttempts: 3,
      partialCreditRatio: '0.50', status: 'draft', createdBy: '3',
    };
    const locked = { ...current, categoryId: '8' };
    const save = vi.fn(async (value: any) => value);
    const deleteRows = vi.fn();
    const paperRepo = { findOne: vi.fn(async () => current), save };
    const lockedRepo = { findOne: vi.fn(async () => locked), save, create: vi.fn((value: any) => value) };
    const manager = { getRepository(entity: unknown) {
      if (entity === ExamPaper) return lockedRepo;
      if (entity === PaperQuestion) return { delete: deleteRows, find: vi.fn(async () => []), save: vi.fn(), create: vi.fn((v: any) => v) };
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    } };
    const service = Object.create(PaperService.prototype) as PaperService & Record<string, any>;
    Object.assign(service, {
      paperRepo,
      dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
      categories: { lockActive: vi.fn(async () => ({ id: '7', status: 1 })) },
      audit: { log: vi.fn() },
    });
    return { service, save, deleteRows };
  }

  it.each([
    ['updateTraining', (service: any) => service.updateTraining('11', { title: '新标题' }, { id: '3', name: 'admin' }, null)],
    ['setTrainingQuestions', (service: any) => service.setTrainingQuestions('11', [{ question_version_id: '701', score_cents: 10000 }], { id: '3', name: 'admin' }, null)],
    ['copyTraining', (service: any) => service.copyTraining('11', { id: '3', name: 'admin' }, null)],
  ])('%s rechecks category and mode after acquiring the paper lock', async (_name, invoke) => {
    const { service, save, deleteRows } = staleFixture();

    await expect(invoke(service)).rejects.toMatchObject({ code: 40970 });
    expect(save).not.toHaveBeenCalled();
    expect(deleteRows).not.toHaveBeenCalled();
  });
});

describe('fixed paper score bands', () => {
  it('does not apply the random four-rule transport limit to a fixed draft', () => {
    const dto = plainToInstance(UpdateTrainingPaperDto, {
      mode: 'fixed',
      rules: [1000, 1500, 2000, 2500, 3000].map((score_cents) => ({ type: 'single', count: 1, score_cents })),
    });

    expect(validateSync(dto)).toEqual([]);
  });
});
