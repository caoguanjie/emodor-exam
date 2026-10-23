import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import { PaperAdminController } from '../src/modules/exams/paper-admin.controller';
import { CreateTrainingPaperDto, UpdateTrainingPaperDto } from '../src/modules/exams/paper.dto';

const ACTOR = { id: '9', name: '布局测试管理员' };
const CREATE = { title: '设计器试卷', mode: 'fixed', category_id: '7' };
const LAYOUT = {
  schema_version: 1,
  settings: {
    templateName: '横向纸张', pageSize: 'A5', pageOrientation: 2,
    pageSizeReduce: { top: 0, bottom: 99, left: 12, right: 20 },
  },
};

async function validateCreate(layout: unknown) {
  return bodyPipe('create', 0).transform(
    { ...CREATE, designer_layout: layout },
    { type: 'body', metatype: CreateTrainingPaperDto },
  );
}

function bodyPipe(method: 'create' | 'update', parameterIndex: number) {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, PaperAdminController, method);
  const body = Object.values(args).find((value: any) => value.index === parameterIndex) as any;
  return body.pipes[0];
}

// Only persistence is replaced: the real service validates, constructs, updates,
// and returns paper data. Copies prevent a response mutation from editing storage.
function fixture(existing?: Record<string, unknown>) {
  const rows = new Map<string, any>();
  if (existing) rows.set(String(existing.id), structuredClone(existing));
  const paperRepo = {
    create: (value: unknown) => Object.assign(new ExamPaper(), structuredClone(value)),
    findOne: async ({ where }: any) => structuredClone(rows.get(String(where.id)) ?? null),
    save: async (value: any) => {
      const saved = { ...structuredClone(value), id: value.id ?? String(rows.size + 1) };
      rows.set(saved.id, saved);
      return structuredClone(saved);
    },
  };
  const pqRepo = { find: async () => [] };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === ExamPaper) return paperRepo;
      if (entity === PaperQuestion) return pqRepo;
      throw new Error('Unexpected repository in layout test');
    },
  };
  const service = Object.create(PaperService.prototype) as PaperService;
  Object.assign(service, {
    paperRepo, pqRepo,
    releaseRepo: { findOne: async () => null },
    categories: { lockActive: async (_manager: unknown, id: string) => {
      if (id !== '7') throw new Error('Unexpected category');
      return { id: '7', status: 1 };
    } },
    audit: { log: () => undefined },
    dataSource: { transaction: (work: (value: unknown) => unknown) => work(manager) },
  });
  return { service, rows };
}

describe('training paper designer layout', () => {
  it('accepts schema 1 and preserves exact whitelisted settings through the DTO boundary', async () => {
    expect(await validateCreate(LAYOUT)).toMatchObject({ designer_layout: LAYOUT });
    expect(await bodyPipe('update', 1).transform(
      { designer_layout: LAYOUT }, { type: 'body', metatype: UpdateTrainingPaperDto },
    )).toMatchObject({ designer_layout: LAYOUT });
  });

  const invalid = [
    ['future schema', { ...LAYOUT, schema_version: 2 }],
    ['root unknown property', { ...LAYOUT, answers: [] }],
    ['settings unknown property', { ...LAYOUT, settings: { ...LAYOUT.settings, src: 'https://example.invalid/image' } }],
    ['margin unknown property', { ...LAYOUT, settings: { ...LAYOUT.settings, pageSizeReduce: { ...LAYOUT.settings.pageSizeReduce, style: 'color:red' } } }],
    ['unsupported page', { ...LAYOUT, settings: { ...LAYOUT.settings, pageSize: 'A3' } }],
    ['unsupported orientation', { ...LAYOUT, settings: { ...LAYOUT.settings, pageOrientation: '2' } }],
    ['empty name', { ...LAYOUT, settings: { ...LAYOUT.settings, templateName: '' } }],
    ['long name', { ...LAYOUT, settings: { ...LAYOUT.settings, templateName: '题'.repeat(129) } }],
    ['negative margin', { ...LAYOUT, settings: { ...LAYOUT.settings, pageSizeReduce: { top: -1, bottom: 15, left: 15, right: 15 } } }],
    ['fractional margin', { ...LAYOUT, settings: { ...LAYOUT.settings, pageSizeReduce: { top: 1.5, bottom: 15, left: 15, right: 15 } } }],
    ['oversized margin', { ...LAYOUT, settings: { ...LAYOUT.settings, pageSizeReduce: { top: 100, bottom: 15, left: 15, right: 15 } } }],
    ['missing margin', { ...LAYOUT, settings: { ...LAYOUT.settings, pageSizeReduce: { top: 15, bottom: 15, left: 15 } } }],
    ['missing settings', { schema_version: 1 }],
    ['array layout', []],
    ['explicit null layout', null],
    ['prototype-shaped unknown key', Object.fromEntries([...Object.entries(LAYOUT), ['__proto__', { polluted: true }]])],
    ['constructor-shaped unknown key', { ...LAYOUT, settings: { ...LAYOUT.settings, constructor: { unsafe: true } } }],
  ] as const;

  for (const [name, layout] of invalid) {
    it(`rejects ${name} at the request boundary`, async () => {
      await expect(validateCreate(layout)).rejects.toMatchObject({ code: 40001 });
      await expect(bodyPipe('update', 1).transform(
        { designer_layout: layout }, { type: 'body', metatype: UpdateTrainingPaperDto },
      )).rejects.toMatchObject({ code: 40001 });
    });
  }

  it('persists create/update layout and returns the same value when reopening detail', async () => {
    const { service, rows } = fixture();
    const created = await service.createTraining(await validateCreate(LAYOUT), ACTOR, null);
    expect(created).toMatchObject({ designer_layout: LAYOUT });
    expect(rows.get(created.id)).toMatchObject({ designerLayout: LAYOUT });
    expect(await service.trainingDetail(created.id)).toMatchObject({ designer_layout: LAYOUT });

    const changed = { ...LAYOUT, settings: { ...LAYOUT.settings, templateName: '更新布局', pageSize: 'A4', pageOrientation: 1 } };
    const patch = await bodyPipe('update', 1).transform(
      { designer_layout: changed }, { type: 'body', metatype: UpdateTrainingPaperDto },
    );
    expect(await service.updateTraining(created.id, patch, ACTOR, null)).toMatchObject({ designer_layout: changed });
    expect((await service.trainingDetail(created.id)) as any).toMatchObject({ designer_layout: changed });
    await service.updateTraining(created.id, { title: '仅改卷名' }, ACTOR, null);
    expect(rows.get(created.id).designerLayout).toEqual(changed);
  });

  it('deep-copies the persisted designer layout when copying a training paper', async () => {
    const { service, rows } = fixture();
    const created = await service.createTraining(await validateCreate(LAYOUT), ACTOR, null);

    const copied = await service.copyTraining(created.id, ACTOR, null) as any;

    expect(copied.designer_layout).toEqual(LAYOUT);
    expect(rows.get(copied.id).designerLayout).toEqual(LAYOUT);
    copied.designer_layout.settings.pageSizeReduce.top = 88;
    expect(rows.get(copied.id).designerLayout.settings.pageSizeReduce.top).toBe(0);
  });

  it('derives old null layout from the current title without backfilling or sharing mutable defaults', async () => {
    const { service, rows } = fixture();
    const created = await service.createTraining(CREATE as CreateTrainingPaperDto, ACTOR, null);
    expect(rows.get(created.id).designerLayout).toBeNull();
    const expected = {
      schema_version: 1,
      settings: { templateName: '设计器试卷', pageSize: 'A4', pageOrientation: 1, pageSizeReduce: { top: 15, bottom: 15, left: 15, right: 15 } },
    };
    const detail = await service.trainingDetail(created.id) as any;
    expect(detail.designer_layout).toEqual(expected);
    detail.designer_layout.settings.pageSizeReduce.top = 99;
    expect((await service.trainingDetail(created.id)) as any).toMatchObject({ designer_layout: expected });
    expect(rows.get(created.id).designerLayout).toBeNull();
  });

  it('rejects invalid direct service writes before changing persisted papers', async () => {
    const { service, rows } = fixture();
    const bad = { ...LAYOUT, settings: { ...LAYOUT.settings, unknown: true } };
    await expect(service.createTraining({ ...CREATE, designer_layout: bad } as any, ACTOR, null)).rejects.toMatchObject({ code: 40001 });
    expect(rows.size).toBe(0);
    const created = await service.createTraining(CREATE as CreateTrainingPaperDto, ACTOR, null);
    const before = structuredClone(rows.get(created.id));
    await expect(service.updateTraining(created.id, { designer_layout: bad } as any, ACTOR, null)).rejects.toMatchObject({ code: 40001 });
    expect(rows.get(created.id)).toEqual(before);
  });

  it('keeps random paper rules intact when no layout is supplied', async () => {
    const { service, rows } = fixture();
    const created = await service.createTraining({
      ...CREATE, mode: 'random', rules: [{ type: 'single', count: 10, score_cents: 1000 }],
    } as CreateTrainingPaperDto, ACTOR, null);
    expect(created).toMatchObject({ mode: 'random', rules: [{ type: 'single', count: 10, score_cents: 1000 }] });
    expect(rows.get(created.id).designerLayout).toBeNull();
    expect(rows.get(created.id).ruleConfig.rules).toEqual([{ type: 'single', count: 10, scoreCents: 1000 }]);
  });

  it('rejects explicit null service writes without clearing an existing layout', async () => {
    const { service, rows } = fixture();
    await expect(service.createTraining({ ...CREATE, designer_layout: null } as any, ACTOR, null)).rejects.toMatchObject({ code: 40001 });
    expect(rows.size).toBe(0);
    const created = await service.createTraining(await validateCreate(LAYOUT), ACTOR, null);
    await expect(service.updateTraining(created.id, { designer_layout: null } as any, ACTOR, null)).rejects.toMatchObject({ code: 40001 });
    expect(rows.get(created.id).designerLayout).toEqual(LAYOUT);
  });
});
