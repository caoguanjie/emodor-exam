import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { Errors, RoleEnum } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import { SysUser } from '../../entities/sys-user.entity';
import { SysRole } from '../../entities/sys-role.entity';
import { SysPermission } from '../../entities/sys-permission.entity';
import { SysRolePermission } from '../../entities/sys-role-permission.entity';
import { SysUserRole } from '../../entities/sys-user-role.entity';
import { AuthSession } from '../../entities/auth-session.entity';
import { SessionService } from '../auth/session.service';
import {
  LEGACY_REGULATION_ADMIN_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_NAMES,
  PermissionCode,
  isRegisteredPermission,
} from './permission-catalog';

const CACHE_TTL_SECONDS = 60;

@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(SysRole) private readonly roleRepo: Repository<SysRole>,
    @InjectRepository(SysPermission) private readonly permissionRepo: Repository<SysPermission>,
    @InjectRepository(SysRolePermission) private readonly rolePermissionRepo: Repository<SysRolePermission>,
    @InjectRepository(SysUserRole) private readonly userRoleRepo: Repository<SysUserRole>,
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
    private readonly audit?: AuditService,
    private readonly config?: AppConfig,
  ) {}

  private cacheKey(userId: string | number, authVersion?: number) {
    return authVersion === undefined
      ? `access:permissions:${String(userId)}`
      : `access:permissions:${String(userId)}:${authVersion}`;
  }

  private authVersion(user: SysUser): number {
    return Number.isInteger(Number(user.authVersion)) ? Number(user.authVersion) : 0;
  }

  async invalidate(userId: string | number): Promise<void> {
    // Permission caches are generation-scoped. Deleting the legacy key keeps
    // rolling deployments tidy; a new auth_version can never read a prior
    // generation's permissions even if post-commit cache deletion races.
    await this.redis.del(this.cacheKey(userId));
  }

  /** 返回当前用户的有效权限；显式业务角色关系存在时覆盖旧三角色默认矩阵。 */
  async permissions(userId: string | number, options: { manager?: EntityManager; useCache?: boolean } = {}): Promise<string[]> {
    const userRepo = options.manager?.getRepository(SysUser) || this.userRepo;
    // Read the authoritative user generation before consulting Redis. A role
    // mutation changes auth_version in the same transaction as its links, so
    // a current token can never inherit a prior generation's cached matrix.
    const user = await userRepo.findOne({ where: { id: String(userId) } });
    if (!user || user.status === 0) return [];
    const useCache = !options.manager && options.useCache !== false;
    const key = this.cacheKey(userId, this.authVersion(user));
    if (useCache) {
      const cached = await this.redis.get(key);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
        } catch { /* cache corruption is ignored and repaired below */ }
      }
    }

    let effective: string[];
    if (user.role === RoleEnum.SUPER_ADMIN) {
      effective = [...PERMISSION_CATALOG];
    } else {
      const userRoleRepo = options.manager?.getRepository(SysUserRole) || this.userRoleRepo;
      const roleRepo = options.manager?.getRepository(SysRole) || this.roleRepo;
      const rolePermissionRepo = options.manager?.getRepository(SysRolePermission) || this.rolePermissionRepo;
      const permissionRepo = options.manager?.getRepository(SysPermission) || this.permissionRepo;
      const links = await userRoleRepo.find({ where: { userId: String(userId) } });
      if (links.length === 0 && user.role === RoleEnum.REGULATION_ADMIN && Number(user.rolesConfigured || 0) === 0) {
        // 兼容既有种子管理员；一旦配置了业务角色，就只使用显式授权。
        effective = [...LEGACY_REGULATION_ADMIN_PERMISSIONS];
      } else if (links.length === 0) {
        effective = [];
      } else {
        const roleIds = links.map((link) => String(link.roleId));
        const roles = await roleRepo.find({ where: { id: In(roleIds), status: 1 } });
        const rolePermissionRows = roles.length
          ? await rolePermissionRepo.find({ where: { roleId: In(roles.map((role) => role.id)) } })
          : [];
        const permissionIds = [...new Set(rolePermissionRows.map((row) => String(row.permissionId)))];
        const permissionRows = permissionIds.length
          ? await permissionRepo.find({ where: { id: In(permissionIds) } })
          : [];
        effective = permissionRows.map((permission) => permission.code).filter(isRegisteredPermission);
      }
    }
    effective = [...new Set(effective)].sort();
    if (useCache) await this.redis.set(key, JSON.stringify(effective), CACHE_TTL_SECONDS);
    return effective;
  }

  async assertAllowed(userId: string | number, code: string): Promise<void> {
    if (!isRegisteredPermission(code)) throw Errors.forbidden();
    const permissions = await this.permissions(userId);
    if (!permissions.includes(code)) throw Errors.forbidden();
  }

  async catalog() {
    return PERMISSION_CATALOG.map((code) => ({ code, name: PERMISSION_NAMES[code] }));
  }

  async listRoles() {
    const roles = await this.roleRepo.find({ order: { id: 'ASC' } });
    if (!roles.length) return [];
    const links = await this.rolePermissionRepo.find({ where: { roleId: In(roles.map((role) => role.id)) } });
    const permissionIds = [...new Set(links.map((link) => String(link.permissionId)))];
    const permissions = permissionIds.length ? await this.permissionRepo.find({ where: { id: In(permissionIds) } }) : [];
    const byId = new Map(permissions.map((permission) => [String(permission.id), permission.code]));
    return roles.map((role) => ({
      id: String(role.id), code: role.code, name: role.name,
      is_system: Boolean(role.isSystem), status: role.status,
      permissions: links.filter((link) => String(link.roleId) === String(role.id))
        .map((link) => byId.get(String(link.permissionId))).filter((code): code is string => Boolean(code)),
    }));
  }

  private assertPermissionCodes(codes: string[]): asserts codes is PermissionCode[] {
    if (!Array.isArray(codes) || codes.some((code) => !isRegisteredPermission(code))) throw Errors.param('包含未注册的权限代码');
  }

  async createRole(input: { code: string; name: string; permissions: string[] }, actorId: string | number) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(input.code)) throw Errors.param('角色代码格式非法');
    if (['super_admin', 'regulation_admin', 'employee'].includes(input.code)) throw Errors.param('系统角色代码不可重复创建');
    let role: SysRole;
    try {
      role = await this.dataSource.transaction(async (manager) => {
        const roleRepo = manager.getRepository(SysRole);
        const permissionRepo = manager.getRepository(SysPermission);
        const rolePermissionRepo = manager.getRepository(SysRolePermission);
        const created = await roleRepo.save(roleRepo.create({ code: input.code, name: input.name.trim(), isSystem: 0, status: 1 }));
        // Validate after the parent row is written so an invalid permission
        // proves the whole transaction rolls back, rather than only rejecting
        // before entering the transaction.
        this.assertPermissionCodes(input.permissions);
        const permissions = input.permissions.length ? await permissionRepo.find({ where: { code: In(input.permissions) } }) : [];
        if (permissions.length !== input.permissions.length) throw Errors.param('权限代码不存在');
        if (permissions.length) await rolePermissionRepo.save(permissions.map((permission) => rolePermissionRepo.create({ roleId: created.id, permissionId: permission.id })));
        return created;
      });
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('角色代码已存在');
      throw error;
    }
    this.audit?.log({ actor_id: Number(actorId), actor_name: 'system', action: 'access.role.create', object_type: 'sys_role', object_id: role.id, detail: { code: role.code }, result: 'success', source_ip: null });
    return (await this.listRoles()).find((item) => item.id === String(role.id));
  }

  async updateRole(id: string, input: { name?: string; permissions?: string[]; status?: number }, actorId: string | number) {
    const oldSids: string[] = [];
    const affectedUserIds: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(SysRole);
      // Role updates and assignments use the same lock order: role rows first,
      // then affected user rows. This prevents an assignment committed during
      // the affected-user scan from escaping invalidation.
      const current = await roleRepo.createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id })
        .getOne();
      if (!current) throw Errors.notFound('角色不存在');
      if (current.isSystem) throw Errors.param('系统角色不可编辑');
      if (input.permissions) this.assertPermissionCodes(input.permissions);
      const userRoleRepo = manager.getRepository(SysUserRole);
      const affected = await userRoleRepo.find({ where: { roleId: id }, order: { userId: 'ASC' } });
      const ids = [...new Set(affected.map((link) => String(link.userId)))].sort((a, b) => Number(a) - Number(b));
      const userRepo = manager.getRepository(SysUser);
      const users = ids.length
        ? await userRepo.createQueryBuilder('u')
          .setLock('pessimistic_write')
          .where('u.id IN (:...ids)', { ids })
          .orderBy('u.id', 'ASC')
          .getMany()
        : [];
      const usersById = new Map(users.map((user) => [String(user.id), user]));
      affectedUserIds.push(...ids);
      if (input.name !== undefined) current.name = input.name.trim();
      if (input.status !== undefined) current.status = input.status ? 1 : 0;
      await roleRepo.save(current);
      if (input.permissions) await this.replaceRolePermissions(id, input.permissions, manager);
      for (const userId of ids) {
        const user = usersById.get(userId);
        if (!user) continue;
        user.authVersion = this.authVersion(user) + 1;
        await userRepo.save(user);
        oldSids.push(...await this.sessions.invalidateUser(manager, user.id));
      }
    });
    await this.sessions.markRevoked(oldSids);
    await Promise.all(affectedUserIds.map((userId) => this.invalidate(userId)));
    this.audit?.log({ actor_id: Number(actorId), actor_name: 'system', action: 'access.role.update', object_type: 'sys_role', object_id: id, detail: {}, result: 'success', source_ip: null });
    return (await this.listRoles()).find((item) => item.id === String(id));
  }

  private async replaceRolePermissions(roleId: string, codes: string[], manager = this.dataSource.manager) {
    const permissionRepo = manager.getRepository(SysPermission);
    const rolePermissionRepo = manager.getRepository(SysRolePermission);
    const permissions = codes.length ? await permissionRepo.find({ where: { code: In(codes) } }) : [];
    if (permissions.length !== codes.length) throw Errors.param('权限代码不存在');
    await rolePermissionRepo.delete({ roleId });
    if (permissions.length) await rolePermissionRepo.save(permissions.map((permission) => rolePermissionRepo.create({ roleId, permissionId: permission.id })));
  }

  async listAdministrators() {
    const [legacyUsers, links] = await Promise.all([
      this.userRepo.find({ where: [{ role: RoleEnum.SUPER_ADMIN }, { role: RoleEnum.REGULATION_ADMIN }] }),
      this.userRoleRepo.find(),
    ]);
    const linkedIds = [...new Set(links.map((link) => String(link.userId)))];
    const linkedUsers = linkedIds.length ? await this.userRepo.find({ where: { id: In(linkedIds) } }) : [];
    const users = [...new Map([...legacyUsers, ...linkedUsers].map((user) => [String(user.id), user])).values()];
    return Promise.all(users.map(async (user) => {
      let links = await this.userRoleRepo.find({ where: { userId: user.id } });
      if (!links.length && user.role !== RoleEnum.EMPLOYEE && Number(user.rolesConfigured || 0) === 0) {
        const legacyRole = await this.roleRepo.findOne({ where: { code: user.role } });
        if (legacyRole) links = [{ roleId: legacyRole.id } as SysUserRole];
      }
      return {
        id: String(user.id), username: user.username, real_name: user.realName,
        system_role: user.role, status: user.status, last_login_at: user.lastLoginAt,
        role_ids: links.map((link) => String(link.roleId)), permissions: await this.permissions(user.id),
      };
    }));
  }

  async assignRoles(userId: string, roleIds: string[], actorId: string | number) {
    const uniqueRoleIds = [...new Set(roleIds.map(String))];
    if (uniqueRoleIds.length !== roleIds.length) throw Errors.param('角色不可重复选择');
    const oldSids: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(SysUser);
      const roleRepo = manager.getRepository(SysRole);
      const userRoleRepo = manager.getRepository(SysUserRole);
      // Match updateRole's deterministic role -> user lock order. A role
      // update therefore cannot miss this assignment while collecting users.
      const currentRoles = uniqueRoleIds.length
        ? await roleRepo.createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id IN (:...roleIds)', { roleIds: uniqueRoleIds })
          .orderBy('r.id', 'ASC')
          .getMany()
        : [];
      if (currentRoles.length !== uniqueRoleIds.length || currentRoles.some((role) => role.status !== 1 || role.isSystem)) {
        throw Errors.param('只能分配启用的业务角色');
      }
      const current = await userRepo.createQueryBuilder('u')
        .setLock('pessimistic_write')
        .where('u.id = :userId', { userId })
        .getOne();
      if (!current) throw Errors.notFound('管理员不存在');
      if (current.role === RoleEnum.SUPER_ADMIN && Number(current.id) === 1 && uniqueRoleIds.length === 0) throw Errors.lastSuperAdmin();
      current.rolesConfigured = 1;
      current.authVersion = this.authVersion(current) + 1;
      await userRepo.save(current);
      await userRoleRepo.delete({ userId });
      if (currentRoles.length) await userRoleRepo.save(currentRoles.map((role) => userRoleRepo.create({ userId, roleId: role.id })));
      oldSids.push(...await this.sessions.invalidateUser(manager, userId));
    });
    await this.sessions.markRevoked(oldSids);
    await this.invalidate(userId);
    this.audit?.log({ actor_id: Number(actorId), actor_name: 'system', action: 'access.administrator.roles', object_type: 'sys_user', object_id: userId, detail: { role_ids: roleIds }, result: 'success', source_ip: null });
  }
}
