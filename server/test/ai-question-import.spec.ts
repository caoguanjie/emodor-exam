import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { QuestionImportService } from '../src/modules/questions/question-import.service';
import { ImportBatchService } from '../src/modules/imports/import-batch.service';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { ImportBatch } from '../src/entities/import-batch.entity';
import { QUESTION_IMPORT_HEADERS } from '../src/modules/questions/question-import-format';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { Errors } from '../src/common/errors';

const reference = '一次性参考正文不得留存';
const options = [{ key: 'A', text: '先确认风险' }, { key: 'B', text: '直接作业' }];
const generatedOptions = [{ key: 'A', text: '复核许可证后依规实施' }, { key: 'B', text: '无视监护人的提示' }];
const refCells = ['10', 'single', 'medium', '', reference, JSON.stringify(options), '[0]', '参考解析', '5'];
const draft = (difficulty = 'easy', stem = '新生成的题目') => ({
  categoryId: '10', type: 'single', difficulty, conceptId: undefined, stem,
  options, answer: [0], analysis: '生成解析', scoreCents: 500, source: 'ai',
});
const generated = (difficulty: string, overrides: Record<string, unknown> = {}) => ({
  category: '999', type: 'essay', difficulty, concept: '999', stem: `${difficulty}生成题`,
  options: generatedOptions, answer: [0], analysis: '生成解析', score: '99', source: 'manual', status: 'approved',
  regulation_id: '999', ...overrides,
});

function file(rows = [refCells]) {
  return Buffer.from([[...QUESTION_IMPORT_HEADERS, 'score'].join('\t'), ...rows.map((row) => row.join('\t'))].join('\n'));
}

function fixture() {
  const batches: any[] = [];
  const questions: any[] = [];
  const revisions: any[] = [];
  const cache = new Map<string, string>();
  const logs: unknown[] = [];
  const batchRepo: any = {
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      if (!value.id) value.id = String(batches.length + 1);
      const at = batches.findIndex((item) => item.id === value.id);
      if (at < 0) batches.push(value); else batches[at] = value;
      return value;
    },
    findOne: async ({ where }: any) => batches.find((value) => Object.entries(where)
      .every(([key, expected]) => String(value[key]) === String(expected))) || null,
  };
  const qRepo: any = {
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      if (!value.id) { value.id = String(questions.length + 100); questions.push(value); }
      return value;
    },
    find: async () => questions,
    createQueryBuilder: () => {
      const query: any = { where: () => query, setLock: () => query, getMany: async () => questions };
      return query;
    },
  };
  const vRepo: any = {
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      value.id = String(revisions.length + 200); revisions.push(value); return value;
    },
  };
  const manager: any = {
    findOne: async (entity: unknown, query: unknown) => {
      if (entity === ImportBatch) return batchRepo.findOne(query);
      throw new Error('unexpected findOne');
    },
    save: (value: any) => batchRepo.save(value),
    getRepository: (entity: unknown) => {
      if (entity === Question) return qRepo;
      if (entity === QuestionVersion) return vRepo;
      throw new Error('unexpected repository');
    },
  };
  const dataSource: any = { transaction: async (callback: any) => {
    const snapshot = structuredClone({ batches, questions, revisions });
    try { return await callback(manager); } catch (error) {
      batches.splice(0, batches.length, ...snapshot.batches);
      questions.splice(0, questions.length, ...snapshot.questions);
      revisions.splice(0, revisions.length, ...snapshot.revisions);
      throw error;
    }
  } };
  const versions: any = Object.create(QuestionVersionService.prototype);
  Object.assign(versions, {
    dataSource, questionRepo: qRepo, versionRepo: vRepo,
    categories: { lockActive: async () => ({ id: '10', status: 1 }) },
    concepts: { assertCompatible: async () => undefined },
    media: { assertUsable: async () => undefined, bind: async () => undefined },
  });
  const imports: any = Object.create(ImportBatchService.prototype);
  Object.assign(imports, { batchRepo, adapters: new Map() });
  const importer: any = Object.create(QuestionImportService.prototype);
  const audit = { log: (entry: unknown) => logs.push(entry) };
  const config: any = { upload: { maxImportSizeMb: 5, maxImportRows: 1000 }, ai: { timeoutMs: 30, blockConcurrency: 3 } };
  Object.assign(importer, {
    batchRepo, questionRepo: qRepo, categoryRepo: { findOne: async ({ where }: any) =>
      where.id === '10' ? { id: '10', name: '安全', status: 1 } : null },
    conceptRepo: { findOne: async () => null }, dataSource, audit, config, importBatches: imports, versions,
  });
  importer.onModuleInit();
  const redis: any = {
    set: async (key: string, value: string) => { cache.set(key, value); },
    get: async (key: string) => cache.get(key) || null,
  };
  const gateway: any = { chat: vi.fn(async () => JSON.stringify([generated('easy'), generated('hard')])) };
  return { batches, questions, revisions, cache, logs, importer, imports, versions, gateway, redis, config, vRepo };
}

async function aiFixture() {
  const f = fixture();
  const { AiQuestionImportService } = await import('../src/modules/questions/ai-question-import.service');
  const ai = new AiQuestionImportService(f.importer, f.gateway, f.redis, f.config);
  return { ...f, ai };
}

async function finished(ai: any, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const task = await ai.status('1', id);
    if (task.status === 'completed' || task.status === 'failed') return task;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('task did not finish');
}

afterEach(() => vi.useRealTimers());

describe('AI import transaction boundary', () => {
  it('keeps generated preview separate and commits selected rows as pending AI revision 1 exactly once', async () => {
    const f = fixture();
    const preview = await f.importer.previewAiGenerated('1', [draft(), draft('hard', '困难新题')]);
    expect(f.questions).toEqual([]);
    expect(f.revisions).toEqual([]);
    expect(f.batches[0].kind).toBe('questions_ai');
    await expect(f.imports.commitQuestions('1', preview.batch_id, [2])).rejects.toMatchObject({ code: 40302 });
    const first = await f.importer.commitAiGenerated('1', preview.batch_id, [2]);
    expect(await f.importer.commitAiGenerated('1', preview.batch_id, [2])).toEqual(first);
    expect(f.questions).toHaveLength(1);
    expect(f.questions[0].score).toBeNull();
    expect(f.revisions[0].scoreCents).toBeNull();
    expect(f.questions[0]).toMatchObject({ status: 'pending', source: 'ai', regulationId: null, versionId: null });
    expect(f.revisions[0]).toMatchObject({ revision: 1, status: 'pending', source: 'ai',
      approvedBy: null, approvedAt: null, reviewedBy: null, reviewedAt: null,
      regulationId: null, regulationVersionId: null });
    await expect(f.importer.commitAiGenerated('1', preview.batch_id, [3])).rejects.toMatchObject({ code: 40911 });
  });

  it('rolls back questions, revisions and receipt when any revision write fails', async () => {
    const f = fixture();
    const preview = await f.importer.previewAiGenerated('1', [draft(), draft('hard', '困难新题')]);
    const save = f.vRepo.save;
    f.vRepo.save = async (value: any) => {
      if (value.difficulty === 'hard') throw new Error('write failed');
      return save(value);
    };
    await expect(f.importer.commitAiGenerated('1', preview.batch_id, [2, 3])).rejects.toThrow('write failed');
    expect(f.questions).toEqual([]);
    expect(f.revisions).toEqual([]);
    expect(f.batches[0]).toMatchObject({ status: 'previewed', createdIds: null, committedRows: null });
  });
});

describe('ephemeral AI references', () => {
  it.each(['txt', 'xlsx'] as const)('uses strict %s references and overrides every model-controlled trusted field', async (format) => {
    const f = await aiFixture();
    let buffer = file();
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('refs');
      sheet.addRow([...QUESTION_IMPORT_HEADERS, 'score']); sheet.addRow(refCells);
      buffer = Buffer.from(await book.xlsx.writeBuffer());
    }
    const task = await f.ai.start('1', buffer, format);
    const done = await finished(f.ai, task.task_id);
    expect(done).toMatchObject({ status: 'completed', total_count: 1, completed_count: 1, generated_count: 2, failed_count: 0 });
    const batch = await f.ai.readBatch('1', done.batch_id);
    expect(batch.rows.map((row: any) => row.difficulty)).toEqual(['easy', 'hard']);
    for (const row of batch.rows) expect(row).toMatchObject({ category: '10', type: 'single', concept: '', errors: [] });
    const persistent = JSON.stringify({ cache: [...f.cache.values()], batches: f.batches, logs: f.logs });
    expect(persistent).not.toContain(reference);
    expect(persistent).not.toContain('参考解析');
    expect(f.questions).toEqual([]); expect(f.revisions).toEqual([]);
  });

  it('rejects malformed headers, over 50 reference rows, and over 5MB before AI or persistence', async () => {
    const f = await aiFixture();
    await expect(f.ai.start('1', Buffer.from('bad\nheader'), 'txt')).rejects.toMatchObject({ code: 40001 });
    await expect(f.ai.start('1', file(Array.from({ length: 51 }, () => refCells)), 'txt')).rejects.toMatchObject({ code: 40001 });
    await expect(f.ai.start('1', Buffer.alloc(5 * 1024 * 1024 + 1), 'txt')).rejects.toMatchObject({ code: 42202 });
    expect(f.gateway.chat).not.toHaveBeenCalled(); expect(f.cache.size).toBe(0); expect(f.batches).toEqual([]);
  });

  it('does not persist or echo reference text when every model call fails', async () => {
    const f = await aiFixture();
    f.gateway.chat.mockRejectedValue(new Error(reference));
    const task = await f.ai.start('1', file(), 'txt');
    const done = await finished(f.ai, task.task_id);
    expect(done).toMatchObject({ status: 'failed', generated_count: 0, failed_count: 2 });
    expect(f.batches).toEqual([]); expect(f.questions).toEqual([]);
    expect(JSON.stringify([...f.cache.values()])).not.toContain(reference);
  });

  it('retains only valid results for a partial failure and does not accept non-integer answers', async () => {
    const f = await aiFixture();
    f.gateway.chat.mockResolvedValue(JSON.stringify([generated('easy'), generated('hard', { answer: ['0'] })]));
    const task = await f.ai.start('1', file(), 'txt');
    const done = await finished(f.ai, task.task_id);
    expect(done).toMatchObject({ status: 'completed', generated_count: 1, failed_count: 1 });
    const batch = await f.ai.readBatch('1', done.batch_id);
    expect(batch.rows).toHaveLength(1); expect(batch.rows[0].difficulty).toBe('easy');
  });

  it('times out a stuck model call and leaves no generated batch', async () => {
    const f = await aiFixture();
    f.gateway.chat.mockImplementation(() => new Promise(() => undefined));
    const task = await f.ai.start('1', file(), 'txt');
    const done = await finished(f.ai, task.task_id);
    expect(done).toMatchObject({ status: 'failed', generated_count: 0, failed_count: 2 });
    expect(f.batches).toEqual([]);
    expect(f.gateway.chat.mock.calls[0][2].aborted).toBe(true);
  });

  it('marks a task from a restarted process as failed without recovering reference content', async () => {
    const f = await aiFixture();
    f.cache.set('ai:question-import:task:interrupted', JSON.stringify({
      task_id: 'interrupted', owner_id: '1', status: 'running', total_count: 2,
      completed_count: 1, generated_count: 2, failed_count: 0,
    }));
    expect(await f.ai.status('1', 'interrupted')).toMatchObject({ status: 'failed', message: expect.stringContaining('重新上传') });
    expect(f.batches).toEqual([]);
  });

  it('expires unconfirmed AI batches after 24 hours while keeping committed receipts retryable', async () => {
    const f = fixture();
    const preview = await f.importer.previewAiGenerated('1', [draft()]);
    f.batches[0].createdAt = new Date(Date.now() - 24 * 3600 * 1000 - 1);
    await expect(f.importer.readAiGenerated('1', preview.batch_id)).rejects.toMatchObject({ code: 40401 });
    await expect(f.importer.commitAiGenerated('1', preview.batch_id, [2])).rejects.toMatchObject({ code: 40401 });
    f.batches[0].createdAt = new Date();
    const receipt = await f.importer.commitAiGenerated('1', preview.batch_id, [2]);
    f.batches[0].createdAt = new Date(Date.now() - 48 * 3600 * 1000);
    expect(await f.importer.commitAiGenerated('1', preview.batch_id, [2])).toEqual(receipt);
  });

  it('supports multiple and judgment references with the original concept and without a bank score', async () => {
    const f = await aiFixture();
    const cases = [
      { type: 'multiple', options, answer: [0, 1], concept: '31' },
      { type: 'judgment', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [1], concept: '' },
    ];
    f.importer.conceptRepo = { findOne: async () => ({ id: '31', categoryId: '10', type: 'multiple', name: '检查' }) };
    f.gateway.chat.mockImplementation(async (messages: any) => {
      const input = JSON.parse(messages[1].content).reference;
      return JSON.stringify(['easy', 'hard'].map((difficulty) => generated(difficulty, {
        stem: `${input.type}-${difficulty}-新题`,
        options: input.type === 'judgment' ? input.options : generatedOptions, answer: input.answer,
      })));
    });
    const task = await f.ai.start('1', file(cases.map((item) => [
      '10', item.type, 'ignored', item.concept, `${reference}${item.type}`, JSON.stringify(item.options),
      JSON.stringify(item.answer), '参考解析', '7.25',
    ])), 'txt');
    const done = await finished(f.ai, task.task_id);
    const batch = await f.ai.readBatch('1', done.batch_id);
    expect(batch.rows).toHaveLength(4);
    expect(batch.rows.filter((row) => row.type === 'multiple').every((row) => row.concept === '31' && !('score' in row))).toBe(true);
    await f.ai.commit('1', done.batch_id, batch.valid_rows);
    expect(f.questions.map((row) => row.type).sort()).toEqual(['judgment', 'judgment', 'multiple', 'multiple']);
  });

  it('turns twenty reference rows into at most twenty easy and twenty hard generated rows', async () => {
    const f = await aiFixture();
    f.gateway.chat.mockImplementation(async (messages: any) => {
      const stem = JSON.parse(messages[1].content).reference.stem;
      const index = stem.match(/\d+$/)[0];
      return JSON.stringify(['easy', 'hard'].map((difficulty) => generated(difficulty, { stem: `全新-${index}-${difficulty}` })));
    });
    const task = await f.ai.start('1', file(Array.from({ length: 20 }, (_, index) => [
      ...refCells.slice(0, 4), `${reference}-${index}`, ...refCells.slice(5),
    ])), 'txt');
    const done = await finished(f.ai, task.task_id);
    const batch = await f.ai.readBatch('1', done.batch_id);
    expect(done).toMatchObject({ generated_count: 40, completed_count: 20, failed_count: 0 });
    expect(batch.rows.filter((row) => row.difficulty === 'easy')).toHaveLength(20);
    expect(batch.rows.filter((row) => row.difficulty === 'hard')).toHaveLength(20);
    expect(f.questions).toEqual([]); expect(f.revisions).toEqual([]);
    expect(JSON.stringify(f.batches)).not.toContain(reference);
  });

  it('isolates tasks and batch read/commit/edit/export by owner and kind', async () => {
    const f = await aiFixture();
    const task = await f.ai.start('1', file(), 'txt');
    await expect(f.ai.status('2', task.task_id)).rejects.toMatchObject({ code: 40302 });
    const done = await finished(f.ai, task.task_id);
    await expect(f.ai.readBatch('2', done.batch_id)).rejects.toMatchObject({ code: 40302 });
    await expect(f.ai.commit('2', done.batch_id, [2])).rejects.toMatchObject({ code: 40302 });
    await expect(f.ai.updateRow('2', done.batch_id, 2, { stem: '伪造修改' })).rejects.toMatchObject({ code: 40302 });
    await expect(f.ai.download('2', done.batch_id, 'txt')).rejects.toMatchObject({ code: 40302 });
    f.batches[0].kind = 'questions';
    await expect(f.ai.readBatch('1', done.batch_id)).rejects.toMatchObject({ code: 40302 });
    await expect(f.ai.commit('1', done.batch_id, [2])).rejects.toMatchObject({ code: 40302 });
  });

  it('edits only generated content, regenerates with trusted fields fixed, and exports strict eight columns', async () => {
    const f = await aiFixture();
    const task = await f.ai.start('1', file(), 'txt');
    const done = await finished(f.ai, task.task_id);
    await expect(f.ai.updateRow('1', done.batch_id, 2, { category: '999' } as any)).rejects.toMatchObject({ code: 40001 });
    await f.ai.updateRow('1', done.batch_id, 2, { stem: '<p>人工修订</p>', answer: [1] });
    let batch = await f.ai.readBatch('1', done.batch_id);
    expect(batch.rows[0]).toMatchObject({ stem: '<p>人工修订</p>', answer: [1], difficulty: 'easy' });
    f.gateway.chat.mockResolvedValue(JSON.stringify([generated('easy', { stem: '重生成的简单题' })]));
    await f.ai.regenerateRow('1', done.batch_id, 2);
    batch = await f.ai.readBatch('1', done.batch_id);
    expect(batch.rows[0]).toMatchObject({ stem: '重生成的简单题', category: '10', type: 'single', difficulty: 'easy' });
    const txt = (await f.ai.download('1', done.batch_id, 'txt')).toString('utf8').replace(/^\uFEFF/, '');
    expect(txt.split(/\r?\n/)[0]).toBe(QUESTION_IMPORT_HEADERS.join('\t'));
    expect(txt).toContain('重生成的简单题'); expect(txt).not.toContain(reference);
    await f.ai.commit('1', done.batch_id, [2]);
    await expect(f.ai.updateRow('1', done.batch_id, 2, { stem: '确认后修改' })).rejects.toMatchObject({ code: 40911 });
  });

  it('rejects a provider that returns an unchanged reference stem', async () => {
    const f = await aiFixture();
    f.gateway.chat.mockResolvedValue(JSON.stringify([generated('easy', { stem: reference }), generated('hard', { stem: reference })]));
    const task = await f.ai.start('1', file(), 'txt');
    expect(await finished(f.ai, task.task_id)).toMatchObject({ status: 'failed', generated_count: 0 });
    expect(f.batches).toEqual([]);
  });

  it.each(['stem', 'analysis', 'option', 'stem_in_analysis'] as const)(
    'rejects replay of any reference in the batch through generated %s', async (field) => {
      const f = await aiFixture();
      const secondStem = 'REFERENCE_B_STEM_PRIVATE';
      const secondAnalysis = 'REFERENCE_B_ANALYSIS_PRIVATE';
      const secondOption = 'REFERENCE_B_OPTION_PRIVATE';
      const replay = field === 'stem' ? { stem: `<p>${secondStem}</p>` }
        : field === 'analysis' ? { analysis: `解释如下：${secondAnalysis}。` }
          : field === 'stem_in_analysis' ? { analysis: `根据${secondStem}得出结论。` }
            : { options: [{ key: 'A', text: `<p>${secondOption}</p>` }, generatedOptions[1]] };
      f.gateway.chat.mockResolvedValue(JSON.stringify([generated('easy', replay), generated('hard', replay)]));
      const task = await f.ai.start('1', file([refCells, [
        '10', 'single', 'easy', '', secondStem,
        JSON.stringify([{ key: 'A', text: secondOption }, { key: 'B', text: 'REFERENCE_B_OTHER_OPTION_PRIVATE' }]),
        '[0]', secondAnalysis, '5',
      ]]), 'txt');
      const done = await finished(f.ai, task.task_id);
      expect(done).toMatchObject({ status: 'failed', generated_count: 0, failed_count: 4 });
      expect(f.batches).toEqual([]); expect(f.questions).toEqual([]);
      expect(JSON.stringify({ cache: [...f.cache.values()], logs: f.logs })).not.toContain('REFERENCE_B_');
    },
  );

  it('allows generic short reference options inside newly written generated content', async () => {
    const f = await aiFixture();
    f.gateway.chat.mockResolvedValue(JSON.stringify(['easy', 'hard'].map((difficulty) => generated(difficulty, {
      stem: `${difficulty}作业方案是否必须复核？`,
      options: [{ key: 'A', text: '是，应在实施前复核' }, { key: 'B', text: '否，可以随后补办' }],
    }))));
    const task = await f.ai.start('1', file([[
      '10', 'single', 'easy', '', reference,
      JSON.stringify([{ key: 'A', text: '是' }, { key: 'B', text: '否' }]), '[0]', '参考解析', '5',
    ]]), 'txt');
    const done = await finished(f.ai, task.task_id);
    expect(done).toMatchObject({ status: 'completed', generated_count: 2, failed_count: 0 });
  });

  it('rejects a complete reference option set even when every option is short', async () => {
    const f = await aiFixture();
    f.gateway.chat.mockResolvedValue(JSON.stringify(['easy', 'hard'].map((difficulty) => generated(difficulty, { options }))));
    const task = await f.ai.start('1', file(), 'txt');
    expect(await finished(f.ai, task.task_id)).toMatchObject({ status: 'failed', generated_count: 0 });
    expect(f.batches).toEqual([]);
  });

  it.each([{ options: {} }, { options: null }, { answer: {} }, { answer: null }])(
    'rejects non-array PATCH values as parameter errors: %j', async (patch) => {
      const f = await aiFixture();
      const task = await f.ai.start('1', file(), 'txt');
      const done = await finished(f.ai, task.task_id);
      await expect(f.ai.updateRow('1', done.batch_id, 2, patch as any)).rejects.toMatchObject({ code: 40001 });
      const batch = await f.ai.readBatch('1', done.batch_id);
      expect(batch.rows[0]).toMatchObject({ options: generatedOptions, answer: [0] });
    },
  );
});

describe('AI import HTTP boundary', () => {
  it('enforces the distinct task, preview-write and question-confirmation permissions', async () => {
    const { AiQuestionImportController } = await import('../src/modules/questions/ai-question-import.controller');
    const handlers: Array<[string, string]> = [
      ['start', 'ai:write'], ['status', 'ai:read'], ['batch', 'ai:read'], ['download', 'ai:read'],
      ['update', 'ai:write'], ['regenerate', 'ai:write'], ['commit', 'questions:write'],
    ];
    for (const [name, permission] of handlers) {
      const context: any = {
        getHandler: () => (AiQuestionImportController.prototype as any)[name],
        getClass: () => AiQuestionImportController,
        switchToHttp: () => ({ getRequest: () => ({ user: { id: 1 }, method: 'POST' }) }),
      };
      const access: any = { assertAllowed: async (_id: string, actual: string) => {
        if (actual !== permission) throw Errors.forbidden();
      } };
      expect(await new PermissionsGuard(new Reflector(), access).canActivate(context)).toBe(true);
      access.assertAllowed = async () => { throw Errors.forbidden(); };
      await expect(new PermissionsGuard(new Reflector(), access).canActivate(context)).rejects.toMatchObject({ code: 40301 });
    }
  });

  it('clears the upload buffer after both successful validation and rejected requests', async () => {
    const { AiQuestionImportController } = await import('../src/modules/questions/ai-question-import.controller');
    const f = await aiFixture();
    const controller = new AiQuestionImportController(f.ai);
    const uploaded: any = { buffer: file() };
    const task = await controller.start(uploaded, { format: 'txt' }, { id: 1 } as any);
    expect(uploaded.buffer.every((byte: number) => byte === 0)).toBe(true);
    await finished(f.ai, task.task_id);
    const rejected: any = { buffer: file() };
    await expect(controller.start(rejected, { format: 'txt', category_id: '10' }, { id: 1 } as any)).rejects.toMatchObject({ code: 40001 });
    expect(rejected.buffer.every((byte: number) => byte === 0)).toBe(true);
  });
});
