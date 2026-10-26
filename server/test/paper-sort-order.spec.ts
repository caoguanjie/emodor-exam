import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import {
  CreateTrainingPaperDto,
  PAPER_CREATE_KEYS,
  TrainingPaperDtoValidationPipe,
  UpdateTrainingPaperDto,
} from '../src/modules/exams/paper.dto';

const ACTOR = { id: '9', name: '排序管理员' };
const CREATE = { title: '排序试卷', mode: 'fixed', category_id: '7' } as const;

function dto(input: unknown, update = false) {
  return new TrainingPaperDtoValidationPipe(PAPER_CREATE_KEYS).transform(input, {
    type: 'body',
    metatype: update ? UpdateTrainingPaperDto : CreateTrainingPaperDto,
  });
}

function fixture() {
  const papers = new Map<string, any>();
  let nextId = 11;
  const orderCalls: Array<[string, 'ASC' | 'DESC']> = [];
  const paperRepo = {
    create: vi.fn((value: any) => Object.assign(new ExamPaper(), structuredClone(value))),
    save: vi.fn(async (value: any) => {
      const id = String(value.id ?? nextId++);
      const saved = {
        ...structuredClone(value),
        id,
        createdAt: value.createdAt ?? new Date('2026-10-26T08:00:00.000Z'),
        updatedAt: new Date('2026-10-26T08:00:00.000Z'),
      };
      papers.set(id, saved);
      return structuredClone(saved);
    }),
    findOne: vi.fn(async ({ where }: any) => structuredClone(papers.get(String(where.id)) ?? null)),
    createQueryBuilder: vi.fn(() => {
      const qb: any = {};
      for (const method of ['where', 'andWhere', 'skip', 'take']) qb[method] = vi.fn(() => qb);
      qb.orderBy = vi.fn((field: string, direction: 'ASC' | 'DESC') => {
        orderCalls.push([field, direction]);
        return qb;
      });
      qb.addOrderBy = vi.fn((field: string, direction: 'ASC' | 'DESC') => {
        orderCalls.push([field, direction]);
        return qb;
      });
      qb.getManyAndCount = vi.fn(async () => [[...papers.values()], papers.size]);
      return qb;
    }),
  };
  const paperQuestionRepo = { find: vi.fn(async () => []) };
  const manager = { getRepository(entity: unknown) {
    if (entity === ExamPaper) return paperRepo;
    if (entity === PaperQuestion) return paperQuestionRepo;
    throw new Error(`unexpected repository ${(entity as any)?.name}`);
  } };
  const service = Object.create(PaperService.prototype) as PaperService;
  Object.assign(service, {
    paperRepo,
    pqRepo: paperQuestionRepo,
    releaseRepo: { findOne: vi.fn(async () => null) },
    userRepo: { findBy: vi.fn(async ({ id }: any) => id.value.map((value: string) => ({ id: value, realName: null, username: 'admin' }))) },
    categories: { lockActive: vi.fn(async () => ({ id: '7', status: 1 })) },
    audit: { log: vi.fn() },
    dataSource: { transaction: (work: (value: any) => Promise<unknown>) => work(manager) },
  });
  return { service, papers, orderCalls };
}

describe('training paper sort order', () => {
  it('accepts only an optional non-negative signed-int sort_order at the strict DTO boundary', async () => {
    for (const sortOrder of [0, 2_147_483_647]) {
      await expect(dto({ ...CREATE, sort_order: sortOrder })).resolves.toMatchObject({ sort_order: sortOrder });
      await expect(dto({ sort_order: sortOrder }, true)).resolves.toMatchObject({ sort_order: sortOrder });
    }
    for (const sortOrder of [-1, 1.5, '1', null, 2_147_483_648]) {
      await expect(dto({ ...CREATE, sort_order: sortOrder })).rejects.toMatchObject({ status: 400 });
    }
  });

  it('defaults, serializes, updates and copies sort_order without exposing it on the legacy view', async () => {
    const f = fixture();
    const defaulted = await f.service.createTraining(CREATE, ACTOR, null);
    expect(defaulted).toMatchObject({ id: '11', sort_order: 0 });
    expect(f.papers.get('11').sortOrder).toBe(0);

    const created = await f.service.createTraining({ ...CREATE, title: '靠后试卷', sort_order: 17 } as any, ACTOR, null);
    expect(created).toMatchObject({ id: '12', sort_order: 17 });
    expect(await f.service.updateTraining('12', { title: '仅改标题' }, ACTOR, null)).toMatchObject({ sort_order: 17 });
    expect(await f.service.updateTraining('12', { sort_order: 3 } as any, ACTOR, null)).toMatchObject({ sort_order: 3 });

    const copied = await f.service.copyTraining('12', ACTOR, null);
    expect(copied).toMatchObject({ id: '13', sort_order: 3, status: 'draft' });
    expect(f.papers.get('12').sortOrder).toBe(3);

    const legacyView = f.service.paperView({
      ...f.papers.get('12'), businessScope: 'regulation', regulationId: '5', sortOrder: 99,
    } as ExamPaper);
    expect(legacyView).not.toHaveProperty('sort_order');
  });

  it('lists training papers by sort_order ascending and id descending and returns the field', async () => {
    const f = fixture();
    await f.service.createTraining({ ...CREATE, sort_order: 2 } as any, ACTOR, null);
    await f.service.createTraining({ ...CREATE, title: '同序较新', sort_order: 0 } as any, ACTOR, null);
    await f.service.createTraining({ ...CREATE, title: '同序较旧', sort_order: 0 } as any, ACTOR, null);

    const result = await f.service.listTraining({ page: 1, page_size: 20 });

    expect(f.orderCalls).toEqual([
      ['paper.sort_order', 'ASC'],
      ['paper.id', 'DESC'],
    ]);
    expect(result.items.map((item) => item.sort_order)).toEqual([2, 0, 0]);
  });
});
