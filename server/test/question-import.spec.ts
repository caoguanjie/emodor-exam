import { describe, expect, it, vi } from 'vitest';
import {
  buildQuestionImportTemplate,
  parseQuestionImportFile,
} from '../src/modules/questions/question-import-format';
import { QuestionImportService } from '../src/modules/questions/question-import.service';
import { ImportBatchService } from '../src/modules/imports/import-batch.service';
import { validateAndSanitizeQuestionDraft, type QuestionDraftInput } from '../src/modules/questions/question-validator';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import ExcelJS from 'exceljs';

describe('question import format', () => {
  it('round-trips the same template rows through xlsx and UTF-8 TSV', async () => {
    const xlsx = await buildQuestionImportTemplate('xlsx');
    const txt = await buildQuestionImportTemplate('txt');

    const xlsxRows = await parseQuestionImportFile(xlsx, 'xlsx');
    const txtRows = await parseQuestionImportFile(txt, 'txt');

    expect(xlsxRows).toEqual(txtRows);
    expect(xlsxRows.map((row) => row.row)).toEqual([2, 3, 4, 5]);
  });

  it('accepts a BOM and CRLF while keeping JSON cells unambiguous', async () => {
    const header = 'category\ttype\tdifficulty\tconcept\tstem\toptions\tanswer\tanalysis\trubric\tscore';
    const row = [
      '',
      'single',
      'easy',
      '',
      '<p>进入前应做什么？</p>',
      JSON.stringify([{ key: 'A', text: '检测' }, { key: 'B', text: '直接进入' }]),
      JSON.stringify([0]),
      '<p>先检测。</p>',
      '',
      '5',
    ].join('\t');

    const rows = await parseQuestionImportFile(Buffer.from(`\uFEFF${header}\r\n${row}\r\n`, 'utf8'), 'txt');

    expect(rows).toEqual([expect.objectContaining({
      row: 2,
      type: 'single',
      difficulty: 'easy',
      options: '[{"key":"A","text":"检测"},{"key":"B","text":"直接进入"}]',
      answer: '[0]',
    })]);
  });

  it('reports formulas and extra Excel columns without using a cached formula result', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('导入');
    sheet.addRow(HEADER.split('\t'));
    sheet.addRow(singleRow('<p>原题干</p>'));
    sheet.getRow(2).getCell(5).value = { formula: '1+1', result: '<p>缓存结果</p>' };
    sheet.getRow(2).getCell(11).value = '额外列';

    const rows = await parseQuestionImportFile(Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer), 'xlsx');

    expect(rows[0].stem).toBe('');
    expect(rows[0].format_errors).toEqual(expect.arrayContaining([
      expect.stringContaining('不允许使用公式'),
      expect.stringContaining('10 列'),
    ]));
  });

  it('reports text in column K even when optional cells make the Excel row sparse', async () => {
    const workbook = sparseQuestionWorkbook();
    workbook.worksheets[0].getRow(2).getCell(11).value = '额外文本';

    const rows = await parseQuestionImportFile(Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer), 'xlsx');

    expect(rows[0].format_errors).toContain('Excel 每行必须使用 10 列');
  });

  it('reports a formula in sparse column K without trusting its cached result', async () => {
    const workbook = sparseQuestionWorkbook();
    workbook.worksheets[0].getRow(2).getCell(11).value = { formula: '1+1', result: '' };

    const rows = await parseQuestionImportFile(Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer), 'xlsx');

    expect(rows[0].format_errors).toContain('Excel 每行必须使用 10 列');
  });

  it('accepts a ten-column Excel row whose optional cells are genuinely empty', async () => {
    const workbook = sparseQuestionWorkbook();

    const rows = await parseQuestionImportFile(Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer), 'xlsx');

    expect(rows).toEqual([expect.objectContaining({
      row: 2, category: '', concept: '', analysis: '', rubric: '', type: 'single', score: '5',
    })]);
    expect(rows[0].format_errors).toBeUndefined();
  });
});

const HEADER = 'category\ttype\tdifficulty\tconcept\tstem\toptions\tanswer\tanalysis\trubric\tscore';

function sparseQuestionWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('题库导入');
  sheet.addRow(HEADER.split('\t'));
  const row = sheet.getRow(2);
  row.getCell(2).value = 'single';
  row.getCell(3).value = 'easy';
  row.getCell(5).value = '<p>稀疏行题干</p>';
  row.getCell(6).value = JSON.stringify([{ key: 'A', text: '是' }, { key: 'B', text: '否' }]);
  row.getCell(7).value = '[0]';
  row.getCell(10).value = '5';
  row.commit();
  return workbook;
}

function txtFile(rows: string[][]): Buffer {
  return Buffer.from(`\uFEFF${[HEADER, ...rows.map((row) => row.join('\t'))].join('\r\n')}\r\n`, 'utf8');
}

function singleRow(stem: string, overrides: Partial<Record<string, string>> = {}): string[] {
  const row = {
    category: '', type: 'single', difficulty: 'easy', concept: '受限空间', stem,
    options: JSON.stringify([{ key: 'A', text: '先检测' }, { key: 'B', text: '直接进入' }]),
    answer: JSON.stringify([0]), analysis: '<p>应先检测。</p>', rubric: '', score: '5',
    ...overrides,
  };
  return ['category', 'type', 'difficulty', 'concept', 'stem', 'options', 'answer', 'analysis', 'rubric', 'score']
    .map((key) => row[key]);
}

function questionImportFixture(existingQuestions: any[] = []) {
  const batches: any[] = [];
  let nextQuestionId = 100;
  const batchRepo = {
    create: (value: any) => ({ ...value }),
    save: vi.fn(async (value: any) => {
      if (!value.id) value.id = String(batches.length + 1);
      const index = batches.findIndex((item) => item.id === value.id);
      if (index >= 0) batches[index] = value;
      else batches.push(value);
      return value;
    }),
    findOne: vi.fn(async ({ where }: any) => batches.find((item) => (
      String(item.id) === String(where.id)
      && (where.ownerId === undefined || String(item.ownerId) === String(where.ownerId))
      && (where.kind === undefined || item.kind === where.kind)
    )) || null),
  };
  const imports = Object.create(ImportBatchService.prototype) as ImportBatchService & Record<string, any>;
  imports.adapters = new Map();
  imports.batchRepo = batchRepo;
  const versions = {
    validateImportDraft: vi.fn(async (input: QuestionDraftInput) => validateAndSanitizeQuestionDraft(input)),
    createApprovedImportsInManager: vi.fn(async (
      manager: unknown,
      drafts: QuestionDraftInput[],
      _actorId: string,
      afterRelationsLocked?: (manager: unknown, drafts: QuestionDraftInput[]) => Promise<void>,
    ) => {
      await afterRelationsLocked?.(manager, drafts);
      return drafts.map((draft) => {
        const questionId = String(nextQuestionId++);
        existingQuestions.push({ id: questionId, ...draft });
        return { questionId, versionId: String(Number(questionId) + 400) };
      });
    }),
  };
  const category = { id: '10', name: '安全管理', status: 1 };
  const concept = { id: '20', categoryId: '10', type: 'single', name: '受限空间' };
  const service = Object.create(QuestionImportService.prototype) as QuestionImportService & Record<string, any>;
  Object.assign(service, {
    batchRepo,
    questionRepo: { find: vi.fn(async () => existingQuestions) },
    categoryRepo: {
      findOne: vi.fn(async ({ where }: any) => (
        String(where.id || '') === category.id || String(where.name || '') === category.name ? category : null
      )),
    },
    conceptRepo: {
      findOne: vi.fn(async ({ where }: any) => (
        (String(where.id || '') === concept.id || String(where.name || '') === concept.name)
        && String(where.categoryId) === concept.categoryId && where.type === concept.type ? concept : null
      )),
    },
    dataSource: {
      transaction: vi.fn(async (callback: (manager: any) => Promise<unknown>) => {
        const snapshot = structuredClone(batches);
        try {
          return await callback({
            findOne: async (_entity: unknown, { where }: any) => batches.find((item) => (
              String(item.id) === String(where.id) && String(item.ownerId) === String(where.ownerId)
            )) || null,
            save: async (value: any) => batchRepo.save(value),
            getRepository(entity: unknown) {
              if (entity !== Question) throw new Error(`unexpected repository ${(entity as any)?.name}`);
              const builder: any = {
                where: vi.fn(() => builder),
                setLock: vi.fn(() => builder),
                getMany: vi.fn(async () => existingQuestions),
              };
              return { createQueryBuilder: vi.fn(() => builder) };
            },
          });
        } catch (error) {
          batches.splice(0, batches.length, ...snapshot);
          throw error;
        }
      }),
    },
    audit: { log: vi.fn() },
    config: { upload: { maxImportSizeMb: 5, maxImportRows: 1000 } },
    importBatches: imports,
    versions,
  });
  service.onModuleInit();
  return { service, imports, versions, batches, batchRepo };
}

describe('question import preview', () => {
  it('separates valid, invalid, and later duplicate rows after canonical validation', async () => {
    const { service, versions } = questionImportFixture();
    const file = txtFile([
      singleRow('<p>进入前应做什么？</p>'),
      singleRow('<p>未知题型</p>', { type: 'essay' }),
      singleRow('  <p>进入前应做什么？</p>  '),
      singleRow('<p>上传现场照片。</p>', {
        type: 'image', difficulty: '', concept: '', options: '[]', answer: '[]', analysis: '',
        rubric: '<p>识别隐患位置。</p>', score: '10',
      }),
    ]);

    const preview = await service.preview('1', file, 'txt', { categoryId: '10', difficulty: 'hard' });

    expect(preview.valid_rows).toEqual([2, 5]);
    expect(preview.errors.some((item) => item.row === 3 && item.message.includes('题型'))).toBe(true);
    expect(preview.duplicates).toEqual([4]);
    expect(versions.validateImportDraft).toHaveBeenCalled();
  });

  it('marks a database match as a duplicate instead of a valid row', async () => {
    const existing = [{
      categoryId: '10', type: 'single', difficulty: 'easy', stem: '<p>已有题目</p>',
      options: [{ key: 'A', text: '先检测' }, { key: 'B', text: '直接进入' }], answer: [0],
      analysis: '<p>应先检测。</p>', rubric: null,
    }];
    const { service } = questionImportFixture(existing);

    const preview = await service.preview('1', txtFile([singleRow('<p>已有题目</p>')]), 'txt', { categoryId: '10' });

    expect(preview.valid_rows).toEqual([]);
    expect(preview.duplicates).toEqual([2]);
    expect(preview.errors).toEqual([]);
  });

  it('rejects string answer indexes instead of coercing non-integer JSON values', async () => {
    const { service } = questionImportFixture();

    const preview = await service.preview(
      '1',
      txtFile([singleRow('<p>答案类型</p>', { answer: '["0"]' })]),
      'txt',
      { categoryId: '10' },
    );

    expect(preview.valid_rows).toEqual([]);
    expect(preview.errors).toEqual([{ row: 2, message: expect.stringContaining('整数下标') }]);
  });
});

describe('question import ownership and commit', () => {
  it('keeps the legacy students commit entry bound to student batches', async () => {
    const { service, imports, versions } = questionImportFixture();
    const preview = await service.preview('1', txtFile([singleRow('<p>不可借学员入口确认</p>')]), 'txt', { categoryId: '10' });

    await expect(imports.commit('1', preview.batch_id, [2])).rejects.toMatchObject({ code: 40401 });
    expect(versions.createApprovedImportsInManager).not.toHaveBeenCalled();
  });

  it('returns the first committed ids on same-row retry and creates approved questions once', async () => {
    const { service, imports, versions } = questionImportFixture();
    const preview = await service.preview('1', txtFile([singleRow('<p>幂等题目</p>')]), 'txt', { categoryId: '10' });

    const first = await imports.commitQuestions('1', preview.batch_id, [2]);
    const second = await imports.commitQuestions('1', preview.batch_id, [2]);

    expect(first.created_ids).toEqual(['100']);
    expect(second).toEqual(first);
    expect(versions.createApprovedImportsInManager).toHaveBeenCalledTimes(1);
  });

  it('rejects a second pre-existing preview after the first batch creates the same question', async () => {
    const { service, imports, batches } = questionImportFixture();
    const file = txtFile([singleRow('<p>跨批重复题目</p>')]);
    const firstPreview = await service.preview('1', file, 'txt', { categoryId: '10' });
    const secondPreview = await service.preview('1', file, 'txt', { categoryId: '10' });

    await imports.commitQuestions('1', firstPreview.batch_id, [2]);

    await expect(imports.commitQuestions('1', secondPreview.batch_id, [2]))
      .rejects.toMatchObject({ code: 40911, message: expect.stringContaining('重新预检查') });
    expect(batches.find((batch) => batch.id === secondPreview.batch_id)).toMatchObject({
      status: 'previewed', committedRows: null, createdIds: null,
    });
  });

  it('rejects another owner and a student batch at the questions endpoint without exposing either batch', async () => {
    const { service, imports, batches } = questionImportFixture();
    const preview = await service.preview('1', txtFile([singleRow('<p>归属题目</p>')]), 'txt', { categoryId: '10' });
    batches.push({ id: '9', ownerId: '1', kind: 'students', status: 'previewed' });

    await expect(imports.commitQuestions('2', preview.batch_id, [2])).rejects.toMatchObject({ code: 40302 });
    await expect(imports.commitQuestions('1', '9', [2])).rejects.toMatchObject({ code: 40302 });
    await expect(imports.questionStatus('2', preview.batch_id)).rejects.toMatchObject({ code: 40302 });
    await expect(imports.questionStatus('1', '9')).rejects.toMatchObject({ code: 40302 });
  });

  it('leaves the batch uncommitted when approved question creation fails', async () => {
    const { service, imports, versions, batches } = questionImportFixture();
    const preview = await service.preview('1', txtFile([singleRow('<p>回滚题目</p>')]), 'txt', { categoryId: '10' });
    versions.createApprovedImportsInManager.mockRejectedValueOnce(new Error('write failed'));

    await expect(imports.commitQuestions('1', preview.batch_id, [2])).rejects.toThrow('write failed');
    expect(batches.find((batch) => batch.id === preview.batch_id)).toMatchObject({ status: 'previewed', createdIds: null });
  });

  it('rejects rows that were not returned in valid_rows', async () => {
    const { service, imports } = questionImportFixture();
    const preview = await service.preview('1', txtFile([singleRow('<p>选择边界</p>')]), 'txt', { categoryId: '10' });

    await expect(imports.commitQuestions('1', preview.batch_id, [3])).rejects.toMatchObject({ code: 40001 });
  });
});

function importDraft(overrides: Partial<QuestionDraftInput> = {}): QuestionDraftInput {
  return {
    categoryId: '10', difficulty: 'easy', type: 'single', stem: '<p>导入题目</p>',
    options: [{ key: 'A', text: '正确项' }, { key: 'B', text: '干扰项' }], answer: [0],
    analysis: '<p>解析</p>', rubric: null, scoreCents: 500, source: 'import', ...overrides,
  };
}

describe('approved import adapter for the versioned question bank', () => {
  it('passes the caller manager through controlled-media validation', async () => {
    const assertUsable = vi.fn(async () => undefined);
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
    Object.assign(service, { media: { assertUsable } });
    const manager = { getRepository: vi.fn() } as any;

    await service.validateImportDraft(importDraft({
      stem: '<p>带图导入题<img data-media-id="42"></p>',
    }), '7', manager);

    expect(assertUsable).toHaveBeenCalledWith('7', '42', 'question', undefined, manager);
    expect(manager.getRepository).not.toHaveBeenCalled();
  });

  it('validates every draft before acquiring locks or writing any question row', async () => {
    const questionSave = vi.fn();
    const lockActive = vi.fn();
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
    Object.assign(service, {
      categories: { lockActive },
      concepts: { assertCompatible: vi.fn() },
      media: { assertUsable: vi.fn(async () => undefined), bind: vi.fn() },
    });
    const manager = {
      getRepository(entity: unknown) {
        if (entity === Question) return { save: questionSave };
        throw new Error(`unexpected repository ${(entity as any)?.name}`);
      },
    } as any;

    await expect(service.createApprovedImportsInManager(
      manager,
      [importDraft({ categoryId: '20' }), importDraft({ type: 'image', rubric: null })],
      '7',
    )).rejects.toMatchObject({ code: 40001 });

    expect(lockActive).not.toHaveBeenCalled();
    expect(questionSave).not.toHaveBeenCalled();
  });

  it('creates approved identity and version rows in the caller transaction with exact review metadata', async () => {
    const questions: any[] = [];
    const versions: any[] = [];
    const questionRepo = {
      create: (value: any) => ({ ...value }),
      save: vi.fn(async (value: any) => {
        if (!value.id) value.id = String(questions.length + 1);
        if (!questions.includes(value)) questions.push(value);
        return value;
      }),
    };
    const versionRepo = {
      create: (value: any) => ({ ...value }),
      save: vi.fn(async (value: any) => {
        if (!value.id) value.id = String(versions.length + 21);
        if (!versions.includes(value)) versions.push(value);
        return value;
      }),
    };
    const manager = {
      getRepository(entity: unknown) {
        if (entity === Question) return questionRepo;
        if (entity === QuestionVersion) return versionRepo;
        throw new Error(`unexpected repository ${(entity as any)?.name}`);
      },
    } as any;
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService & Record<string, any>;
    const lockActive = vi.fn(async () => ({ id: '10', status: 1 }));
    Object.assign(service, {
      categories: { lockActive },
      concepts: { assertCompatible: vi.fn(async () => undefined) },
      media: { assertUsable: vi.fn(async () => undefined), bind: vi.fn(async () => undefined) },
      regulationRepo: { findOne: vi.fn(async () => null) },
      regulationVersionRepo: { findOne: vi.fn(async () => null) },
    });

    const created = await service.createApprovedImportsInManager(manager, [
      importDraft({ categoryId: '20' }),
      importDraft({ categoryId: '10', stem: '<p>第二道导入题目</p>' }),
    ], '7');

    expect(created).toEqual([
      { questionId: '1', versionId: '21' },
      { questionId: '2', versionId: '22' },
    ]);
    expect(lockActive.mock.calls.map((call) => call[1])).toEqual(['10', '20']);
    for (const version of versions) {
      expect(version).toMatchObject({
        status: 'approved', approvedBy: '7', reviewedBy: '7', reviewReason: null,
      });
      expect(version.approvedAt).toBeInstanceOf(Date);
      expect(version.reviewedAt).toBe(version.approvedAt);
    }
    expect(versions[1].approvedAt).toBe(versions[0].approvedAt);
    expect(questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'approved', currentVersionId: '21', source: 'import' }),
      expect.objectContaining({ status: 'approved', currentVersionId: '22', source: 'import' }),
    ]));
  });
});
