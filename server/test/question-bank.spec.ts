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
import { QuestionReviewService } from '../src/modules/ai/question-review.service';

function baseDraft(overrides: Partial<QuestionDraftInput> = {}): QuestionDraftInput {
  return {
    categoryId: '11',
    difficulty: 'medium',
    type: 'single',
    stem: '<p>进入受限空间前应做什么？</p>',
    options: [
      { key: 'A', text: '先通风并检测' },
      { key: 'B', text: '直接进入' },
    ],
    answer: [0],
    analysis: '<p>先通风、检测并履行审批。</p>',
    rubric: null,
    scoreCents: 500,
    source: 'manual',
    ...overrides,
  };
}

describe('training question bank validation', () => {
  it('keeps category and difficulty fixed while accepting a manual question without regulation source', () => {
    const result = validateAndSanitizeQuestionDraft(baseDraft());

    expect(result.categoryId).toBe('11');
    expect(result.difficulty).toBe('medium');
    expect(result.regulationId).toBeUndefined();
    expect(result.regulationVersionId).toBeUndefined();
  });

  it('rejects unknown question types instead of treating them as image questions', () => {
    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ type: 'essay' as any })))
      .toThrow('题型非法');
  });

  it('enforces all four question shapes', () => {
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

    const image = validateAndSanitizeQuestionDraft(baseDraft({
      type: 'image',
      options: [],
      answer: [],
      rubric: '<p>能识别三项隐患，每项 2 分。</p>',
    }));
    expect(image.options).toEqual([]);
    expect(image.answer).toEqual([]);
    expect(image.rubric).toContain('三项隐患');

    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ type: 'single', answer: [0, 1] })))
      .toThrow('单选题答案必须唯一');
    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ type: 'multiple', answer: [0] })))
      .toThrow('多选题答案至少 2 个');
    expect(() => validateAndSanitizeQuestionDraft(baseDraft({ type: 'image', options: [], answer: [], rubric: null })))
      .toThrow();
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
    rubric: null,
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

describe('versioned question bank', () => {
  it('captures a legacy row before saving a pending revision', async () => {
    const { service, question, versions } = versionServiceFixture();

    const newVersionId = await service.revise('5', baseDraft({ stem: '<p>修订题干</p>', regulationId: '2', regulationVersionId: '3' }), '9');

    expect(newVersionId).toBe('101');
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ revision: 1, stem: '<p>原始题干</p>', status: 'approved', approvedBy: null });
    expect(versions[0].legacyCapturedAt).toBeInstanceOf(Date);
    expect(versions[1]).toMatchObject({ revision: 2, stem: '<p>修订题干</p>', status: 'pending', createdBy: '9' });
    expect(question).toMatchObject({ currentVersionId: '101', stem: '<p>修订题干</p>', status: 'pending' });
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
      rubric: null, scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
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
        analysis: null, rubric: null, scoreCents: 800, conceptId: null, regulationId: '2', regulationVersionId: '3',
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

  it('regenerates a scanned PDF question through the vision path without changing its category or difficulty', async () => {
    const q: any = {
      id: '5', currentVersionId: '101', regulationId: '2', versionId: '3', categoryId: '11', difficulty: 'hard',
      conceptId: '7', type: 'single', stem: '<p>旧题干</p>', options: [{ key: 'A', text: '旧 A' }, { key: 'B', text: '旧 B' }],
      answer: [0], analysis: '<p>旧解析</p>', rubric: null, score: '5.00', status: 'rejected', source: 'ai',
    };
    const cleanup = vi.fn(async () => undefined);
    const renderGroup = vi.fn(async () => ({ startPage: 1, endPage: 2, images: ['data:image/png;base64,AAA'] }));
    const revise = vi.fn(async () => '102');
    const gateway = {
      chat: vi.fn(async (messages: any[]) => {
        expect(Array.isArray(messages[1].content)).toBe(true);
        expect(messages[1].content.some((item: any) => item.type === 'image_url')).toBe(true);
        return JSON.stringify([{ type: 'single', stem: '新题干', options: [{ text: '新 A' }, { text: '新 B' }], answer: [1], analysis: '新解析' }]);
      }),
    };
    const service = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    service.questionRepo = { findOne: async () => q };
    service.versionRepo = { findOne: async () => ({ id: '3', regulationId: '2', fileType: 'pdf', textContent: null }) };
    service.gateway = gateway;
    service.pdfVision = {
      shouldUseVision: vi.fn(() => true),
      prepare: vi.fn(async () => ({ groupCount: 1, pageCount: 2, renderGroup, cleanup })),
    };
    service.versions = {
      revise,
      current: vi.fn(async () => ({
        id: '102', revision: 2, approvedBy: null, approvedAt: null, reviewedBy: null,
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

    await service.regenerate('5', { id: 9, name: 'admin' }, null);

    expect(renderGroup).toHaveBeenCalledWith(0);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(revise).toHaveBeenCalledWith('5', expect.objectContaining({
      categoryId: '11', difficulty: 'hard', regulationId: '2', regulationVersionId: '3', source: 'ai',
    }), '9');
  });
});
