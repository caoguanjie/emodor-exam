import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';
import { Errors } from '../src/common/errors';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { SysDictionary } from '../src/entities/sys-dictionary.entity';
import { DictionaryTypeDto, SystemController } from '../src/modules/system/system.controller';
import { SystemService } from '../src/modules/system/system.service';

function typeRow(type: string, label: string, isSystem = 0, sort = 1000, description: string | null = null) {
  return { type, label, description, sort, isSystem, createdAt: new Date('2026-10-27T00:00:00Z'), updatedAt: new Date('2026-10-27T00:00:00Z') };
}

async function dictionaryFixture(rows: { type: string; count: string | number }[] = [], types: ReturnType<typeof typeRow>[] = []) {
  const source = new DataSource({ type: 'mysql', database: 'dictionary_types_unit', entities: [SysDictionary] });
  await (source as any).buildMetadatas();
  const queries: string[] = [];
  source.createQueryRunner = () => ({
    isReleased: false,
    isTransactionActive: false,
    query: async (sql: string) => {
      queries.push(sql.replace(/\s+/g, ' ').replace(/`/g, ''));
      return { records: rows };
    },
    release: async () => undefined,
  }) as any;
  const dictionaryRepo = source.getRepository(SysDictionary);
  const originalRepository = source.getRepository.bind(source);
  source.getRepository = ((entity: any) => entity.name === 'SysDictionaryType'
    ? { find: async () => types }
    : originalRepository(entity)) as any;
  const service = new SystemService(
    {} as any, dictionaryRepo, {} as any, {} as any, {} as any,
    source, { registerOwnerPolicy: () => undefined } as any, {} as any, {} as any,
  );
  return { service, queries };
}

function permissionContext(handler: Function, permissions: string[], authenticated = true) {
  const guard = new PermissionsGuard(new Reflector(), {
    assertAllowed: async (_userId: string, code: string) => {
      if (!permissions.includes(code)) throw Errors.forbidden();
    },
  } as any);
  return guard.canActivate({
    getHandler: () => handler,
    getClass: () => SystemController,
    switchToHttp: () => ({ getRequest: () => ({
      user: authenticated ? { id: 9 } : undefined,
      method: 'GET', originalUrl: '/api/v1/admin/dictionaries/types',
    }) }),
  } as any);
}

describe('dictionary type summary', () => {
  it('returns persisted names, descriptions and empty categories with numeric counts', async () => {
    const { service } = await dictionaryFixture([
      { type: 'question_type', count: '3' },
      { type: 'difficulty', count: '2' },
      { type: 'custom_alpha', count: '2' },
    ], [
      typeRow('question_type', '可编辑的题型名称', 1, 0, '新的显示说明'),
      typeRow('difficulty', '题目难度', 1, 1),
      typeRow('custom_alpha', '自定义分类'),
      typeRow('custom_empty', '空分类'),
    ]);
    await expect(service.dictionaryTypes()).resolves.toEqual({
      items: [
        { type: 'question_type', label: '可编辑的题型名称', description: '新的显示说明', sort: 0, count: 3, is_system: true },
        { type: 'difficulty', label: '题目难度', description: null, sort: 1, count: 2, is_system: true },
        { type: 'custom_alpha', label: '自定义分类', description: null, sort: 1000, count: 2, is_system: false },
        { type: 'custom_empty', label: '空分类', description: null, sort: 1000, count: 0, is_system: false },
      ],
      total: 4,
    });
  });

  it('counts all item statuses without filtering or pagination', async () => {
    const { service, queries } = await dictionaryFixture();
    await service.dictionaryTypes();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/^SELECT dictionary\.type AS type, COUNT\(\*\) AS count FROM sys_dictionary dictionary GROUP BY dictionary\.type(?: ORDER BY .*)?$/);
    expect(queries[0]).not.toMatch(/\b(?:WHERE|LIMIT|OFFSET)\b/);
  });

  it('returns no fabricated categories for an empty dictionary table', async () => {
    const { service } = await dictionaryFixture();
    await expect(service.dictionaryTypes()).resolves.toEqual({ items: [], total: 0 });
  });

  it('keeps the paginated item list ordered by the same category order, then type, sort and id', async () => {
    const { service, queries } = await dictionaryFixture();
    await service.listDictionaries({ page: 2, page_size: 10, type: 'custom_alpha', status: 0 });
    expect(queries[0]).toMatch(/WHERE dictionary\.type = \? AND dictionary\.status = \?/);
    expect(queries[0]).toMatch(/ORDER BY CASE dictionary\.type WHEN 'question_type' THEN 0 WHEN 'difficulty' THEN 1 WHEN 'learner_source' THEN 2 WHEN 'paper_status' THEN 3 WHEN 'exam_status' THEN 4 WHEN 'question_status' THEN 5 WHEN 'regulation_status' THEN 6 ELSE 7 END ASC, dictionary\.type ASC, dictionary\.sort ASC, dictionary\.id ASC LIMIT 10 OFFSET 10$/);
  });
});

describe('dictionary type controller boundary', () => {
  it('serves an empty query through the service', async () => {
    const { service } = await dictionaryFixture([{ type: 'custom', count: '2' }], [typeRow('custom', '显示名称')]);
    const controller = new SystemController(service, {} as any);
    await expect(controller.dictionaryTypes({ query: {} } as any)).resolves.toEqual({
      items: [{ type: 'custom', label: '显示名称', description: null, sort: 1000, count: 2, is_system: false }], total: 1,
    });
  });

  it.each(['page', 'page_size', 'type', 'keyword', 'status', 'extra'])('rejects unsupported query field %s', (key) => {
    const controller = new SystemController({} as any, {} as any);
    expect(() => controller.dictionaryTypes({ query: { [key]: '1' } } as any)).toThrowError(expect.objectContaining({ code: 40001 }));
  });

  it('requires system settings read permission and authenticated access', async () => {
    const handler = SystemController.prototype.dictionaryTypes;
    await expect(permissionContext(handler, ['system_settings:read'])).resolves.toBe(true);
    await expect(permissionContext(handler, [])).rejects.toMatchObject({ code: 40301 });
    await expect(permissionContext(handler, ['system_settings:write'])).rejects.toMatchObject({ code: 40301 });
    await expect(permissionContext(handler, ['menus:read'])).rejects.toMatchObject({ code: 40301 });
    await expect(permissionContext(handler, ['system_settings:read'], false)).rejects.toMatchObject({ code: 40101 });
  });
});

const actor = { id: '9', name: 'operator' };
const itemInput = { type: 'custom_one', code: 'first', label: '第一项', sort: 10, status: 1 };

function managementFixture(options: { missingMutex?: boolean; databaseDuplicate?: boolean } = {}) {
  let types = new Map([
    typeRow('question_type', '试题类型', 1, 0),
    typeRow('custom_one', '自定义一'),
    typeRow('custom_two', '自定义二'),
  ].filter((row) => !options.missingMutex || row.type !== 'question_type').map((row) => [row.type, row]));
  let items = new Map<string, any>([['1', {
    id: '1', ...itemInput, isSystem: 0, remark: null,
    createdAt: new Date('2026-10-27T00:00:00Z'), updatedAt: new Date('2026-10-27T00:00:00Z'),
  }]]);
  const audits: any[] = [];
  const events: string[] = [];
  let active = false;
  let locked = false;
  const assertLocked = () => {
    if (!active || !locked) throw new Error('dictionary access before the shared transaction mutex');
  };
  const typeRepo = {
    find: async (options: any) => {
      expect(options.order).toEqual({ sort: 'ASC', type: 'ASC' });
      return [...types.values()].sort((a, b) => a.sort - b.sort || a.type.localeCompare(b.type)).map((row) => ({ ...row }));
    },
    findOne: async (options: any) => {
      if (options.where.type === 'question_type' && options.lock?.mode === 'pessimistic_write' && !locked) {
        if (!active) throw new Error('mutex must be acquired inside a transaction');
        events.push('lock:question_type');
        locked = types.has('question_type');
        return types.has('question_type') ? { ...types.get('question_type')! } : null;
      }
      assertLocked();
      events.push('type:read');
      const row = [...types.values()].find((row) => Object.entries(options.where).every(([key, value]) => row[key] === value));
      return row ? { ...row } : null;
    },
    create: (value: any) => ({ ...value }),
    insert: async (value: any) => {
      assertLocked();
      if (types.has(value.type)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      return typeRepo.save(value);
    },
    save: async (value: any) => {
      assertLocked();
      events.push('type:save');
      if (options.databaseDuplicate || [...types.values()].some((row) => row.label === value.label && row.type !== value.type)) {
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      }
      const row = { ...typeRow(value.type, value.label), ...value };
      types.set(row.type, row);
      return { ...row };
    },
    delete: async ({ type }: { type: string }) => { assertLocked(); events.push('type:delete'); types.delete(type); },
  };
  const dictionaryRepo = {
    findOne: async ({ where }: any) => { assertLocked(); events.push('item:read'); return items.has(where.id) ? { ...items.get(where.id) } : null; },
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      assertLocked();
      events.push('item:save');
      const row = { ...value, id: value.id || String(items.size + 1) };
      items.set(row.id, row);
      return { ...row };
    },
    count: async ({ where }: any) => { assertLocked(); events.push('item:count'); return [...items.values()].filter((row) => row.type === where.type).length; },
    delete: async ({ id }: any) => { assertLocked(); events.push('item:delete'); items.delete(id); },
    createQueryBuilder: () => {
      const builder: any = {
        select: () => builder, addSelect: () => builder, groupBy: () => builder,
        getRawMany: async () => {
          const counts = new Map<string, number>();
          for (const item of items.values()) counts.set(item.type, (counts.get(item.type) || 0) + 1);
          return [...counts].map(([type, count]) => ({ type, count: String(count) }));
        },
      };
      return builder;
    },
  };
  const repository = (entity: any) => entity.name === 'SysDictionaryType' ? typeRepo : entity === SysDictionary ? dictionaryRepo : null;
  const source = {
    getRepository: repository,
    transaction: async (callback: any) => {
      const previousTypes = structuredClone(types);
      const previousItems = structuredClone(items);
      events.push('transaction');
      active = true;
      locked = false;
      try { return await callback({ getRepository: repository }); }
      catch (error) { types = previousTypes; items = previousItems; throw error; }
      finally { active = false; locked = false; }
    },
  };
  const service = () => new SystemService(
    {} as any, dictionaryRepo as any, {} as any, {} as any, {} as any, source as any,
    { registerOwnerPolicy: () => undefined } as any, {} as any, { log: (value: any) => audits.push(value) } as any,
  ) as SystemService & Record<string, any>;
  return { service, types: () => types, items: () => items, audits, events };
}

describe('persistent dictionary type management', () => {
  it('creates a normalized empty category with an opaque stable type that survives a new service instance', async () => {
    const fixture = managementFixture();
    const created = await fixture.service().createDictionaryType({ label: '  新分类  ', description: '  分类说明  ' }, actor, null);
    expect(created).toEqual({ type: expect.stringMatching(/^custom_[a-f0-9]{32}$/), label: '新分类', description: '分类说明', sort: 1000, is_system: false, count: 0 });
    expect((await fixture.service().dictionaryTypes()).items).toContainEqual(created);
    expect(fixture.audits).toContainEqual(expect.objectContaining({
      actor_id: '9', actor_name: 'operator', action: 'system.dictionary_type.create', object_id: created.type,
      detail: { name: '新分类', after: { label: '新分类', description: '分类说明' } }, result: 'success',
    }));
    expect(fixture.events.slice(0, 2)).toEqual(['transaction', 'lock:question_type']);
  });

  it('edits built-in display metadata without changing its stable type or dictionary item values', async () => {
    const fixture = managementFixture();
    fixture.types().get('question_type')!.description = '旧说明';
    fixture.items().set('2', { ...fixture.items().get('1'), id: '2', type: 'question_type', code: 'single', label: '单选题', isSystem: 1 });
    const before = structuredClone([...fixture.items().values()]);
    await expect(fixture.service().updateDictionaryType('question_type', { label: '  题型显示名  ', description: '   ' }, actor, null)).resolves.toEqual({
      type: 'question_type', label: '题型显示名', description: null, sort: 0, is_system: true, count: 1,
    });
    expect([...fixture.items().values()]).toEqual(before);
    expect(fixture.audits.at(-1)).toMatchObject({ action: 'system.dictionary_type.update', detail: {
      name: '题型显示名', changes: { label: { before: '试题类型', after: '题型显示名' }, description: { before: '旧说明', after: null } },
    } });
  });

  it('rejects duplicate trimmed names and converts database uniqueness races to friendly parameter errors', async () => {
    const fixture = managementFixture();
    await expect(fixture.service().createDictionaryType({ label: ' 自定义一 ' }, actor, null)).rejects.toMatchObject({ code: 40001, message: '字典分类名称已存在' });
    await expect(fixture.service().updateDictionaryType('custom_two', { label: '自定义一' }, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(fixture.types().get('custom_two')!.label).toBe('自定义二');
    await expect(fixture.service().updateDictionaryType('custom_one', { label: ' 自定义一 ' }, actor, null)).resolves.toMatchObject({ type: 'custom_one', label: '自定义一' });
    await expect(managementFixture({ databaseDuplicate: true }).service().createDictionaryType({ label: '新名称' }, actor, null))
      .rejects.toMatchObject({ code: 40001, message: '字典分类名称已存在' });
  });

  it('protects built-in and nonempty custom categories, including disabled items, while deleting empty custom categories', async () => {
    const fixture = managementFixture();
    fixture.items().get('1').status = 0;
    await expect(fixture.service().removeDictionaryType('question_type', actor, null)).rejects.toMatchObject({ code: 40920 });
    await expect(fixture.service().removeDictionaryType('custom_one', actor, null)).rejects.toMatchObject({ code: 40920 });
    await expect(fixture.service().removeDictionaryType('custom_two', actor, null)).resolves.toBeNull();
    expect((await fixture.service().dictionaryTypes()).items.map((row) => row.type)).not.toContain('custom_two');
  });

  it('rejects item creation and moves to a missing category without modifying any existing item', async () => {
    const fixture = managementFixture();
    const before = structuredClone([...fixture.items().values()]);
    const unknown = { ...itemInput, type: 'missing_type' };
    await expect(fixture.service().createDictionary(unknown, actor, null)).rejects.toMatchObject({ code: 40001, message: '字典分类不存在，请先创建分类' });
    await expect(fixture.service().updateDictionary('1', unknown, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect([...fixture.items().values()]).toEqual(before);
  });

  it('creates, moves and deletes dictionary items inside the shared mutex transaction', async () => {
    const fixture = managementFixture();
    const service = fixture.service();
    const item = await service.createDictionary({ ...itemInput, code: 'second' }, actor, null);
    await service.updateDictionary(item.id, { ...itemInput, type: 'custom_two', code: 'second' }, actor, null);
    expect(fixture.items().get(item.id)).toMatchObject({ type: 'custom_two', code: 'second' });
    await service.removeDictionary(item.id, actor, null);
    expect(fixture.items().has(item.id)).toBe(false);
    expect(fixture.events.filter((event) => event === 'lock:question_type')).toHaveLength(3);
  });

  it('retains fixed business enum item protections after making their category names editable', async () => {
    const fixture = managementFixture();
    fixture.items().set('2', { ...fixture.items().get('1'), id: '2', type: 'question_type', isSystem: 1 });
    await expect(fixture.service().createDictionary({ ...itemInput, type: 'question_type' }, actor, null)).rejects.toMatchObject({ code: 40920 });
    await expect(fixture.service().updateDictionary('2', itemInput, actor, null)).rejects.toMatchObject({ code: 40920 });
    await expect(fixture.service().removeDictionary('2', actor, null)).rejects.toMatchObject({ code: 40920 });
  });

  it.each([
    ['createDictionaryType', [{ label: '新分类' }]],
    ['updateDictionaryType', ['custom_one', { label: '新分类' }]],
    ['removeDictionaryType', ['custom_two']],
    ['createDictionary', [itemInput]],
    ['updateDictionary', ['1', itemInput]],
    ['removeDictionary', ['1']],
  ])('%s fails closed when the persistent mutex row is missing', async (method, args) => {
    const fixture = managementFixture({ missingMutex: true });
    await expect(fixture.service()[method](...args, actor, null)).rejects.toMatchObject({ code: 50004, httpStatus: 503 });
    expect(fixture.events).toEqual(['transaction', 'lock:question_type']);
  });
});

describe('dictionary category write boundaries', () => {
  it('validates normalized names and descriptions through the strict DTO pipe', async () => {
    const pipe = new StrictDtoValidationPipe(['label', 'description']);
    const parse = (value: unknown) => pipe.transform(value, { type: 'body', metatype: DictionaryTypeDto });
    expect(await parse({ label: '  新分类  ', description: '  ' })).toMatchObject({ label: '新分类', description: null });
    expect(await parse({ label: '名'.repeat(128), description: '述'.repeat(255) })).toMatchObject({ label: '名'.repeat(128) });
    for (const body of [{}, { label: '  ' }, { label: null }, { label: 1 }, { label: '名'.repeat(129) }, { label: '分类', description: '述'.repeat(256) }, { label: '分类', description: [] }, { label: '分类', type: 'question_type' }]) {
      await expect(parse(body)).rejects.toMatchObject({ status: 400 });
    }
  });

  it.each(['createDictionaryType', 'updateDictionaryType', 'removeDictionaryType'])('%s requires a system settings write grant', async (method) => {
    const handler = (SystemController.prototype as any)[method];
    expect(handler).toBeTypeOf('function');
    await expect(permissionContext(handler, ['system_settings:write'])).resolves.toBe(true);
    await expect(permissionContext(handler, ['system_settings:read'])).rejects.toMatchObject({ code: 40301 });
    await expect(permissionContext(handler, ['menus:update'])).rejects.toMatchObject({ code: 40301 });
    await expect(permissionContext(handler, ['system_settings:write'], false)).rejects.toMatchObject({ code: 40101 });
  });

  it.each(['type', 'code', 'sort', 'is_system', 'count'])('rejects injected %s fields in category create and update requests', (key) => {
    const controller = new SystemController({} as any, {} as any);
    const body = { label: '分类', [key]: 'forbidden' };
    expect(() => controller.createDictionaryType(body, actor as any, { body } as any)).toThrowError(expect.objectContaining({ code: 40001 }));
    expect(() => controller.updateDictionaryType('custom_one', body, actor as any, { body } as any)).toThrowError(expect.objectContaining({ code: 40001 }));
  });
});
