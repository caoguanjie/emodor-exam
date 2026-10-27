import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AppConfig } from '../../config/configuration';
import { Errors, RoleEnum } from '../../common/errors';
import { validatePasswordStrength } from '../../common/password-policy';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import { SysUser } from '../../entities/sys-user.entity';
import { SysRole } from '../../entities/sys-role.entity';
import { SysPermission } from '../../entities/sys-permission.entity';
import { SysRolePermission } from '../../entities/sys-role-permission.entity';
import { SysUserRole } from '../../entities/sys-user-role.entity';
import { SysMenu } from '../../entities/sys-menu.entity';
import { AuthSession } from '../../entities/auth-session.entity';
import { SessionService } from '../auth/session.service';
import { normalizeOptionalChinaMobile } from '../auth/phone';
import {
  LEGACY_REGULATION_ADMIN_PERMISSIONS,
  CONFIGURABLE_PERMISSION_CATALOG,
  LEGACY_AGGREGATE_PERMISSIONS,
  PERMISSION_NAMES,
  PermissionCode,
  isRegisteredPermission,
} from './permission-catalog';

const CACHE_TTL_SECONDS = 60;
const ADMINISTRATOR_SELECT = [
  'u.id', 'u.username', 'u.realName', 'u.phone', 'u.email', 'u.role', 'u.status',
  'u.loginCount', 'u.lastLoginIp', 'u.lastLoginAt', 'u.createdAt', 'u.rolesConfigured', 'u.deletedAt',
];
type AdministratorActor = { id: number; name: string; role: string };
type RoleMutationActor = string | number | { id: string | number; name: string; sourceIp?: string | null };

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
      ? `access:permissions:v2:${String(userId)}`
      : `access:permissions:v2:${String(userId)}:${authVersion}`;
  }

  private authVersion(user: SysUser): number {
    return Number.isInteger(Number(user.authVersion)) ? Number(user.authVersion) : 0;
  }

  private roleMutationActor(actor: RoleMutationActor) {
    if (typeof actor === 'object') {
      return { id: actor.id, name: actor.name, sourceIp: actor.sourceIp || null };
    }
    return { id: Number(actor), name: `user:${String(actor)}`, sourceIp: null };
  }

  async invalidate(userId: string | number): Promise<void> {
    // Both schema and user generation scope permission caches. A new schema
    // ignores pre-upgrade caches without revoking equivalent user sessions;
    // auth_version isolates subsequent explicit permission changes.
    await this.redis.del(this.cacheKey(userId));
  }

  /** 返回当前用户的有效权限；显式业务角色关系存在时覆盖旧三角色默认矩阵。 */
  async permissions(userId: string | number, options: { manager?: EntityManager; useCache?: boolean } = {}): Promise<string[]> {
    const userRepo = options.manager?.getRepository(SysUser) || this.userRepo;
    // Read the authoritative user generation before consulting Redis. A role
    // mutation changes auth_version in the same transaction as its links, so
    // a current token can never inherit a prior generation's cached matrix.
    const user = await userRepo.findOne({ where: { id: String(userId) } });
    if (!user || user.status === 0 || user.deletedAt) return [];
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
      effective = [...CONFIGURABLE_PERMISSION_CATALOG];
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
        effective = permissionRows.map((permission) => permission.code)
          .filter((code) => isRegisteredPermission(code) && !LEGACY_AGGREGATE_PERMISSIONS.includes(code));
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
    return CONFIGURABLE_PERMISSION_CATALOG.map((code) => ({ code, name: PERMISSION_NAMES[code] }));
  }

  async listRoles() {
    const roles = await this.roleRepo.find({ order: { id: 'ASC' } });
    return this.roleViews(roles);
  }

  async listRolePage(query: { page?: number; page_size?: number; keyword?: string } = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 10)));
    const qb = this.roleRepo.createQueryBuilder('r');
    const keyword = String(query.keyword || '').trim();
    if (keyword) qb.where('r.name LIKE :keyword', { keyword: `%${keyword}%` });
    const total = await qb.getCount();
    const roles = await qb.orderBy('r.id', 'ASC').skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items: await this.roleViews(roles), total, page, page_size: pageSize };
  }

  private async roleViews(roles: SysRole[]) {
    if (!roles.length) return [];
    const links = await this.rolePermissionRepo.find({ where: { roleId: In(roles.map((role) => role.id)) } });
    const permissionIds = [...new Set(links.map((link) => String(link.permissionId)))];
    const permissions = permissionIds.length ? await this.permissionRepo.find({ where: { id: In(permissionIds) } }) : [];
    const byId = new Map(permissions.map((permission) => [String(permission.id), permission.code]));
    return roles.map((role) => ({
      id: String(role.id), code: role.code, name: role.name, remark: role.remark ?? null,
      is_system: Boolean(role.isSystem), status: role.status,
      created_at: role.createdAt, updated_at: role.updatedAt,
      permissions: links.filter((link) => String(link.roleId) === String(role.id))
        .map((link) => byId.get(String(link.permissionId))).filter((code): code is string => Boolean(code)),
    }));
  }

  async getRole(id: string) {
    if (!/^[1-9]\d*$/.test(id)) throw Errors.notFound('角色不存在');
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw Errors.notFound('角色不存在');
    return (await this.roleViews([role]))[0];
  }

  async rolePermissionTree() {
    const menus = await this.dataSource.getRepository(SysMenu).find({ order: { sort: 'ASC', id: 'ASC' } });
    return {
      menus: menus.map((menu) => ({
        id: String(menu.id), parent_id: menu.parentId === null ? null : String(menu.parentId),
        name: menu.name, type: menu.type, permission_code: menu.permissionCode,
        sort: Number(menu.sort), status: Number(menu.status),
      })),
      permissions: await this.catalog(),
    };
  }

  /** Administrator create/edit forms need only enabled business-role identities. */
  async listAssignableRoles() {
    const roles = await this.roleRepo.find({ where: { isSystem: 0, status: 1 }, order: { id: 'ASC' } });
    return roles.map((role) => ({
      id: String(role.id), code: role.code, name: role.name,
      status: Number(role.status), is_system: Boolean(role.isSystem),
    }));
  }

  private assertPermissionCodes(codes: string[]): asserts codes is PermissionCode[] {
    if (!Array.isArray(codes) || codes.some((code) => !isRegisteredPermission(code))) throw Errors.param('包含未注册的权限代码');
    if (new Set(codes).size !== codes.length) throw Errors.param('权限代码不可重复');
  }

  private rolePermissionCodes(codes: string[], mode: 'legacy' | 'granular'): PermissionCode[] {
    this.assertPermissionCodes(codes);
    if (mode === 'granular') {
      if (codes.some((code) => LEGACY_AGGREGATE_PERMISSIONS.includes(code))) throw Errors.param('请使用独立按钮权限，不能保存旧聚合权限');
      return [...codes];
    }
    const expansions: Partial<Record<PermissionCode, PermissionCode[]>> = {
      'administrators:write': ['administrators:create', 'administrators:update', 'administrators:delete', 'administrators:reset_password'],
      'roles:write': ['roles:create', 'roles:update', 'roles:delete', 'roles:permissions'],
      'system_settings:read': ['system_settings:read', 'menus:read'],
      'system_settings:write': ['system_settings:write', 'menus:create', 'menus:update', 'menus:delete'],
    };
    return [...new Set(codes.flatMap((code) => expansions[code] || [code]))];
  }

  private roleName(value: string) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) throw Errors.param('角色名称必填且不超过 128 字符');
    return value.trim();
  }

  private roleRemark(value: string | null | undefined) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.length > 500) throw Errors.param('角色备注不能超过 500 字符');
    return value.trim() || null;
  }

  private roleWriteError(error: any): never {
    if (String(error?.code) === 'ER_DUP_ENTRY') {
      const duplicate = String(error?.constraint || error?.sqlMessage || error?.message || '');
      throw Errors.param(duplicate.includes('uk_sys_role_name') ? '角色名称已存在' : '角色代码已存在');
    }
    throw error;
  }

  async createRole(input: { code?: string; name: string; remark?: string | null; permissions?: string[]; status?: number }, actorInput: RoleMutationActor) {
    const code = input.code === undefined ? `r_${randomUUID().replace(/-/g, '')}` : input.code;
    if (typeof code !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(code)) throw Errors.param('角色代码格式非法');
    if (['super_admin', 'regulation_admin', 'employee'].includes(code)) throw Errors.param('系统角色代码不可重复创建');
    const name = this.roleName(input.name);
    const remark = this.roleRemark(input.remark);
    this.assertAdministratorStatus(input.status);
    const codes = this.rolePermissionCodes(input.permissions === undefined ? [] : input.permissions, 'legacy');
    let role: SysRole;
    try {
      role = await this.dataSource.transaction(async (manager) => {
        const roleRepo = manager.getRepository(SysRole);
        const permissionRepo = manager.getRepository(SysPermission);
        const rolePermissionRepo = manager.getRepository(SysRolePermission);
        if (await roleRepo.findOne({ where: { name } })) throw Errors.param('角色名称已存在');
        const now = new Date();
        const created = await roleRepo.save(roleRepo.create({ code, name, remark, isSystem: 0, status: input.status ?? 1, createdAt: now, updatedAt: now }));
        const permissions = codes.length ? await permissionRepo.find({ where: { code: In(codes) } }) : [];
        if (permissions.length !== codes.length) throw Errors.param('权限代码不存在');
        if (permissions.length) await rolePermissionRepo.save(permissions.map((permission) => rolePermissionRepo.create({ roleId: created.id, permissionId: permission.id })));
        return created;
      });
    } catch (error: any) {
      this.roleWriteError(error);
    }
    const actor = this.roleMutationActor(actorInput);
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action: 'access.role.create', object_type: 'sys_role', object_id: role.id, detail: { code: role.code, name: role.name }, result: 'success', source_ip: actor.sourceIp });
    return (await this.listRoles()).find((item) => item.id === String(role.id));
  }

  async updateRole(id: string, input: { name?: string; remark?: string | null; permissions?: string[]; status?: number }, actorInput: RoleMutationActor, mode: 'legacy' | 'granular' = 'legacy') {
    const name = input.name === undefined ? undefined : this.roleName(input.name);
    const remark = input.remark === undefined ? undefined : this.roleRemark(input.remark);
    this.assertAdministratorStatus(input.status);
    const codes = input.permissions === undefined ? undefined : this.rolePermissionCodes(input.permissions, mode);
    const oldSids: string[] = [];
    const affectedUserIds: string[] = [];
    let auditDetail: Record<string, unknown> = {};
    try {
      await this.dataSource.transaction(async (manager) => {
        const roleRepo = manager.getRepository(SysRole);
        // Role definition updates and administrator account updates use the same
        // lock order: role rows first, then affected user rows. This prevents an
        // account update committed during the affected-user scan from escaping
        // session invalidation.
        const current = await roleRepo.createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id })
          .getOne();
        if (!current) throw Errors.notFound('角色不存在');
        if (current.isSystem) throw Errors.param('系统角色不可编辑');
        const changes: Record<string, { before: unknown; after: unknown }> = {};
        if (name !== undefined) {
          const duplicate = await roleRepo.findOne({ where: { name } });
          if (duplicate && String(duplicate.id) !== id) throw Errors.param('角色名称已存在');
          if (name !== current.name) changes.name = { before: current.name, after: name };
        }
        if (remark !== undefined && remark !== current.remark) changes.remark = { before: current.remark, after: remark };
        if (input.status !== undefined && input.status !== Number(current.status)) {
          changes.status = { before: Number(current.status), after: input.status };
        }
        let permissionsChanged = false;
        if (codes !== undefined) {
          const rows = await manager.getRepository(SysRolePermission).find({ where: { roleId: id } });
          const permissionIds = [...new Set(rows.map((row) => String(row.permissionId)))];
          const permissions = permissionIds.length ? await manager.getRepository(SysPermission).find({ where: { id: In(permissionIds) } }) : [];
          const previous = [...new Set(permissions.map((permission) => permission.code))].sort();
          const next = [...codes].sort();
          permissionsChanged = previous.length !== next.length || previous.some((code, index) => code !== next[index]);
          if (permissionsChanged) changes.permissions = { before: previous, after: next };
        }
        const authorizationChanged = permissionsChanged || (input.status !== undefined && input.status !== Number(current.status));
        const userRoleRepo = manager.getRepository(SysUserRole);
        const affected = authorizationChanged ? await userRoleRepo.find({ where: { roleId: id }, order: { userId: 'ASC' } }) : [];
        const ids = [...new Set(affected.map((link) => String(link.userId)))].sort((a, b) => (
          a.length - b.length || a.localeCompare(b)
        ));
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
        if (name !== undefined) current.name = name;
        if (remark !== undefined) current.remark = remark;
        if (input.status !== undefined) current.status = input.status;
        current.updatedAt = new Date();
        await roleRepo.save(current);
        if (permissionsChanged) await this.replaceRolePermissions(id, codes!, manager);
        auditDetail = { name: current.name, changes };
        for (const userId of ids) {
          const user = usersById.get(userId);
          if (!user) continue;
          user.authVersion = this.authVersion(user) + 1;
          await userRepo.save(user);
          oldSids.push(...await this.sessions.invalidateUser(manager, user.id));
        }
      });
    } catch (error: any) {
      this.roleWriteError(error);
    }
    if (affectedUserIds.length) {
      await this.sessions.markRevoked(oldSids);
      await Promise.all(affectedUserIds.map((userId) => this.invalidate(userId)));
    }
    const actor = this.roleMutationActor(actorInput);
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action: 'access.role.update', object_type: 'sys_role', object_id: id, detail: auditDetail, result: 'success', source_ip: actor.sourceIp });
    return (await this.listRoles()).find((item) => item.id === String(id));
  }

  async setRolePermissions(id: string, codes: string[], actorInput: RoleMutationActor) {
    return this.updateRole(id, { permissions: codes }, actorInput, 'granular');
  }

  async deleteRole(id: string, actorInput: RoleMutationActor) {
    if (!/^[1-9]\d*$/.test(id)) throw Errors.notFound('角色不存在');
    let detail: Record<string, unknown> = {};
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SysRole);
      const role = await repo.createQueryBuilder('r').setLock('pessimistic_write').where('r.id = :id', { id }).getOne();
      if (!role) throw Errors.notFound('角色不存在');
      if (role.isSystem) throw Errors.param('系统角色不可删除');
      // All links count, including links retained by logically deleted accounts.
      if (await manager.getRepository(SysUserRole).count({ where: { roleId: id } })) throw Errors.param('角色仍有关联账号，不能删除');
      detail = { name: role.name, before: { code: role.code, name: role.name, status: Number(role.status) } };
      await manager.getRepository(SysRolePermission).delete({ roleId: id });
      await repo.delete({ id });
    });
    const actor = this.roleMutationActor(actorInput);
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action: 'access.role.delete', object_type: 'sys_role', object_id: id, detail, result: 'success', source_ip: actor.sourceIp });
  }

  private async replaceRolePermissions(roleId: string, codes: string[], manager = this.dataSource.manager) {
    const permissionRepo = manager.getRepository(SysPermission);
    const rolePermissionRepo = manager.getRepository(SysRolePermission);
    const permissions = codes.length ? await permissionRepo.find({ where: { code: In(codes) } }) : [];
    if (permissions.length !== codes.length) throw Errors.param('权限代码不存在');
    await rolePermissionRepo.delete({ roleId });
    if (permissions.length) await rolePermissionRepo.save(permissions.map((permission) => rolePermissionRepo.create({ roleId, permissionId: permission.id })));
  }

  async listAdministrators(query: { page?: number; page_size?: number; keyword?: string } = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 10)));
    const qb = this.userRepo.createQueryBuilder('u').select(ADMINISTRATOR_SELECT)
      .where('u.deleted_at IS NULL')
      .andWhere('(u.role IN (:...systemRoles) OR EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id = u.id))', {
        systemRoles: [RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN],
      });
    const keyword = String(query.keyword || '').trim();
    if (keyword) qb.andWhere('(u.username LIKE :keyword OR u.real_name LIKE :keyword OR u.phone LIKE :keyword)', { keyword: `%${keyword}%` });
    const total = await qb.getCount();
    const rows = await qb.orderBy('u.id', 'ASC').skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items: await Promise.all(rows.map((user) => this.administratorView(user))), total, page, page_size: pageSize };
  }

  private async administratorView(user: SysUser, assignedLinks?: SysUserRole[]) {
    let links = assignedLinks || await this.userRoleRepo.find({ where: { userId: String(user.id) } });
    if (!links.length && user.role !== RoleEnum.EMPLOYEE && Number(user.rolesConfigured || 0) === 0) {
      const legacyRole = await this.roleRepo.findOne({ where: { code: user.role } });
      if (legacyRole) links = [{ roleId: legacyRole.id } as SysUserRole];
    }
    return {
      id: String(user.id), username: user.username, real_name: user.realName,
      phone: user.phone, email: user.email, system_role: user.role, status: Number(user.status),
      login_count: Number(user.loginCount || 0), last_login_ip: user.lastLoginIp,
      last_login_at: user.lastLoginAt, created_at: user.createdAt,
      role_ids: links.map((link) => String(link.roleId)), permissions: await this.permissions(user.id),
    };
  }

  /** Repeat identity classification under the same user lock used by student mutations. */
  private async managedAdministrator(id: string, manager?: EntityManager) {
    if (!/^[1-9]\d*$/.test(id)) throw Errors.notFound('管理员不存在');
    const repo = manager?.getRepository(SysUser) || this.userRepo;
    const qb = repo.createQueryBuilder('u');
    if (manager) qb.setLock('pessimistic_write');
    else qb.select(ADMINISTRATOR_SELECT);
    const user = await qb.where('u.id = :id', { id }).getOne();
    if (!user || user.deletedAt) throw Errors.notFound('管理员不存在');
    const links = await (manager?.getRepository(SysUserRole) || this.userRoleRepo).find({ where: { userId: id } });
    if (user.role !== RoleEnum.SUPER_ADMIN && user.role !== RoleEnum.REGULATION_ADMIN && !links.length) {
      throw Errors.notFound('管理员不存在');
    }
    return { user, links };
  }

  async getAdministrator(id: string) {
    const { user, links } = await this.managedAdministrator(id);
    return this.administratorView(user, links);
  }

  private administratorRoleIds(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) || new Set(value).size !== value.length) {
      throw Errors.param('管理员必须选择至少一个不重复的业务角色');
    }
    return value;
  }

  private async lockAdministratorRoles(manager: EntityManager, roleIds: string[]) {
    return manager.getRepository(SysRole).createQueryBuilder('r').setLock('pessimistic_write')
      .where('r.id IN (:...roleIds)', { roleIds }).orderBy('r.id', 'ASC').getMany();
  }

  private assertSuperAdministratorActor(user: SysUser, actor: AdministratorActor) {
    if (user.role === RoleEnum.SUPER_ADMIN && actor.role !== RoleEnum.SUPER_ADMIN) throw Errors.forbidden();
  }

  private assertAdministratorStatus(status: unknown) {
    if (status !== undefined && status !== 0 && status !== 1) throw Errors.param('status 只能为数字 0 或 1');
  }

  private async finishAdministratorMutation(id: string, oldSids: string[], block: boolean, disabled = false) {
    await this.sessions.markRevoked(oldSids);
    await this.invalidate(id);
    if (block) {
      await this.redis.setUserBlock(Number(id), Math.floor(Date.now() / 1000) + (disabled ? 1 : 0), (this.config?.jwt.refreshExpiresDays || 7) * 86400);
    }
  }

  async updateAdministrator(id: string, input: { real_name?: string; phone?: string | null; role_ids?: string[]; status?: number }, actor: AdministratorActor, sourceIp: string | null) {
    this.assertAdministratorStatus(input.status);
    const roleIds = input.role_ids === undefined ? undefined : this.administratorRoleIds(input.role_ids);
    const oldSids: string[] = [];
    try {
      await this.dataSource.transaction(async (manager) => {
        // Role writers take these locks before scanning users. Never reverse this order.
        const roles = roleIds ? await this.lockAdministratorRoles(manager, roleIds) : [];
        const { user, links } = await this.managedAdministrator(id, manager);
        this.assertSuperAdministratorActor(user, actor);
        if (input.status === 0 && (String(actor.id) === String(user.id) || user.role === RoleEnum.SUPER_ADMIN)) {
          throw Errors.param('不能禁用本人或超级管理员');
        }
        if (user.role === RoleEnum.SUPER_ADMIN) {
          if (roleIds !== undefined) throw Errors.param('超级管理员不可配置业务角色');
        } else {
          if (!roleIds) throw Errors.param('管理员必须选择至少一个业务角色');
          const existingIds = new Set(links.map((link) => String(link.roleId)));
          if (roles.length !== roleIds.length || roles.some((role) => role.isSystem || (role.status !== 1 && !existingIds.has(String(role.id))))) {
            throw Errors.param('只能新增启用的非系统业务角色；既有停用角色可以保留');
          }
        }
        if (input.real_name !== undefined) user.realName = input.real_name.trim();
        if (input.phone !== undefined) user.phone = normalizeOptionalChinaMobile(input.phone);
        if (input.status !== undefined) user.status = input.status;
        if (user.role !== RoleEnum.SUPER_ADMIN) {
          user.rolesConfigured = 1;
          const linkRepo = manager.getRepository(SysUserRole);
          await linkRepo.delete({ userId: id });
          await linkRepo.save(roleIds!.map((roleId) => linkRepo.create({ userId: id, roleId })));
        }
        user.authVersion = this.authVersion(user) + 1;
        await manager.getRepository(SysUser).save(user);
        oldSids.push(...await this.sessions.invalidateUser(manager, id));
      });
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('手机号已存在');
      throw error;
    }
    await this.finishAdministratorMutation(id, oldSids, input.status === 0, input.status === 0);
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action: 'access.administrator.update', object_type: 'sys_user', object_id: id, detail: { role_ids: roleIds, status: input.status }, result: 'success', source_ip: sourceIp });
    return this.getAdministrator(id);
  }

  async resetAdministratorPassword(id: string, input: { password: string }, actor: AdministratorActor, sourceIp: string | null) {
    if (String(actor.id) === id) throw Errors.param('请通过本人修改密码入口修改当前账号密码');
    const oldSids: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const { user } = await this.managedAdministrator(id, manager);
      this.assertSuperAdministratorActor(user, actor);
      if (typeof input.password !== 'string' || !/^(?=.*[A-Za-z])(?=.*\d)\S{8,128}$/.test(input.password)) throw Errors.param('密码须为 8—128 位且含字母和数字');
      validatePasswordStrength(input.password, user, '新密码');
      user.passwordHash = await bcrypt.hash(input.password, 12);
      user.forcePasswordChange = 1;
      user.authVersion = this.authVersion(user) + 1;
      await manager.getRepository(SysUser).save(user);
      oldSids.push(...await this.sessions.invalidateUser(manager, id));
    });
    await this.finishAdministratorMutation(id, oldSids, true);
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action: 'access.administrator.reset_password', object_type: 'sys_user', object_id: id, detail: {}, result: 'success', source_ip: sourceIp });
  }

  async deleteAdministrator(id: string, actor: AdministratorActor, sourceIp: string | null) {
    const oldSids: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const { user } = await this.managedAdministrator(id, manager);
      if (String(actor.id) === String(user.id) || user.role === RoleEnum.SUPER_ADMIN) throw Errors.param('不能删除本人或超级管理员');
      user.status = 0;
      user.deletedAt = new Date();
      user.authVersion = this.authVersion(user) + 1;
      // Keep identity and role links so the account cannot fall into student management.
      await manager.getRepository(SysUser).save(user);
      oldSids.push(...await this.sessions.invalidateUser(manager, id));
    });
    await this.finishAdministratorMutation(id, oldSids, true, true);
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action: 'access.administrator.delete', object_type: 'sys_user', object_id: id, detail: {}, result: 'success', source_ip: sourceIp });
  }

  async createAdministrator(input: {
    username: string;
    password: string;
    real_name?: string;
    phone?: string | null;
    email?: string | null;
    role_ids: string[];
    status?: number;
  }, actor: { id: number; name: string }, sourceIp: string | null) {
    const roleIds = this.administratorRoleIds(input.role_ids);
    this.assertAdministratorStatus(input.status);
    const username = input.username.trim();
    const realName = input.real_name?.trim() || '';
    if (!username) throw Errors.param('管理员用户名不能为空');
    validatePasswordStrength(input.password, { username, realName }, '初始密码');
    const passwordHash = await bcrypt.hash(input.password, 12);
    let created!: SysUser;
    try {
      await this.dataSource.transaction(async (manager) => {
        const roleRepo = manager.getRepository(SysRole);
        const roles = await roleRepo.createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id IN (:...roleIds)', { roleIds })
          .orderBy('r.id', 'ASC')
          .getMany();
        if (roles.length !== roleIds.length || roles.some((role) => role.status !== 1 || role.isSystem)) {
          throw Errors.param('只能分配启用的非系统业务角色');
        }
        const userRepo = manager.getRepository(SysUser);
        const now = new Date();
        created = await userRepo.save(userRepo.create({
          username,
          passwordHash,
          realName,
          employeeNo: null,
          departmentId: null,
          categoryId: null,
          source: null,
          role: RoleEnum.EMPLOYEE,
          phone: normalizeOptionalChinaMobile(input.phone),
          email: input.email?.trim() || null,
          status: input.status ?? 1,
          authVersion: 0,
          forcePasswordChange: 1,
          loginCount: 0,
          lastLoginAt: null,
          lastLoginIp: null,
          rolesConfigured: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        }));
        const userRoleRepo = manager.getRepository(SysUserRole);
        await userRoleRepo.save(roleIds.map((roleId) => userRoleRepo.create({
          userId: String(created.id), roleId,
        })));
      });
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') {
        const duplicate = String(error?.constraint || error?.sqlMessage || error?.message || '');
        throw Errors.param(duplicate.includes('uk_sys_user_phone') ? '手机号已存在' : '用户名已存在');
      }
      throw error;
    }
    await this.invalidate(created.id);
    const permissions = await this.permissions(created.id, { useCache: false });
    this.audit?.log({
      actor_id: actor.id,
      actor_name: actor.name,
      action: 'access.administrator.create',
      object_type: 'sys_user',
      object_id: String(created.id),
      detail: { role_ids: roleIds },
      result: 'success',
      source_ip: sourceIp,
    });
    return {
      id: String(created.id),
      username: created.username,
      real_name: created.realName,
      system_role: created.role,
      status: Number(created.status),
      last_login_at: created.lastLoginAt,
      role_ids: roleIds,
      permissions,
    };
  }

}
