import { describe, expect, it, vi } from 'vitest';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { CreateQuestionDto, EditQuestionDto, GenerateQuestionsDto, QuestionListQueryDto } from '../src/modules/questions/question.dto';
import { validateAndSanitizeQuestionDraft, type QuestionDraftInput } from '../src/modules/questions/question-validator';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';
import { QuestionGenerationService } from '../src/modules/ai/question-generation.service';
import { QuestionImportService } from '../src/modules/questions/question-import.service';
import { AiQuestionImportService } from '../src/modules/questions/ai-question-import.service';
import { buildQuestionImportTemplate, parseQuestionImportFile } from '../src/modules/questions/question-import-format';
import { activeDifficulties, assertActiveDifficulty, createDifficultyPolicy, difficultyCatalog, difficultyForSource } from '../src/common/question-difficulty';
import { QuestionAuthoringOptionsController } from '../src/modules/questions/question-authoring-options.controller';
import { PERMISSIONS_ANY_KEY } from '../src/common/decorators/permissions.decorator';
import { PATH_METADATA } from '@nestjs/common/constants';

const draft = (difficulty: string): QuestionDraftInput => ({
  categoryId: '7', difficulty: difficulty as any, type: 'single', source: 'manual', scoreCents: 10000,
  stem: '<p>作业前先检查什么？</p>', options: [{ key: 'A', text: '风险' }, { key: 'B', text: '无需检查' }],
  answer: [0], analysis: '<p>先确认风险。</p>',
});

describe('one authoritative difficulty catalog', () => {
  it('advertises only enabled choices while keeping the historic medium label', () => {
    const response = new QuestionAuthoringOptionsController().options();
    expect(response.difficulties).toEqual([
      { code: 'easy', label: '简单', enabled: true, sort: 10 },
      { code: 'medium', label: '中级', enabled: false, sort: 20 },
      { code: 'hard', label: '困难', enabled: true, sort: 30 },
    ]);
    expect(activeDifficulties()).toEqual(['easy', 'hard']);
    for (const option of response.difficulties) {
      if (option.enabled) expect(() => assertActiveDifficulty(option.code)).not.toThrow();
      else expect(() => assertActiveDifficulty(option.code)).toThrow(/未启用/);
    }
  });

  it('exposes the authoring options route to question readers or writers', () => {
    expect(Reflect.getMetadata(PATH_METADATA, QuestionAuthoringOptionsController)).toBe('admin/questions');
    expect(Reflect.getMetadata(PATH_METADATA, QuestionAuthoringOptionsController.prototype.options)).toBe('authoring-options');
    expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, QuestionAuthoringOptionsController.prototype.options)).toEqual(['questions:read', 'questions:write']);
  });

  it('keeps source selection explicit and rejects an unconfigured learner source', () => {
    expect(difficultyForSource('institution')).toBe('easy');
    expect(difficultyForSource('external')).toBe('hard');
    expect(() => difficultyForSource(null)).toThrow(/来源/);
  });

  it('derives future enabled choices and validation from the same configured catalog', () => {
    const future = createDifficultyPolicy(difficultyCatalog().map((option) => ({ ...option, enabled: true })));
    expect(future.activeDifficulties()).toEqual(['easy', 'medium', 'hard']);
    expect(() => future.assertActiveDifficulty('medium')).not.toThrow();
    expect(future.difficultyForSource('institution')).toBe('easy');
    expect(() => future.assertActiveDifficulty('unknown')).toThrow(/未启用/);
    expect(activeDifficulties()).toEqual(['easy', 'hard']);
  });

  it('uses a future catalog in the real DTO, draft, candidate and random publishing paths', async () => {
    const future = createDifficultyPolicy(difficultyCatalog().map((option) => ({ ...option, enabled: true })));
    vi.resetModules();
    vi.doMock('../src/common/question-difficulty', () => ({ ...future }));
    try {
      const { validateAndSanitizeQuestionDraft: validateFuture } = await import('../src/modules/questions/question-validator');
      const { EditQuestionDto: FutureEditDto } = await import('../src/modules/questions/question.dto');
      const { PaperService } = await import('../src/modules/ai/paper.service');
      const { PaperReleaseService } = await import('../src/modules/exams/paper-release.service');
      const { SamplingService } = await import('../src/modules/exams/sampling.service');
      expect(validateFuture(draft('medium')).difficulty).toBe('medium');
      await expect(new DtoValidationPipe().transform({ difficulty: 'medium' }, { type: 'body', metatype: FutureEditDto } as any))
        .resolves.toMatchObject({ difficulty: 'medium' });
      const versions = { approvedCandidates: async ({ difficulty }: any) => [{ ...draft(difficulty), questionId: String({ easy: 10, medium: 20, hard: 30 }[difficulty]), versionId: String({ easy: 101, medium: 201, hard: 301 }[difficulty]), revision: 1, approvedBy: '1', approvedAt: null }] };
      const paper: any = { id: '1', categoryId: '7', businessScope: 'training', mode: 'random', status: 'draft', regulationIds: [], passScore: 60, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, ruleConfig: { rules: [{ type: 'single', count: 1, scoreCents: 10000 }] } };
      const service = Object.create(PaperService.prototype);
      service.paperRepo = { findOne: async () => paper }; service.versions = versions;
      const candidates = await service.trainingCandidates('1', { type: 'single' });
      expect(candidates.items.map((item: any) => item.difficulty).sort()).toEqual(['easy', 'hard', 'medium']);
      const releases = Object.create(PaperReleaseService.prototype);
      releases.questions = versions; releases.sampling = new SamplingService();
      const published = await releases.randomPool(undefined, paper);
      expect(published.pool.map((item: any) => item.difficulty)).toEqual(['easy', 'medium', 'hard']);
    } finally { vi.doUnmock('../src/common/question-difficulty'); vi.resetModules(); }
  });
});

describe('enabled difficulty at question write boundaries', () => {
  it.each(['medium', 'unknown', '', null])('rejects %s in a new draft', (value) => {
    expect(() => validateAndSanitizeQuestionDraft(draft(value as string))).toThrow(/难度/);
  });

  it.each(['easy', 'hard'])('accepts %s without changing the requested value', (value) => {
    expect(validateAndSanitizeQuestionDraft(draft(value)).difficulty).toBe(value);
  });

  it.each([CreateQuestionDto, EditQuestionDto, GenerateQuestionsDto])('rejects medium in HTTP %s input', async (Dto) => {
    const body = Dto === GenerateQuestionsDto
      ? { material_id: '2', material_version_id: '3', category_id: '7', difficulty: 'medium' }
      : { category_id: '7', difficulty: 'medium', type: 'single', stem: '题干', options: draft('easy').options, answer: [0], score: 100 };
    await expect(new DtoValidationPipe().transform(body, { type: 'body', metatype: Dto } as any))
      .rejects.toMatchObject({ status: 400 });
  });

  it('keeps medium available for historical list queries', async () => {
    await expect(new DtoValidationPipe().transform({ difficulty: 'medium' }, { type: 'query', metatype: QuestionListQueryDto } as any))
      .resolves.toMatchObject({ difficulty: 'medium' });
  });

  it('rejects a medium candidate filter before opening the new question pool', async () => {
    const service = Object.create(QuestionVersionService.prototype);
    service.categories = { assertActive: async () => undefined };
    service.versionRepo = { createQueryBuilder: () => { throw new Error('unexpected pool query'); } };
    await expect(service.approvedCandidates({ categoryId: '7', type: 'single', difficulty: 'medium' }))
      .rejects.toMatchObject({ code: 40001 });
  });

  it('rejects a medium AI request before reading materials or starting a task', async () => {
    const service = Object.create(QuestionGenerationService.prototype);
    service.categories = { assertActive: () => { throw new Error('unexpected material access'); } };
    await expect(service.start({ difficulty: 'medium' })).rejects.toMatchObject({ code: 40001 });
  });

  it('rejects regeneration of a disabled AI batch row as a difficulty error', async () => {
    const service = Object.create(AiQuestionImportService.prototype);
    service.importer = { readAiGeneratedDraft: async () => draft('medium') };
    await expect(service.regenerateRow('1', '8', 2)).rejects.toMatchObject({ code: 40001 });
  });

  it('keeps request difficulty and trusted metadata when a reference model attempts to overwrite them', async () => {
    const service = Object.create(AiQuestionImportService.prototype);
    service.importer = { validateAiGenerated: async (_owner: string, value: QuestionDraftInput) => validateAndSanitizeQuestionDraft(value, { allowReferenceAi: true }) };
    const result = await service.generatedDraft('1', draft('easy'), {
      difficulty: 'hard', categoryId: '999', source: 'manual', status: 'approved', conceptId: '777',
      stem: '生成后不同的题干', options: [{ key: 'A', text: '先检测' }, { key: 'B', text: '直接进入' }], answer: [0], analysis: '完成风险检查。',
    }, 'easy');
    expect(result).toMatchObject({ difficulty: 'easy', categoryId: '7', source: 'ai', conceptId: undefined });
    expect(result).not.toHaveProperty('scoreCents');
  });

  it('persists material-generated questions using the requested difficulty instead of model tags', async () => {
    const state = new Map<string, string>();
    const persisted: any[] = [];
    const service = Object.create(QuestionGenerationService.prototype);
    Object.assign(service, {
      questionRepo: { find: async () => [] }, config: { ai: { chunkSize: 4000, chunkOverlap: 200, blockConcurrency: 1 } },
      pdfVision: { shouldUseVision: () => false },
      gateway: { chat: async () => JSON.stringify([{ type: 'single', difficulty: 'medium', categoryId: '999', source: 'manual', status: 'approved', stem: '新资料生成题', options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }], answer: [0], analysis: '来自所选资料。' }]) },
      redis: { get: async (key: string) => state.get(key), set: async (key: string, value: string) => { state.set(key, value); }, del: async (key: string) => { state.delete(key); } },
      versions: { createMany: async (values: QuestionDraftInput[]) => {
        persisted.push(...values.map((value) => validateAndSanitizeQuestionDraft(value)));
        return [{ questionId: '101', versionId: '201' }];
      } }, audit: { log: vi.fn() },
    });
    await service.runTaskInner('test-task', { id: '2', title: '资料' }, { id: '3', textContent: '作业前须进行风险检查。' }, {
      categoryId: '7', difficulty: 'hard', questionCountSingle: 1, questionCountMultiple: 0, scoreSingle: 100, scoreMultiple: 1, actor: { id: 1, name: 'admin' },
    });
    expect(persisted).toEqual([expect.objectContaining({ difficulty: 'hard', categoryId: '7', source: 'ai', regulationId: '2', regulationVersionId: '3' })]);
    expect(JSON.parse(state.get('ai:task:test-task')!)).toMatchObject({ status: 'completed', question_ids: [101] });
  });

  it('rejects a disabled default even when every file row has its own enabled difficulty', async () => {
    const service = Object.create(QuestionImportService.prototype);
    service.config = { upload: { maxImportSizeMb: 5, maxImportRows: 100 } };
    service.importBatches = { preview: async () => ({ valid_rows: [2] }) };
    await expect(service.preview('1', await buildQuestionImportTemplate('txt'), 'txt', { difficulty: 'medium' }))
      .rejects.toMatchObject({ code: 40001 });
  });

  it.each(['txt', 'xlsx'] as const)('provides only importable enabled difficulties in the %s template', async (format) => {
    const rows = await parseQuestionImportFile(await buildQuestionImportTemplate(format), format);
    expect(rows.map((row) => row.difficulty)).toEqual(['easy', 'hard', 'hard']);
  });

  it('returns a row error for medium without reclassifying or writing a question', async () => {
    const batches: any[] = [];
    const service = Object.create(QuestionImportService.prototype);
    service.batchRepo = { create: (value: any) => value, save: async (value: any) => { batches.push(value); return { id: '8', ...value }; } };
    service.categoryRepo = { findOne: async () => ({ id: '7', status: 1 }) };
    service.questionRepo = { find: async () => [] };
    service.versions = { validateImportDraft: async (value: any) => ({ ...value, mediaAssetIds: [] }) };
    service.audit = { log: vi.fn() };
    const row = { row: 2, category: '7', type: 'single', difficulty: 'medium', concept: '', stem: '题干', options: JSON.stringify(draft('easy').options), answer: '[0]', analysis: '解析', score: '100' };
    const result = await service.previewRows('1', [row]);
    expect(result.valid_rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: expect.stringMatching(/难度|difficulty/) }]);
    expect(batches[0].normalizedRows).toEqual([]);
    expect(row.difficulty).toBe('medium');
  });
});
