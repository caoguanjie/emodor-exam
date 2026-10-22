import { describe, expect, it, vi } from 'vitest';
import { AccessService } from '../src/modules/access/access.service';
import { AccessController } from '../src/modules/access/access.controller';
import { RoleEnum } from '../src/common/errors';
import { SysRole } from '../src/entities/sys-role.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { SysUserRole } from '../src/entities/sys-user-role.entity';

function queryBuilder<T>(rows: T[]) {
  return {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    setLock: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getCount: vi.fn().mockResolvedValue(rows.length),
    getMany: vi.fn().mockResolvedValue(rows),
    getOne: vi.fn().mockResolvedValue(rows[0] ?? null),
  };
}

function serviceWith(repositories: Record<string, any>, dataSource: any = {}) {
  return new AccessService(
    repositories.user,
    repositories.role,
    repositories.permission || {},
    repositories.rolePermission || {},
    repositories.userRole || {},
    { del: vi.fn(), set: vi.fn() } as any,
    dataSource,
    repositories.sessions || {},
    { log: vi.fn() } as any,
  );
}

describe('first business-role assignment contracts', () => {
  it('returns a bounded page with only safe candidate account fields', async () => {
    const qb = queryBuilder([{
      id: '17', username: 'pc_manager', realName: 'PC 管理员', status: 1, role: RoleEnum.EMPLOYEE,
      employeeNo: 'E-17', phone: '13800000000', email: 'private@example.com', passwordHash: 'must-not-leak',
    }]);
    const service = serviceWith({ user: { createQueryBuilder: vi.fn(() => qb) } });

    const result = await service.listAssignableUsers({ page: 2, page_size: 10, keyword: 'pc' });

    expect(result).toEqual({
      items: [{ id: '17', username: 'pc_manager', real_name: 'PC 管理员', status: 1, system_role: RoleEnum.EMPLOYEE }],
      total: 1,
      page: 2,
      page_size: 10,
    });
    expect(Object.keys(result.items[0])).toEqual(['id', 'username', 'real_name', 'status', 'system_role']);
    expect(qb.select).toHaveBeenCalledWith(['u.id', 'u.username', 'u.realName', 'u.status', 'u.role']);
    expect(qb.where).toHaveBeenCalledWith('u.role <> :superAdmin', { superAdmin: RoleEnum.SUPER_ADMIN });
    expect(qb.andWhere).toHaveBeenCalledWith('NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id = u.id)');
  });

  it('returns only enabled non-system role options without permission matrix', async () => {
    const roleRepo = { find: vi.fn().mockResolvedValue([{ id: '7', code: 'training_manager', name: '培训管理员', status: 1, isSystem: 0 }]) };
    const service = serviceWith({ user: {}, role: roleRepo });

    const result = await service.listAssignableRoles();

    expect(result).toEqual([{ id: '7', code: 'training_manager', name: '培训管理员', status: 1, is_system: false }]);
    expect(roleRepo.find).toHaveBeenCalledWith({ where: { isSystem: 0, status: 1 }, order: { id: 'ASC' } });
    expect(result[0]).not.toHaveProperty('permissions');
  });

  it('rejects assignment to any super administrator before mutating roles', async () => {
    const roleQb = queryBuilder([{ id: '7', status: 1, isSystem: 0 }]);
    const userQb = queryBuilder([{ id: '1', role: RoleEnum.SUPER_ADMIN, authVersion: 0 }]);
    const repositories = {
      user: { createQueryBuilder: vi.fn(() => userQb), save: vi.fn() },
      role: { createQueryBuilder: vi.fn(() => roleQb) },
      userRole: { delete: vi.fn(), save: vi.fn(), create: vi.fn() },
      sessions: { invalidateUser: vi.fn(), markRevoked: vi.fn() },
    };
    const manager = {
      getRepository: (entity: unknown) => entity === SysUser ? repositories.user
        : entity === SysRole ? repositories.role : repositories.userRole,
    };
    const dataSource = { transaction: vi.fn(async (callback: (value: any) => Promise<unknown>) => callback(manager)) };
    const service = serviceWith(repositories, dataSource);

    await expect(service.assignRoles('1', ['7'], '9')).rejects.toMatchObject({ code: 40001 });
    expect(repositories.user.save).not.toHaveBeenCalled();
    expect(repositories.userRole.delete).not.toHaveBeenCalled();
  });

  it('rejects invalid administrator roles before creating an account', async () => {
    const roleQb = queryBuilder([]);
    const userRepo = { create: vi.fn((value: any) => value), save: vi.fn() };
    const userRoleRepo = { create: vi.fn((value: any) => value), save: vi.fn() };
    const repositories = {
      user: userRepo,
      role: { createQueryBuilder: vi.fn(() => roleQb) },
      userRole: userRoleRepo,
      sessions: { invalidateUser: vi.fn(), markRevoked: vi.fn() },
    };
    const manager = {
      getRepository: (entity: unknown) => entity === SysUser ? userRepo
        : entity === SysRole ? repositories.role : userRoleRepo,
    };
    const dataSource = { transaction: vi.fn(async (callback: (value: any) => Promise<unknown>) => callback(manager)) };
    const service = serviceWith(repositories, dataSource) as AccessService & Record<string, any>;

    expect(typeof service.createAdministrator, 'administrator creation must be independent from student creation').toBe('function');
    if (typeof service.createAdministrator !== 'function') return;
    await expect(service.createAdministrator({
      username: 'course_admin', password: 'SafePassword9', real_name: '课程管理员',
      role_ids: ['999'],
    }, { id: 1, name: 'root' }, '127.0.0.1')).rejects.toMatchObject({ code: 40001 });

    expect(userRepo.save).not.toHaveBeenCalled();
    expect(userRoleRepo.save).not.toHaveBeenCalled();
  });

  it('rejects administrator identities that become empty after trimming before a transaction', async () => {
    const transaction = vi.fn();
    const service = serviceWith({ user: {}, role: {}, userRole: {} }, { transaction });

    await expect(service.createAdministrator({
      username: '   ', password: 'SafePassword9', real_name: '   ', role_ids: ['7'],
    }, { id: 1, name: 'root' }, null)).rejects.toMatchObject({ code: 40001 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates an administrator account and role links in the same transaction', async () => {
    const roleQb = queryBuilder([{ id: '7', status: 1, isSystem: 0 }]);
    const savedUsers: any[] = [];
    const savedLinks: any[] = [];
    const userRepo = {
      create: vi.fn((value: any) => ({ id: '31', ...value })),
      save: vi.fn(async (value: any) => { savedUsers.push(value); return value; }),
    };
    const userRoleRepo = {
      create: vi.fn((value: any) => value),
      save: vi.fn(async (value: any[]) => { savedLinks.push(...value); return value; }),
    };
    const roleRepo = { createQueryBuilder: vi.fn(() => roleQb) };
    const repositories = {
      user: userRepo,
      role: roleRepo,
      userRole: userRoleRepo,
      sessions: { invalidateUser: vi.fn(), markRevoked: vi.fn() },
    };
    const manager = {
      getRepository: (entity: unknown) => entity === SysUser ? userRepo
        : entity === SysRole ? roleRepo : userRoleRepo,
    };
    const dataSource = { transaction: vi.fn(async (callback: (value: any) => Promise<unknown>) => callback(manager)) };
    const service = serviceWith(repositories, dataSource) as AccessService & Record<string, any>;
    service.invalidate = vi.fn(async () => undefined);
    service.permissions = vi.fn(async () => ['courses:write']);

    const result = await service.createAdministrator({
      username: 'course_admin', password: 'SafePassword9', real_name: '课程管理员',
      phone: '13800000000', role_ids: ['7'],
    }, { id: 1, name: 'root' }, '127.0.0.1');

    expect(dataSource.transaction).toHaveBeenCalledOnce();
    expect(savedUsers).toHaveLength(1);
    expect(savedUsers[0]).toMatchObject({
      id: '31', username: 'course_admin', realName: '课程管理员', role: RoleEnum.EMPLOYEE,
      rolesConfigured: 1, categoryId: null, departmentId: null, forcePasswordChange: 1,
    });
    expect(savedUsers[0].passwordHash).not.toBe('SafePassword9');
    expect(savedLinks).toEqual([{ userId: '31', roleId: '7' }]);
    expect(result).toEqual({
      id: '31', username: 'course_admin', real_name: '课程管理员', system_role: RoleEnum.EMPLOYEE,
      status: 1, last_login_at: null, role_ids: ['7'], permissions: ['courses:write'],
    });
  });

  it('exposes independent administrator creation from the administrator controller', async () => {
    const createAdministrator = vi.fn(async () => ({ id: '31' }));
    const controller = new AccessController({ createAdministrator } as any, {} as any) as AccessController & Record<string, any>;
    expect(typeof controller.createAdministrator, 'administrator controller must provide account creation').toBe('function');
    if (typeof controller.createAdministrator !== 'function') return;

    await expect(controller.createAdministrator(
      { username: 'course_admin', password: 'SafePassword9', real_name: '课程管理员', role_ids: ['7'] },
      { id: 1, username: 'root' },
      { ip: '127.0.0.1', body: {} },
    )).resolves.toEqual({ id: '31' });
    expect(createAdministrator).toHaveBeenCalledWith(
      { username: 'course_admin', password: 'SafePassword9', real_name: '课程管理员', role_ids: ['7'] },
      { id: 1, name: 'root' },
      '127.0.0.1',
    );
  });
});
