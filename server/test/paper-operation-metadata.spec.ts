import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import {
  CreateTrainingPaperDto,
  PAPER_CREATE_KEYS,
  TrainingPaperDtoValidationPipe,
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
      const isNew = value.id == null;
      const id = String(value.id ?? nextId++);
      const now = new Date(Date.parse('2026-10-26T08:00:00.000Z') + tick++ * 1000);
      const saved = {
        ...structuredClone(value), id,
        createdAt: value.createdAt ?? now,
        updatedAt: isNew ? now : value.updatedAt,
      };
      papers.set(id, saved);
      return structuredClone(saved);
    }),
  };
  const paperQuestionRepo = {
    find: vi.fn(async ({ where }: any) => links.filter((item) => String(item.paperId) === String(where.paperId)).map(item => structuredClone(item))),
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
  Object.assign(service, {
    paperRepo, pqRepo: paperQuestionRepo, versionRepo, questionRepo, userRepo,
    releaseRepo: { findOne: vi.fn(async () => null) },
    categories: { lockActive: vi.fn(async () => ({ id: '7', status: 1 })) },
    audit: { log: vi.fn() },
    dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
  });
  return { service, papers, userRepo };
}

describe('training paper operation metadata', () => {
  it('returns real creator/updater names after each write while preserving the creator', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE, CREATOR, null);
    expect(created).toMatchObject({
      created_by_name: '创建管理员', updated_by_name: '创建管理员',
      created_at: expect.any(Date), updated_at: expect.any(Date),
    });
    const createdAt = created.created_at;
    expect(f.papers.get(created.id)).toMatchObject({ createdBy: '9', updatedBy: '9' });

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
