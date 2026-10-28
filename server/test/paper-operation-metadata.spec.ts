import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import {
  CreateTrainingPaperDto,
  PAPER_CREATE_KEYS,
  PAPER_UPDATE_KEYS,
  TrainingPaperDtoValidationPipe,
  UpdateTrainingPaperDto,
} from '../src/modules/exams/paper.dto';

const CREATOR = { id: '9', name: 'creator' };
const UPDATER = { id: '10', name: 'updater' };
const CREATE = { title: '操作信息试卷', mode: 'fixed', category_id: '7' } as const;

function fixture() {
  const papers = new Map<string, any>();
  const links: any[] = [];
  const users = [
    { id: '9', realName: '创建管理员', username: 'creator' },
    { id: '10', realName: '   ', username: 'updater' },
  ];
  let nextId = 11;
  let tick = 0;
  const paperRepo = {
    create: vi.fn((value: any) => Object.assign(new ExamPaper(), structuredClone(value))),
    findOne: vi.fn(async ({ where }: any) => structuredClone(papers.get(String(where.id)) ?? null)),
    save: vi.fn(async (value: any) => {
      const id = String(value.id ?? nextId++);
      const now = new Date(Date.parse('2026-10-26T08:00:00.000Z') + tick++ * 1000);
      const saved = {
        ...structuredClone(value), id,
        createdAt: value.createdAt ?? now,
        updatedAt: value.updatedAt ?? now,
      };
      papers.set(id, saved);
      return structuredClone(saved);
    }),
  };
  const paperQuestionRepo = {
    find: vi.fn(async ({ where }: any) => links.filter((item) => String(item.paperId) === String(where.paperId)).map(item => structuredClone(item))),
    existsBy: vi.fn(async ({ paperId }: any) => links.some((item) => String(item.paperId) === String(paperId))),
    create: vi.fn((value: any) => ({ id: String(700 + links.length), ...value })),
    delete: vi.fn(async ({ paperId }: any) => {
      const remaining = links.filter((item) => String(item.paperId) !== String(paperId));
      links.splice(0, links.length, ...remaining);
      return { affected: 1 };
    }),
    save: vi.fn(async (values: any[]) => { links.push(...structuredClone(values)); return values; }),
  };
  const version = {
    id: '501', questionId: '101', categoryId: '7', difficulty: 'easy', type: 'single',
    stem: '题干', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0],
    analysis: null, regulationId: null,
  };
  const question = { id: '101', currentVersionId: '501', isEnabled: true, deletedAt: null };
  const versionRepo = { findBy: vi.fn(async ({ id }: any) => id.value.includes('501') ? [structuredClone(version)] : []) };
  const questionRepo = {
    findBy: vi.fn(async () => [structuredClone(question)]),
    findOne: vi.fn(async ({ where }: any) => String(where.id) === '101' ? structuredClone(question) : null),
  };
  const userRepo = {
    findBy: vi.fn(async ({ id }: any) => users.filter((user) => id.value.includes(String(user.id))).map(user => structuredClone(user))),
  };
  const manager = { getRepository(entity: unknown) {
    if (entity === ExamPaper) return paperRepo;
    if (entity === PaperQuestion) return paperQuestionRepo;
    if (entity === QuestionVersion) return versionRepo;
    if (entity === Question) return questionRepo;
    throw new Error(`unexpected repository ${(entity as any)?.name}`);
  } };
  const service = Object.create(PaperService.prototype) as PaperService;
  const audit = { log: vi.fn() };
  Object.assign(service, {
    paperRepo, pqRepo: { ...paperQuestionRepo, existsBy() { throw new Error('question preservation must use the transaction repository'); } },
    versionRepo, questionRepo, userRepo,
    releaseRepo: { findOne: vi.fn(async () => null) },
    categories: { lockActive: vi.fn(async () => ({ id: '7', status: 1 })) },
    audit,
    dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
  });
  return { service, papers, userRepo, paperRepo, paperQuestionRepo, links, audit };
}

describe('training paper operation metadata', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T01:57:26.706Z'));
  });
  afterEach(() => vi.useRealTimers());

  it.each(['create', 'copy'])('supplies one UTC instant to both timestamp columns at the %s save boundary', async (operation) => {
    const f = fixture();
    let result;
    if (operation === 'create') {
      result = await f.service.createTraining(CREATE, CREATOR, null);
    } else {
      const source = await f.service.createTraining(CREATE, CREATOR, null);
      vi.advanceTimersByTime(60_000);
      f.paperRepo.save.mockClear();
      result = await f.service.copyTraining(source.id, UPDATER, null);
    }
    const saved = f.paperRepo.save.mock.calls[0][0];
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBe(saved.createdAt);
    expect(saved.createdAt.toISOString()).toBe(new Date().toISOString());
    expect(result.created_at.toISOString()).toBe(new Date().toISOString());
    expect(result.updated_at.toISOString()).toBe(result.created_at.toISOString());
  });

  it('returns real creator/updater names after each write while preserving the creator', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    expect(created).toMatchObject({
      created_by_name: '创建管理员', updated_by_name: '创建管理员',
      created_at: expect.any(Date), updated_at: expect.any(Date),
    });
    const createdAt = created.created_at;
    expect(f.papers.get(created.id)).toMatchObject({ createdBy: '9', updatedBy: '9' });

    vi.advanceTimersByTime(1_000);
    const updated = await f.service.updateTraining(created.id, { title: '修改配置' }, UPDATER, null);
    expect(updated).toMatchObject({ created_by_name: '创建管理员', updated_by_name: 'updater', created_at: createdAt });
    expect(updated.updated_at.getTime()).toBeGreaterThan(created.updated_at.getTime());
    expect(f.papers.get(created.id)).toMatchObject({ createdBy: '9', updatedBy: '10' });

    const questions = await f.service.setTrainingQuestions(
      created.id,
      [{ question_version_id: '501', score_cents: 10000 }],
      CREATOR,
      null,
    );
    expect(questions).toMatchObject({ created_by_name: '创建管理员', updated_by_name: '创建管理员', created_at: createdAt });
    expect(questions.updated_at.getTime()).toBeGreaterThanOrEqual(updated.updated_at.getTime());
    expect(f.papers.get(created.id)).toMatchObject({ createdBy: '9', updatedBy: '9' });

    const copied = await f.service.copyTraining(created.id, UPDATER, null);
    expect(copied).toMatchObject({ created_by_name: 'updater', updated_by_name: 'updater', status: 'draft' });
    expect(f.papers.get(copied.id)).toMatchObject({ createdBy: '10', updatedBy: '10' });
    expect(f.papers.get(created.id).createdBy).toBe('9');
  });

  it('touches updated_at when the same actor repeats an unchanged configuration or question set', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    const items = [{ question_version_id: '501', score_cents: 10000 }];
    await f.service.setTrainingQuestions(created.id, items, CREATOR, null);

    const stale = new Date('2020-01-01T00:00:00.000Z');
    Object.assign(f.papers.get(created.id), { updatedAt: stale, updatedBy: '9' });
    const repeatedQuestions = await f.service.setTrainingQuestions(created.id, items, CREATOR, null);
    expect(repeatedQuestions.updated_at.getTime()).toBeGreaterThan(stale.getTime());

    Object.assign(f.papers.get(created.id), { updatedAt: stale, updatedBy: '9' });
    const repeatedConfig = await f.service.updateTraining(created.id, { title: CREATE.title }, CREATOR, null);
    expect(repeatedConfig.updated_at.getTime()).toBeGreaterThan(stale.getTime());
  });

  it('looks up at most the two referenced users once and returns null for a missing historical updater', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    Object.assign(f.papers.get(created.id), { updatedBy: '999' });
    f.userRepo.findBy.mockClear();

    const detail = await f.service.trainingDetail(created.id);

    expect(detail).toMatchObject({ created_by_name: '创建管理员', updated_by_name: null });
    expect(f.userRepo.findBy).toHaveBeenCalledTimes(1);
  });

  it('keeps creator/updater identity server-owned at the strict DTO boundary', async () => {
    const pipe = new TrainingPaperDtoValidationPipe(PAPER_CREATE_KEYS);
    for (const field of ['created_by', 'updated_by', 'created_by_name', 'updated_by_name']) {
      await expect(pipe.transform({ ...CREATE, [field]: '9' }, {
        type: 'body', metatype: CreateTrainingPaperDto,
      })).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe('basic paper updates preserve the current question list', () => {
  it('accepts preserve_questions only as an optional update boolean', async () => {
    const pipe = new TrainingPaperDtoValidationPipe(PAPER_UPDATE_KEYS);
    for (const preserve_questions of [true, false]) {
      await expect(pipe.transform({ preserve_questions }, { type: 'body', metatype: UpdateTrainingPaperDto }))
        .resolves.toMatchObject({ preserve_questions });
    }
    await expect(pipe.transform({}, { type: 'body', metatype: UpdateTrainingPaperDto })).resolves.toEqual({});
    for (const preserve_questions of [null, 'true', 1]) {
      await expect(pipe.transform({ preserve_questions }, { type: 'body', metatype: UpdateTrainingPaperDto }))
        .rejects.toMatchObject({ status: 400 });
    }
    await expect(new TrainingPaperDtoValidationPipe(PAPER_CREATE_KEYS).transform({ ...CREATE, preserve_questions: true }, {
      type: 'body', metatype: CreateTrainingPaperDto,
    })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['category', { category_id: '8', title: '旧弹框修改' }],
    ['mode', { mode: 'random', rules: [{ type: 'single', count: 1, score_cents: 10000 }] }],
  ])('rejects a stale basic %s change after another session adds questions, before changing the locked entity', async (_name, patch) => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    expect((await f.service.trainingDetail(created.id)).questions).toEqual([]);
    await f.service.setTrainingQuestions(created.id, [{ question_version_id: '501', score_cents: 10000 }], CREATOR, null);
    const beforePaper = structuredClone(f.papers.get(created.id));
    const beforeLinks = structuredClone(f.links);
    f.paperRepo.save.mockClear(); f.paperQuestionRepo.delete.mockClear(); f.audit.log.mockClear();

    await expect(f.service.updateTraining(created.id, { ...patch, preserve_questions: true } as UpdateTrainingPaperDto, UPDATER, null))
      .rejects.toMatchObject({ code: 40970 });

    expect(f.papers.get(created.id)).toEqual(beforePaper);
    expect(await f.paperRepo.findOne.mock.results.at(-1)!.value).toEqual(beforePaper);
    expect(f.links).toEqual(beforeLinks);
    if (patch.category_id) expect(f.paperQuestionRepo.existsBy).toHaveBeenCalledWith({ paperId: created.id });
    else expect(f.paperQuestionRepo.existsBy).not.toHaveBeenCalled();
    expect(f.paperRepo.save).not.toHaveBeenCalled();
    expect(f.paperQuestionRepo.delete).not.toHaveBeenCalled();
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it('allows a category change while the locked category paper is empty', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    const updated = await f.service.updateTraining(created.id, { category_id: '8', preserve_questions: true }, UPDATER, null);
    expect(updated).toMatchObject({ category_id: '8', mode: 'fixed' });
    expect(f.paperQuestionRepo.existsBy).toHaveBeenCalledWith({ paperId: created.id });
    expect(f.links).toEqual([]);
  });

  it('rejects a mode conversion even when the existing draft has no questions', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    await expect(f.service.updateTraining(created.id, {
      mode: 'random', rules: [{ type: 'single', count: 1, score_cents: 10000 }], preserve_questions: true,
    }, UPDATER, null)).rejects.toMatchObject({ code: 40970 });
    expect(f.papers.get(created.id).mode).toBe('fixed');
  });

  it('allows basic title edits on a populated paper without clearing its question list', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    await f.service.setTrainingQuestions(created.id, [{ question_version_id: '501', score_cents: 10000 }], CREATOR, null);
    const before = structuredClone(f.links);
    const updated = await f.service.updateTraining(created.id, { title: '基本修改', preserve_questions: true }, UPDATER, null);
    expect(updated.title).toBe('基本修改');
    expect(updated).not.toHaveProperty('preserve_questions');
    expect(f.links).toEqual(before);
    expect(f.paperQuestionRepo.existsBy).not.toHaveBeenCalled();
  });

  it.each([undefined, false])('keeps explicit designer category-change behavior when preserve_questions=%s', async (preserve_questions) => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    await f.service.setTrainingQuestions(created.id, [{ question_version_id: '501', score_cents: 10000 }], CREATOR, null);
    const updated = await f.service.updateTraining(created.id, { category_id: '8', preserve_questions }, UPDATER, null);
    expect(updated.category_id).toBe('8');
    expect(f.links).toEqual([]);
    expect(f.paperQuestionRepo.existsBy).not.toHaveBeenCalled();
  });
});
