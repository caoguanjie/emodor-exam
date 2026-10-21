import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SysUser } from '../../entities/sys-user.entity';
import { SysDepartment } from '../../entities/sys-department.entity';
import { Errors, RoleEnum, Role } from '../../common/errors';
import { DepartmentService } from '../departments/department.service';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import { AppConfig } from '../../config/configuration';
import { validatePasswordStrength } from '../../common/password-policy';
import { CategoryService } from '../training/category.service';
import { SessionService } from '../auth/session.service';
import { AccessService } from '../access/access.service';

const VALID_ROLES: Role[] = [RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN, RoleEnum.EMPLOYEE];

/** 员工管理子服务（05 册 2.4.4）：CRUD / 禁用 / 重置密码，唯一性与角色枚举校验 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly dataSource: DataSource,
    private readonly departments: DepartmentService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly categories: CategoryService,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
  ) {}

  private authVersion(u: SysUser): number {
    return Number.isInteger(Number(u.authVersion)) ? Number(u.authVersion) : 0;
  }

  sanitize(u: SysUser) {
    return {
      id: Number(u.id),
      username: u.username,
      real_name: u.realName,
      employee_no: u.employeeNo,
      department_id: u.departmentId ? Number(u.departmentId) : null,
      role: u.role,
      phone: u.phone,
      email: u.email,
      status: u.status,
      auth_version: this.authVersion(u),
      force_password_change: u.forcePasswordChange === undefined ? u.lastLoginAt === null : Number(u.forcePasswordChange) === 1,
      login_count: Number(u.loginCount || 0),
      last_login_at: u.lastLoginAt,
      last_login_ip: u.lastLoginIp,
      created_at: u.createdAt,
    };
  }

  private validateRole(role: string) {
    if (!VALID_ROLES.includes(role as Role)) throw Errors.param('角色枚举非法');
  }

  async list(query: { page?: number; page_size?: number; keyword?: string; department_id?: number; role?: string; status?: number }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.userRepo.createQueryBuilder('u');
    if (query.keyword) {
      qb.andWhere('(u.username LIKE :kw OR u.real_name LIKE :kw OR u.employee_no LIKE :kw)', { kw: `%${query.keyword}%` });
    }
    if (query.department_id) {
      // 含子部门展开（部门维度口径一致）
      const ids = await this.departments.expandWithChildren([String(query.department_id)]);
      qb.andWhere('u.department_id IN (:...ids)', { ids: Array.from(ids) });
    }
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.status !== undefined && query.status !== null && (query as any).status !== '') {
      qb.andWhere('u.status = :status', { status: Number(query.status) });
    }
    qb.orderBy('u.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();
    return { list: rows.map((u) => this.sanitize(u)), total, page, page_size: pageSize };
  }

  async detail(id: string) {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw Errors.notFound('员工不存在');
    return this.sanitize(u);
  }

  /** 新培训接口使用字符串 ID 与 Page.items，不改变旧 /users 的 numeric 结构。 */
  private sanitizeStudent(u: SysUser) {
    return {
      id: String(u.id),
      username: u.username,
      real_name: u.realName,
      employee_no: u.employeeNo,
      department_id: u.departmentId ? String(u.departmentId) : null,
      category_id: u.categoryId ? String(u.categoryId) : null,
      source: u.source,
      role: u.role,
      phone: u.phone,
      email: u.email,
      status: Number(u.status),
      last_login_at: u.lastLoginAt,
      created_at: u.createdAt,
    };
  }

  async trainingProfile(userId: string): Promise<{ categoryId: string | null; source: 'institution' | 'external' | null; active: boolean }> {
    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user) throw Errors.notFound('员工不存在');
    return {
      categoryId: user.categoryId ? String(user.categoryId) : null,
      source: user.source === 'institution' || user.source === 'external' ? user.source : null,
      active: Number(user.status) === 1,
    };
  }

  async listStudents(query: { page?: number; page_size?: number; keyword?: string; category_id?: string; source?: string; status?: number }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.userRepo.createQueryBuilder('u').where('u.role = :role', { role: RoleEnum.EMPLOYEE });
    if (query.keyword?.trim()) {
      qb.andWhere('(u.username LIKE :kw OR u.real_name LIKE :kw OR u.employee_no LIKE :kw)', { kw: `%${query.keyword.trim()}%` });
    }
    if (query.category_id) qb.andWhere('u.category_id = :categoryId', { categoryId: String(query.category_id) });
    if (query.source) {
      if (query.source !== 'institution' && query.source !== 'external') throw Errors.param('来源枚举非法');
      qb.andWhere('u.source = :source', { source: query.source });
    }
    if (query.status !== undefined && query.status !== null && (query as any).status !== '') qb.andWhere('u.status = :status', { status: Number(query.status) });
    qb.orderBy('u.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items: rows.map((u) => this.sanitizeStudent(u)), total, page, page_size: pageSize };
  }

  async studentDetail(id: string) {
    const user = await this.userRepo.findOne({ where: { id: String(id), role: RoleEnum.EMPLOYEE } });
    if (!user) throw Errors.notFound('学员不存在');
    return this.sanitizeStudent(user);
  }

  async selfProfile(id: string) {
    const user = await this.userRepo.findOne({ where: { id: String(id) } });
    if (!user) throw Errors.notFound('员工不存在');
    return this.sanitizeStudent(user);
  }

  private assertLearnerSource(source: string): asserts source is 'institution' | 'external' {
    if (source !== 'institution' && source !== 'external') throw Errors.param('来源必须是 institution 或 external');
  }

  async createStudent(input: { username: string; password: string; real_name: string; category_id: string; source: 'institution' | 'external'; employee_no?: string | null; department_id?: string | null; phone?: string | null; email?: string | null }, actor: { id: number; name: string }, ip: string | null) {
    this.assertLearnerSource(input.source);
    validatePasswordStrength(input.password, { username: input.username, employeeNo: input.employee_no, realName: input.real_name }, '初始密码');
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        await this.categories.lockActive(manager, input.category_id);
        if (input.department_id) {
          const dept = await manager.getRepository(SysDepartment).findOne({ where: { id: input.department_id } });
          if (!dept) throw Errors.param('部门不存在');
        }
        return manager.getRepository(SysUser).save(manager.getRepository(SysUser).create({
          username: input.username,
          passwordHash,
          realName: input.real_name,
          employeeNo: input.employee_no || null,
          departmentId: input.department_id || null,
          categoryId: String(input.category_id),
          source: input.source,
          role: RoleEnum.EMPLOYEE,
          phone: input.phone || null,
          email: input.email || null,
          status: 1,
          lastLoginAt: null,
        }));
      });
      this.audit.log({
        actor_id: actor.id, actor_name: actor.name, action: 'student.create', object_type: 'sys_user',
        object_id: user.id, detail: { username: user.username, category_id: user.categoryId, source: user.source }, result: 'success', source_ip: ip,
      });
      return this.sanitizeStudent(user);
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') {
        if (String(error?.message || '').includes('uk_employee_no')) throw Errors.param('工号已存在');
        throw Errors.param('用户名已存在');
      }
      throw error;
    }
  }

  async updateStudent(id: string, patch: { real_name?: string; employee_no?: string | null; department_id?: string | null; category_id?: string; source?: 'institution' | 'external'; phone?: string | null; email?: string | null }, actor: { id: number; name: string }, ip: string | null) {
    if (patch.source !== undefined) this.assertLearnerSource(patch.source);
    let user: SysUser;
    try {
      user = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(SysUser);
        const lockedUser = await manager.findOne(SysUser, {
          where: { id: String(id), role: RoleEnum.EMPLOYEE },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedUser) throw Errors.notFound('学员不存在');
        if (patch.category_id !== undefined) await this.categories.lockActive(manager, patch.category_id);
        if (patch.real_name !== undefined) lockedUser.realName = patch.real_name;
        if (patch.employee_no !== undefined) lockedUser.employeeNo = patch.employee_no || null;
        if (patch.department_id !== undefined) {
          if (patch.department_id) {
            const dept = await manager.getRepository(SysDepartment).findOne({ where: { id: patch.department_id } });
            if (!dept) throw Errors.param('部门不存在');
          }
          lockedUser.departmentId = patch.department_id || null;
        }
        if (patch.category_id !== undefined) lockedUser.categoryId = String(patch.category_id);
        if (patch.source !== undefined) lockedUser.source = patch.source;
        if (patch.phone !== undefined) lockedUser.phone = patch.phone || null;
        if (patch.email !== undefined) lockedUser.email = patch.email || null;
        return repo.save(lockedUser);
      });
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('工号已存在');
      throw error;
    }
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'student.update', object_type: 'sys_user',
      object_id: id, detail: { category_id: user.categoryId, source: user.source }, result: 'success', source_ip: ip,
    });
    return this.sanitizeStudent(user);
  }

  async setStudentStatus(id: string, status: 0 | 1, actor: { id: number; name: string }, ip: string | null) {
    const user = await this.userRepo.findOne({ where: { id: String(id), role: RoleEnum.EMPLOYEE } });
    if (!user) throw Errors.notFound('学员不存在');
    return this.setStatus(String(id), status, actor, ip);
  }

  async resetStudentPassword(id: string, newPassword: string, actor: { id: number; name: string }, ip: string | null) {
    const user = await this.userRepo.findOne({ where: { id: String(id), role: RoleEnum.EMPLOYEE } });
    if (!user) throw Errors.notFound('学员不存在');
    return this.resetPassword(String(id), newPassword, actor, ip);
  }

  async updateSelfProfile(id: string, patch: { real_name?: string; phone?: string | null; email?: string | null }) {
    const user = await this.userRepo.findOne({ where: { id: String(id) } });
    if (!user) throw Errors.notFound('员工不存在');
    if (patch.real_name !== undefined) user.realName = patch.real_name;
    if (patch.phone !== undefined) user.phone = patch.phone || null;
    if (patch.email !== undefined) user.email = patch.email || null;
    await this.userRepo.save(user);
    return this.sanitizeStudent(user);
  }

  async create(input: { username: string; password: string; real_name: string; employee_no?: string | null; department_id?: string | null; role: string; phone?: string | null; email?: string | null }, actor: { id: number; name: string }, ip: string | null) {
    this.validateRole(input.role);
    // 与改密（auth）同策略：弱口令黑名单 + 个人信息子串一并拦截（07 册 2.2.2 三层统一）
    validatePasswordStrength(
      input.password,
      { username: input.username, employeeNo: input.employee_no, realName: input.real_name },
      '初始密码',
    );
    if (input.department_id) {
      const dept = await this.dataSource.getRepository(SysDepartment).findOne({ where: { id: input.department_id } });
      if (!dept) throw Errors.param('部门不存在');
    }
    try {
      const hash = await bcrypt.hash(input.password, 12);
      const u = await this.userRepo.save(
        this.userRepo.create({
          username: input.username,
          passwordHash: hash,
          realName: input.real_name,
          employeeNo: input.employee_no || null,
          departmentId: input.department_id || null,
          role: input.role,
          phone: input.phone || null,
          email: input.email || null,
          status: 1,
          forcePasswordChange: 1,
          loginCount: 0,
          lastLoginAt: null,
          lastLoginIp: null,
          rolesConfigured: 0,
        }),
      );
      this.audit.log({
        actor_id: actor.id, actor_name: actor.name, action: 'user.create', object_type: 'sys_user',
        object_id: u.id, detail: { username: input.username, role: input.role }, result: 'success', source_ip: ip,
      });
      return this.sanitize(u);
    } catch (e: any) {
      if (String(e?.code) === 'ER_DUP_ENTRY') {
        if (String(e?.message || '').includes('uk_employee_no')) throw Errors.param('工号已存在');
        throw Errors.param('用户名已存在');
      }
      throw e;
    }
  }

  async update(id: string, patch: { real_name?: string; employee_no?: string | null; department_id?: string | null; role?: string; phone?: string | null; email?: string | null }, actor: { id: number; name: string }, ip: string | null) {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw Errors.notFound('员工不存在');
    if (patch.role !== undefined) this.validateRole(patch.role);
    if (patch.role !== undefined && u.role === RoleEnum.SUPER_ADMIN && patch.role !== RoleEnum.SUPER_ADMIN) {
      const activeSuperCount = await this.userRepo.count({ where: { role: RoleEnum.SUPER_ADMIN, status: 1 } });
      if (Number(u.id) === 1 || activeSuperCount <= 1) throw Errors.lastSuperAdmin();
    }
    if (patch.department_id) {
      const dept = await this.dataSource.getRepository(SysDepartment).findOne({ where: { id: patch.department_id } });
      if (!dept) throw Errors.param('部门不存在');
    }
    const roleChanged = patch.role !== undefined && patch.role !== u.role;
    if (patch.real_name !== undefined) u.realName = patch.real_name;
    if (patch.employee_no !== undefined) u.employeeNo = patch.employee_no || null;
    if (patch.department_id !== undefined) u.departmentId = patch.department_id || null;
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.phone !== undefined) u.phone = patch.phone || null;
    if (patch.email !== undefined) u.email = patch.email || null;
    try {
      if (roleChanged) {
        const oldSids: string[] = [];
        await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(SysUser);
          const current = await repo.findOne({ where: { id } });
          if (!current) throw Errors.notFound('员工不存在');
          if (patch.role !== undefined && current.role === RoleEnum.SUPER_ADMIN && patch.role !== RoleEnum.SUPER_ADMIN) {
            const activeSuperCount = await repo.count({ where: { role: RoleEnum.SUPER_ADMIN, status: 1 } });
            if (Number(current.id) === 1 || activeSuperCount <= 1) throw Errors.lastSuperAdmin();
          }
          if (patch.real_name !== undefined) current.realName = patch.real_name;
          if (patch.employee_no !== undefined) current.employeeNo = patch.employee_no || null;
          if (patch.department_id !== undefined) current.departmentId = patch.department_id || null;
          if (patch.role !== undefined) current.role = patch.role;
          if (patch.phone !== undefined) current.phone = patch.phone || null;
          if (patch.email !== undefined) current.email = patch.email || null;
          current.authVersion = this.authVersion(current) + 1;
          await repo.save(current);
          oldSids.push(...await this.sessions.invalidateUser(manager, id));
          Object.assign(u, current);
        });
        await this.sessions.markRevoked(oldSids);
        await this.access.invalidate(id);
      } else {
        await this.userRepo.save(u);
      }
    } catch (e: any) {
      if (String(e?.code) === 'ER_DUP_ENTRY') throw Errors.param('工号已存在');
      throw e;
    }
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'user.update', object_type: 'sys_user',
      object_id: id, detail: patch as any, result: 'success', source_ip: ip,
    });
    return this.sanitize(u);
  }

  /** 启停（1=启用 / 0=停用）：停用即刻无法登录、敏感路径即时失效、不计入应学人数（FR-ORG-03） */
  async setStatus(id: string, status: 0 | 1, actor: { id: number; name: string }, ip: string | null) {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw Errors.notFound('员工不存在');
    if (status === 0 && u.role === RoleEnum.SUPER_ADMIN) {
      const activeSuperCount = await this.userRepo.count({ where: { role: RoleEnum.SUPER_ADMIN, status: 1 } });
      if (Number(u.id) === 1 || activeSuperCount <= 1) throw Errors.lastSuperAdmin();
    }
    const oldSids: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SysUser);
      const current = await repo.findOne({ where: { id } });
      if (!current) throw Errors.notFound('员工不存在');
      if (status === 0 && current.role === RoleEnum.SUPER_ADMIN) {
        const activeSuperCount = await repo.count({ where: { role: RoleEnum.SUPER_ADMIN, status: 1 } });
        if (Number(current.id) === 1 || activeSuperCount <= 1) throw Errors.lastSuperAdmin();
      }
      current.status = status;
      current.authVersion = this.authVersion(current) + 1;
      await repo.save(current);
      oldSids.push(...await this.sessions.invalidateUser(manager, id));
      Object.assign(u, current);
    });
    await this.sessions.markRevoked(oldSids);
    if (status === 0) {
      // 用户级封禁：存量令牌即时失效（07 册 2.1.4）
      // 令牌 iat 只有秒精度；向前推进一秒，覆盖与停用请求同一秒签发的旧 access，停用后不会再签发新令牌。
      await this.redis.setUserBlock(Number(u.id), Math.floor(Date.now() / 1000) + 1, this.config.jwt.refreshExpiresDays * 86400);
    }
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'user.status', object_type: 'sys_user',
      object_id: id, detail: { status }, result: 'success', source_ip: ip,
    });
    return this.sanitize(u);
  }

  /** 重置密码：旧密码立即失效、回到强制改密流程（FR-ORG-03 验收③ + 07 册 2.2.3） */
  async resetPassword(id: string, newPassword: string, actor: { id: number; name: string }, ip: string | null) {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw Errors.notFound('员工不存在');
    // 与改密（auth）同策略：弱口令黑名单 + 个人信息子串一并拦截（07 册 2.2.2 三层统一）
    validatePasswordStrength(
      newPassword,
      { username: u.username, employeeNo: u.employeeNo, realName: u.realName },
      '初始密码',
    );
    const hash = await bcrypt.hash(newPassword, 12);
    const oldSids: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SysUser);
      const current = await repo.findOne({ where: { id } });
      if (!current) throw Errors.notFound('员工不存在');
      current.passwordHash = hash;
      current.forcePasswordChange = 1;
      current.authVersion = this.authVersion(current) + 1;
      await repo.save(current);
      oldSids.push(...await this.sessions.invalidateUser(manager, id));
      Object.assign(u, current);
    });
    await this.sessions.markRevoked(oldSids);
    await this.redis.setUserBlock(Number(u.id), Math.floor(Date.now() / 1000) + 1, this.config.jwt.refreshExpiresDays * 86400);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'user.password.reset', object_type: 'sys_user',
      object_id: id, detail: {}, result: 'success', source_ip: ip,
    });
  }

  async findByIds(ids: string[]): Promise<SysUser[]> {
    if (!ids.length) return [];
    return this.userRepo.find({ where: { id: In(ids) } });
  }
}
