import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { UsersService } from '../src/modules/users/users.service';
import * as UserControllers from '../src/modules/users/users.controller';
import { CategoryService } from '../src/modules/training/category.service';
import { SysUser } from '../src/entities/sys-user.entity';
import { SysUserRole } from '../src/entities/sys-user-role.entity';
import { TrainingCategory } from '../src/entities/training-category.entity';
import { RoleEnum } from '../src/common/errors';
import type { AuthUser } from '../src/common/decorators/current-user.decorator';

const learner = { id: 7, username: 'learner', role: RoleEnum.EMPLOYEE, client: 'mobile' } as AuthUser;
const admin = { id: 9, name: 'admin' };
const clone = <T>(value: T): T => structuredClone(value);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Only persistence is replaced. Row locks are acquired per entity/id rather than
// serializing whole transactions, so removing the production user lock breaks
// concurrent confirmation. Writes are staged until commit and rolled back on error.
function fixture() {
  const users = new Map<string, any>([['7', {
    id: '7', username: 'learner', passwordHash: 'irrelevant-hash', realName: '已核验姓名',
    employeeNo: 'E7', departmentId: '5', categoryId: null, source: 'external',
    role: RoleEnum.EMPLOYEE, phone: '13800000007', email: null, avatarId: null,
    occupation: '旧自由文本', gender: 'female', birthday: '2000-02-29', status: 1,
    authVersion: 3, forcePasswordChange: 0, loginCount: 0, rolesConfigured: 0,
    lastLoginAt: null, lastLoginIp: null, createdAt: new Date('2026-01-01T00:00:00Z'),
  }]]);
  const categories = new Map<string, any>([
    ['1', { id: '1', name: '电工', status: 1, description: '不对移动端开放', createdBy: '9' }],
    ['2', { id: '2', name: '焊工', status: 1, description: null, createdBy: '9' }],
    ['3', { id: '3', name: '已停用类别', status: 0, description: null, createdBy: '9' }],
    ['9007199254740993', { id: '9007199254740993', name: '大 ID 类别', status: 1, createdBy: '9' }],
  ]);
  const roleLinks = new Map<string, string[]>();
  const audits: any[] = [];
  const saves: any[] = [];
  const lockTails = new Map<string, Promise<void>>();
  const events: string[] = [];
  let failSave = false;
  let activeTransactions = 0;
  let singleConnectionPool = false;
  let beforeCategoryLock: (() => Promise<void>) | undefined;

  const categoryRepo: any = {
    findOne: async ({ where }: any) => clone(categories.get(String(where.id)) ?? null),
    createQueryBuilder: () => {
      if (singleConnectionPool && activeTransactions) throw new Error('pool exhausted by an unreleased transaction');
      let status: number | undefined; let offset = 0; let size = 20;
      const rows = () => [...categories.values()]
        .filter((row) => status === undefined || row.status === status)
        .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
      const qb: any = {
        andWhere: (_condition: string, params: any) => { status = params.status; return qb; },
        orderBy: () => qb,
        getCount: async () => rows().length,
        skip: (value: number) => { offset = value; return qb; },
        take: (value: number) => { size = value; return qb; },
        getMany: async () => clone(rows().slice(offset, offset + size)),
      };
      return qb;
    },
  };
  const userRepo: any = {
    findOne: async ({ where }: any) => clone(users.get(String(where.id)) ?? null),
  };
  const dataSource = {
    async transaction(work: (manager: any) => Promise<any>) {
      activeTransactions++;
      const locks = new Set<string>();
      const release: Array<() => void> = [];
      const pendingUsers = new Map<string, any>();
      async function lock(key: string) {
        if (locks.has(key)) return;
        const previous = lockTails.get(key) ?? Promise.resolve();
        const next = deferred();
        lockTails.set(key, previous.then(() => next.promise));
        await previous;
        locks.add(key); release.push(next.resolve); events.push(`lock:${key}`);
      }
      const txUserRepo: any = {
        async findOne({ where, lock: requestedLock }: any) {
          if (requestedLock) await lock(`user:${where.id}`);
          const row = clone(pendingUsers.get(String(where.id)) ?? users.get(String(where.id)) ?? null);
          if (where.role !== undefined && row?.role !== where.role) return null;
          return row;
        },
        async save(row: any) {
          if (!locks.has(`user:${row.id}`)) throw new Error('user writes require the shared row lock');
          if (failSave) throw new Error('simulated write failure');
          pendingUsers.set(String(row.id), clone(row));
          saves.push(clone(row));
          return clone(row);
        },
      };
      const manager: any = {
        async findOne(entity: unknown, options: any) {
          if (entity === SysUser) return txUserRepo.findOne(options);
          if (entity === TrainingCategory) {
            if (options.lock) {
              await beforeCategoryLock?.();
              await lock(`category:${options.where.id}`);
            }
            return categoryRepo.findOne(options);
          }
          throw new Error('unexpected entity read');
        },
        getRepository(entity: unknown) {
          if (entity === SysUser) return txUserRepo;
          if (entity === TrainingCategory) return categoryRepo;
          if (entity === SysUserRole) return { findOne: async ({ where }: any) => {
            events.push(`role-links:${where.userId}`);
            const links = roleLinks.get(String(where.userId));
            return links?.length ? { userId: String(where.userId), roleId: links[0] } : null;
          } };
          // No repositories for identity, assignments, answers or scores: a new
          // dependency on any historical/business table fails this fixture.
          throw new Error('unexpected repository write/read');
        },
      };
      try {
        const result = await work(manager);
        for (const [id, row] of pendingUsers) users.set(id, clone(row));
        return result;
      } finally {
        activeTransactions--;
        for (const unlock of release.reverse()) unlock();
      }
    },
  };
  const categoryService = new CategoryService(categoryRepo, userRepo, { log: (entry: any) => audits.push(entry) } as any);
  const service: any = new UsersService(userRepo, dataSource as any, {} as any,
    { log: (entry: any) => audits.push(entry) } as any, {} as any, categoryService,
    { markRevoked: async () => undefined } as any, {} as any,
    { registerOwnerPolicy: () => undefined } as any,
    { assertNameEditable: async () => { throw new Error('category confirmation must not change identity'); } } as any);
  return {
    service, users, categories, roleLinks, audits, saves, events, dataSource,
    setFailSave(value: boolean) { failSave = value; },
    useSingleConnectionPool() { singleConnectionPool = true; },
    onCategoryLock(callback: () => Promise<void>) { beforeCategoryLock = callback; },
  };
}

function routePipe(method: string, index = 0) {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, UserControllers.MeProfileController, method);
  const param = Object.values(args ?? {}).find((value: any) => value.index === index) as any;
  expect(param?.pipes[0], `registered validation pipe for ${method}`).toBeDefined();
  return param.pipes[0];
}

describe('learner training category request contract', () => {
  it('registers dedicated GET and PUT routes', () => {
    for (const [method, path, verb] of [
      ['trainingCategories', 'training-categories', RequestMethod.GET],
      ['confirmTrainingCategory', 'training-category', RequestMethod.PUT],
    ] as const) {
      const handler = (UserControllers.MeProfileController.prototype as any)[method];
      expect(handler).toBeTypeOf('function');
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
    }
  });

  it.each([
    {}, { category_id: null }, { category_id: 1 }, { category_id: '' }, { category_id: '0' },
    { category_id: '01' }, { category_id: '-1' }, { category_id: '1.5' }, { category_id: '1e2' },
    { category_id: ' 1' }, { category_id: ['1'] },
    { category_id: '1', source: 'institution' }, { category_id: '1', user_id: '8' },
    { category_id: '1', role: 'super_admin' }, { category_id: '1', real_name: '篡改姓名' },
  ])('rejects malformed or injected PUT body %j', async (body) => {
    await expect(routePipe('confirmTrainingCategory').transform(body, {
      type: 'body', metatype: (UserControllers as any).ConfirmTrainingCategoryDto,
    })).rejects.toBeDefined();
  });

  it('keeps BIGINT category IDs as strings through the PUT DTO', async () => {
    await expect(routePipe('confirmTrainingCategory').transform({ category_id: '9007199254740993' }, {
      type: 'body', metatype: (UserControllers as any).ConfirmTrainingCategoryDto,
    })).resolves.toMatchObject({ category_id: '9007199254740993' });
  });

  it.each([
    { page: '0' }, { page: '-1' }, { page: '1.2' }, { page: '' },
    { page: ['1', '2'] }, { page_size: '101' }, { page_size: '0' },
    { page_size: '-1' }, { page_size: '1.5' }, { status: '0' }, { keyword: 'secret' },
  ])('rejects invalid or expanded GET query %j', async (query) => {
    await expect(routePipe('trainingCategories').transform(query, {
      type: 'query', metatype: (UserControllers as any).TrainingCategoryQueryDto,
    })).rejects.toBeDefined();
  });

  it('passes only the authenticated owner and canonical query to the service', async () => {
    const { service } = fixture();
    const controller: any = new UserControllers.MeProfileController(service);
    const query = await routePipe('trainingCategories').transform({ page: '1', page_size: '100' }, {
      type: 'query', metatype: (UserControllers as any).TrainingCategoryQueryDto,
    });
    expect(await controller.trainingCategories(query, learner, { query: { page: '1', page_size: '100' } }))
      .toMatchObject({ total: 3, page: 1, page_size: 100 });
    expect(await controller.confirmTrainingCategory({ category_id: '1' }, learner, { body: { category_id: '1' }, ip: '127.0.0.1' }))
      .toMatchObject({ id: '7', category_id: '1', category_name: '电工' });
  });
});

describe('learner training category authoritative service', () => {
  it('releases the identity transaction before using the category repository connection', async () => {
    const { service, useSingleConnectionPool } = fixture();
    useSingleConnectionPool();
    await expect(service.listSelfTrainingCategories(learner, {}))
      .resolves.toMatchObject({ total: 3, page: 1, page_size: 20 });
  });

  it('returns enabled paged options with only lossless id/name fields', async () => {
    const { service } = fixture();
    expect(await service.listSelfTrainingCategories(learner, {})).toEqual({
      items: [{ id: '9007199254740993', name: '大 ID 类别' }, { id: '2', name: '焊工' }, { id: '1', name: '电工' }],
      total: 3, page: 1, page_size: 20,
    });
    expect(await service.listSelfTrainingCategories(learner, { page: 2, page_size: 2 })).toEqual({
      items: [{ id: '1', name: '电工' }], total: 3, page: 2, page_size: 2,
    });
  });

  it('returns an empty option page when all categories are disabled', async () => {
    const { service, categories } = fixture();
    for (const category of categories.values()) category.status = 0;
    expect(await service.listSelfTrainingCategories(learner, {})).toEqual({ items: [], total: 0, page: 1, page_size: 20 });
  });

  it('confirms once, returns the full profile, and preserves all unrelated user facts', async () => {
    const { service, users, audits, saves } = fixture();
    const before = clone(users.get('7'));
    expect(await service.confirmTrainingCategory(learner, { category_id: '1' }, '127.0.0.1')).toMatchObject({
      id: '7', username: 'learner', real_name: '已核验姓名', category_id: '1', category_name: '电工',
      source: 'external', role: 'employee', occupation: '旧自由文本', gender: 'female', birthday: '2000-02-29',
    });
    expect(users.get('7')).toEqual({ ...before, categoryId: '1' });
    expect(saves).toHaveLength(1);
    expect(audits).toEqual([expect.objectContaining({
      actor_id: learner.id, actor_name: learner.username, action: 'student.training_category.confirm',
      object_type: 'sys_user', object_id: '7', detail: { before_category_id: null, after_category_id: '1' },
      result: 'success', source_ip: '127.0.0.1',
    })]);
    expect(JSON.stringify(audits)).not.toContain('已核验姓名');
  });

  it('replays the same category after it is disabled without another write or audit', async () => {
    const { service, categories, audits, saves } = fixture();
    await service.confirmTrainingCategory(learner, { category_id: '1' }, null);
    categories.get('1').status = 0;
    categories.get('1').name = '电工（新名称）';
    expect(await service.confirmTrainingCategory(learner, { category_id: '1' }, null))
      .toMatchObject({ category_id: '1', category_name: '电工（新名称）' });
    expect(audits).toHaveLength(1); expect(saves).toHaveLength(1);
  });

  it('rejects changing a nonempty category with the stable locked reason', async () => {
    const { service, users, audits } = fixture();
    users.get('7').categoryId = '1';
    await expect(service.confirmTrainingCategory(learner, { category_id: '2' }, null)).rejects.toMatchObject({
      code: 40001, data: { reason_code: 'TRAINING_CATEGORY_LOCKED' },
    });
    expect(users.get('7').categoryId).toBe('1'); expect(audits).toHaveLength(0);
  });

  it.each(['3', '404'])('rejects inactive/missing category %s without binding', async (categoryId) => {
    const { service, users, audits, saves } = fixture();
    await expect(service.confirmTrainingCategory(learner, { category_id: categoryId }, null))
      .rejects.toMatchObject({ code: 40910 });
    expect(users.get('7').categoryId).toBeNull(); expect(audits).toHaveLength(0); expect(saves).toHaveLength(0);
  });

  it('rechecks the category after obtaining its lock rather than trusting a prior option list', async () => {
    const { service, categories, users, onCategoryLock } = fixture();
    await service.listSelfTrainingCategories(learner, {});
    onCategoryLock(async () => { categories.delete('1'); });
    await expect(service.confirmTrainingCategory(learner, { category_id: '1' }, null)).rejects.toMatchObject({ code: 40910 });
    expect(users.get('7').categoryId).toBeNull();
  });

  it('allows exactly one concurrent different first selection', async () => {
    const { service, users, audits, saves } = fixture();
    const results = await Promise.allSettled([
      service.confirmTrainingCategory(learner, { category_id: '1' }, null),
      service.confirmTrainingCategory(learner, { category_id: '2' }, null),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 40001, data: { reason_code: 'TRAINING_CATEGORY_LOCKED' } },
    });
    expect(['1', '2']).toContain(users.get('7').categoryId);
    expect(audits).toHaveLength(1); expect(saves).toHaveLength(1);
  });

  it('collapses concurrent same-value confirmations into one write/audit', async () => {
    const { service, audits, saves } = fixture();
    const responses = await Promise.all([
      service.confirmTrainingCategory(learner, { category_id: '1' }, null),
      service.confirmTrainingCategory(learner, { category_id: '1' }, null),
    ]);
    expect(responses).toEqual([expect.objectContaining({ category_id: '1' }), expect.objectContaining({ category_id: '1' })]);
    expect(audits).toHaveLength(1); expect(saves).toHaveLength(1);
  });

  it.each([
    ['pc', { ...learner, client: 'pc' }, {}, []],
    ['missing client', { ...learner, client: undefined }, {}, []],
    ['token admin', { ...learner, role: RoleEnum.SUPER_ADMIN }, {}, []],
    ['current admin', learner, { role: RoleEnum.SUPER_ADMIN }, []],
    ['disabled', learner, { status: 0 }, []],
    ['empty-permission role', learner, {}, ['empty-permission-role']],
    ['inactive role', learner, {}, ['inactive-role']],
  ] as const)('rejects %s for both dedicated endpoints', async (_label, actor, changes, links) => {
    const { service, users, roleLinks, audits, saves } = fixture();
    Object.assign(users.get('7'), changes); roleLinks.set('7', [...links]);
    await expect(service.listSelfTrainingCategories(actor, {})).rejects.toMatchObject({ httpStatus: 403 });
    await expect(service.confirmTrainingCategory(actor, { category_id: '1' }, null)).rejects.toMatchObject({ httpStatus: 403 });
    expect(users.get('7').categoryId).toBeNull(); expect(audits).toHaveLength(0); expect(saves).toHaveLength(0);
  });

  it('rechecks authority after waiting for a PC user lock', async () => {
    const { service, dataSource, roleLinks, users, audits } = fixture();
    const ready = deferred(); const release = deferred();
    const assignment = dataSource.transaction(async (manager) => {
      await manager.findOne(SysUser, { where: { id: '7' }, lock: { mode: 'pessimistic_write' } });
      ready.resolve(); await release.promise; roleLinks.set('7', ['new-business-role']);
    });
    await ready.promise;
    const confirmation = service.confirmTrainingCategory(learner, { category_id: '1' }, null);
    release.resolve(); await assignment;
    await expect(confirmation).rejects.toMatchObject({ httpStatus: 403 });
    expect(users.get('7').categoryId).toBeNull(); expect(audits).toHaveLength(0);
  });

  it('serializes a waiting learner confirmation after a PC category adjustment', async () => {
    const { service, onCategoryLock, audits, users } = fixture();
    const ready = deferred(); const release = deferred();
    onCategoryLock(async () => { ready.resolve(); await release.promise; });
    const pc = service.updateStudent('7', { category_id: '2' }, admin, null);
    await ready.promise;
    const confirmation = service.confirmTrainingCategory(learner, { category_id: '1' }, null);
    release.resolve(); await pc;
    await expect(confirmation).rejects.toMatchObject({ code: 40001, data: { reason_code: 'TRAINING_CATEGORY_LOCKED' } });
    expect(users.get('7').categoryId).toBe('2'); expect(audits).toHaveLength(1);
  });

  it('allows PC adjustment after first selection and records actual before/after values', async () => {
    const { service, users, categories, audits } = fixture();
    await service.confirmTrainingCategory(learner, { category_id: '1' }, null);
    const before = clone(users.get('7'));
    await service.updateStudent('7', { category_id: '2' }, admin, '127.0.0.1');
    expect(users.get('7')).toEqual({ ...before, categoryId: '2' });
    expect(audits[1]).toMatchObject({ actor_id: admin.id, object_id: '7', action: 'student.update',
      detail: { before_category_id: '1', after_category_id: '2' } });
    categories.get('2').name = '焊工新名称'; categories.get('2').status = 0;
    expect(await service.selfProfile('7')).toMatchObject({ category_id: '2', category_name: '焊工新名称' });
    expect(await service.updateSelfProfile('7', { email: 'updated@example.test' }))
      .toMatchObject({ category_id: '2', category_name: '焊工新名称' });
    expect(await service.confirmTrainingCategory(learner, { category_id: '2' }, null))
      .toMatchObject({ category_id: '2', category_name: '焊工新名称' });
    expect(audits).toHaveLength(2);
  });

  it('keeps shared PC/admin self-profile access and represents null/missing category names honestly', async () => {
    const { service, users } = fixture();
    users.get('7').role = RoleEnum.SUPER_ADMIN;
    expect(await service.selfProfile('7')).toMatchObject({ category_id: null, category_name: null });
    users.get('7').categoryId = '404';
    expect(await service.selfProfile('7')).toMatchObject({ category_id: '404', category_name: null });
    expect(await service.updateSelfProfile('7', { occupation: '兼容职业' }))
      .toMatchObject({ category_id: '404', category_name: null, occupation: '兼容职业' });
  });

  it.each([
    { category_id: '1' }, { source: 'institution' }, { role: 'super_admin' }, { status: 0 },
  ])('keeps ordinary profile authority fields forbidden: %j', async (patch) => {
    const { service, saves } = fixture();
    await expect(service.updateSelfProfile('7', patch)).rejects.toMatchObject({ code: 40001 });
    expect(saves).toHaveLength(0);
  });

  it.each([{ category_id: '1', source: 'institution' }, { category_id: '1', user_id: '8' }, { category_id: 1 }])
  ('rejects direct service injection as well as DTO injection: %j', async (body) => {
    const { service, users, audits } = fixture();
    await expect(service.confirmTrainingCategory(learner, body, null)).rejects.toMatchObject({ code: 40001 });
    expect(users.get('7').categoryId).toBeNull(); expect(audits).toHaveLength(0);
  });

  it('rolls back a failed first selection without a success audit and permits an explicit later attempt', async () => {
    const { service, users, audits, setFailSave } = fixture();
    setFailSave(true);
    await expect(service.confirmTrainingCategory(learner, { category_id: '1' }, null)).rejects.toThrow('simulated write failure');
    expect(users.get('7').categoryId).toBeNull(); expect(audits).toHaveLength(0);
    setFailSave(false);
    expect(await service.confirmTrainingCategory(learner, { category_id: '2' }, null)).toMatchObject({ category_id: '2' });
    expect(audits).toHaveLength(1);
  });
});
