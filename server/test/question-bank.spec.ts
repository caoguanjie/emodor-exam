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
  it('sanitizes malicious legacy rich text at the response boundary without rewriting storage', async () => {
    const service = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    const storedStem = '<p onclick="steal()">旧题<script>alert(1)</script><img src="https://evil.test/x" onerror="steal()"><img data-media-id="42" alt="现场"></p>';
    service.versions = { current: vi.fn(async () => null) };
    const view = await service.questionView({
      id: '5', regulationId: null, versionId: null, categoryId: null, difficulty: null, conceptId: null,
      currentVersionId: null, type: 'single', stem: storedStem,
      options: [{ key: 'A', text: '<b onmouseover="steal()">答案</b>' }, { key: 'B', text: '否' }],
      answer: [0], analysis: '<a href="javascript:steal()">解析</a>', rubric: null, score: '5.00',
      status: 'approved', source: 'manual', createdAt: new Date(), updatedAt: new Date(),
    } as any);

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

  it('rejects a stale expected version before creating a revision', async () => {
    const { service, question, versions } = versionServiceFixture();
    question.categoryId = '11';
    question.difficulty = 'medium';
    question.currentVersionId = '99';
    versions.push({
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'medium', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      rubric: null, scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
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
      rubric: null, scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
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
      answer: [0], analysis: '<p>旧解析</p>', rubric: null, score: '5.00', status: 'rejected', source: 'ai',
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
      rubric: null, scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
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
      answer: [0], analysis: null, rubric: null, score: '5.00', status: 'approved', source: 'manual',
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
      options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0], score: 5,
    }, { id: 9, name: 'admin' }, null);

    expect(created).toMatchObject({
      question_id: '7', current_version_id: '202', saved_version_id: '201', stem: '<p>并发后的题目</p>',
    });
    expect(service.versions.approve).toHaveBeenCalledWith('201', '9');
  });

  it('does not inherit PDF page provenance when an edit changes the regulation source version', async () => {
    const { service: versions, question, versions: rows } = versionServiceFixture();
    Object.assign(question, {
      categoryId: '11', difficulty: 'hard', currentVersionId: '99', status: 'rejected',
    });
    rows.push({
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'hard', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      rubric: null, scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
      sourcePageGroup: 1, sourcePageStart: 3, sourcePageEnd: 4,
      source: 'ai', status: 'rejected', approvedBy: null, approvedAt: null, reviewedBy: '1',
      reviewedAt: new Date(), reviewReason: '重做', createdBy: '1', legacyCapturedAt: null,
    });
    (versions as any).regulationVersionRepo = {
      findOne: vi.fn(async ({ where }: any) => (
        String(where.id) === '4' && String(where.regulationId) === '2'
          ? { id: '4', regulationId: '2' }
          : null
      )),
    };
    const review = Object.create(QuestionReviewService.prototype) as QuestionReviewService & Record<string, any>;
    review.questionRepo = { findOne: vi.fn(async () => question) };
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
      '5', { regulation_version_id: '4', analysis: '<p>改用新制度版本</p>' },
      { id: 9, name: 'admin' }, null, '99',
    );

    expect(edited.current_version_id).toBe('100');
    expect(rows[1]).toMatchObject({
      regulationId: '2', regulationVersionId: '4',
      sourcePageGroup: null, sourcePageStart: null, sourcePageEnd: null,
    });
  });

  it('rejects a delayed regeneration when the current version changes and creates no wrong version', async () => {
    const { service: versions, question, versions: rows } = versionServiceFixture();
    question.categoryId = '11';
    question.difficulty = 'medium';
    question.currentVersionId = '99';
    rows.push({
      id: '99', questionId: '5', revision: 1, categoryId: '11', difficulty: 'medium', type: 'single',
      stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis,
      rubric: null, scoreCents: 250, conceptId: null, regulationId: '2', regulationVersionId: '3',
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

  it('rejects judgment and image questions at every legacy fixed-paper capability boundary', async () => {
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

    const examService = Object.create(ExamService.prototype) as ExamService & Record<string, any>;
    examService.pqRepo = { find: vi.fn(async () => [{ id: '9', paperId: '3', questionId: '7', score: '100.00', sort: 0 }]) };
    examService.questionRepo = { find: vi.fn(async () => [unsupported]) };
    examService.userRepo = { findOne: vi.fn(async () => ({ id: '1', role: 'super_admin', status: 1 })) };
    examService.paperRepo = { findOne: vi.fn(async () => ({ ...paper, status: 'published', maxAttempts: 3 })) };
    examService.regRepo = { findOne: vi.fn(async () => ({ id: '2', status: 'published' })) };
    examService.learningRepo = { findOne: vi.fn(async () => ({ isValid: 1 })) };
    examService.dataSource = { transaction: vi.fn() };
    examService.shuffle = {
      deriveSeed: vi.fn(() => 'seed'), shuffleQuestionOrder: vi.fn((items: any[]) => items), shuffleOptions: vi.fn((items: any[]) => items),
    };
    await expect(examService.start('3', 1)).rejects.toThrow('固定试卷');
    expect(examService.learningRepo.findOne).not.toHaveBeenCalled();
    expect(examService.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('blocks changing the type of any question already referenced by a legacy paper', async () => {
    const q: any = {
      id: '5', currentVersionId: '101', regulationId: '2', versionId: '3', categoryId: '11', difficulty: 'medium',
      conceptId: null, type: 'single', stem: '题干', options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }],
      answer: [0], analysis: null, rubric: null, score: '5.00', status: 'approved', source: 'manual',
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
