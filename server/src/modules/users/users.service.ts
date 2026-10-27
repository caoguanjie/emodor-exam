import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { SysUser } from '../../entities/sys-user.entity';
import { Errors, RoleEnum } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import { AppConfig } from '../../config/configuration';
import { CategoryService } from '../training/category.service';
import { SessionService } from '../auth/session.service';
import { AccessService } from '../access/access.service';
import { SysUserRole } from '../../entities/sys-user-role.entity';
import { MediaService } from '../media/media.service';
import { normalizeChinaMobile } from '../auth/phone';
import { IdentityService } from '../identity/identity.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

interface SelfProfilePatch {
  real_name?: string;
  email?: string | null;
  avatar_id?: string | null;
  occupation?: string | null;
  gender?: 'male' | 'female' | null;
  birthday?: string | null;
}

const SELF_PROFILE_KEYS = ['real_name', 'email', 'avatar_id', 'occupation', 'gender', 'birthday'];

/** Shared account service for managed students and self-service profiles. */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly categories: CategoryService,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly media: MediaService,
    @Optional() private readonly identity?: IdentityService,
  ) {
    // Keep avatar business authorization in the users domain so media does
    // not import the managed-student boundary back through AccessService.
    this.media.registerOwnerPolicy('user_avatar', {
      allowedPurposes: ['avatar'],
      authorizeRead: (actorId, businessId) => this.canReadAvatar(actorId, businessId),
      validateBinding: async (_manager, asset, businessId) => {
        if (asset.ownerId !== String(businessId) || asset.purpose !== 'avatar' || asset.mediaKind !== 'image') {
          throw Errors.dataForbidden('媒体不是可绑定的头像');
        }
      },
    });
  }

  private async canReadAvatar(actorId: string, businessId: string): Promise<boolean> {
    if (actorId === businessId) return true;
    const permissions = await this.access.permissions(actorId);
    if (!permissions.includes('students:read') && !permissions.includes('students:write')) return false;
    const target = await this.userRepo.findOne({ where: { id: String(businessId), role: RoleEnum.EMPLOYEE } });
    if (!target) return false;
    const link = await this.userRepo.manager.getRepository(SysUserRole).findOne({ where: { userId: String(businessId) } });
    return !link;
  }

  private authVersion(u: SysUser): number {
    return Number.isInteger(Number(u.authVersion)) ? Number(u.authVersion) : 0;
  }

  /** Training APIs use string IDs so BIGINT values remain lossless. */
  private sanitizeStudent(u: SysUser) {
    return {
      id: String(u.id),
      username: u.username,
      real_name: u.realName,
      employee_no: u.employeeNo,
      category_id: u.categoryId ? String(u.categoryId) : null,
      source: u.source,
      role: u.role,
      phone: u.phone,
      email: u.email,
      gender: u.gender ?? null,
      birthday: u.birthday ?? null,
      age: u.age ?? null,
      avatar_id: u.avatarId ? String(u.avatarId) : null,
      status: Number(u.status),
      last_login_at: u.lastLoginAt,
      created_at: u.createdAt,
    };
  }

  private async sanitizeProfile(u: SysUser) {
    // Existing references retain their current name even after deactivation.
    const category = u.categoryId ? await this.categories.findById(String(u.categoryId)) : null;
    return {
      ...this.sanitizeStudent(u),
      category_name: category?.name ?? null,
      occupation: u.occupation ?? null,
      gender: u.gender ?? null,
      birthday: u.birthday ?? null,
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
    const qb = this.userRepo.createQueryBuilder('u')
      .where('u.role = :role', { role: RoleEnum.EMPLOYEE })
      // Any explicit business-role link makes an employee a managed administrator,
      // even when that role currently has no permissions or is inactive.
      .andWhere('NOT EXISTS (SELECT 1 FROM sys_user_role student_role WHERE student_role.user_id = u.id)');
    if (query.keyword?.trim()) {
      qb.andWhere('(u.real_name LIKE :kw OR u.phone LIKE :kw)', { kw: `%${query.keyword.trim()}%` });
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
    const user = await this.userRepo.createQueryBuilder('u')
      .where('u.id = :id', { id: String(id) })
      .andWhere('u.role = :role', { role: RoleEnum.EMPLOYEE })
      .andWhere('NOT EXISTS (SELECT 1 FROM sys_user_role student_role WHERE student_role.user_id = u.id)')
      .getOne();
    if (!user) throw Errors.notFound('学员不存在');
    return this.sanitizeStudent(user);
  }

  async selfProfile(id: string) {
    const user = await this.userRepo.findOne({ where: { id: String(id) } });
    if (!user) throw Errors.notFound('员工不存在');
    return this.sanitizeProfile(user);
  }

  private assertMobileLearnerActor(actor: AuthUser): void {
    if (actor.client !== 'mobile' || actor.role !== RoleEnum.EMPLOYEE) {
      throw Errors.forbidden('仅普通移动学员可确认培训工种');
    }
  }

  private async lockMobileLearner(manager: EntityManager, actor: AuthUser): Promise<SysUser> {
    this.assertMobileLearnerActor(actor);
    const user = await manager.findOne(SysUser, {
      where: { id: String(actor.id) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user || user.role !== RoleEnum.EMPLOYEE) throw Errors.forbidden('仅普通移动学员可确认培训工种');
    if (Number(user.status) !== 1) throw Errors.accountDisabled();
    const link = await manager.getRepository(SysUserRole).findOne({ where: { userId: String(user.id) } });
    if (link) throw Errors.forbidden('管理账号不能使用学员培训工种入口');
    return user;
  }

  async listSelfTrainingCategories(actor: AuthUser, query: { page?: number; page_size?: number }) {
    this.assertMobileLearnerActor(actor);
    const page = query.page === undefined ? 1 : query.page;
    const pageSize = query.page_size === undefined ? 20 : query.page_size;
    if (Object.keys(query).some((key) => key !== 'page' && key !== 'page_size')
      || !Number.isSafeInteger(page) || page < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw Errors.param('培训工种分页参数非法');
    }
    await this.dataSource.transaction(async (manager) => {
      await this.lockMobileLearner(manager, actor);
    });
    // Release the transaction connection before using CategoryService's repository.
    const result = await this.categories.list({ page, page_size: pageSize, status: 1 });
    return { ...result, items: result.items.map((category) => ({ id: String(category.id), name: category.name })) };
  }

  async confirmTrainingCategory(actor: AuthUser, input: { category_id: string }, ip: string | null) {
    this.assertMobileLearnerActor(actor);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => key !== 'category_id')
      || typeof input.category_id !== 'string' || input.category_id.length > 32 || !/^[1-9]\d*$/.test(input.category_id)) {
      throw Errors.param('培训工种确认只接受 category_id 正十进制字符串');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockMobileLearner(manager, actor);
      // The user row serializes first confirmation with PC edits and role changes.
      // Replay precedes category validation so a later deactivation cannot break it.
      if (user.categoryId !== null && user.categoryId !== undefined) {
        if (String(user.categoryId) !== input.category_id) {
          throw Errors.param('培训工种已确认，如需修改请联系管理员或监考人员', { reason_code: 'TRAINING_CATEGORY_LOCKED' });
        }
        return { user, changed: false };
      }
      // Match updateStudent's user -> category order. Category deletion holds the
      // category lock while checking references, so no dangling reference can win.
      await this.categories.lockActive(manager, input.category_id);
      user.categoryId = input.category_id;
      return { user: await manager.getRepository(SysUser).save(user), changed: true };
    });
    if (result.changed) {
      this.audit.log({
        actor_id: actor.id, actor_name: actor.username, action: 'student.training_category.confirm', object_type: 'sys_user',
        object_id: String(result.user.id), detail: { before_category_id: null, after_category_id: String(result.user.categoryId) },
        result: 'success', source_ip: ip,
      });
    }
    return this.sanitizeProfile(result.user);
  }

  private assertLearnerSource(source: string): asserts source is 'institution' | 'external' {
    if (source !== 'institution' && source !== 'external') throw Errors.param('来源必须是 institution 或 external');
  }

  async createStudent(input: { username?: string; real_name: string; category_id: string; source: 'institution' | 'external'; employee_no?: string | null; phone: string; email?: string | null; gender?: 'male' | 'female' | null; birthday?: string | null; age?: number | null }, actor: { id: number; name: string }, ip: string | null) {
    if ('password' in input || 'initial_password' in input || 'password_hash' in input) throw Errors.param('学员使用手机验证码登录，不接受密码字段');
    this.assertLearnerSource(input.source);
    this.validateDemographics(input);
    const phone = normalizeChinaMobile(input.phone);
    const username = input.username || `m_${randomBytes(20).toString('hex')}`;
    const passwordHash = await bcrypt.hash(randomBytes(48).toString('base64'), 12);
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        await this.categories.lockActive(manager, input.category_id);
        return manager.getRepository(SysUser).save(manager.getRepository(SysUser).create({
          username,
          passwordHash,
          realName: input.real_name,
          employeeNo: input.employee_no || null,
          departmentId: null,
          categoryId: String(input.category_id),
          source: input.source,
          role: RoleEnum.EMPLOYEE,
          phone,
          email: input.email || null,
          gender: input.gender ?? null,
          birthday: input.birthday ?? null,
          age: input.age ?? null,
          status: 1,
          forcePasswordChange: 0,
          loginCount: 0,
          lastLoginAt: null,
          lastLoginIp: null,
          rolesConfigured: 0,
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
        if (String(error?.message || '').includes('uk_sys_user_phone')) throw Errors.param('手机号已存在');
        throw Errors.param('用户名已存在');
      }
      throw error;
    }
  }

  async updateStudent(id: string, patch: { real_name?: string; employee_no?: string | null; category_id?: string; source?: 'institution' | 'external'; phone?: string | null; email?: string | null; gender?: 'male' | 'female' | null; birthday?: string | null; age?: number | null }, actor: { id: number; name: string }, ip: string | null) {
    if ('password' in patch || 'initial_password' in patch || 'password_hash' in patch) throw Errors.param('学员使用手机验证码登录，不接受密码字段');
    if (patch.source !== undefined) this.assertLearnerSource(patch.source);
    this.validateDemographics(patch);
    let user: SysUser;
    let previousCategoryId: string | null = null;
    const oldSids: string[] = [];
    try {
      user = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(SysUser);
        const lockedUser = await this.lockManagedStudent(manager, id);
        previousCategoryId = lockedUser.categoryId ? String(lockedUser.categoryId) : null;
        if (patch.category_id !== undefined) await this.categories.lockActive(manager, patch.category_id);
        if (patch.real_name !== undefined) { await this.identity?.assertNameEditable(manager, id, lockedUser.realName, patch.real_name); lockedUser.realName = patch.real_name; }
        if (patch.employee_no !== undefined) lockedUser.employeeNo = patch.employee_no || null;
        if (patch.category_id !== undefined) lockedUser.categoryId = String(patch.category_id);
        if (patch.source !== undefined) lockedUser.source = patch.source;
        if (patch.phone !== undefined) {
          const phone = normalizeChinaMobile(patch.phone as string);
          if (phone !== lockedUser.phone) {
            lockedUser.phone = phone;
            lockedUser.authVersion = this.authVersion(lockedUser) + 1;
            oldSids.push(...await this.sessions.invalidateUser(manager, lockedUser.id));
          }
        }
        if (patch.email !== undefined) lockedUser.email = patch.email || null;
        if (patch.gender !== undefined) lockedUser.gender = patch.gender;
        if (patch.birthday !== undefined) lockedUser.birthday = patch.birthday;
        if (patch.age !== undefined) lockedUser.age = patch.age;
        return repo.save(lockedUser);
      });
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param(String(error?.message || '').includes('uk_sys_user_phone') ? '手机号已存在' : '工号已存在');
      throw error;
    }
    await this.sessions.markRevoked(oldSids);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'student.update', object_type: 'sys_user',
      object_id: id, detail: {
        category_id: user.categoryId, source: user.source,
        before_category_id: previousCategoryId, after_category_id: user.categoryId ? String(user.categoryId) : null,
      }, result: 'success', source_ip: ip,
    });
    return this.sanitizeStudent(user);
  }

  async setStudentStatus(id: string, status: 0 | 1, actor: { id: number; name: string }, ip: string | null) {
    return this.setStatus(String(id), status, actor, ip);
  }

  /**
   * A training-managed student is an employee with no explicit business-role
   * links. The user row is the shared serialization point with AccessService:
   * role assignment locks role rows first and then this same user row, while
   * student mutations lock only the user row before checking links.
   */
  private async lockManagedStudent(manager: EntityManager, id: string): Promise<SysUser> {
    const user = await manager.findOne(SysUser, {
      where: { id: String(id), role: RoleEnum.EMPLOYEE },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw Errors.notFound('学员不存在');
    await this.assertManagedStudent(manager, user);
    return user;
  }

  private async assertManagedStudent(manager: EntityManager, user: SysUser): Promise<void> {
    if (user.role !== RoleEnum.EMPLOYEE) throw Errors.notFound('学员不存在');
    const link = await manager.getRepository(SysUserRole).findOne({
      where: { userId: String(user.id) },
    });
    if (link) throw Errors.notFound('学员不存在');
  }

  private validateDemographics(patch: Pick<SelfProfilePatch, 'gender' | 'birthday'> & { age?: number | null }) {
    if (patch.age !== undefined && patch.age !== null && (!Number.isInteger(patch.age) || patch.age < 0 || patch.age > 150)) {
      throw Errors.param('年龄须为 0—150 的整数或 null');
    }
    if (patch.gender !== undefined && patch.gender !== null && patch.gender !== 'male' && patch.gender !== 'female') {
      throw Errors.param('性别仅支持 male、female 或 null');
    }
    if (patch.birthday !== undefined && patch.birthday !== null) {
      const birthday = patch.birthday;
      if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
        throw Errors.param('生日须为 YYYY-MM-DD 真实日期');
      }
      const [year, month, day] = birthday.split('-').map(Number);
      const date = new Date(0);
      date.setUTCFullYear(year, month - 1, day);
      if (year === 0 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw Errors.param('生日须为 YYYY-MM-DD 真实日期');
      }
      const today = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      if (birthday > today) throw Errors.param('生日不能晚于当前日期');
    }
  }

  async updateSelfProfile(id: string, patch: SelfProfilePatch) {
    const unknown = Object.keys(patch).filter((key) => !SELF_PROFILE_KEYS.includes(key));
    if (unknown.length) throw Errors.param(`本人资料请求 包含不支持的字段：${unknown.join(',')}`);
    let realName = patch.real_name;
    if ('real_name' in patch) {
      if (typeof realName !== 'string' || !realName.trim() || realName.trim().length > 64) {
        throw Errors.param('姓名去除首尾空白后须为 1—64 个字符');
      }
      realName = realName.trim();
    }
    let occupation = patch.occupation;
    if (occupation !== undefined && occupation !== null) {
      if (typeof occupation !== 'string' || !occupation.trim() || occupation.trim().length > 64) {
        throw Errors.param('工种去除首尾空白后须为 1—64 个字符');
      }
      occupation = occupation.trim();
    }
    this.validateDemographics(patch);
    const user = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SysUser);
      const current = await repo.findOne({
        where: { id: String(id) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw Errors.notFound('员工不存在');
      if (realName !== undefined) { await this.identity?.assertNameEditable(manager, String(id), current.realName, realName); current.realName = realName; }
      if (patch.email !== undefined) current.email = patch.email || null;
      if (occupation !== undefined) current.occupation = occupation;
      if (patch.gender !== undefined) current.gender = patch.gender;
      if (patch.birthday !== undefined) current.birthday = patch.birthday;
      if (patch.avatar_id !== undefined) {
        const previous = current.avatarId;
        if (patch.avatar_id) {
          await this.media.bind(manager, String(patch.avatar_id), 'user_avatar', String(id));
        }
        if (previous && previous !== patch.avatar_id) {
          await this.media.unbind(manager, String(previous), 'user_avatar', String(id));
        }
        current.avatarId = patch.avatar_id || null;
      }
      return repo.save(current);
    });
    return this.sanitizeProfile(user);
  }

  async updateStudentAvatar(id: string, avatarId: string | null, actor: { id: number; name: string }, ip: string | null) {
    let user!: SysUser;
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockManagedStudent(manager, String(id));
      const previous = current.avatarId;
      if (avatarId) await this.media.bind(manager, String(avatarId), 'user_avatar', String(id));
      if (previous && previous !== avatarId) await this.media.unbind(manager, String(previous), 'user_avatar', String(id));
      current.avatarId = avatarId || null;
      user = await manager.getRepository(SysUser).save(current);
    });
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'student.avatar', object_type: 'sys_user',
      object_id: id, detail: { avatar_id: avatarId }, result: 'success', source_ip: ip,
    });
    return this.sanitizeStudent(user);
  }

  /** Student enable/disable revokes all existing sessions immediately. */
  private async setStatus(id: string, status: 0 | 1, actor: { id: number; name: string }, ip: string | null) {
    let user!: SysUser;
    const oldSids: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SysUser);
      const current = await this.lockManagedStudent(manager, id);
      current.status = status;
      current.authVersion = this.authVersion(current) + 1;
      await repo.save(current);
      oldSids.push(...await this.sessions.invalidateUser(manager, id));
      user = current;
    });
    await this.sessions.markRevoked(oldSids);
    if (status === 0) {
      // 用户级封禁：存量令牌即时失效（07 册 2.1.4）
      // 令牌 iat 只有秒精度；向前推进一秒，覆盖与停用请求同一秒签发的旧 access，停用后不会再签发新令牌。
      await this.redis.setUserBlock(Number(user.id), Math.floor(Date.now() / 1000) + 1, this.config.jwt.refreshExpiresDays * 86400);
    }
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'user.status', object_type: 'sys_user',
      object_id: id, detail: { status }, result: 'success', source_ip: ip,
    });
    return this.sanitizeStudent(user);
  }

}
