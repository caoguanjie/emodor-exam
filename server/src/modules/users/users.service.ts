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
  ) {}

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
      last_login_at: u.lastLoginAt,
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
          lastLoginAt: null, // 初始密码：首登强制改密（07 册 2.2.3）
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
    if (patch.department_id) {
      const dept = await this.dataSource.getRepository(SysDepartment).findOne({ where: { id: patch.department_id } });
      if (!dept) throw Errors.param('部门不存在');
    }
    if (patch.real_name !== undefined) u.realName = patch.real_name;
    if (patch.employee_no !== undefined) u.employeeNo = patch.employee_no || null;
    if (patch.department_id !== undefined) u.departmentId = patch.department_id || null;
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.phone !== undefined) u.phone = patch.phone || null;
    if (patch.email !== undefined) u.email = patch.email || null;
    try {
      await this.userRepo.save(u);
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
    if (Number(u.id) === 1 || (u.role === RoleEnum.SUPER_ADMIN && Number(u.id) === 1)) {
      if (status === 0) throw Errors.param('超级管理员账号不可停用');
    }
    u.status = status;
    await this.userRepo.save(u);
    if (status === 0) {
      // 用户级封禁：存量令牌即时失效（07 册 2.1.4）
      await this.redis.setUserBlock(Number(u.id), Math.floor(Date.now() / 1000), this.config.jwt.refreshExpiresDays * 86400);
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
    u.passwordHash = await bcrypt.hash(newPassword, 12);
    u.lastLoginAt = null;
    await this.userRepo.save(u);
    await this.redis.setUserBlock(Number(u.id), Math.floor(Date.now() / 1000), this.config.jwt.refreshExpiresDays * 86400);
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
