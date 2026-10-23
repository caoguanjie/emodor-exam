import { Injectable } from '@nestjs/common';
import { Response, Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SysUser } from '../../entities/sys-user.entity';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { KEY_COMPONENT_PATTERN } from '../../common/guards/jwt-auth.guard';
import { validatePasswordStrength as assertPasswordStrength } from '../../common/password-policy';
import { CaptchaService } from './captcha.service';
import { SessionService } from './session.service';
import { AccessService } from '../access/access.service';
import { parseExpirySeconds, SessionIssuerService } from './session-issuer.service';

const LOGIN_MAX_FAILS = 5; // username 连续失败 5 次
const LOGIN_LOCK_SECONDS = 600; // 锁定 10 分钟
const LOGIN_IP_LIMIT_PER_MIN = 10; // source_ip 维度 10 次/分钟

export interface TokenPair {
  access_token: string;
  expires_in: number;
}

/**
 * 认证服务（05 册 2.4.1 / 07 册 2.1 - 2.2）：
 * 双令牌（access 2h / refresh 7d 轮换）、bcrypt cost=12、
 * 登录失败双计数防爆破、独立 force_password_change 强制改密与认证世代吊销。
 */
@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;

  constructor(
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly captcha: CaptchaService,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly issuer: SessionIssuerService,
  ) {
    this.accessTtl = parseExpirySeconds(this.config.jwt.expiresIn);
    this.refreshTtlDays = this.config.jwt.refreshExpiresDays;
  }

  /** 密码强度策略（07 册 2.2.2）：≥8 位、含字母与数字、不含个人信息 ≥3 字符子串、非常见弱口令 */
  validatePasswordStrength(password: string, user?: { username?: string; employeeNo?: string | null; realName?: string }) {
    assertPasswordStrength(password, user, '新密码');
  }

  private passwordChangeRequired(user: SysUser): boolean {
    // A1 rows are backfilled by 002_access; retain the NULL fallback for
    // a short compatibility window when a legacy entity is read during rollout.
    return user.forcePasswordChange === undefined
      ? user.lastLoginAt === null
      : Number(user.forcePasswordChange) === 1;
  }

  private authVersion(user: SysUser): number {
    return Number.isInteger(Number(user.authVersion)) ? Number(user.authVersion) : 0;
  }

  async login(username: string, password: string, ip: string | null, req: Request, res: Response, captchaId?: string, captchaCode?: string) {
    // source_ip 维度限流：10 次/分钟（04 册 6.2；Redis 故障时进程内兜底计数由 RedisService 承担）
    const ipKey = `auth:ip:${ip || 'unknown'}`;
    const ipCount = await this.redis.incr(ipKey, 60);
    if (ipCount > LOGIN_IP_LIMIT_PER_MIN) throw Errors.tooManyRequests('请求过于频繁，请稍后再试');

    // username 维度防爆破：连续失败 5 次锁定 10 分钟（40106，message 含剩余秒数）
    const lockCount = await this.redis.getLoginFail(username);
    if (lockCount && Number(lockCount) >= LOGIN_MAX_FAILS) {
      const ttl = await this.redis.getLoginFailTtl(username);
      throw Errors.accountLocked(ttl > 0 ? ttl : LOGIN_LOCK_SECONDS);
    }

    // Credentials, the authoritative admin classification, login facts and
    // durable session creation share one locked transaction. This prevents a
    // concurrent reset/role assignment from minting a token from stale state,
    // and a failed session insert from committing a false successful login.
    let failedUserId: number | null = null;
    let loginResult!: { user: SysUser; session: Awaited<ReturnType<SessionService['create']>>; firstLogin: boolean };
    try {
      loginResult = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(SysUser);
        const current = await repo.createQueryBuilder('u')
          .setLock('pessimistic_write')
          .where('u.username = :username', { username })
          .getOne();
        failedUserId = current ? Number(current.id) : null;

        // Do not consult the Redis permission cache before deciding whether a
        // captcha is mandatory. The manager-scoped read is authoritative and
        // observes the same locked user generation as this login.
        const effectivePermissions = current
          ? await this.access.permissions(current.id, { manager })
          : [];
        const isAdminAccount = Boolean(current && (current.role !== 'employee' || effectivePermissions.length > 0));
        if (isAdminAccount && (!captchaId || !captchaCode || !(await this.captcha.verify(captchaId, captchaCode)))) {
          throw Errors.param('验证码错误');
        }

        const ok = current ? await bcrypt.compare(password, current.passwordHash) : false;
        if (!current || !ok || !isAdminAccount) throw Errors.badCredentials();
        if (current.status === 0) {
          this.audit.log({
            actor_id: Number(current.id), actor_name: username, action: 'auth.login', object_type: 'sys_user',
            object_id: current.id, detail: { reason: 'disabled' }, result: 'failure', source_ip: ip,
          });
          throw Errors.accountDisabled();
        }

        current.loginCount = Number(current.loginCount || 0) + 1;
        current.lastLoginAt = new Date();
        current.lastLoginIp = ip;
        const saved = await repo.save(current);
        const session = await this.sessions.create(saved.id, ip, req.get('user-agent') || null, manager);
        return { user: saved, session, firstLogin: this.passwordChangeRequired(saved) };
      });
    } catch (error: any) {
      if (Number(error?.code) === 40104) {
        const fails = await this.redis.incrLoginFail(username, LOGIN_LOCK_SECONDS);
        this.audit.log({
          actor_id: failedUserId, actor_name: username, action: 'auth.login',
          object_type: 'sys_user', object_id: failedUserId, detail: { reason: 'bad_credentials' },
          result: 'failure', source_ip: ip,
        });
        if (fails >= LOGIN_MAX_FAILS) throw Errors.accountLocked(LOGIN_LOCK_SECONDS);
      }
      throw error;
    }

    await this.redis.clearLoginFail(username);
    const loggedInUser = loginResult.user;
    const session = loginResult.session;
    const firstLogin = loginResult.firstLogin;
    const pair = await this.issuer.issue(loggedInUser, { client: 'pc', authMethod: 'password', ip, userAgent: req.get('user-agent') || null }, res, session, firstLogin);
    this.audit.log({
      actor_id: Number(loggedInUser.id), actor_name: username, action: 'auth.login', object_type: 'sys_user',
      object_id: loggedInUser.id, detail: { first_login: firstLogin }, result: 'success', source_ip: ip,
    });
    return {
      ...pair,
      force_change_password: firstLogin,
      user: { ...this.sanitize(loggedInUser), permissions: await this.access.permissions(loggedInUser.id) },
    };
  }

  async refresh(token: string | undefined, ip: string | null, res: Response) {
    const result = await this.issuer.refresh(token, 'pc', ip, res);
    return { access_token: result.access_token, expires_in: result.expires_in, force_change_password: result.force_change_password };
  }

  async profile(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user) throw Errors.notFound();
    return { ...this.sanitize(user), permissions: await this.access.permissions(user.id) };
  }

  /** 修改本人密码（FR-ORG-06）：校验原密码；成功后同事务写 last_login_at、写封禁键、签发完整令牌 */
  async changePassword(userId: number, oldPassword: string, newPassword: string, ip: string | null, res: Response, currentUser?: AuthUser, refreshToken?: string, req?: Request) {
    // 同一事务：覆写哈希、清除独立强制改密标志、递增认证世代、吊销
    // durable sessions，并创建新会话；提交后才写 Redis 快速吊销标记。
    const changed = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(SysUser);
      const u = await repo.createQueryBuilder('u')
        .setLock('pessimistic_write')
        .where('u.id = :userId', { userId: String(userId) })
        .getOne();
      if (!u) throw Errors.notFound();
      if (u.role === 'employee' && !(await this.access.permissions(u.id, { manager: m, useCache: false })).length) {
        throw Errors.forbidden('学员请使用手机验证码登录');
      }
      const ok = await bcrypt.compare(oldPassword, u.passwordHash);
      if (!ok) throw Errors.param('原密码错误');
      this.validatePasswordStrength(newPassword, u);
      const hash = await bcrypt.hash(newPassword, 12);
      u.passwordHash = hash;
      u.forcePasswordChange = 0;
      u.authVersion = this.authVersion(u) + 1;
      const oldSids = await this.sessions.invalidateUser(m, userId);
      const session = await this.sessions.create(userId, ip, req?.get('user-agent') || null, m);
      await repo.save(u);
      return { user: u, oldSids, session };
    });
    await this.sessions.markRevoked(changed.oldSids);
    // 写用户级封禁键：iat 早于封禁时刻的旧令牌（access 与 refresh）全部失效（07 册 2.1.4）
    await this.redis.setUserBlock(userId, Math.floor(Date.now() / 1000), this.refreshTtlDays * 86400);
    if (currentUser?.jti && KEY_COMPONENT_PATTERN.test(currentUser.jti)) {
      await this.redis.blacklistJti(currentUser.jti, Math.max(1, this.accessTtl - (Math.floor(Date.now() / 1000) - currentUser.iat)));
    }
    if (refreshToken) {
      try {
        const oldRefresh: any = this.jwt.verify(refreshToken);
        if (oldRefresh?.type === 'refresh' && KEY_COMPONENT_PATTERN.test(String(oldRefresh.jti || ''))) {
          const remain = Math.max(1, this.refreshTtlDays * 86400 - (Math.floor(Date.now() / 1000) - Number(oldRefresh.iat || 0)));
          await this.redis.blacklistJti(String(oldRefresh.jti), remain);
        }
      } catch { /* 无效旧 Cookie 不影响已完成的密码更新 */ }
    }
    const pair = await this.issuer.issue(changed.user, { client: 'pc', authMethod: 'password', ip, userAgent: req?.get('user-agent') || null }, res, changed.session);
    this.audit.log({
      actor_id: userId, actor_name: changed.user.username, action: 'auth.password.change', object_type: 'sys_user',
      object_id: changed.user.id, detail: {}, result: 'success', source_ip: ip,
    });
    return pair;
  }

  /** 登出：吊销所呈报 access（jti 黑名单）+ 吊销 Cookie 中的 refresh + 审计 + 清 Cookie（04 册 1.3 / 07 册 2.1.4） */
  async logout(user: AuthUser, ip: string | null, res: Response, refreshToken?: string) {
    await this.issuer.revoke(user, res, refreshToken);
    this.audit.log({
      actor_id: user.id, actor_name: user.username, action: 'auth.logout', object_type: 'sys_user',
      object_id: user.id, detail: {}, result: 'success', source_ip: ip,
    });
    return null;
  }

  /** 接口返回用户信息一律排除 password_hash（03 册 3.1.2 设计说明 2） */
  sanitize(user: SysUser) {
    return {
      id: Number(user.id),
      username: user.username,
      real_name: user.realName,
      employee_no: user.employeeNo,
      department_id: user.departmentId ? Number(user.departmentId) : null,
      role: user.role,
      phone: user.phone,
      email: user.email,
      status: user.status,
      auth_version: this.authVersion(user),
      force_password_change: this.passwordChangeRequired(user),
      login_count: Number(user.loginCount || 0),
      last_login_at: user.lastLoginAt,
      last_login_ip: user.lastLoginIp,
      created_at: user.createdAt,
    };
  }
}
