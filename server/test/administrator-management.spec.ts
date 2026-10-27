import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { AccessService } from '../src/modules/access/access.service';
import { AccessController } from '../src/modules/access/access.controller';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { RoleEnum } from '../src/common/errors';
import { SysUser } from '../src/entities/sys-user.entity';
import { SysRole } from '../src/entities/sys-role.entity';
import { SysUserRole } from '../src/entities/sys-user-role.entity';
import { SysRolePermission } from '../src/entities/sys-role-permission.entity';
import { SysPermission } from '../src/entities/sys-permission.entity';

// tsc emits the decorator metadata that Vitest's source transformer omits.
const { AccessController: CompiledAccessController } = createRequire(import.meta.url)('../dist/modules/access/access.controller.js');

const actor = { id: 1, name: 'root', role: RoleEnum.SUPER_ADMIN };
const freshPassword = () => `Z9${randomBytes(18).toString('hex')}`;

function fixture(overrides: Record<string, unknown> = {}, roleRows = [{ id: '7', status: 1, isSystem: 0 }]) {
  const user = {
    id: '17', username: 'course_manager', realName: '课程管理员', employeeNo: null,
    role: RoleEnum.EMPLOYEE, phone: '13800000000', email: 'contact@example.invalid',
    status: 1, authVersion: 4, rolesConfigured: 1, forcePasswordChange: 0,
    passwordHash: 'old-hash', loginCount: 23, lastLoginIp: '192.0.2.10',
    lastLoginAt: new Date('2026-10-26T03:20:00Z'), createdAt: new Date('2026-10-01T01:00:00Z'),
    deletedAt: null, ...overrides,
  };
  let links: any[] = [{ userId: '17', roleId: '7' }];
  const events: string[] = [];
  const query = (rows: any[], type: string) => ({
    select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(), take: vi.fn().mockReturnThis(),
    setLock: vi.fn(() => { events.push(`lock:${type}`); return builders[type]; }),
    getCount: vi.fn(async () => rows.length), getMany: vi.fn(async () => rows), getOne: vi.fn(async () => rows[0] || null),
  });
  const builders: Record<string, any> = {};
  builders.user = query([user], 'user');
  builders.role = query(roleRows, 'role');
  const repos = {
    user: {
      createQueryBuilder: () => builders.user, find: vi.fn(async () => [user]), findOne: vi.fn(async () => user),
      create: (value: any) => ({ id: '31', ...value }),
      save: vi.fn(async (value: any) => { events.push('save:user'); Object.assign(user, value); return value; }),
    },
    role: { createQueryBuilder: () => builders.role, find: vi.fn(async () => roleRows), findOne: vi.fn(async () => null) },
    userRole: {
      find: vi.fn(async () => links), create: (value: any) => value,
      delete: vi.fn(async () => { events.push('delete:links'); links = []; }),
      save: vi.fn(async (values: any[]) => { events.push('save:links'); links = values; return values; }),
    },
    rolePermission: { find: vi.fn(async () => [{ roleId: '7', permissionId: '3' }]) },
    permission: { find: vi.fn(async () => [{ id: '3', code: 'courses:write' }]) },
  };
  const manager = { getRepository: (entity: unknown) => {
    if (entity === SysUser) return repos.user;
    if (entity === SysRole) return repos.role;
    if (entity === SysUserRole) return repos.userRole;
    if (entity === SysRolePermission) return repos.rolePermission;
    if (entity === SysPermission) return repos.permission;
    throw new Error('Unexpected repository');
  } };
  const sessions = {
    invalidateUser: vi.fn(async (transactionManager: unknown) => {
      expect(transactionManager).toBe(manager); events.push('revoke:db'); return ['old-session'];
    }),
    markRevoked: vi.fn(async () => { events.push('revoke:redis'); }),
  };
  const redis = { del: vi.fn(), get: vi.fn(async () => null), set: vi.fn(), setUserBlock: vi.fn() };
  const audit = { log: vi.fn() };
  const dataSource = { transaction: vi.fn(async (callback: any) => {
    events.push('begin'); const result = await callback(manager); events.push('commit'); return result;
  }) };
  const service = new AccessService(
    repos.user as any, repos.role as any, repos.permission as any, repos.rolePermission as any,
    repos.userRole as any, redis as any, dataSource as any, sessions as any, audit as any,
    { jwt: { refreshExpiresDays: 7 } } as any,
  ) as AccessService & Record<string, any>;
  return { service, user, repos, builders, events, sessions, redis, audit, dataSource, clearLinks: () => { links = []; } };
}

describe('administrator management', () => {
  it('returns a service-paginated safe account view and searches username/name/phone', async () => {
    const { service, builders } = fixture();
    const result = await service.listAdministrators({ page: 2, page_size: 10, keyword: '138' });
    expect(result).toMatchObject({ total: 1, page: 2, page_size: 10, items: [{
      id: '17', username: 'course_manager', real_name: '课程管理员', phone: '13800000000',
      email: 'contact@example.invalid', system_role: RoleEnum.EMPLOYEE, status: 1,
      login_count: 23, last_login_ip: '192.0.2.10', role_ids: ['7'], permissions: ['courses:write'],
    }] });
    expect(result.items[0]).not.toHaveProperty('passwordHash');
    expect(result.items[0]).not.toHaveProperty('authVersion');
    expect(result.items[0].created_at).toEqual(new Date('2026-10-01T01:00:00Z'));
    expect(builders.user.skip).toHaveBeenCalledWith(10);
    expect(builders.user.take).toHaveBeenCalledWith(10);
    expect(builders.user.where).toHaveBeenCalledWith('u.deleted_at IS NULL');
    expect(builders.user.andWhere).toHaveBeenCalledWith(
      '(u.username LIKE :keyword OR u.real_name LIKE :keyword OR u.phone LIKE :keyword)', { keyword: '%138%' },
    );
    expect(builders.user.select.mock.calls[0][0]).not.toContain('u.passwordHash');
  });

  it('defaults administrator pages to 1/10', async () => {
    const { service } = fixture();
    expect(await service.listAdministrators()).toMatchObject({ page: 1, page_size: 10 });
  });

  it('creates a disabled administrator with optional empty name and a single JS timestamp', async () => {
    const { service, repos } = fixture();
    const result = await service.createAdministrator({ username: 'new_manager', password: freshPassword(), role_ids: ['7'], status: 0 }, actor, null);
    const saved = repos.user.save.mock.calls[0][0];
    expect(saved).toMatchObject({ realName: '', status: 0, rolesConfigured: 1, forcePasswordChange: 1, loginCount: 0 });
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBe(saved.createdAt);
    expect(result).toMatchObject({ real_name: '', status: 0 });
  });

  it('reads only administrator details, including disabled-role links', async () => {
    const { service } = fixture({}, [{ id: '7', status: 0, isSystem: 0 }]);
    expect(await service.getAdministrator('17')).toMatchObject({ id: '17', role_ids: ['7'], login_count: 23 });
  });

  it.each(['detail', 'update', 'reset', 'delete'])('rejects a pure learner through the administrator %s endpoint', async (operation) => {
    const f = fixture(); f.clearLinks();
    const run = () => operation === 'detail' ? f.service.getAdministrator('17')
      : operation === 'update' ? f.service.updateAdministrator('17', { role_ids: ['7'], real_name: '改名' }, actor, null)
      : operation === 'reset' ? f.service.resetAdministratorPassword('17', { password: freshPassword() }, actor, null)
      : f.service.deleteAdministrator('17', actor, null);
    await expect(run()).rejects.toMatchObject({ code: 40401 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it.each(['detail', 'update', 'reset', 'delete'])('rejects an already deleted administrator through %s', async (operation) => {
    const f = fixture({ deletedAt: new Date(), status: 0 });
    const run = () => operation === 'detail' ? f.service.getAdministrator('17')
      : operation === 'update' ? f.service.updateAdministrator('17', { role_ids: ['7'], status: 1 }, actor, null)
      : operation === 'reset' ? f.service.resetAdministratorPassword('17', { password: freshPassword() }, actor, null)
      : f.service.deleteAdministrator('17', actor, null);
    await expect(run()).rejects.toMatchObject({ code: 40401 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
    expect(f.repos.userRole.delete).not.toHaveBeenCalled();
  });

  it('does not serve cached permissions for deleted accounts', async () => {
    const f = fixture({ deletedAt: new Date() });
    f.redis.get.mockResolvedValue(JSON.stringify(['courses:write']));
    expect(await f.service.permissions('17')).toEqual([]);
  });

  it('updates profile, roles and state atomically in role-before-user lock order', async () => {
    const f = fixture();
    const result = await f.service.updateAdministrator('17', { real_name: '新姓名', phone: '139-0000-0000', role_ids: ['7'], status: 0 }, actor, null);
    expect(f.user).toMatchObject({ realName: '新姓名', phone: '13900000000', status: 0, authVersion: 5, rolesConfigured: 1 });
    expect(result).toMatchObject({ id: '17', status: 0 });
    expect(f.events.indexOf('lock:role')).toBeLessThan(f.events.indexOf('lock:user'));
    expect(f.events.indexOf('save:links')).toBeLessThan(f.events.indexOf('commit'));
    expect(f.events.indexOf('revoke:db')).toBeLessThan(f.events.indexOf('commit'));
    expect(f.events.indexOf('revoke:redis')).toBeGreaterThan(f.events.indexOf('commit'));
    expect(f.redis.del).toHaveBeenCalledWith('access:permissions:v2:17');
    expect(f.redis.setUserBlock).toHaveBeenCalledWith(17, expect.any(Number), 7 * 86400);
  });

  it('retains an already assigned disabled role while editing profile', async () => {
    const f = fixture({}, [{ id: '7', status: 0, isSystem: 0 }]);
    await f.service.updateAdministrator('17', { real_name: '新姓名', role_ids: ['7'] }, actor, null);
    expect(f.repos.userRole.save).toHaveBeenCalledWith([{ userId: '17', roleId: '7' }]);
    expect(f.user.passwordHash).toBe('old-hash');
  });

  it('rejects a newly assigned disabled role without changing profile', async () => {
    const f = fixture({}, [{ id: '8', status: 0, isSystem: 0 }]);
    await expect(f.service.updateAdministrator('17', { real_name: '越权', role_ids: ['8'] }, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(f.user.realName).toBe('课程管理员');
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it.each([{ role_ids: undefined }, { role_ids: [] }, { role_ids: ['7', '7'] }])('requires nonempty distinct ordinary administrator roles: %j', async ({ role_ids }) => {
    const f = fixture();
    await expect(f.service.updateAdministrator('17', { role_ids }, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it.each(['disable', 'delete'])('protects the current account from %s', async (operation) => {
    const f = fixture(); const self = { id: 17, name: 'self', role: RoleEnum.EMPLOYEE };
    const request = operation === 'disable'
      ? f.service.updateAdministrator('17', { role_ids: ['7'], status: 0 }, self, null)
      : f.service.deleteAdministrator('17', self, null);
    await expect(request).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it.each(['disable', 'delete', 'roles'])('protects every super administrator from %s', async (operation) => {
    const f = fixture({ role: RoleEnum.SUPER_ADMIN });
    const request = operation === 'delete' ? f.service.deleteAdministrator('17', actor, null)
      : f.service.updateAdministrator('17', operation === 'roles' ? { role_ids: ['7'] } : { status: 0 }, actor, null);
    await expect(request).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it('allows a super administrator to edit super-administrator profile without role payload', async () => {
    const f = fixture({ role: RoleEnum.SUPER_ADMIN });
    await f.service.updateAdministrator('17', { real_name: '超级管理', phone: '13900000000', status: 1 }, actor, null);
    expect(f.user).toMatchObject({ realName: '超级管理', phone: '13900000000', rolesConfigured: 1 });
    expect(f.repos.userRole.delete).not.toHaveBeenCalled();
  });

  it.each(['update', 'reset'])('denies lower-level %s of super administrators', async (operation) => {
    const f = fixture({ role: RoleEnum.SUPER_ADMIN });
    const low = { id: 2, name: 'operator', role: RoleEnum.EMPLOYEE };
    const request = operation === 'update'
      ? f.service.updateAdministrator('17', { real_name: '越权' }, low, null)
      : f.service.resetAdministratorPassword('17', { password: freshPassword() }, low, null);
    await expect(request).rejects.toMatchObject({ code: 40301 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it('resets a strong password, forces next change and preserves all login history', async () => {
    const f = fixture(); const password = freshPassword();
    await f.service.resetAdministratorPassword('17', { password }, actor, null);
    expect(await bcrypt.compare(password, f.user.passwordHash)).toBe(true);
    expect(bcrypt.getRounds(f.user.passwordHash)).toBe(12);
    expect(f.user).toMatchObject({ authVersion: 5, forcePasswordChange: 1, loginCount: 23, lastLoginIp: '192.0.2.10' });
    expect(f.user.lastLoginAt).toEqual(new Date('2026-10-26T03:20:00Z'));
    expect(f.events.indexOf('revoke:db')).toBeLessThan(f.events.indexOf('commit'));
    expect(f.events.indexOf('revoke:redis')).toBeGreaterThan(f.events.indexOf('commit'));
    expect(f.redis.setUserBlock).toHaveBeenCalledWith(17, expect.any(Number), 7 * 86400);
    expect(JSON.stringify(f.audit.log.mock.calls)).not.toContain(password);
    expect(JSON.stringify(f.audit.log.mock.calls)).not.toContain(f.user.passwordHash);
  });

  it('rejects resetting the current user instead of bypassing self password change', async () => {
    const f = fixture();
    await expect(f.service.resetAdministratorPassword('17', { password: freshPassword() }, { ...actor, id: 17 }, null)).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it('rejects a password containing account identity before saving', async () => {
    const f = fixture();
    await expect(f.service.resetAdministratorPassword('17', { password: `${f.user.username}${randomBytes(4).toString('hex')}9` }, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(f.repos.user.save).not.toHaveBeenCalled();
  });

  it('soft deletes with retained account, role links and login history', async () => {
    const f = fixture();
    await f.service.deleteAdministrator('17', actor, null);
    expect(f.user).toMatchObject({ status: 0, authVersion: 5, loginCount: 23, rolesConfigured: 1 });
    expect(f.user.deletedAt).toBeInstanceOf(Date);
    expect(f.user.username).toBe('course_manager');
    expect(f.user.phone).toBe('13800000000');
    expect(f.repos.userRole.delete).not.toHaveBeenCalled();
    expect(f.events.indexOf('revoke:db')).toBeLessThan(f.events.indexOf('commit'));
    expect(f.events.indexOf('revoke:redis')).toBeGreaterThan(f.events.indexOf('commit'));
    expect(f.redis.setUserBlock).toHaveBeenCalledWith(17, expect.any(Number), 7 * 86400);
  });
});

describe('administrator request contracts', () => {
  async function dto(method: string, value: any, index = 1) {
    const type = Reflect.getMetadata('design:paramtypes', CompiledAccessController.prototype, method)?.[index];
    expect(type, `${method} must expose a validated DTO`).toBeTypeOf('function');
    return new DtoValidationPipe().transform(value, { type: 'body', metatype: type });
  }

  it('accepts omitted name and numeric disabled status when creating', async () => {
    expect(await dto('createAdministrator', { username: 'new_manager', password: freshPassword(), role_ids: ['7'], status: 0 }, 0)).toMatchObject({ status: 0 });
  });

  it.each(['0', '1', null, true, 2])('rejects invalid status %j', async (status) => {
    await expect(dto('updateAdministrator', { role_ids: ['7'], status })).rejects.toBeDefined();
  });

  it('rejects unknown raw update fields even after the global pipe stripped them', async () => {
    const access = { updateAdministrator: vi.fn() };
    const controller = new AccessController(access as any, {} as any) as AccessController & Record<string, any>;
    const raw = { real_name: '测试', role_ids: ['7'], username: 'forged' };
    const body = await dto('updateAdministrator', raw);
    await expect(Promise.resolve().then(() => controller.updateAdministrator('17', body, { id: 1, username: 'root', role: RoleEnum.SUPER_ADMIN }, { body: raw, ip: null }))).rejects.toMatchObject({ code: 40001 });
    expect(access.updateAdministrator).not.toHaveBeenCalled();
  });
});
