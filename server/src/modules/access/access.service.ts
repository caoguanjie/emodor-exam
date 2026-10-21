import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
    private readonly audit?: AuditService,
    private readonly config?: AppConfig,
  ) {}

  private cacheKey(userId: string | number) {
    return `access:permissions:${String(userId)}`;
  }

  async invalidate(userId: string | number): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
  }

  /** 返回当前用户的有效权限；显式业务角色关系存在时覆盖旧三角色默认矩阵。 */
  async permissions(userId: string | number): Promise<string[]> {
    const cached = await this.redis.get(this.cacheKey(userId));
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
      } catch { /* cache corruption is ignored and repaired below */ }
    }

    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user || user.status === 0) return [];

    let effective: string[];
    if (user.role === RoleEnum.SUPER_ADMIN) {
      effective = [...PERMISSION_CATALOG];
    } else {
      const links = await this.userRoleRepo.find({ where: { userId: String(userId) } });
      if (links.length === 0 && user.role === RoleEnum.REGULATION_ADMIN) {
        // 兼容既有种子管理员；一旦配置了业务角色，就只使用显式授权。
        effective = [...LEGACY_REGULATION_ADMIN_PERMISSIONS];
      } else if (links.length === 0) {
        effective = [];
      } else {
        const roleIds = links.map((link) => String(link.roleId));
        const roles = await this.roleRepo.find({ where: { id: In(roleIds), status: 1 } });
        const rolePermissionRows = roles.length
          ? await this.rolePermissionRepo.find({ where: { roleId: In(roles.map((role) => role.id)) } })
          : [];
        const permissionIds = [...new Set(rolePermissionRows.map((row) => String(row.permissionId)))];
        const permissionRows = permissionIds.length
          ? await this.permissionRepo.find({ where: { id: In(permissionIds) } })
          : [];
        effective = permissionRows.map((permission) => permission.code).filter(isRegisteredPermission);
      }
    }
    effective = [...new Set(effective)].sort();
    await this.redis.set(this.cacheKey(userId), JSON.stringify(effective), CACHE_TTL_SECONDS);
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
    this.assertPermissionCodes(input.permissions);
    if (['super_admin', 'regulation_admin', 'employee'].includes(input.code)) throw Errors.param('系统角色代码不可重复创建');
    let role: SysRole;
    try {
      role = await this.roleRepo.save(this.roleRepo.create({ code: input.code, name: input.name.trim(), isSystem: 0, status: 1 }));
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('角色代码已存在');
      throw error;
    }
    await this.replaceRolePermissions(String(role.id), input.permissions);
    this.audit?.log({ actor_id: Number(actorId), actor_name: 'system', action: 'access.role.create', object_type: 'sys_role', object_id: role.id, detail: { code: role.code }, result: 'success', source_ip: null });
    return (await this.listRoles()).find((item) => item.id === String(role.id));
  }

  async updateRole(id: string, input: { name?: string; permissions?: string[]; status?: number }, actorId: string | number) {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw Errors.notFound('角色不存在');
    if (role.isSystem) throw Errors.param('系统角色不可编辑');
    if (input.permissions) this.assertPermissionCodes(input.permissions);
    if (input.name !== undefined) role.name = input.name.trim();
    if (input.status !== undefined) role.status = input.status ? 1 : 0;
    await this.roleRepo.save(role);
    if (input.permissions) await this.replaceRolePermissions(id, input.permissions);
    await this.invalidateUsersWithRole(id);
    this.audit?.log({ actor_id: Number(actorId), actor_name: 'system', action: 'access.role.update', object_type: 'sys_role', object_id: id, detail: {}, result: 'success', source_ip: null });
    return (await this.listRoles()).find((item) => item.id === String(id));
  }

  private async replaceRolePermissions(roleId: string, codes: string[]) {
    const permissions = codes.length ? await this.permissionRepo.find({ where: { code: In(codes) } }) : [];
    if (permissions.length !== codes.length) throw Errors.param('权限代码不存在');
    await this.rolePermissionRepo.delete({ roleId });
    if (permissions.length) await this.rolePermissionRepo.save(permissions.map((permission) => this.rolePermissionRepo.create({ roleId, permissionId: permission.id })));
  }

  private async invalidateUsersWithRole(roleId: string) {
    const links = await this.userRoleRepo.find({ where: { roleId } });
    await Promise.all(links.map((link) => this.invalidate(link.userId)));
  }

  async listAdministrators() {
    const users = await this.userRepo.find({ where: [{ role: RoleEnum.SUPER_ADMIN }, { role: RoleEnum.REGULATION_ADMIN }] });
    return Promise.all(users.map(async (user) => {
      let links = await this.userRoleRepo.find({ where: { userId: user.id } });
      if (!links.length && user.role !== RoleEnum.EMPLOYEE) {
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
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw Errors.notFound('管理员不存在');
    const roles = roleIds.length ? await this.roleRepo.find({ where: { id: In(roleIds), status: 1 } }) : [];
    if (roles.length !== roleIds.length) throw Errors.param('角色不存在或已停用');
    const isSuper = roles.some((role) => role.code === RoleEnum.SUPER_ADMIN);
    if (Number(user.id) === 1 && !isSuper) throw Errors.lastSuperAdmin();
    if (user.role === RoleEnum.SUPER_ADMIN && !isSuper) {
      const activeSuperCount = await this.userRepo.count({ where: { role: RoleEnum.SUPER_ADMIN, status: 1 } });
      if (activeSuperCount <= 1) throw Errors.lastSuperAdmin();
    }
    const systemRole = [RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN, RoleEnum.EMPLOYEE]
      .map((code) => roles.find((role) => role.code === code))
      .find((role): role is SysRole => Boolean(role));
    if (systemRole) user.role = systemRole.code;
    else if (roles.length === 0) user.role = RoleEnum.EMPLOYEE;
    await this.userRepo.save(user);
    await this.userRoleRepo.delete({ userId });
    if (roles.length) await this.userRoleRepo.save(roles.map((role) => this.userRoleRepo.create({ userId, roleId: role.id })));
    await this.invalidate(userId);
    this.audit?.log({ actor_id: Number(actorId), actor_name: 'system', action: 'access.administrator.roles', object_type: 'sys_user', object_id: userId, detail: { role_ids: roleIds }, result: 'success', source_ip: null });
  }
}
