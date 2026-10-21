import { describe, expect, it, vi } from 'vitest';
import type { Difficulty, PoolRule, QuestionType, RuleSnapshot } from '../src/common/training-contracts';
import { Errors } from '../src/common/errors';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { PaperReleaseQuestion } from '../src/entities/paper-release-question.entity';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { Regulation } from '../src/entities/regulation.entity';
import { TrainingCourse } from '../src/entities/training-course.entity';
import type { QuestionVersionSnapshot } from '../src/modules/questions/question-version.service';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';
import { paperPreviewView } from '../src/modules/exams/paper-admin.controller';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { ExamService } from '../src/modules/exams/exam.service';
import { PaperService } from '../src/modules/ai/paper.service';

const RULE: RuleSnapshot = {
  totalCents: 10000,
  passCents: 6000,
  durationMinutes: 30,
  maxAttempts: 3,
  partialCreditRatio: 0.5,
  rules: [{ type: 'single', count: 1, scoreCents: 10000 }],
};

function snapshot(
  questionId: string,
  difficulty: Difficulty,
  regulationId?: string,
): QuestionVersionSnapshot {
  return {
    questionId,
    versionId: `v-${questionId}`,
    revision: 1,
    categoryId: '7',
    difficulty,
    type: 'single' as QuestionType,
    stem: `发布时题干 ${questionId}`,
    options: [{ key: 'A', text: '发布时选项' }, { key: 'B', text: '干扰项' }],
    answer: [0],
    analysis: '发布时解析',
    rubric: null,
    scoreCents: 800,
    regulationId,
    source: 'manual',
    approvedBy: '9',
    approvedAt: '2026-10-21T08:00:00.000Z',
  };
}

function releaseFixture(regulationIds: string[]) {
  const paper: any = {
    id: '11', regulationId: null, title: '随机安全考试', totalScore: '100.00', passScore: '60.00',
    durationMinutes: 30, maxAttempts: 3, partialCreditRatio: '0.50', status: 'draft', createdBy: '1',
    businessScope: 'training', mode: 'random', categoryId: '7', requiresLearning: 0,
    regulationIds, courseIds: [], ruleConfig: structuredClone(RULE),
  };
  const manualEasy = snapshot('101', 'easy');
  const sourcedEasy = snapshot('102', 'easy', '9');
  const manualHard = snapshot('201', 'hard');
  const sourcedHard = snapshot('202', 'hard', '9');
  const candidates = [manualEasy, sourcedEasy, manualHard, sourcedHard];
  const releases: any[] = [];
  const releaseQuestions: any[] = [];
  const paperRepo = {
    findOne: vi.fn(async () => paper),
    find: vi.fn(async ({ where }: any) => (
      where.businessScope === 'training'
      && where.mode === 'random'
      && where.status === 'draft'
      && String(where.categoryId) === String(paper.categoryId)
        ? [paper]
        : []
    )),
    save: vi.fn(async (value: any) => value),
  };
  const paperQuestionRepo = { find: vi.fn(async () => []) };
  const releaseRepo = {
    create: vi.fn((value: any) => ({ ...value })),
    save: vi.fn(async (value: any) => {
      const saved = { id: String(releases.length + 1), ...value };
      releases.push(saved);
      return saved;
    }),
    findOne: vi.fn(async ({ where }: any) => releases.find((item) => String(item.id) === String(where.id)) || null),
  };
  const releaseQuestionRepo = {
    create: vi.fn((value: any) => ({ ...value })),
    save: vi.fn(async (values: any[]) => {
      const saved = values.map((value, index) => ({ id: String(index + 1), ...value }));
      releaseQuestions.push(...saved);
      return saved;
    }),
    find: vi.fn(async ({ where }: any) => releaseQuestions.filter((item) => item.releaseId === String(where.releaseId))),
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === ExamPaper) return paperRepo;
      if (entity === PaperQuestion) return paperQuestionRepo;
      if (entity === PaperRelease) return releaseRepo;
      if (entity === PaperReleaseQuestion) return releaseQuestionRepo;
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    },
  };
  const approvedCandidates = vi.fn(async (filter: { difficulty: Difficulty; regulationIds?: string[] }) => candidates.filter((item) => (
    item.difficulty === filter.difficulty
      && (!filter.regulationIds?.length || Boolean(item.regulationId && filter.regulationIds.includes(item.regulationId)))
  )));
  const registerRandomDraftMediaResolver = vi.fn();
  const service = Object.create(PaperReleaseService.prototype) as PaperReleaseService & Record<string, any>;
  Object.assign(service, {
    releaseRepo,
    paperRepo,
    releaseQuestionRepo,
    dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
    categories: { lockActive: vi.fn(async () => ({ id: '7', status: 1 })) },
    questions: { approvedCandidates, registerRandomDraftMediaResolver },
    sampling: new SamplingService(),
    audit: { log: vi.fn() },
  });
  return {
    service,
    paper,
    candidates,
    approvedCandidates,
    paperRepo,
    releaseRepo,
    releaseQuestionRepo,
    registerRandomDraftMediaResolver,
  };
}

describe('immutable paper releases', () => {
  it('registers a random-draft media lookup that reuses the fully validated candidate pool without writes', async () => {
    const {
      service,
      approvedCandidates,
      paperRepo,
      releaseRepo,
      releaseQuestionRepo,
      registerRandomDraftMediaResolver,
    } = releaseFixture([]);

    service.onModuleInit();
    const resolver = registerRandomDraftMediaResolver.mock.calls[0]?.[0];

    await expect(resolver('v-101', '7')).resolves.toMatchObject({ versionId: 'v-101', categoryId: '7' });
    await expect(resolver('v-101', '8')).resolves.toBeNull();

    expect(paperRepo.find).toHaveBeenCalledWith({
      where: { businessScope: 'training', mode: 'random', status: 'draft', categoryId: '7' },
      order: { id: 'ASC' },
    });
    expect(approvedCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: '7', type: 'single', difficulty: 'easy' }),
      undefined,
    );
    expect(approvedCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: '7', type: 'single', difficulty: 'hard' }),
      undefined,
    );
    expect(releaseRepo.save).not.toHaveBeenCalled();
    expect(releaseQuestionRepo.save).not.toHaveBeenCalled();
    expect(paperRepo.save).not.toHaveBeenCalled();
  });

  it('skips only explicit non-previewable random drafts while surfacing unexpected lookup failures', async () => {
    const inactive = releaseFixture([]);
    inactive.approvedCandidates.mockRejectedValue(Errors.categoryInactive());
    inactive.service.onModuleInit();
    const inactiveResolver = inactive.registerRandomDraftMediaResolver.mock.calls[0]?.[0];

    await expect(inactiveResolver('v-101', '7')).resolves.toBeNull();

    const invalid = releaseFixture([]);
    invalid.approvedCandidates.mockResolvedValue([]);
    invalid.service.onModuleInit();
    const invalidResolver = invalid.registerRandomDraftMediaResolver.mock.calls[0]?.[0];

    await expect(invalidResolver('v-101', '7')).resolves.toBeNull();

    const invalidRule = releaseFixture([]);
    invalidRule.paper.ruleConfig.rules = [
      { type: 'single', count: 1, scoreCents: 5000 },
      { type: 'single', count: 1, scoreCents: 5000 },
    ];
    invalidRule.service.onModuleInit();
    const invalidRuleResolver = invalidRule.registerRandomDraftMediaResolver.mock.calls[0]?.[0];

    await expect(invalidRuleResolver('v-101', '7')).resolves.toBeNull();

    const unexpected = releaseFixture([]);
    unexpected.approvedCandidates.mockRejectedValue(new Error('candidate lookup failed'));
    unexpected.service.onModuleInit();
    const unexpectedResolver = unexpected.registerRandomDraftMediaResolver.mock.calls[0]?.[0];

    await expect(unexpectedResolver('v-101', '7')).rejects.toThrow('candidate lookup failed');
  });

  it('deep-freezes the current approved candidate contents when publishing', async () => {
    const { service, candidates } = releaseFixture([]);

    const { releaseId } = await service.publish('11', '9');
    const releaseBeforeEdit = await service.get(releaseId);
    (candidates[0] as any).stem = '发布后被修改的题干';
    (candidates[0] as any).options[0].text = '发布后被修改的选项';
    (candidates[0] as any).answer = [1];
    const releaseAfterEdit = await service.get(releaseId);

    expect(releaseAfterEdit.pool).toEqual(releaseBeforeEdit.pool);
    expect(releaseAfterEdit.pool.find((item) => item.questionId === '101')).toMatchObject({
      stem: '发布时题干 101', answer: [0], scoreCents: 10000,
    });
  });

  it('includes manual questions without a regulation only when no regulation filter was configured', async () => {
    const withoutFilter = releaseFixture([]);
    const withFilter = releaseFixture(['9']);

    const unfilteredRelease = await withoutFilter.service.publish('11', '9');
    const filteredRelease = await withFilter.service.publish('11', '9');
    const withoutRegulationFilter = (await withoutFilter.service.get(unfilteredRelease.releaseId)).pool.map((item) => item.questionId);
    const withRegulationFilter = (await withFilter.service.get(filteredRelease.releaseId)).pool.map((item) => item.questionId);

    expect(withoutRegulationFilter).toContain('101');
    expect(withRegulationFilter).not.toContain('101');
    expect(withFilter.approvedCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ regulationIds: ['9'] }),
      expect.anything(),
    );
  });

  it('stores the exact release rule and marks the training paper published without enabling a learning gate', async () => {
    const { service, paper } = releaseFixture([]);

    const result = await service.publish('11', '9');
    const published = await service.get(result.releaseId);

    expect(published).toMatchObject({
      id: result.releaseId,
      paperId: '11',
      categoryId: '7',
      businessScope: 'training',
      mode: 'random',
      requiresLearning: false,
      rule: RULE,
    });
    expect(paper.status).toBe('published');
  });

  it('does not present random-pool capacity rows for a fixed-paper preview', async () => {
    const service = Object.create(PaperReleaseService.prototype) as PaperReleaseService & Record<string, any>;
    Object.assign(service, {
      paperRepo: { findOne: vi.fn(async () => ({ id: '11', businessScope: 'training', mode: 'fixed' })) },
      latestForPaper: vi.fn(async () => ({
        id: '21', paperId: '11', categoryId: '7', businessScope: 'training', mode: 'fixed',
        rule: RULE, pool: [snapshot('101', 'medium')], requiresLearning: false,
      })),
      sampling: new SamplingService(),
    });

    const preview = await service.preview('11');

    expect(preview.sample_kind).toBe('fixed_paper');
    expect(preview.capacities).toEqual([]);
  });

  it('serializes the internal rule snapshot with snake_case HTTP fields', () => {
    const view = paperPreviewView({
      paper_id: '11', release_id: '21', mode: 'fixed', sample_kind: 'fixed_paper', note: '固定卷',
      difficulty: null, rule: RULE, capacities: [], questions: [snapshot('101', 'medium')],
    }, false);

    expect(view.rule).toEqual({
      total_cents: 10000,
      pass_cents: 6000,
      duration_minutes: 30,
      max_attempts: 3,
      partial_credit_ratio: 0.5,
      rules: [{ type: 'single', count: 1, score_cents: 10000 }],
    });
    expect(Object.hasOwn(view.questions[0], 'answer')).toBe(false);
  });
});

describe('legacy exam compatibility boundary', () => {
  it('does not route a release-backed training paper through the legacy regulation start guards', async () => {
    const service = Object.create(ExamService.prototype) as ExamService & Record<string, any>;
    const regulationLookup = vi.fn();
    Object.assign(service, {
      userContext: vi.fn(async () => ({ id: '31', role: 'employee', departmentId: '2' })),
      paperRepo: { findOne: vi.fn(async () => ({ id: '11', businessScope: 'training', regulationId: null, status: 'published' })) },
      regRepo: { findOne: regulationLookup },
    });

    await expect(service.start('11', 31)).rejects.toMatchObject({ code: 40402 });
    expect(regulationLookup).not.toHaveBeenCalled();
  });
});

function paperAdminFixture(paperOverride: Record<string, unknown> = {}) {
  const paper: any = {
    id: '11', title: '培训考试', regulationId: null, status: 'draft', businessScope: 'training', mode: 'fixed',
    categoryId: '7', requiresLearning: 0, regulationIds: [], courseIds: [], ruleConfig: null,
    totalScore: '100.00', passScore: '60.00', durationMinutes: 30, maxAttempts: 3, partialCreditRatio: '0.50',
    ...paperOverride,
  };
  const savedQuestions: any[] = [];
  const paperRepo = {
    create: vi.fn((value: any) => ({ ...value })),
    save: vi.fn(async (value: any) => {
      Object.assign(paper, value, { id: value.id || paper.id });
      return paper;
    }),
    findOne: vi.fn(async () => paper),
  };
  const paperQuestionRepo = {
    create: vi.fn((value: any) => ({ ...value })),
    delete: vi.fn(async () => ({ affected: savedQuestions.splice(0).length })),
    save: vi.fn(async (values: any[]) => { savedQuestions.push(...values); return values; }),
    find: vi.fn(async () => savedQuestions),
  };
  const versions = ['single', 'multiple', 'judgment', 'image'].map((type, index) => ({
    id: String(501 + index), questionId: String(101 + index), revision: 1, categoryId: '7', difficulty: 'medium', type,
    stem: `${type} 题`, options: type === 'image' ? [] : [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
    answer: type === 'image' ? [] : type === 'multiple' ? [0, 1] : [0], analysis: null,
    rubric: type === 'image' ? '按风险点评分' : null, scoreCents: 2500, conceptId: `concept-${index + 1}`,
    regulationId: index === 0 ? '1' : index === 1 ? '2' : null, regulationVersionId: null,
    sourcePageGroup: null, sourcePageStart: null, sourcePageEnd: null, source: 'manual', status: 'approved',
    approvedBy: '9', approvedAt: new Date('2026-10-21T08:00:00.000Z'), reviewedBy: '9', reviewedAt: new Date(),
    reviewReason: null, createdBy: '9', legacyCapturedAt: null, createdAt: new Date(),
  }));
  const questions = versions.map((version) => ({ id: version.questionId, currentVersionId: version.id }));
  const manager = {
    getRepository(entity: unknown) {
      if (entity === ExamPaper) return paperRepo;
      if (entity === PaperQuestion) return paperQuestionRepo;
      if (entity === QuestionVersion) return { findBy: vi.fn(async () => versions) };
      if (entity === Question) return { findBy: vi.fn(async () => questions) };
      if (entity === Regulation || entity === TrainingCourse) return { findBy: vi.fn(async () => []) };
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    },
  };
  const service = Object.create(PaperService.prototype) as PaperService & Record<string, any>;
  Object.assign(service, {
    paperRepo,
    pqRepo: paperQuestionRepo,
    dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
    categories: { lockActive: vi.fn(async () => ({ id: '7', status: 1 })) },
    audit: { log: vi.fn() },
  });
  return { service, paper, paperRepo, paperQuestionRepo, savedQuestions, versions };
}

describe('training paper draft configuration', () => {
  it('creates a release-backed training draft with the default learning gate disabled', async () => {
    const { service, paper } = paperAdminFixture();

    const created = await service.createTraining({
      title: '随机考试', mode: 'random', category_id: '7', regulation_ids: [], course_ids: [],
      rules: [{ type: 'single', count: 2, score_cents: 5000 }],
    }, { id: '9', name: 'admin' }, null);

    expect(created).toMatchObject({
      id: '11', business_scope: 'training', mode: 'random', category_id: '7', requires_learning: false,
    });
    expect(paper.ruleConfig).toMatchObject({ totalCents: 10000, passCents: 6000, rules: [{ scoreCents: 5000 }] });
  });

  it('accepts all four approved types and medium difficulty in one fixed same-category paper across regulations', async () => {
    const { service, savedQuestions } = paperAdminFixture();

    const detail = await service.setTrainingQuestions('11', [
      { question_version_id: '501', score_cents: 2500 },
      { question_version_id: '502', score_cents: 2500 },
      { question_version_id: '503', score_cents: 2500 },
      { question_version_id: '504', score_cents: 2500 },
    ], { id: '9', name: 'admin' }, null);

    expect(savedQuestions.map((item) => item.questionVersionId)).toEqual(['501', '502', '503', '504']);
    expect(new Set(savedQuestions.map((item) => item.conceptId)).size).toBe(4);
    expect(detail.sum_score_cents).toBe(10000);
  });

  it('accepts different per-question scores for independent fixed questions of the same type', async () => {
    const fixture = paperAdminFixture();
    fixture.versions[1].type = 'single';

    const detail = await fixture.service.setTrainingQuestions('11', [
      { question_version_id: '501', score_cents: 3000 },
      { question_version_id: '502', score_cents: 2000 },
      { question_version_id: '503', score_cents: 2500 },
      { question_version_id: '504', score_cents: 2500 },
    ], { id: '9', name: 'admin' }, null);

    expect(detail.sum_score_cents).toBe(10000);
    expect(fixture.paper.ruleConfig.rules).toEqual(expect.arrayContaining([
      { type: 'single', count: 1, scoreCents: 3000 },
      { type: 'single', count: 1, scoreCents: 2000 },
    ]));
  });

  it('rejects a duplicate concept before replacing the saved fixed question list', async () => {
    const fixture = paperAdminFixture();
    fixture.versions[1].conceptId = fixture.versions[0].conceptId;

    await expect(fixture.service.setTrainingQuestions('11', [
      { question_version_id: '501', score_cents: 5000 },
      { question_version_id: '502', score_cents: 5000 },
    ], { id: '9', name: 'admin' }, null)).rejects.toMatchObject({ code: 40972 });
    expect(fixture.paperQuestionRepo.delete).not.toHaveBeenCalled();
  });

  it('keeps a published training paper immutable while leaving the legacy strategy method separate', async () => {
    const { service, paperRepo } = paperAdminFixture({ status: 'published' });

    await expect(service.updateTraining('11', { title: '试图改写发布卷' }, { id: '9', name: 'admin' }, null))
      .rejects.toMatchObject({ code: 40970 });
    expect(paperRepo.save).not.toHaveBeenCalled();
  });
});
