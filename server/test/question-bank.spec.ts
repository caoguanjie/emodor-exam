import { describe, expect, it, vi } from 'vitest';
import {
  validateAndSanitizeQuestionDraft,
  type QuestionDraftInput,
} from '../src/modules/questions/question-validator';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';
import { QuestionConceptService } from '../src/modules/questions/question-concept.service';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { QuestionConcept } from '../src/entities/question-concept.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { QuestionReviewService } from '../src/modules/ai/question-review.service';
import { QuestionGenerationService } from '../src/modules/ai/question-generation.service';
import { PaperService } from '../src/modules/ai/paper.service';
import { ExamService } from '../src/modules/exams/exam.service';
import { DtoValidationPipe, StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';
import {
  CreateQuestionDto, EditQuestionDto, GenerateQuestionsDto, QUESTION_CREATE_KEYS, QUESTION_EDIT_KEYS,
} from '../src/modules/questions/question.dto';

function baseDraft(overrides: Partial<QuestionDraftInput> = {}): QuestionDraftInput {
  return {
    categoryId: '11',
    difficulty: 'easy',
    type: 'single',
    stem: '<p>进入受限空间前应做什么？</p>',
    options: [
      { key: 'A', text: '先通风并检测' },
      { key: 'B', text: '直接进入' },
    ],
    answer: [0],
    analysis: '<p>先通风、检测并履行审批。</p>',
    source: 'manual',
    ...overrides,
  };
}

describe('training question bank validation', () => {
  it('accepts score-free manual creation and revision contracts and ignores the old score field', async () => {
    const input = { category_id: '11', difficulty: 'easy', type: 'single', stem: '<p>题干</p>',
      options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0] };
    for (const [metatype, keys, body] of [
      [CreateQuestionDto, QUESTION_CREATE_KEYS, input],
      [EditQuestionDto, QUESTION_EDIT_KEYS, { expected_version_id: '101', analysis: '新解析' }],
    ] as const) {
      const pipe = new StrictDtoValidationPipe(keys);
      await expect(pipe.transform(body, { type: 'body', metatype } as any)).resolves.toMatchObject(body);
      const legacy = await pipe.transform({ ...body, score: 'ignored-invalid-score' }, { type: 'body', metatype } as any);
      expect(legacy).toMatchObject(body); expect(legacy).not.toHaveProperty('score');
    }
  });

  it('validates a draft without manufacturing a bank score', () => {
    const input: any = baseDraft(); delete input.scoreCents;
    const result = validateAndSanitizeQuestionDraft(input);
    expect(result).not.toHaveProperty('scoreCents');
  });

  it('keeps category and difficulty fixed while accepting a manual question without regulation source', () => {
    const result = validateAndSanitizeQuestionDraft(baseDraft());

    expect(result.categoryId).toBe('11');
    expect(result.difficulty).toBe('easy');
    expect(result.regulationId).toBeUndefined();
    expect(result.regulationVersionId).toBeUndefined();
  });

  it('rejects unknown question types instead of treating them as image questions', () => {
    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ type: 'essay' as any })))
      .toThrow('题型非法');
  });

  it('accepts the three objective question shapes and rejects image-answer questions', () => {
    expect(validateAndSanitizeQuestionDraft(baseDraft({ type: 'single', answer: [0] })).answer).toEqual([0]);
    expect(validateAndSanitizeQuestionDraft(baseDraft({ type: 'multiple', answer: [1, 0] })).answer).toEqual([0, 1]);

    const judgment = validateAndSanitizeQuestionDraft(baseDraft({
      type: 'judgment',
      options: [
        { key: 'A', text: '正确' },
        { key: 'B', text: '错误' },
      ],
      answer: [1],
    }));
    expect(judgment.options).toEqual([
      { key: 'A', text: '正确' },
      { key: 'B', text: '错误' },
    ]);

    expect(() => validateAndSanitizeQuestionDraft(baseDraft({
      type: 'image' as any,
      options: [],
      answer: [],
    }))).toThrow('题型非法');

    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ type: 'single', answer: [0, 1] })))
      .toThrow('单选题答案必须唯一');
    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ type: 'multiple', answer: [0] })))
      .toThrow('多选题答案至少 2 个');
  });

  it('starts AI generation by quantity without any score template or total-score requirement', async () => {
    const service = Object.create(QuestionGenerationService.prototype) as QuestionGenerationService & Record<string, any>;
    const tasks: any[] = [];
    Object.assign(service, {
      categories: { assertActive: async () => undefined },
      regRepo: { findOne: async () => ({ id: '21' }) },
      versionRepo: { findOne: async () => ({ id: '34', parseStatus: 'parsed', textContent: '资料正文' }) },
      aiConfig: { isConfigured: async () => true },
      redis: { setNx: async () => true },
      setTask: async (_id: string, task: any) => { tasks.push(task); },
      runTask: async () => undefined,
    });
    const result = await service.start({ materialId: '21', materialVersionId: '34', categoryId: '11', difficulty: 'easy',
      questionCountSingle: 1, questionCountMultiple: 0, actor: { id: 9, name: 'admin' } } as any);
    expect(result).toMatchObject({ question_count_single: 1, question_count_multiple: 0 });
    expect(result).not.toHaveProperty('score_single'); expect(result).not.toHaveProperty('score_multiple');
    expect(tasks[0]).not.toHaveProperty('score_single'); expect(tasks[0]).not.toHaveProperty('score_multiple');
  });

  it('accepts AI generation input by exact material and material-version ids', async () => {
    const pipe = new DtoValidationPipe();

    await expect(pipe.transform({
      material_id: '21',
      material_version_id: '34',
      category_id: '11',
      difficulty: 'easy',
      score_single: 'ignored-nonnumeric', score_multiple: null,
    }, { type: 'body', metatype: GenerateQuestionsDto } as any)).resolves.toMatchObject({
      material_id: '21',
      material_version_id: '34',
      category_id: '11',
      difficulty: 'easy',
    });
  });

  it('rejects the removed image-scoring rubric from objective question input', async () => {
    const pipe = new StrictDtoValidationPipe(QUESTION_CREATE_KEYS);

    await expect(pipe.transform({
      category_id: '11', difficulty: 'easy', type: 'single', stem: '<p>题干</p>',
      options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0],
      analysis: '<p>解析</p>', rubric: '<p>已取消字段</p>', score: 5,
    }, { type: 'body', metatype: CreateQuestionDto } as any)).rejects.toMatchObject({ status: 400 });
  });

  it('sanitizes active content and records controlled media ids', () => {
    const result = validateAndSanitizeQuestionDraft(baseDraft({
      stem: '<p onclick="steal()">题干<script>alert(1)</script><img data-media-id="42" alt="现场图"></p>',
      analysis: '<a href="javascript:alert(1)">解析</a>',
    }));

    expect(result.stem).not.toContain('<script');
    expect(result.stem).not.toContain('onclick');
    expect(result.analysis).not.toContain('javascript:');
    expect(result.mediaAssetIds).toEqual(['42']);
    expect(result.stem).toContain('data-media-id="42"');
  });

  it('rejects arbitrary external image URLs', () => {
    expect(() => validateAndSanitizeQuestionDraft(baseDraft({
      stem: '<p>题干<img src="https://example.com/tracker.png"></p>',
    }))).toThrow('图片只能引用受控媒体');
  });

  it('requires an actual regulation source version for AI questions', () => {
    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ source: 'ai' }))).toThrow('AI 题必须记录实际制度及来源版本');
  });
});

function versionServiceFixture() {
  const question: any = {
    id: '5',
    regulationId: '2',
    versionId: '3',
    categoryId: null,
    difficulty: null,
    conceptId: null,
    currentVersionId: null,
    type: 'single',
    stem: '<p>原始题干</p>',
    options: [{ key: 'A', text: '原答案' }, { key: 'B', text: '干扰项' }],
    answer: [0],
    analysis: '<p>原解析</p>',
    score: '2.50',
    status: 'approved',
    source: 'ai',
    createdBy: '1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const versions: any[] = [];
  let nextVersionId = 100;
  const questionRepo = {
    findOne: vi.fn(async ({ where }: any) => String(where.id) === question.id ? question : null),
    save: vi.fn(async (value: any) => value),
  };
  const versionRepo = {
    create: (value: any) => ({ ...value }),
    save: vi.fn(async (value: any) => {
      if (!value.id) value.id = String(nextVersionId++);
      const index = versions.findIndex((item) => item.id === value.id);
      if (index >= 0) versions[index] = value;
      else versions.push(value);
      return value;
    }),
    findOne: vi.fn(async ({ where }: any) => versions.find((item) => item.id === String(where.id)) || null),
  };
  const manager = {
    getRepository(entity: any) {
      if (entity === Question) return questionRepo;
      if (entity === QuestionVersion) return versionRepo;
      throw new Error(`unexpected repository ${entity?.name}`);
    },
  };
  const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
  service.questionRepo = questionRepo;
  service.versionRepo = versionRepo;
  service.dataSource = { transaction: async (callback: (value: any) => Promise<unknown>) => callback(manager) };
  service.categories = { lockActive: vi.fn(async () => ({ id: '11', status: 1 })) };
  service.concepts = { assertCompatible: vi.fn(async () => undefined) };
  service.media = {
    assertUsable: vi.fn(async () => undefined),
    bind: vi.fn(async () => undefined),
    registerOwnerPolicy: vi.fn(),
  };
  service.access = { permissions: vi.fn(async () => ['questions:read']) };
  service.regulationRepo = { findOne: vi.fn(async () => ({ id: '2', currentVersionId: '3' })) };
  service.regulationVersionRepo = { findOne: vi.fn(async () => ({ id: '3', regulationId: '2' })) };
  return { service, question, versions };
}

function questionMediaPolicyFixture(input: {
  permissions: (actorId: string) => string[];
  version: Record<string, unknown> | null;
  draftReferenced?: boolean;
  releaseSnapshots?: Array<Record<string, unknown>>;
  randomCandidate?: Record<string, unknown> | null;
}) {
  let policy: any;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('paper_question')) return input.draftReferenced ? [{ readable: 1 }] : [];
    if (sql.includes('paper_release_question')) {
      return (input.releaseSnapshots || []).map((snapshot_json) => ({ snapshot_json }));
    }
    throw new Error(`unexpected media authorization query: ${sql}`);
  });
  const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
  Object.assign(service, {
    media: { registerOwnerPolicy: vi.fn((_ownerType: string, value: any) => { policy = value; }) },
    access: { permissions: vi.fn(async (actorId: string) => input.permissions(actorId)) },
    versionRepo: { findOne: vi.fn(async () => input.version) },
    dataSource: { query },
  });
  service.onModuleInit();
  const randomResolver = vi.fn(async () => input.randomCandidate || null);
  if ('randomCandidate' in input) service.registerRandomDraftMediaResolver(randomResolver);
  return { service, policy, query, randomResolver };
}

describe('versioned question bank', () => {
  it('sanitizes malicious legacy rich text at the response boundary without rewriting storage', async () => {
    const service = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    const storedStem = '<p onclick="steal()">旧题<script>alert(1)</script><img src="https://evil.test/x" onerror="steal()"><img data-media-id="42" alt="现场"></p>';
    service.versions = { current: vi.fn(async () => null) };
    const view = await service.questionView({
      id: '5', regulationId: null, versionId: null, categoryId: null, difficulty: null, conceptId: null,
      currentVersionId: null, type: 'single', stem: storedStem,
      options: [{ key: 'A', text: '<b onmouseover="steal()">答案</b>' }, { key: 'B', text: '否' }],
      answer: [0], analysis: '<a href="javascript:steal()">解析</a>', score: '5.00',
      status: 'approved', source: 'manual', createdAt: new Date(), updatedAt: new Date(),
    } as any);

    expect(view).not.toHaveProperty('score');
    expect(view.stem).not.toContain('<script');
    expect(view.stem).not.toContain('onclick');
    expect(view.stem).not.toContain('src=');
    expect(view.stem).toContain('data-media-id="42"');
    expect(view.options[0].text).not.toContain('onmouseover');
    expect(view.analysis).not.toContain('javascript:');
    expect(storedStem).toContain('onclick');
  });

  it('captures a legacy row before saving a pending revision', async () => {
    const { service, question, versions } = versionServiceFixture();

    const newVersionId = await service.revise('5', baseDraft({ stem: '<p>修订题干</p>', regulationId: '2', regulationVersionId: '3' }), '9');

    expect(newVersionId).toBe('101');
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ revision: 1, stem: '<p>原始题干</p>', status: 'approved', approvedBy: null });
    expect(versions[0].legacyCapturedAt).toBeInstanceOf(Date);
    expect(versions[0].scoreCents).toBe(250);
    expect(versions[1].scoreCents).toBeNull();
    expect(question.score).toBeNull();
    expect(versions[1]).toMatchObject({ revision: 2, stem: '<p>修订题干</p>', status: 'pending', createdBy: '9' });
    expect(question).toMatchObject({ currentVersionId: '101', stem: '<p>修订题干</p>', status: 'pending' });
  });

  it.each([
    { patch: { analysis: '新解析' }, concept: '7' },
    { patch: { category_id: '22' }, concept: null },
    { patch: { type: 'multiple' as const, answer: [0, 1] }, concept: null },
  ])('preserves hidden concept on ordinary edits and detaches it only from a changed category/type: $patch', async ({ patch, concept }) => {
    const f = versionServiceFixture();
    Object.assign(f.question, { categoryId: '11', difficulty: 'easy', conceptId: '7' });
    f.service.concepts.assertCompatible = async (_manager: unknown, _id: string, category: string, type: string) => {
      if (category !== '11' || type !== 'single') throw new Error('incompatible hidden concept');
    };
    const builder: any = { select: () => builder, from: () => builder, innerJoin: () => builder,
      where: () => builder, andWhere: () => builder, limit: () => builder, getRawOne: async () => null };
    const review = Object.create(QuestionReviewService.prototype);
    Object.assign(review, { questionRepo: { findOne: async () => f.question }, versions: f.service,
      dataSource: { createQueryBuilder: () => builder }, audit: { log: () => undefined } });
    const result = await review.edit('5', patch, { id: 9, name: 'admin' }, null, null);
    expect(result.concept_id).toBe(concept);
    expect(f.versions[0].conceptId).toBe('7');
    expect(f.versions[1].conceptId).toBe(concept);
    expect(f.versions[1].regulationId).toBe('2');
    expect(f.versions[1].regulationVersionId).toBe('3');
  });

  it('records the actual administrator and time when approving the current revision', async () => {
    const { service, question, versions } = versionServiceFixture();
    await service.revise('5', baseDraft({ regulationId: '2', regulationVersionId: '3' }), '9');

    await service.approve('101', '27');

    expect(versions[1].status).toBe('approved');
    expect(versions[1].approvedBy).toBe('27');
    expect(versions[1].approvedAt).toBeInstanceOf(Date);
    expect(question.status).toBe('approved');
  });

  it('rejects a stale expected version before creating a revision', async () => {
    const { service, question, versions } = versionServiceFixture();
    question.categoryId = '11';
    question.difficulty = 'medium';
    question.currentVersionId = '99';
    versions.push({
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'medium', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
      source: 'ai', status: 'approved', approvedBy: '1', approvedAt: new Date(), reviewedBy: '1',
      reviewedAt: new Date(), reviewReason: null, createdBy: '1', legacyCapturedAt: null,
    });

    await expect((service as any).revise(
      '5', baseDraft({ regulationId: '2', regulationVersionId: '3' }), '9', '98',
    )).rejects.toMatchObject({ code: 40940 });
    expect(versions).toHaveLength(1);
    expect(question.currentVersionId).toBe('99');
  });

  it('rejects a stale review without changing the current version or review state', async () => {
    const { service, question, versions } = versionServiceFixture();
    question.categoryId = '11';
    question.difficulty = 'medium';
    question.currentVersionId = '99';
    const current = {
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'medium', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
      source: 'ai', status: 'pending', approvedBy: null, approvedAt: null, reviewedBy: null,
      reviewedAt: null, reviewReason: null, createdBy: '1', legacyCapturedAt: null,
    };
    versions.push(current);

    await expect(service.reviewCurrent('5', '98', 'approved', '9'))
      .rejects.toMatchObject({ code: 40940 });
    expect(versions).toHaveLength(1);
    expect(current).toMatchObject({ status: 'pending', approvedBy: null, reviewedBy: null });
    expect(question).toMatchObject({ currentVersionId: '99', status: 'approved' });
  });

  it('binds each controlled rich-text image to the immutable question version', async () => {
    const { service } = versionServiceFixture();

    await service.revise('5', baseDraft({
      stem: '<p>带图题干<img data-media-id="42" alt="现场图"></p>',
      regulationId: '2', regulationVersionId: '3',
    }), '9');

    expect((service as any).media.assertUsable).toHaveBeenCalledWith('9', '42', 'question');
    expect((service as any).media.bind).toHaveBeenCalledWith(expect.anything(), '42', 'question_version', '101');
  });

  it('reuses media already belonging to the same question without requiring the new editor to own the upload', async () => {
    const { service, question, versions } = versionServiceFixture();
    question.categoryId = '11';
    question.difficulty = 'medium';
    question.currentVersionId = '99';
    question.stem = '<p>原图<img data-media-id="42"></p>';
    versions.push({
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'medium', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
      source: 'ai', status: 'approved', approvedBy: '1', approvedAt: new Date(), reviewedBy: '1',
      reviewedAt: new Date(), reviewReason: null, createdBy: '1', legacyCapturedAt: null,
    });

    const nextId = await service.revise('5', baseDraft({
      stem: question.stem,
      regulationId: '2', regulationVersionId: '3',
    }), '9');

    expect(nextId).toBe('100');
    expect((service as any).media.assertUsable).not.toHaveBeenCalled();
    expect((service as any).media.bind).toHaveBeenCalledWith(expect.anything(), '42', 'question_version', '100');
  });

  it('lets a paper reader load only prompt assets from an exact fixed draft reference', async () => {
    const { policy } = questionMediaPolicyFixture({
      permissions: () => ['papers:read'],
      draftReferenced: true,
      version: {
        id: '701', stem: '<p><img data-media-id="11"></p>',
        options: [{ key: 'A', text: '<img data-media-id="12">' }],
        analysis: '<p><img data-media-id="13"></p>',
      },
    });

    await expect(policy.authorizeRead('8', '701', '11')).resolves.toBe(true);
    await expect(policy.authorizeRead('8', '701', '12')).resolves.toBe(true);
    await expect(policy.authorizeRead('8', '701', '13')).resolves.toBe(false);
    await expect(policy.authorizeRead('8', '701', '14')).resolves.toBe(false);
    await expect(policy.authorizeRead('8', '701', '99')).resolves.toBe(false);
  });

  it('uses an immutable release snapshot for historical field authorization and accepts either export permission for answer-only assets', async () => {
    const { policy } = questionMediaPolicyFixture({
      permissions: (actorId) => actorId === 'exporter'
        ? ['papers:export', 'papers:read']
        : actorId === 'question-exporter' ? ['questions:export', 'papers:read']
          : actorId === 'question-export-only' ? ['questions:export']
        : actorId === 'reader' ? ['papers:read'] : [],
      version: {
        id: '701', stem: '<p><img data-media-id="91"></p>', options: [], analysis: null,
      },
      releaseSnapshots: [{
        versionId: '701', stem: '<p><img data-media-id="21"></p>',
        options: [{ key: 'A', text: '<img data-media-id="22">' }],
        analysis: '<p><img data-media-id="23"></p>',
      }],
    });

    await expect(policy.authorizeRead('reader', '701', '21')).resolves.toBe(true);
    await expect(policy.authorizeRead('reader', '701', '23')).resolves.toBe(false);
    await expect(policy.authorizeRead('exporter', '701', '23')).resolves.toBe(true);
    await expect(policy.authorizeRead('question-exporter', '701', '23')).resolves.toBe(true);
    await expect(policy.authorizeRead('question-export-only', '701', '23')).resolves.toBe(false);
    await expect(policy.authorizeRead('exporter', '701', '91')).resolves.toBe(false);
    await expect(policy.authorizeRead('none', '701', '21')).resolves.toBe(false);
  });

  it('authorizes exact fields from a validated random-draft candidate without a stored paper reference', async () => {
    const { policy, query, randomResolver } = questionMediaPolicyFixture({
      permissions: (actorId) => actorId === 'question-exporter'
        ? ['papers:read', 'questions:export']
        : ['papers:read'],
      version: {
        id: '801', categoryId: '7', stem: '<p>current</p>', options: [], analysis: null,
      },
      randomCandidate: {
        versionId: '801', categoryId: '7', stem: '<p><img data-media-id="31"></p>',
        options: [{ key: 'A', text: '<img data-media-id="32">' }],
        analysis: '<p><img data-media-id="33"></p>',
      },
    });

    await expect(policy.authorizeRead('reader', '801', '31')).resolves.toBe(true);
    await expect(policy.authorizeRead('reader', '801', '32')).resolves.toBe(true);
    await expect(policy.authorizeRead('reader', '801', '33')).resolves.toBe(false);
    await expect(policy.authorizeRead('question-exporter', '801', '33')).resolves.toBe(true);
    await expect(policy.authorizeRead('question-exporter', '801', '99')).resolves.toBe(false);

    expect(randomResolver).toHaveBeenCalledWith('801', '7');
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls.every(([sql]) => String(sql).includes('paper_release_question'))).toBe(true);
  });

  it('refuses duplicate random-draft media resolver registration', () => {
    const { service } = questionMediaPolicyFixture({
      permissions: () => [],
      version: null,
      randomCandidate: null,
    });

    expect(() => service.registerRandomDraftMediaResolver(async () => null)).toThrow(/重复注册/);
  });

  it('denies an unreferenced random-version asset when no resolver was registered', async () => {
    const { policy } = questionMediaPolicyFixture({
      permissions: () => ['papers:read'],
      version: {
        id: '802', categoryId: '7', stem: '<p><img data-media-id="41"></p>', options: [], analysis: null,
      },
    });

    await expect(policy.authorizeRead('reader', '802', '41')).resolves.toBe(false);
  });

  it('preserves the existing question-reader owner policy without requiring an asset argument', async () => {
    const { policy, query } = questionMediaPolicyFixture({
      permissions: () => ['questions:read'],
      version: null,
    });

    await expect(policy.authorizeRead('question-reader', '701')).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns only immutable current approved candidates for the exact pool dimensions', async () => {
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
    const calls: Array<{ method: string; sql?: string; params?: unknown }> = [];
    const builder: any = {
      innerJoin: (_entity: unknown, _alias: string, sql: string) => { calls.push({ method: 'innerJoin', sql }); return builder; },
      where: (sql: string, params: unknown) => { calls.push({ method: 'where', sql, params }); return builder; },
      andWhere: (sql: string, params: unknown) => { calls.push({ method: 'andWhere', sql, params }); return builder; },
      orderBy: () => builder,
      getMany: async () => [{
        id: '501', questionId: '41', revision: 3, categoryId: '11', difficulty: 'hard', type: 'multiple',
        stem: '<p>题干</p>', options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }], answer: [0, 1],
        analysis: null, scoreCents: null, conceptId: null, regulationId: '2', regulationVersionId: '3',
        source: 'ai', status: 'approved', approvedBy: '27', approvedAt: new Date('2026-10-21T08:00:00.000Z'),
      }],
    };
    service.versionRepo = { createQueryBuilder: vi.fn(() => builder) };
    service.categories = { assertActive: vi.fn(async () => undefined) };

    const result = await service.approvedCandidates({
      categoryId: '11', regulationIds: ['2'], type: 'multiple', difficulty: 'hard',
    });

    expect(calls.some((call) => call.sql?.includes('question.current_version_id = version.id'))).toBe(true);
    expect(calls.some((call) => call.sql?.includes('version.status = :status'))).toBe(true);
    expect(calls.some((call) => call.sql?.includes('version.regulation_id IN'))).toBe(true);
    expect(service.categories.assertActive).toHaveBeenCalledWith('11');
    expect(result[0]).toMatchObject({ questionId: '41', versionId: '501', categoryId: '11', type: 'multiple', difficulty: 'hard' });
    expect(result[0]).not.toHaveProperty('scoreCents');
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it('rejects linking a concept from another category or question type', async () => {
    const service = Object.create(QuestionConceptService.prototype) as QuestionConceptService & Record<string, any>;
    const manager = {
      getRepository(entity: any) {
        if (entity !== QuestionConcept) throw new Error('unexpected repository');
        return { findOne: async () => ({ id: '7', categoryId: '12', type: 'single' }) };
      },
    };

    await expect(service.assertCompatible(manager as any, '7', '11', 'single')).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('scopes write-only concept options to an active category and exact question type', async () => {
    const service = Object.create(QuestionConceptService.prototype) as QuestionConceptService & Record<string, any>;
    const calls: Array<{ sql: string; params: unknown }> = [];
    const builder: any = {
      where: (sql: string, params: unknown) => { calls.push({ sql, params }); return builder; },
      andWhere: (sql: string, params: unknown) => { calls.push({ sql, params }); return builder; },
      getCount: vi.fn(async () => 1),
      orderBy: () => builder,
      skip: () => builder,
      take: () => builder,
      getMany: vi.fn(async () => [{ id: '7', categoryId: '11', type: 'single', name: '受限空间' }]),
    };
    service.categories = { assertActive: vi.fn(async () => undefined) };
    service.conceptRepo = { createQueryBuilder: vi.fn(() => builder) };

    const page = await service.options({ categoryId: '11', type: 'single', page: 1, pageSize: 20 });

    expect(service.categories.assertActive).toHaveBeenCalledWith('11');
    expect(calls).toContainEqual({ sql: 'concept.category_id = :categoryId', params: { categoryId: '11' } });
    expect(calls).toContainEqual({ sql: 'concept.type = :type', params: { type: 'single' } });
    expect(page).toEqual({ items: [{ id: '7', name: '受限空间' }], total: 1, page: 1, page_size: 20 });
  });

  it('paginates the new concept list contract with Page.items', async () => {
    const service = Object.create(QuestionConceptService.prototype) as QuestionConceptService & Record<string, any>;
    const builder: any = {
      where: () => builder,
      andWhere: () => builder,
      getCount: vi.fn(async () => 41),
      orderBy: () => builder,
      skip: vi.fn(() => builder),
      take: vi.fn(() => builder),
      getMany: vi.fn(async () => [{ id: '21', categoryId: '11', type: 'single', name: '第二页考点' }]),
    };
    service.conceptRepo = { createQueryBuilder: vi.fn(() => builder) };

    const page = await (service as any).list({ categoryId: '11', type: 'single', page: 2, pageSize: 20 });

    expect(page).toEqual({
      items: [{ id: '21', category_id: '11', type: 'single', name: '第二页考点' }],
      total: 41, page: 2, page_size: 20,
    });
    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(builder.take).toHaveBeenCalledWith(20);
  });

  it('paginates version history instead of returning an unbounded array', async () => {
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
    service.versionRepo = {
      findAndCount: vi.fn(async () => [[{
        id: '22', questionId: '5', revision: 22, status: 'pending', stem: '第二页版本',
        approvedBy: null, approvedAt: null, reviewedBy: null, reviewedAt: null, reviewReason: null,
        legacyCapturedAt: null, createdBy: '9', createdAt: new Date('2026-10-21T09:00:00.000Z'),
      }], 41]),
    };

    const page = await (service as any).history('5', { page: 2, pageSize: 20 });

    expect(page).toMatchObject({ total: 41, page: 2, page_size: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: '22', revision: 22, stem: '第二页版本' });
  });

  it('puts authoritative difficulty and the complete JSON shape into text and vision gateway messages', async () => {
    const service = Object.create(QuestionGenerationService.prototype) as QuestionGenerationService & Record<string, any>;
    const calls: any[][] = [];
    service.gateway = {
      chat: vi.fn(async (messages: any[]) => {
        calls.push(messages);
        return JSON.stringify([{
          type: 'single', stem: '题干',
          options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
          answer: [0], analysis: '解析',
        }]);
      }),
    };
    const regulation = { id: '2', title: '制度' } as any;
    const version = { id: '3' } as any;

    await service.generateBlock(regulation, version, 0, 1, { text: '制度原文' }, { single: 1, multiple: 0 }, new Set(), 'hard');
    await service.generateBlock(regulation, version, 1, 2, {
      pages: { startPage: 3, endPage: 4, images: ['data:image/png;base64,AAA'] },
    }, { single: 1, multiple: 0 }, new Set(), 'medium');

    const messageText = (messages: any[]) => messages.flatMap((message: any) => {
      if (typeof message.content === 'string') return [message.content];
      return message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text);
    }).join('\n');
    const textMessages = messageText(calls[0]);
    const visionMessages = messageText(calls[1]);
    expect(textMessages).toContain('高级（hard）');
    expect(textMessages).toContain('多条规则综合应用');
    expect(visionMessages).toContain('中级（medium）');
    expect(visionMessages).toContain('直接应用制度规则');
    for (const message of [textMessages, visionMessages]) {
      expect(message).toContain('"options"');
      expect(message).toContain('"answer"');
      expect(message).toContain('"analysis"');
      expect(message).toContain('恰好 4 个选项');
    }
  });

  it('rejects duplicate or four-choice multiple answers that violate the shared JSON contract', () => {
    const service = Object.create(QuestionGenerationService.prototype) as QuestionGenerationService & Record<string, any>;
    const parsed = service.parseQuestions(JSON.stringify([
      {
        type: 'multiple', stem: '重复答案',
        options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
        answer: [0, 0], analysis: '解析',
      },
      {
        type: 'multiple', stem: '全选答案',
        options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
        answer: [0, 1, 2, 3], analysis: '解析',
      },
    ]));

    expect(parsed).toEqual({ valid: [], invalidCount: 2 });
  });

  it('regenerates a scanned PDF question from its actual second page group with a complete hard-question contract', async () => {
    const q: any = {
      id: '5', currentVersionId: '101', regulationId: '2', versionId: '3', categoryId: '11', difficulty: 'hard',
      conceptId: '7', type: 'single', stem: '<p>旧题干</p>', options: [{ key: 'A', text: '旧 A' }, { key: 'B', text: '旧 B' }],
      answer: [0], analysis: '<p>旧解析</p>', score: '5.00', status: 'rejected', source: 'ai',
    };
    const cleanup = vi.fn(async () => undefined);
    const renderGroup = vi.fn(async (group: number) => ({
      startPage: group * 2 + 1, endPage: group * 2 + 2, images: [`data:image/png;base64,${group}`],
    }));
    const revise = vi.fn(async () => '102');
    const gateway = {
      chat: vi.fn(async (messages: any[]) => {
        expect(Array.isArray(messages[1].content)).toBe(true);
        expect(messages[1].content.some((item: any) => item.type === 'image_url')).toBe(true);
        const serialized = messages.flatMap((message: any) => {
          if (typeof message.content === 'string') return [message.content];
          return message.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text);
        }).join('\n');
        expect(serialized).toContain('高级（hard）');
        expect(serialized).toContain('恰好 4 个选项');
        expect(serialized).toContain('"answer"');
        expect(serialized).toContain('"analysis"');
        return JSON.stringify([{
          type: 'single', stem: '新题干',
          options: [{ text: '新 A' }, { text: '新 B' }, { text: '新 C' }, { text: '新 D' }],
          answer: [1], analysis: '新解析',
        }]);
      }),
    };
    const service = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    service.questionRepo = { findOne: async () => q };
    service.versionRepo = { findOne: async () => ({ id: '3', regulationId: '2', fileType: 'pdf', textContent: null }) };
    service.gateway = gateway;
    service.pdfVision = {
      shouldUseVision: vi.fn(() => true),
      prepare: vi.fn(async () => ({ groupCount: 2, pageCount: 4, renderGroup, cleanup })),
    };
    service.versions = {
      revise,
      current: vi.fn(async () => ({
        id: '101', revision: 1, sourcePageGroup: 1, sourcePageStart: 3, sourcePageEnd: 4,
        approvedBy: null, approvedAt: null, reviewedBy: null,
        reviewedAt: null, reviewReason: null, legacyCapturedAt: null,
      })),
    };
    service.dataSource = {
      createQueryBuilder: () => {
        const builder: any = { select: () => builder, from: () => builder, innerJoin: () => builder, where: () => builder, andWhere: () => builder, limit: () => builder, getRawOne: async () => null };
        return builder;
      },
    };
    service.audit = { log: vi.fn() };

    await (service as any).regenerate('5', { id: 9, name: 'admin' }, null, '101');

    expect(renderGroup).toHaveBeenCalledWith(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(revise).toHaveBeenCalledWith('5', expect.objectContaining({
      categoryId: '11', difficulty: 'hard', regulationId: '2', regulationVersionId: '3', source: 'ai',
      sourcePageGroup: 1, sourcePageStart: 3, sourcePageEnd: 4,
    }), '9', '101');
  });

  it('preserves the actual PDF page group through an analysis edit and uses it for the next regeneration', async () => {
    const { service: versions, question, versions: rows } = versionServiceFixture();
    Object.assign(question, {
      categoryId: '11', difficulty: 'hard', currentVersionId: '99', status: 'rejected',
    });
    rows.push({
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'hard', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
      sourcePageGroup: 1, sourcePageStart: 3, sourcePageEnd: 4,
      source: 'ai', status: 'rejected', approvedBy: null, approvedAt: null, reviewedBy: '1',
      reviewedAt: new Date(), reviewReason: '重做', createdBy: '1', legacyCapturedAt: null,
    });
    const renderGroup = vi.fn(async (group: number) => ({
      startPage: group * 2 + 1, endPage: group * 2 + 2, images: [`data:image/png;base64,${group}`],
    }));
    const review = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    review.questionRepo = { findOne: vi.fn(async () => question) };
    review.versionRepo = {
      findOne: vi.fn(async () => ({ id: '3', regulationId: '2', fileType: 'pdf', textContent: null })),
    };
    review.gateway = {
      chat: vi.fn(async () => JSON.stringify([{
        type: 'single', stem: '重生成题干',
        options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
        answer: [0], analysis: '重生成解析',
      }])),
    };
    review.pdfVision = {
      shouldUseVision: vi.fn(() => true),
      prepare: vi.fn(async () => ({
        groupCount: 2, pageCount: 4, renderGroup, cleanup: vi.fn(async () => undefined),
      })),
    };
    review.versions = versions;
    review.dataSource = {
      createQueryBuilder: () => {
        const builder: any = {
          select: () => builder, from: () => builder, innerJoin: () => builder, where: () => builder,
          andWhere: () => builder, limit: () => builder, getRawOne: async () => null,
        };
        return builder;
      },
    };
    review.audit = { log: vi.fn() };

    const edited = await review.edit(
      '5', { analysis: '<p>管理员仅修改解析</p>' }, { id: 9, name: 'admin' }, null, '99',
    );

    expect(edited.current_version_id).toBe('100');
    expect(rows[1]).toMatchObject({
      regulationId: '2', regulationVersionId: '3',
      sourcePageGroup: 1, sourcePageStart: 3, sourcePageEnd: 4,
    });

    await review.regenerate('5', { id: 9, name: 'admin' }, null, '100');

    expect(renderGroup).toHaveBeenCalledWith(1);
    expect(rows[2]).toMatchObject({
      regulationId: '2', regulationVersionId: '3',
      sourcePageGroup: 1, sourcePageStart: 3, sourcePageEnd: 4,
    });
  });

  it('returns the revision written by edit separately from a later current-version view', async () => {
    const q: any = {
      id: '5', currentVersionId: '101', regulationId: '2', versionId: '3', categoryId: '11', difficulty: 'medium',
      conceptId: null, type: 'single', stem: '<p>原题</p>', options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }],
      answer: [0], analysis: null, score: '5.00', status: 'approved', source: 'manual',
    };
    const service = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    service.questionRepo = { findOne: vi.fn(async () => q) };
    service.versions = { revise: vi.fn(async () => '102') };
    service.getOne = vi.fn(async () => ({ question_id: '5', current_version_id: '103', stem: '<p>并发后的题目</p>' }));
    service.audit = { log: vi.fn() };

    const edited = await service.edit(
      '5', { analysis: '<p>本次修改</p>' }, { id: 9, name: 'admin' }, null, '101',
    );

    expect(edited).toMatchObject({
      question_id: '5', current_version_id: '103', saved_version_id: '102', stem: '<p>并发后的题目</p>',
    });
    expect(service.versions.revise).toHaveBeenCalledWith('5', expect.any(Object), '9', '101');
  });

  it('returns the revision written by manual creation separately from a later current-version view', async () => {
    const service = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    service.versions = {
      create: vi.fn(async () => ({ questionId: '7', versionId: '201' })),
      approve: vi.fn(async () => undefined),
    };
    service.getOne = vi.fn(async () => ({ question_id: '7', current_version_id: '202', stem: '<p>并发后的题目</p>' }));
    service.audit = { log: vi.fn() };

    const created = await service.createManual({
      category_id: '11', difficulty: 'easy', type: 'single', stem: '<p>本次创建</p>',
      options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0],
    }, { id: 9, name: 'admin' }, null);

    expect(created).toMatchObject({
      question_id: '7', current_version_id: '202', saved_version_id: '201', stem: '<p>并发后的题目</p>',
    });
    expect(service.versions.approve).toHaveBeenCalledWith('201', '9');
    expect(service.versions.create.mock.calls[0][0]).not.toHaveProperty('scoreCents');
  });

  it('rejects a delayed regeneration when the current version changes and creates no wrong version', async () => {
    const { service: versions, question, versions: rows } = versionServiceFixture();
    question.categoryId = '11';
    question.difficulty = 'easy';
    question.currentVersionId = '99';
    rows.push({
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'easy', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
      source: 'ai', status: 'rejected', approvedBy: null, approvedAt: null, reviewedBy: '1',
      reviewedAt: new Date(), reviewReason: '重做', createdBy: '1', legacyCapturedAt: null,
    });

    let enterGateway!: () => void;
    const gatewayEntered = new Promise<void>((resolve) => { enterGateway = resolve; });
    let releaseGateway!: (value: string) => void;
    const gatewayResult = new Promise<string>((resolve) => { releaseGateway = resolve; });
    const review = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    review.questionRepo = { findOne: vi.fn(async () => question) };
    review.versionRepo = {
      findOne: vi.fn(async () => ({ id: '3', regulationId: '2', fileType: 'docx', textContent: '制度原文' })),
    };
    review.gateway = {
      chat: vi.fn(async () => {
        enterGateway();
        return gatewayResult;
      }),
    };
    review.pdfVision = { shouldUseVision: vi.fn(() => false) };
    review.versions = versions;
    review.dataSource = {
      createQueryBuilder: () => {
        const builder: any = {
          select: () => builder, from: () => builder, innerJoin: () => builder, where: () => builder,
          andWhere: () => builder, limit: () => builder, getRawOne: async () => null,
        };
        return builder;
      },
    };
    review.audit = { log: vi.fn() };

    const pending = review.regenerate('5', { id: 9, name: 'admin' }, null, '99');
    await gatewayEntered;
    question.currentVersionId = '100';
    releaseGateway(JSON.stringify([{
      type: 'single', stem: '延迟返回的新题干',
      options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
      answer: [0], analysis: '解析',
    }]));

    await expect(pending).rejects.toMatchObject({ code: 40940 });
    expect(rows).toHaveLength(1);
    expect(question.currentVersionId).toBe('100');
    expect(review.audit.log).not.toHaveBeenCalled();
  });

  it('rejects judgment questions at legacy fixed-paper editing and publish boundaries', async () => {
    const unsupported = { id: '7', regulationId: '2', type: 'judgment', status: 'approved', score: '100.00', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }] } as any;
    const paper = { id: '3', regulationId: '2', status: 'draft', totalScore: '100.00' } as any;
    const paperService = Object.create(PaperService.prototype) as PaperService & Record<string, any>;
    paperService.paperRepo = { findOne: vi.fn(async () => paper), save: vi.fn(async (value: any) => value) };
    paperService.questionRepo = { find: vi.fn(async () => [unsupported]) };
    paperService.pqRepo = {
      create: (value: any) => value,
      find: vi.fn(async () => [{ id: '9', paperId: '3', questionId: '7', score: '100.00', sort: 0 }]),
      createQueryBuilder: vi.fn(() => {
        const builder: any = { select: () => builder, where: () => builder, getRawOne: async () => ({ sum: '100.00' }) };
        return builder;
      }),
    };
    paperService.dataSource = { transaction: vi.fn(async (work: (manager: any) => Promise<unknown>) => work({
      getRepository(entity: unknown) {
        if (entity === ExamPaper) return paperService.paperRepo;
        if (entity === Question) return paperService.questionRepo;
        if (entity === PaperQuestion) return {
          ...paperService.pqRepo,
          delete: vi.fn(),
          save: vi.fn(),
        };
        throw new Error(`unexpected repository ${(entity as any)?.name}`);
      },
    })) };
    paperService.audit = { log: vi.fn() };
    paperService.detail = vi.fn(async () => ({}));

    await expect(paperService.setQuestions('3', [{ question_id: '7', score: 100 }], { id: 1, name: 'admin' }, null))
      .rejects.toThrow('固定试卷');
    await expect(paperService.publish('3', { id: 1, name: 'admin' }, null)).rejects.toThrow('固定试卷');

  });

  it('lets the old start boundary use its frozen source without reading current question rows', async () => {
    const response = { exam_record_id: 71, status: 'in_progress', questions: [] };
    const service = Object.create(ExamService.prototype) as ExamService & Record<string, any>;
    service.paperRepo = {
      findOne: vi.fn(async () => ({
        id: '3', regulationId: '2', businessScope: 'regulation', mode: 'fixed', status: 'published',
      })),
    };
    service.pqRepo = {
      find: vi.fn(async () => { throw new Error('current paper questions must not be read'); }),
    };
    service.legacyAdapter = { start: vi.fn(async () => response) };

    await expect(service.start('3', 1)).resolves.toEqual(response);
  });

  it.each([
    { label: 'submitted result', status: 'passed', score: '100.00' },
    { label: 'timeout result', status: 'timeout', score: '20.00' },
  ])('keeps the old recover terminal summary for a frozen $label', async ({ status, score }) => {
    const service = Object.create(ExamService.prototype) as ExamService & Record<string, any>;
    service.recordRepo = {
      findOne: vi.fn(async () => ({
        id: '71', paperId: '3', regulationId: '2', userId: '9', assignmentId: '31',
        status, score,
      })),
    };
    service.legacyAdapter = {
      recover: vi.fn(async () => { throw new Error('terminal record must not enter active recovery'); }),
    };

    await expect(service.recover('71', 9)).resolves.toEqual({
      exam_record_id: 71,
      status,
      score: Number(score),
      finished: true,
    });
  });

  it('blocks changing the type of any question already referenced by a legacy paper', async () => {
    const q: any = {
      id: '5', currentVersionId: '101', regulationId: '2', versionId: '3', categoryId: '11', difficulty: 'medium',
      conceptId: null, type: 'single', stem: '题干', options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }],
      answer: [0], analysis: null, score: '5.00', status: 'approved', source: 'manual',
    };
    let fromTable = '';
    const builder: any = {
      select: () => builder,
      from: (table: string) => { fromTable = table; return builder; },
      innerJoin: () => builder,
      where: () => builder,
      andWhere: () => builder,
      limit: () => builder,
      getRawOne: async () => fromTable === 'paper_question' ? { found: 1 } : null,
    };
    const service = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    service.questionRepo = { findOne: vi.fn(async () => q) };
    service.dataSource = { createQueryBuilder: () => builder };
    service.versions = { revise: vi.fn(async () => '102'), current: vi.fn(async () => null) };
    service.audit = { log: vi.fn() };

    await expect((service as any).edit('5', { type: 'judgment' }, { id: 9, name: 'admin' }, null, '101'))
      .rejects.toMatchObject({ code: 40908 });
    expect(service.versions.revise).not.toHaveBeenCalled();
  });
});
