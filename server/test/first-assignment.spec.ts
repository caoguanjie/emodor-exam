import { describe, expect, it, vi } from 'vitest';
import { AccessService } from '../src/modules/access/access.service';
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
});
