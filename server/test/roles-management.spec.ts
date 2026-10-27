import 'reflect-metadata';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { AccessService } from '../src/modules/access/access.service';
import { AccessController } from '../src/modules/access/access.controller';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { SysRole } from '../src/entities/sys-role.entity';
import { SysPermission } from '../src/entities/sys-permission.entity';
import { SysRolePermission } from '../src/entities/sys-role-permission.entity';
import { SysUserRole } from '../src/entities/sys-user-role.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { SysMenu } from '../src/entities/sys-menu.entity';

const { AccessController: CompiledController } = createRequire(import.meta.url)('../dist/modules/access/access.controller.js');

function fixture(overrides: Record<string, unknown> = {}) {
  const role = { id: '7', code: 'training_manager', name: '培训管理员', remark: '负责培训', isSystem: 0, status: 1,
    createdAt: new Date('2026-10-01T01:00:00Z'), updatedAt: new Date('2026-10-20T01:00:00Z'), ...overrides };
  const user = { id: '17', authVersion: 4 };
  let rolePermissions: any[] = [{ roleId: '7', permissionId: '3' }];
  let userLinks: any[] = [{ userId: '17', roleId: '7' }];
  const events: string[] = [];
  const builders: Record<string, any> = {};
  function builder(kind: string, rows: any[]) {
    return {
      where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(), take: vi.fn().mockReturnThis(),
      setLock: vi.fn(() => { events.push(`lock:${kind}`); return builders[kind]; }),
      getCount: vi.fn(async () => rows.length), getMany: vi.fn(async () => rows), getOne: vi.fn(async () => rows[0] || null),
    };
  }
  builders.role = builder('role', [role]); builders.user = builder('user', [user]);
  const repos = {
    role: {
      createQueryBuilder: () => builders.role, find: vi.fn(async () => [role]),
      findOne: vi.fn(async (options: any) => options.where?.id ? role : null),
      create: vi.fn((value: any) => ({ id: '7', ...value })),
      save: vi.fn(async (value: any) => { events.push('save:role'); Object.assign(role, value); return role; }),
      delete: vi.fn(async () => { events.push('delete:role'); }),
    },
    permission: { find: vi.fn(async () => [{ id: '3', code: 'courses:write' }]) },
    rolePermission: {
      find: vi.fn(async () => rolePermissions), create: (value: any) => value,
      delete: vi.fn(async () => { events.push('delete:grants'); rolePermissions = []; }),
      save: vi.fn(async (values: any[]) => { rolePermissions = values; return values; }),
    },
    userRole: {
      find: vi.fn(async () => userLinks), count: vi.fn(async () => userLinks.length),
    },
    user: { createQueryBuilder: () => builders.user, save: vi.fn(async (value: any) => value) },
  };
  const manager = { getRepository: (entity: unknown) => {
    if (entity === SysRole) return repos.role;
    if (entity === SysPermission) return repos.permission;
    if (entity === SysRolePermission) return repos.rolePermission;
    if (entity === SysUserRole) return repos.userRole;
    if (entity === SysUser) return repos.user;
    throw new Error('Unexpected repository');
  } };
  const sessions = {
    invalidateUser: vi.fn(async (value: unknown) => { expect(value).toBe(manager); events.push('revoke:db'); return ['old-session']; }),
    markRevoked: vi.fn(async () => { events.push('revoke:redis'); }),
  };
  const redis = { del: vi.fn() }; const audit = { log: vi.fn() };
  const menuRepo = { find: vi.fn(async () => [{ id: '31', parentId: '2', name: '停用菜单', type: 'menu',
    permissionCode: 'courses:read', sort: 3, status: 0, routePath: '/private/config', icon: 'private-icon' }]) };
  const dataSource = { getRepository: vi.fn((entity: unknown) => {
    if (entity === SysMenu) return menuRepo;
    throw new Error('Unexpected nontransactional repository');
  }), transaction: vi.fn(async (callback: any) => {
    events.push('begin'); const result = await callback(manager); events.push('commit'); return result;
  }) };
  const service = new AccessService(repos.user as any, repos.role as any, repos.permission as any,
    repos.rolePermission as any, repos.userRole as any, redis as any, dataSource as any, sessions as any, audit as any) as AccessService & Record<string, any>;
  return { service, role, user, repos, sessions, redis, audit, events, builders, dataSource, menuRepo,
    unassign: () => { userLinks = []; }, grants: () => rolePermissions };
}

describe('role metadata and lifecycle', () => {
  it('loads the additive role migration with the original role-table completion probe replaced', async () => {
    const { listMigrations } = await import('../../database/migrate.mjs');
    const migrations = await listMigrations();
    const roleMigration = migrations.find((migration: any) => migration.id === '035_role_management');
    expect(roleMigration?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'add_role_remark', replacesCheck: '002_access/create_sys_role' }),
      expect.objectContaining({ id: 'preflight_role_name_uniqueness' }),
      expect.objectContaining({ id: 'add_unique_role_name' }),
    ]));
  });

  it('retains legacy role arrays while including remark and timestamps', async () => {
    const { service } = fixture();
    expect(await service.listRoles()).toEqual([{
      id: '7', code: 'training_manager', name: '培训管理员', remark: '负责培训', is_system: false, status: 1,
      created_at: new Date('2026-10-01T01:00:00Z'), updated_at: new Date('2026-10-20T01:00:00Z'), permissions: ['courses:write'],
    }]);
  });

  it('pages role names with bounded server-side pagination', async () => {
    const f = fixture();
    expect(await f.service.listRolePage({ page: 2, page_size: 10, keyword: '培训' })).toMatchObject({
      total: 1, page: 2, page_size: 10, items: [{ id: '7', remark: '负责培训', permissions: ['courses:write'] }],
    });
    expect(f.builders.role.where).toHaveBeenCalledWith('r.name LIKE :keyword', { keyword: '%培训%' });
    expect(f.builders.role.skip).toHaveBeenCalledWith(10);
    expect(f.builders.role.take).toHaveBeenCalledWith(10);
  });

  it('defaults role pages to 1/10', async () => {
    const f = fixture();
    expect(await f.service.listRolePage({})).toMatchObject({ page: 1, page_size: 10 });
  });

  it('returns a safe flat menu tree including disabled nodes and all registered permission options', async () => {
    const f = fixture();
    const result = await f.service.rolePermissionTree();
    expect(result.menus).toEqual([{ id: '31', parent_id: '2', name: '停用菜单', type: 'menu',
      permission_code: 'courses:read', sort: 3, status: 0 }]);
    expect(result.permissions).toEqual(expect.arrayContaining([{ code: 'courses:write', name: '维护课程' }]));
    expect(f.menuRepo.find).toHaveBeenCalledWith({ order: { sort: 'ASC', id: 'ASC' } });
  });

  it('creates from name/remark only with a generated internal code and no grants', async () => {
    const f = fixture();
    const result = await f.service.createRole({ name: '  新角色  ', remark: '  管理备注  ' }, 1);
    const saved = f.repos.role.save.mock.calls[0][0];
    expect(saved.code).toMatch(/^r_[a-f0-9]{32}$/);
    expect(saved).toMatchObject({ name: '新角色', remark: '管理备注', status: 1, isSystem: 0 });
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBe(saved.createdAt);
    expect(f.repos.rolePermission.save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ name: '新角色', remark: '管理备注' });
  });

  it('keeps explicit code and permission creation compatible', async () => {
    const f = fixture();
    const result = await f.service.createRole({ code: 'custom_manager', name: '新角色', permissions: ['courses:write'] }, 1);
    expect(result).toMatchObject({ code: 'custom_manager', permissions: ['courses:write'] });
    expect(f.repos.rolePermission.save).toHaveBeenCalledWith([{ roleId: '7', permissionId: '3' }]);
  });

  it('attributes role changes to the real administrator and keeps a readable target snapshot', async () => {
    const f = fixture();
    await f.service.createRole(
      { code: 'custom_manager', name: '新角色', permissions: ['courses:write'] },
      { id: 5, name: 'admin', sourceIp: '127.0.0.1' } as any,
    );
    expect(f.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: 5,
      actor_name: 'admin',
      source_ip: '127.0.0.1',
      action: 'access.role.create',
      detail: expect.objectContaining({ name: '新角色' }),
    }));
  });

  it('records the before and after values of changed role fields', async () => {
    const f = fixture();
    await f.service.updateRole(
      '7',
      { name: '新名称', remark: '新备注' },
      { id: 5, name: 'admin', sourceIp: '127.0.0.1' } as any,
    );
    expect(f.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actor_name: 'admin',
      action: 'access.role.update',
      detail: expect.objectContaining({
        name: '新名称',
        changes: {
          name: { before: '培训管理员', after: '新名称' },
          remark: { before: '负责培训', after: '新备注' },
        },
      }),
    }));
  });

  it.each(['', '   '])('rejects blank role name %j before creating', async (name) => {
    const f = fixture();
    await expect(f.service.createRole({ name }, 1)).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.role.save).not.toHaveBeenCalled();
  });

  it('returns a clear name error when the unique index resolves concurrent creates', async () => {
    const f = fixture();
    f.repos.role.save.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY', sqlMessage: 'uk_sys_role_name' }));
    await expect(f.service.createRole({ name: '重复名称' }, 1)).rejects.toMatchObject({ code: 40001, message: expect.stringContaining('名称') });
  });

  it('rejects an existing same-name role before saving', async () => {
    const f = fixture();
    f.repos.role.findOne.mockResolvedValueOnce({ ...f.role, id: '8' });
    await expect(f.service.createRole({ name: '培训管理员' }, 1)).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.role.save).not.toHaveBeenCalled();
  });

  it('returns latest role details without a paginated-list dependency', async () => {
    const f = fixture({ remark: '最新备注' });
    expect(await f.service.getRole('7')).toMatchObject({ id: '7', remark: '最新备注', permissions: ['courses:write'] });
    expect(f.repos.role.find).not.toHaveBeenCalled();
  });

  it('edits metadata without erasing grants or revoking attached users', async () => {
    const f = fixture();
    const result = await f.service.updateRole('7', { name: '  新名称 ', remark: '  新备注 ' }, 1);
    expect(result).toMatchObject({ name: '新名称', remark: '新备注', permissions: ['courses:write'] });
    expect(f.grants()).toEqual([{ roleId: '7', permissionId: '3' }]);
    expect(f.repos.rolePermission.delete).not.toHaveBeenCalled();
    expect(f.repos.user.save).not.toHaveBeenCalled();
    expect(f.sessions.invalidateUser).not.toHaveBeenCalled();
    expect(f.sessions.markRevoked).not.toHaveBeenCalled();
    expect(f.role.updatedAt.getTime()).toBeGreaterThan(new Date('2026-10-20T01:00:00Z').getTime());
  });

  it('allows explicitly clearing the remark', async () => {
    const f = fixture();
    await f.service.updateRole('7', { remark: null }, 1);
    expect(f.role.remark).toBeNull();
  });

  it('does not revoke sessions when submitted permissions and status are unchanged', async () => {
    const f = fixture();
    await f.service.updateRole('7', { permissions: ['courses:write'], status: 1 }, 1);
    expect(f.sessions.invalidateUser).not.toHaveBeenCalled();
    expect(f.repos.rolePermission.delete).not.toHaveBeenCalled();
    expect(f.user.authVersion).toBe(4);
  });

  it.each([{ permissions: [] }, { status: 0 }])('revokes assigned users atomically only when grants or status change: %j', async (input) => {
    const f = fixture();
    await f.service.updateRole('7', input, 1);
    expect(f.user.authVersion).toBe(5);
    expect(f.events.indexOf('lock:role')).toBeLessThan(f.events.indexOf('lock:user'));
    expect(f.events.indexOf('revoke:db')).toBeLessThan(f.events.indexOf('commit'));
    expect(f.events.indexOf('revoke:redis')).toBeGreaterThan(f.events.indexOf('commit'));
    expect(f.redis.del).toHaveBeenCalledWith('access:permissions:v2:17');
  });

  it('reports duplicate role names on updates', async () => {
    const f = fixture();
    f.repos.role.save.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY', sqlMessage: 'uk_sys_role_name' }));
    await expect(f.service.updateRole('7', { name: '重复名称' }, 1)).rejects.toMatchObject({ code: 40001, message: expect.stringContaining('名称') });
  });

  it.each(['update', 'delete'])('protects system roles from %s', async (operation) => {
    const f = fixture({ isSystem: 1 });
    const run = () => operation === 'update' ? f.service.updateRole('7', { remark: '改动' }, 1) : f.service.deleteRole('7', 1);
    await expect(run()).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.role.save).not.toHaveBeenCalled();
    expect(f.repos.role.delete).not.toHaveBeenCalled();
  });

  it('blocks deletion whenever a role has any user link, including deleted-account links', async () => {
    const f = fixture();
    await expect(f.service.deleteRole('7', 1)).rejects.toMatchObject({ code: 40001, message: expect.stringContaining('关联') });
    expect(f.repos.userRole.count).toHaveBeenCalledWith({ where: { roleId: '7' } });
    expect(f.repos.rolePermission.delete).not.toHaveBeenCalled();
    expect(f.repos.role.delete).not.toHaveBeenCalled();
  });

  it('deletes only an unassigned business role and its grants after locking the role', async () => {
    const f = fixture(); f.unassign();
    await f.service.deleteRole('7', 1);
    expect(f.repos.rolePermission.delete).toHaveBeenCalledWith({ roleId: '7' });
    expect(f.repos.role.delete).toHaveBeenCalledWith({ id: '7' });
    expect(f.events.indexOf('lock:role')).toBeLessThan(f.events.indexOf('delete:grants'));
    expect(f.events.indexOf('delete:grants')).toBeLessThan(f.events.indexOf('delete:role'));
    expect(f.events.indexOf('delete:role')).toBeLessThan(f.events.indexOf('commit'));
    expect(f.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access.role.delete', object_id: '7' }));
  });
});

describe('role HTTP request contracts', () => {
  const typeFor = (method: string, index: number) => Reflect.getMetadata('design:paramtypes', CompiledController.prototype, method)?.[index];
  const dto = (method: string, value: any, index = 0, type: 'body' | 'query' = 'body') => {
    const metatype = typeFor(method, index);
    expect(metatype).toBeTypeOf('function');
    return new DtoValidationPipe().transform(value, { metatype, type });
  };

  it('accepts a name-and-remark creation request without internal code or permissions', async () => {
    expect(await dto('createRole', { name: '值班管理', remark: '负责安排' })).toMatchObject({ name: '值班管理', remark: '负责安排' });
  });

  it.each([0, 'invalid', 101, 1.5])('rejects invalid role page size %j', async (page_size) => {
    await expect(dto('roles', { page_size }, 0, 'query')).rejects.toBeDefined();
  });

  it('uses legacy arrays with no query and pages only when a query was requested', async () => {
    const access = { listRoles: vi.fn(async () => ['legacy']), listRolePage: vi.fn(async () => ({ items: [] })) };
    const controller = new AccessController(access as any, {} as any) as AccessController & Record<string, any>;
    await expect(controller.roles({}, { query: {} })).resolves.toEqual(['legacy']);
    await expect(controller.roles({ page: 1 }, { query: { page: '1' } })).resolves.toEqual({ items: [] });
  });

  it('rejects unknown raw query keys even after the global whitelist pipe', async () => {
    const access = { listRolePage: vi.fn() };
    const controller = new AccessController(access as any, {} as any) as AccessController & Record<string, any>;
    await expect(Promise.resolve().then(() => controller.roles({ page: 1 }, { query: { page: '1', include_users: '1' } }))).rejects.toMatchObject({ code: 40001 });
    expect(access.listRolePage).not.toHaveBeenCalled();
  });

  it.each(['0', null, true, 2])('rejects nonnumeric or out-of-range role status %j', async (status) => {
    await expect(dto('updateRole', { status }, 1)).rejects.toBeDefined();
  });
});
