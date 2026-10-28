import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from '../src/modules/users/users.service';
import { CreateStudentDto, UpdateStudentDto, MeProfileController, StudentsController } from '../src/modules/users/users.controller';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';
import { SysUser } from '../src/entities/sys-user.entity';
import { SysUserRole } from '../src/entities/sys-user-role.entity';
import { RoleEnum } from '../src/common/errors';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

type UserFixture = SysUser & { id: string };

function makeUser(id: string, username: string): UserFixture {
  return {
    id,
    username,
    passwordHash: 'old-hash',
    realName: username,
    employeeNo: `${id}01`,
    departmentId: null,
    categoryId: '7',
    source: 'institution',
    role: RoleEnum.EMPLOYEE,
    phone: null,
    email: null,
    avatarId: null,
    occupation: null,
    gender: null,
    birthday: null,
    age: null,
    status: 1,
    authVersion: 3,
    forcePasswordChange: 0,
    loginCount: 1,
    lastLoginAt: null,
    lastLoginIp: null,
    rolesConfigured: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeService(roleIdsByUser: Record<string, string[]> = {}) {
  const users = new Map<string, UserFixture>([
    ['1', makeUser('1', 'ordinary-student')],
    ['2', makeUser('2', 'business-admin')],
    ['3', makeUser('3', 'inactive-business-admin')],
  ]);
  const roleLinks = new Map<string, string[]>(Object.entries(roleIdsByUser));
  const saves: UserFixture[] = [];
  const events: string[] = [];

  const findByWhere = (where: Record<string, unknown> = {}) => {
    const user = users.get(String(where.id));
    if (!user) return null;
    if (where.role !== undefined && user.role !== where.role) return null;
    return user;
  };

  const queryBuilder = () => {
    const state: { id?: string; role?: string; excludeLinked?: boolean } = {};
    const builder: any = {
      where(condition: string, params?: Record<string, unknown>) {
        if (params?.id !== undefined) state.id = String(params.id);
        if (params?.role !== undefined) state.role = String(params.role);
        if (condition.includes('sys_user_role')) state.excludeLinked = true;
        return builder;
      },
      andWhere(condition: string, params?: Record<string, unknown>) {
        if (params?.id !== undefined) state.id = String(params.id);
        if (params?.role !== undefined) state.role = String(params.role);
        if (condition.includes('sys_user_role')) state.excludeLinked = true;
        return builder;
      },
      setLock(mode: string) {
        events.push(`user-lock:${mode}`);
        return builder;
      },
      orderBy() { return builder; },
      skip() { return builder; },
      take() { return builder; },
      async getCount() { return filter().length; },
      async getMany() { return filter(); },
      async getOne() { return filter()[0] ?? null; },
    };
    function filter() {
      return [...users.values()].filter((user) => {
        if (state.id !== undefined && user.id !== state.id) return false;
        if (state.role !== undefined && user.role !== state.role) return false;
        if (state.excludeLinked && (roleLinks.get(user.id)?.length || 0) > 0) return false;
        return true;
      });
    }
    return builder;
  };

  const userRepo: any = {
    createQueryBuilder: queryBuilder,
    findOne: async ({ where }: { where: Record<string, unknown> }) => findByWhere(where),
  };
  const txUserRepo: any = {
    create: (input: Partial<SysUser>) => ({ ...makeUser('4', input.username!), ...input }),
    createQueryBuilder: queryBuilder,
    findOne: async ({ where, lock }: { where: Record<string, unknown>; lock?: unknown }) => {
      if (lock) events.push('user-lock:findOne');
      return findByWhere(where);
    },
    save: async (user: UserFixture) => {
      users.set(user.id, user);
      saves.push({ ...user });
      return user;
    },
  };
  const txRoleRepo: any = {
    findOne: async ({ where }: { where: Record<string, unknown> }) => {
      events.push('role-link-check');
      const roleIds = roleLinks.get(String(where.userId)) || [];
      return roleIds.length ? { userId: String(where.userId), roleId: roleIds[0] } as SysUserRole : null;
    },
  };
  const manager: any = {
    findOne: async (entity: typeof SysUser, options: { where: Record<string, unknown>; lock?: unknown }) => {
      if (entity !== SysUser) throw new Error('unexpected entity');
      if (options.lock) events.push('user-lock:manager.findOne');
      return findByWhere(options.where);
    },
    getRepository(entity: typeof SysUser | typeof SysUserRole) {
      if (entity === SysUser) return txUserRepo;
      if (entity === SysUserRole) return txRoleRepo;
      throw new Error('unexpected repository');
    },
  };
  const service = Object.create(UsersService.prototype) as UsersService & Record<string, any>;
  service.userRepo = userRepo;
  service.dataSource = { transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) };
  service.categories = {
    lockActive: vi.fn(async () => undefined),
    findById: vi.fn(async (id: string) => ({ id, name: '测试培训类别', status: 1 })),
  };
  service.sessions = {
    invalidateUser: vi.fn(async () => []),
    markRevoked: vi.fn(async () => undefined),
  };
  service.redis = { setUserBlock: vi.fn(async () => undefined) };
  service.config = { jwt: { refreshExpiresDays: 7 } };
  service.audit = { log: vi.fn() };
  service.access = { invalidate: vi.fn(async () => undefined) };

  return { service, users, roleLinks, saves, events };
}

const actor = { id: 1, name: 'admin' };

afterEach(() => vi.useRealTimers());

describe('training student/admin boundary', () => {
  it.each([undefined, null, '', ' '])('accepts an optional category %j at the managed HTTP DTO boundary', async (category_id) => {
    const input = { real_name: '学员', phone: '13800138000', source: 'external', ...(category_id === undefined ? {} : { category_id }) };
    const created = await new StrictDtoValidationPipe(['real_name', 'phone', 'source', 'category_id']).transform(input, { type: 'body', metatype: CreateStudentDto });
    expect(created.category_id ?? null).toBeNull();
    const updated = await new StrictDtoValidationPipe(['category_id']).transform({ category_id }, { type: 'body', metatype: UpdateStudentDto });
    expect(updated.category_id ?? null).toBeNull();
  });

  it.each(['0', '01', 'not-an-id', 7, [], 'null'])('rejects a malformed nonempty category %j before saving', async (category_id) => {
    const { service, saves } = makeService();
    await expect(service.createStudent({ real_name: '学员', phone: '13800138000', source: 'external', category_id } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    await expect(service.updateStudent('1', { category_id } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    await expect(new StrictDtoValidationPipe(['category_id']).transform({ category_id }, { type: 'body', metatype: UpdateStudentDto })).rejects.toThrow();
    expect(saves).toHaveLength(0);
  });
  it.each([undefined, null, '', '   '])('creates an ordinary learner with no optional category %j', async (category_id) => {
    const { service, users } = makeService();
    const created = await service.createStudent({ real_name: '学员', phone: '13800138000', source: 'external', category_id } as any, actor, null);
    expect(created).toMatchObject({ category_id: null, source: 'external', role: 'employee' });
    expect(users.get(created.id)).toMatchObject({ categoryId: null, rolesConfigured: 0 });
    expect(service.categories.lockActive).not.toHaveBeenCalled();
  });

  it('retains an omitted category on edit and lets an administrator explicitly clear it', async () => {
    const { service, users } = makeService();
    await expect(service.updateStudent('1', { age: 18 }, actor, null)).resolves.toMatchObject({ category_id: '7' });
    await expect(service.updateStudent('1', { category_id: null } as any, actor, null)).resolves.toMatchObject({ category_id: null });
    expect(users.get('1')?.categoryId).toBeNull();
    expect(service.categories.lockActive).not.toHaveBeenCalled();
  });

  it.each(['', '  ', null])('rejects missing managed name %j without creating or saving a learner', async (real_name) => {
    const { service, saves } = makeService();
    await expect(service.createStudent({ real_name, phone: '13800138000', source: 'external' } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    await expect(service.updateStudent('1', { real_name } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(saves).toHaveLength(0);
  });

  it('creates SMS-only learners without a chosen password or pending password change', async () => {
    const { service, users } = makeService();
    const input = { real_name: '学员', category_id: '7', source: 'institution' as const, phone: '138 0013-8000' };
    const created = await service.createStudent(input, actor, null);
    expect(created).toMatchObject({ phone: '13800138000', username: expect.stringMatching(/^m_/u) });
    expect(created).not.toHaveProperty('password_hash');
    expect(users.get(created.id)).toMatchObject({ forcePasswordChange: 0, passwordHash: expect.stringMatching(/^\$2[aby]\$/u) });
    for (const field of ['password', 'initial_password', 'password_hash']) {
      await expect(service.createStudent({ ...input, [field]: 'supplied' } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    }
    for (const phone of ['', null, undefined, 'bad']) {
      await expect(service.createStudent({ ...input, phone } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    }
    await expect(service.updateStudent(created.id, { phone: null }, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(users.get(created.id)?.phone).toBe('13800138000');
  });

  it('stores explicit age without deriving or overwriting birthday', async () => {
    const { service } = makeService();
    const controller = new StudentsController(service, {} as any);
    const input = { username: 'age-student', phone: '13800138000', real_name: '学员', category_id: '7', source: 'institution', age: 0 };
    await expect(controller.create(input as any, { id: 1 } as any, { body: input } as any))
      .resolves.toMatchObject({ age: 0, birthday: null });
    await service.updateStudent('4', { birthday: '2000-02-29' }, actor, null);
    await expect(controller.update('4', { age: 150 } as any, { id: 1 } as any, { body: { age: 150 } } as any))
      .resolves.toMatchObject({ age: 150, birthday: '2000-02-29' });
    await expect(service.studentDetail('4')).resolves.toMatchObject({ age: 150 });
    await expect(service.updateStudent('4', { age: null } as any, actor, null))
      .resolves.toMatchObject({ age: null, birthday: '2000-02-29' });
  });

  it.each([-1, 151, 1.5, '18', NaN])('rejects invalid managed age %j before writing', async (age) => {
    const { service, saves } = makeService();
    await expect(service.updateStudent('1', { age } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    await expect(service.createStudent({ username: 'age-student', phone: '13800138000', real_name: '学员', category_id: '7', source: 'institution', age } as any, actor, null))
      .rejects.toMatchObject({ code: 40001 });
    expect(saves).toHaveLength(0);
  });

  it('creates and updates optional learner demographics through the managed student API', async () => {
    const { service } = makeService();
    const controller = new StudentsController(service, {} as any);
    const input = {
      username: 'new-student', phone: '13800138000', real_name: '学员',
      category_id: '7', source: 'institution', gender: 'female', birthday: '2000-02-29',
    };
    await expect(controller.create(input as any, { id: 1, username: 'admin' } as any, { body: input } as any))
      .resolves.toMatchObject({ id: '4', gender: 'female', birthday: '2000-02-29' });
    const patch = { gender: 'male', birthday: '2001-01-01' };
    await expect(controller.update('4', patch as any, { id: 1, username: 'admin' } as any, { body: patch } as any))
      .resolves.toMatchObject(patch);
    await expect(service.studentDetail('4')).resolves.toMatchObject(patch);
    await expect(service.updateStudent('4', { gender: null, birthday: null } as any, actor, null))
      .resolves.toMatchObject({ gender: null, birthday: null });
  });

  it.each([{ gender: 'other' }, { birthday: '2023-02-29' }, { birthday: '9999-01-01' }])
  ('rejects invalid managed demographics before saving: %j', async (patch) => {
    const { service, saves } = makeService();
    await expect(service.updateStudent('1', patch as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    await expect(service.createStudent({
      username: 'new-student', phone: '13800138000', real_name: '学员',
      category_id: '7', source: 'institution', ...patch,
    } as any, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(saves).toHaveLength(0);
  });

  it('persists optional self-profile fields while retaining authoritative account fields', async () => {
    const { service, users } = makeService();
    await expect(service.selfProfile('1')).resolves.toMatchObject({ occupation: null, gender: null, birthday: null });
    const saved = await service.updateSelfProfile('1', {
      occupation: '  架子工  ', gender: 'male', birthday: '2000-02-29',
      real_name: 'PC兼容姓名', email: 'learner@example.test',
    } as any);
    expect(saved).toMatchObject({
      id: '1', occupation: '架子工', gender: 'male', birthday: '2000-02-29',
      real_name: 'PC兼容姓名', email: 'learner@example.test',
      source: 'institution', category_id: '7', role: 'employee', status: 1, phone: null,
    });
    expect(users.get('1')).toMatchObject({ occupation: '架子工', gender: 'male', birthday: '2000-02-29' });
    await expect(service.selfProfile('1')).resolves.toMatchObject({ occupation: '架子工', gender: 'male', birthday: '2000-02-29' });
    await expect(service.updateSelfProfile('1', { occupation: null, gender: null, birthday: null } as any))
      .resolves.toMatchObject({ occupation: null, gender: null, birthday: null });
  });

  it.each([
    { occupation: '' }, { occupation: '  ' }, { occupation: 'a'.repeat(65) }, { occupation: 123 },
    { gender: 'other' }, { gender: '' }, { gender: 1 },
    { birthday: '2023-02-29' }, { birthday: '2026-02-30' }, { birthday: '2026-13-01' },
    { birthday: '2026-1-01' }, { birthday: '2026-01-01T00:00:00Z' }, { birthday: 20260101 },
    { birthday: '0000-01-01' },
  ])('rejects invalid self-profile value without writes: %j', async (patch) => {
    const { service, saves } = makeService();
    await expect(service.updateSelfProfile('1', patch as any)).rejects.toMatchObject({ code: 40001 });
    expect(saves).toHaveLength(0);
  });

  it('uses the server Asia/Shanghai business date for the birthday upper boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T16:30:00.000Z'));
    const { service, saves } = makeService();
    await expect(service.updateSelfProfile('1', { birthday: '2026-10-22' } as any))
      .resolves.toMatchObject({ birthday: '2026-10-22' });
    await expect(service.updateSelfProfile('1', { birthday: '2026-10-23' } as any)).rejects.toMatchObject({ code: 40001 });
    expect(saves).toHaveLength(1);
  });

  it.each(['phone', 'source', 'category_id', 'role', 'status', 'identity_status', 'username'])
  ('rejects controlled self-profile field %s at both controller and service boundaries', async (field) => {
    const { service, saves } = makeService();
    const controller = new MeProfileController(service);
    const patch = { [field]: field === 'status' ? 0 : 'forged' };
    expect(() => controller.update(patch, { id: 1 } as any, { body: patch } as any))
      .toThrow('包含不支持的字段');
    await expect(service.updateSelfProfile('1', patch as any)).rejects.toMatchObject({ code: 40001 });
    expect(saves).toHaveLength(0);
  });

  it('accepts new self-profile fields through the controller whitelist', async () => {
    const { service } = makeService();
    const controller = new MeProfileController(service);
    const patch = { occupation: '电工', gender: 'female', birthday: '2001-01-01' };
    await expect(controller.update(patch as any, { id: 1 } as any, { body: patch } as any))
      .resolves.toMatchObject(patch);
  });

  it('provides POST profile compatibility with the same strict save contract', async () => {
    const { service } = makeService();
    const controller = new MeProfileController(service);
    const handler = Object.getOwnPropertyNames(MeProfileController.prototype)
      .map((key) => (controller as any)[key])
      .find((method) => Reflect.getMetadata(PATH_METADATA, method) === 'profile'
        && Reflect.getMetadata(METHOD_METADATA, method) === RequestMethod.POST);
    expect(handler).toBeTypeOf('function');
    const patch = { occupation: '油漆工', gender: 'female', birthday: '2000-02-29' };
    await expect(handler.call(controller, patch, { id: 1 }, { body: patch })).resolves.toMatchObject(patch);
    for (const field of ['phone', 'source', 'category_id', 'role', 'status', 'identity_status', 'username']) {
      const forged = { [field]: 'forged' };
      expect(() => handler.call(controller, forged, { id: 1 }, { body: forged })).toThrow('包含不支持的字段');
    }
  });

  it('excludes every employee with a sys_user_role link from list and detail', async () => {
    const { service } = makeService({ '2': ['empty-permission-role'], '3': ['inactive-role'] });

    await expect(service.listStudents({})).resolves.toMatchObject({ items: [{ id: '1' }], total: 1 });
    await expect(service.studentDetail('2')).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.studentDetail('3')).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('rejects linked employees in update and status without mutation', async () => {
    const { service, users, saves, events } = makeService({ '2': ['business-role'] });
    const before = { ...users.get('2')! };

    await expect(service.updateStudent('2', { real_name: 'must-not-change' }, actor, null))
      .rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.setStudentStatus('2', 0, actor, null)).rejects.toMatchObject({ httpStatus: 404 });

    expect(saves).toHaveLength(0);
    expect(users.get('2')).toMatchObject({
      passwordHash: before.passwordHash,
      status: before.status,
      authVersion: before.authVersion,
      realName: before.realName,
    });
    expect(events.filter((event) => event.startsWith('user-lock'))).toHaveLength(2);
    expect(events.filter((event) => event === 'role-link-check')).toHaveLength(2);
  });

  it('keeps ordinary unlinked student mutations working', async () => {
    const { service, users, saves, roleLinks } = makeService();
    roleLinks.delete('2');

    await expect(service.updateStudent('2', { real_name: 'updated-student' }, actor, null))
      .resolves.toMatchObject({ id: '2', real_name: 'updated-student' });
    await expect(service.setStudentStatus('2', 0, actor, null)).resolves.toMatchObject({ id: '2', status: 0 });
    expect(saves).toHaveLength(2);
    expect(users.get('2')).toMatchObject({ status: 0, authVersion: 4, forcePasswordChange: 0 });
  });

  it('does not expose the legacy department field in managed student responses', async () => {
    const { service } = makeService();

    const detail = await service.studentDetail('1');
    const page = await service.listStudents({});

    expect(detail).not.toHaveProperty('department_id');
    expect(page.items[0]).not.toHaveProperty('department_id');
  });

  it('rejects the removed department field from student create and update requests', () => {
    const controller = new StudentsController({
      createStudent: vi.fn(), updateStudent: vi.fn(),
    } as any, {} as any);
    const user = { id: 1, username: 'root' } as any;

    expect(() => controller.create({
      username: 'student', phone: '13800138000', real_name: '学员', category_id: '7',
      source: 'institution', department_id: '2',
    } as any, user, { body: {
      username: 'student', phone: '13800138000', real_name: '学员', category_id: '7',
      source: 'institution', department_id: '2',
    }, ip: '127.0.0.1' } as any)).toThrow('学员请求 包含不支持的字段：department_id');

    expect(() => controller.update('1', { department_id: '2' } as any, user, {
      body: { department_id: '2' }, ip: '127.0.0.1',
    } as any)).toThrow('学员请求 包含不支持的字段：department_id');
  });
});
