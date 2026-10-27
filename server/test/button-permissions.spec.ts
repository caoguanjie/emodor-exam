import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AccessController } from '../src/modules/access/access.controller';
import { AccessService } from '../src/modules/access/access.service';
import { SystemController } from '../src/modules/system/system.controller';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { SysRole } from '../src/entities/sys-role.entity';
import { SysRolePermission } from '../src/entities/sys-role-permission.entity';
import { SysPermission } from '../src/entities/sys-permission.entity';
import { SysUserRole } from '../src/entities/sys-user-role.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { PERMISSION_CATALOG } from '../src/modules/access/permission-catalog';

const user = { id: 1, username: 'operator', role: 'employee' };

function guardFixture(grants: string[]) {
  const access = new AccessService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  access.permissions = vi.fn(async () => grants);
  const guard = new PermissionsGuard(new Reflector(), access);
  const check = (controller: any, method: string) => guard.canActivate({
    getHandler: () => controller.prototype[method], getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user, originalUrl: '/api/v1/admin/test', method: 'POST' }) }),
  } as any);
  return { access, check };
}

function roleFixture(initialCodes: string[] = []) {
  const dictionary = [
    'administrators:write', 'administrators:create', 'administrators:update', 'administrators:delete', 'administrators:reset_password',
    'roles:write', 'roles:create', 'roles:update', 'roles:delete', 'roles:permissions',
    'system_settings:read', 'system_settings:write', 'menus:read', 'menus:create', 'menus:update', 'menus:delete', 'courses:write',
  ].map((code, index) => ({ id: String(index + 1), code }));
  let links = initialCodes.map((code) => ({ roleId: '7', permissionId: dictionary.find((row) => row.code === code)!.id }));
  const role: any = { id: '7', code: 'manager', name: '管理', isSystem: 0, status: 1 };
  const roleBuilder = { setLock() { return this; }, where() { return this; }, getOne: async () => role };
  const repos = {
    role: { createQueryBuilder: () => roleBuilder, findOne: async () => null, create: (v: any) => ({ id: '7', ...v }), save: async (v: any) => Object.assign(role, v), find: async () => [role] },
    permission: { find: async (options: any) => {
      const codeValues = options.where?.code?._value;
      const ids = options.where?.id?._value;
      return dictionary.filter((row) => codeValues ? codeValues.includes(row.code) : ids ? ids.includes(row.id) : false);
    } },
    rolePermission: { find: async () => links, create: (v: any) => v,
      save: async (values: any[]) => { links = values; return values; }, delete: async () => { links = []; } },
    userRole: { find: async () => [] }, user: {},
  };
  const manager = { getRepository: (entity: unknown) => entity === SysRole ? repos.role : entity === SysPermission ? repos.permission
    : entity === SysRolePermission ? repos.rolePermission : entity === SysUserRole ? repos.userRole : entity === SysUser ? repos.user : null };
  const dataSource = { transaction: async (callback: any) => callback(manager) };
  const service = new AccessService(repos.user as any, repos.role as any, repos.permission as any, repos.rolePermission as any,
    repos.userRole as any, { del: vi.fn() } as any, dataSource as any, {} as any) as AccessService & Record<string, any>;
  return { service, currentCodes: () => links.map((link) => dictionary.find((row) => row.id === link.permissionId)!.code).sort() };
}

describe('independent management button guards', () => {
  it.each([
    ['createAdministrator', 'administrators:create'], ['updateAdministrator', 'administrators:update'],
    ['deleteAdministrator', 'administrators:delete'], ['resetAdministratorPassword', 'administrators:reset_password'],
    ['administrator', 'administrators:update'], ['administrators', 'administrators:read'],
    ['createRole', 'roles:create'], ['deleteRole', 'roles:delete'], ['roles', 'roles:read'],
  ])('%s accepts only its independent grant %s', async (method, permission) => {
    await expect(guardFixture([permission]).check(AccessController, method)).resolves.toBe(true);
    await expect(guardFixture(['courses:write']).check(AccessController, method)).rejects.toMatchObject({ code: 40301 });
  });

  it.each([
    ['menus', 'menus:read'], ['menu', 'menus:read'], ['createMenu', 'menus:create'], ['updateMenu', 'menus:update'], ['removeMenu', 'menus:delete'],
  ])('menu %s accepts %s without inheriting system settings writes', async (method, permission) => {
    await expect(guardFixture([permission]).check(SystemController, method)).resolves.toBe(true);
    await expect(guardFixture(['system_settings:write', 'system_settings:read']).check(SystemController, method)).rejects.toMatchObject({ code: 40301 });
  });

  it('does not let one administrator write button authorize another', async () => {
    for (const grant of ['administrators:create', 'administrators:update', 'administrators:delete', 'administrators:reset_password']) {
      const methods = ['createAdministrator', 'updateAdministrator', 'deleteAdministrator', 'resetAdministratorPassword'];
      const index = ['administrators:create', 'administrators:update', 'administrators:delete', 'administrators:reset_password'].indexOf(grant);
      for (const [position, method] of methods.entries()) if (position !== index) {
        await expect(guardFixture([grant]).check(AccessController, method)).rejects.toMatchObject({ code: 40301 });
      }
    }
  });

  it.each(['administrators:create', 'administrators:update'])('allows narrow role options for %s', async (grant) => {
    await expect(guardFixture([grant]).check(AccessController, 'assignableRoles')).resolves.toBe(true);
  });

  it.each(['roles:update', 'roles:permissions'])('allows latest role details for %s', async (grant) => {
    await expect(guardFixture([grant]).check(AccessController, 'role')).resolves.toBe(true);
  });

  it.each(['roles:read', 'roles:permissions'])('allows role permission tree and directory for %s', async (grant) => {
    await expect(guardFixture([grant]).check(AccessController, 'rolePermissionTree')).resolves.toBe(true);
    await expect(guardFixture([grant]).check(AccessController, 'catalog')).resolves.toBe(true);
  });

  it.each(['menus:create', 'menus:update'])('allows registered permission options for %s', async (grant) => {
    await expect(guardFixture([grant]).check(SystemController, 'permissionOptions')).resolves.toBe(true);
  });

  it('keeps site and dictionary maintenance behind system settings permission', async () => {
    for (const method of ['createDictionary', 'updateDictionary', 'removeDictionary', 'updateSiteSettings']) {
      await expect(guardFixture(['system_settings:write']).check(SystemController, method)).resolves.toBe(true);
      await expect(guardFixture(['menus:update']).check(SystemController, method)).rejects.toMatchObject({ code: 40301 });
    }
  });

  it('prevents create-only callers from smuggling permissions into a role creation', async () => {
    const f = guardFixture(['roles:create']);
    const createRole = vi.fn();
    const controller = new AccessController({ assertAllowed: f.access.assertAllowed.bind(f.access), createRole } as any, {} as any);
    await f.check(AccessController, 'createRole');
    const body = { name: '新角色', permissions: ['menus:delete'] };
    await expect(Promise.resolve().then(() => controller.createRole(body, user as any, { body } as any))).rejects.toMatchObject({ code: 40301 });
    expect(createRole).not.toHaveBeenCalled();
  });

  it('allows create-only callers to create an unconfigured role', async () => {
    const f = guardFixture(['roles:create']);
    const createRole = vi.fn(async () => ({ id: '7' }));
    const controller = new AccessController({ assertAllowed: f.access.assertAllowed.bind(f.access), createRole } as any, {} as any);
    await expect(controller.createRole({ name: '新角色' }, user as any, { body: { name: '新角色' } } as any)).resolves.toEqual({ id: '7' });
  });

  it.each([
    { grant: 'roles:update', body: { remark: '备注', permissions: [] } },
    { grant: 'roles:permissions', body: { permissions: [], status: 0 } },
  ])('rejects mixed fields beyond $grant authority', async ({ grant, body }) => {
    const f = guardFixture([grant]);
    const updateRole = vi.fn();
    const controller = new AccessController({ assertAllowed: f.access.assertAllowed.bind(f.access), updateRole } as any, {} as any);
    await expect(f.check(AccessController, 'updateRole')).resolves.toBe(true);
    await expect(Promise.resolve().then(() => controller.updateRole('7', body, user as any, { body } as any))).rejects.toMatchObject({ code: 40301 });
    expect(updateRole).not.toHaveBeenCalled();
  });

  it('protects the new strict permission endpoint and rejects metadata fields', async () => {
    await expect(guardFixture(['roles:permissions']).check(AccessController, 'setRolePermissions')).resolves.toBe(true);
    await expect(guardFixture(['roles:update']).check(AccessController, 'setRolePermissions')).rejects.toMatchObject({ code: 40301 });
    const setRolePermissions = vi.fn();
    const controller = new AccessController({ setRolePermissions } as any, {} as any) as AccessController & Record<string, any>;
    await expect(Promise.resolve().then(() => controller.setRolePermissions('7', { permissions: [] }, user, { body: { permissions: [], name: '越权' } }))).rejects.toMatchObject({ code: 40001 });
    expect(setRolePermissions).not.toHaveBeenCalled();
  });
});

describe('permission schema v2 compatibility boundaries', () => {
  it('does not register the retired existing-account promotion permission', () => {
    expect(PERMISSION_CATALOG).not.toContain('administrators:assign_roles');
  });

  it('removes retired account-promotion metadata through a forward migration', async () => {
    const { listMigrations } = await import('../../database/migrate.mjs');
    const migrations = await listMigrations();
    const migration = migrations.find((item: any) => item.id === '038_remove_administrator_role_assignment');
    expect(migration?.steps.map((step: any) => step.id)).toEqual([
      'remove_assignment_menu', 'remove_assignment_grants', 'remove_assignment_permission',
    ]);
    expect(migration?.steps.find((step: any) => step.id === 'remove_assignment_grants')?.replacesCheck)
      .toBe('036_role_menu_button_permissions/copy_legacy_management_grants');
    expect(migration?.steps.find((step: any) => step.id === 'remove_assignment_permission')?.replacesCheck)
      .toBe('036_role_menu_button_permissions/register_button_permissions');
  });

  it('loads the five controlled permission-upgrade steps through the existing migration parser', async () => {
    const { listMigrations } = await import('../../database/migrate.mjs');
    const migrations = await listMigrations();
    const migration = migrations.find((item: any) => item.id === '036_role_menu_button_permissions');
    expect(migration?.steps.map((step: any) => step.id)).toEqual([
      'register_button_permissions', 'copy_legacy_management_grants', 'remove_aggregate_role_grants', 'bind_menu_read_permission', 'seed_management_buttons',
    ]);
  });

  it('keeps aggregate codes registered but hides them from selectable catalogs', async () => {
    const { service } = roleFixture();
    const codes = (await service.catalog()).map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['administrators:create', 'roles:permissions', 'menus:read', 'menus:delete']));
    expect(codes).not.toContain('administrators:assign_roles');
    expect(codes).not.toContain('administrators:write');
    expect(codes).not.toContain('roles:write');
  });

  it('expands legacy administrator and role aggregates on legacy create only', async () => {
    const f = roleFixture();
    await f.service.createRole({ name: '旧调用', permissions: ['administrators:write', 'roles:write'] }, 1);
    expect(f.currentCodes()).toEqual([
      'administrators:create', 'administrators:delete', 'administrators:reset_password', 'administrators:update',
      'roles:create', 'roles:delete', 'roles:permissions', 'roles:update',
    ]);
  });

  it('expands legacy system settings input once while retaining its original grants', async () => {
    const f = roleFixture();
    await f.service.updateRole('7', { permissions: ['system_settings:read', 'system_settings:write'] }, 1);
    expect(f.currentCodes()).toEqual(['menus:create', 'menus:delete', 'menus:read', 'menus:update', 'system_settings:read', 'system_settings:write']);
  });

  it('does not restore menus when strict permissions retain only site and dictionary writes', async () => {
    const f = roleFixture(['system_settings:write', 'menus:create', 'menus:update', 'menus:delete']);
    await f.service.setRolePermissions('7', ['system_settings:write'], 1);
    expect(f.currentCodes()).toEqual(['system_settings:write']);
  });

  it.each(['administrators:write', 'roles:write'])('rejects legacy aggregate %s on strict permission saves', async (code) => {
    const f = roleFixture();
    await expect(f.service.setRolePermissions('7', [code], 1)).rejects.toMatchObject({ code: 40001 });
  });

  it('ignores old-generation Redis caches for ordinary users and super administrators', async () => {
    for (const role of ['employee', 'super_admin']) {
      const values = new Map([['access:permissions:17:4', JSON.stringify(['administrators:write'])]]);
      const redis = { get: vi.fn(async (key: string) => values.get(key) || null),
        set: vi.fn(async (key: string, value: string) => { values.set(key, value); }), del: vi.fn() };
      const access = new AccessService({ findOne: async () => ({ id: '17', role, status: 1, authVersion: 4 }) } as any,
        { find: async () => [{ id: '7' }] } as any, { find: async () => [{ id: '3', code: 'administrators:create' }] } as any,
        { find: async () => [{ roleId: '7', permissionId: '3' }] } as any,
        { find: async () => [{ userId: '17', roleId: '7' }] } as any, redis as any, {} as any, {} as any);
      expect(await access.permissions('17')).toContain('administrators:create');
      expect(redis.get).toHaveBeenCalledWith('access:permissions:v2:17:4');
      expect(values.has('access:permissions:v2:17:4')).toBe(true);
    }
  });
});
