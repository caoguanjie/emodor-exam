import { Injectable, Res } from '@nestjs/common';
import { Response, Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { SysUser } from '../../entities/sys-user.entity';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { REFRESH_COOKIE, KEY_COMPONENT_PATTERN } from '../../common/guards/jwt-auth.guard';
import { validatePasswordStrength as assertPasswordStrength } from '../../common/password-policy';
import { CaptchaService } from './captcha.service';
import { SessionService } from './session.service';
import { AccessService } from '../access/access.service';

const LOGIN_MAX_FAILS = 5; // username 连续失败 5 次
const LOGIN_LOCK_SECONDS = 600; // 锁定 10 分钟
const LOGIN_IP_LIMIT_PER_MIN = 10; // source_ip 维度 10 次/分钟

export interface TokenPair {
  access_token: string;
  expires_in: number;
}

function parseExpirySeconds(expr: string): number {
  const m = expr.trim().match(/^(\d+)([smhd])?$/);
  if (!m) return 7200;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return n;
  }
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
  ) {
    this.accessTtl = parseExpirySeconds(this.config.jwt.expiresIn);
    this.refreshTtlDays = this.config.jwt.refreshExpiresDays;
  }

  private sign(user: { id: number; username: string; role: string; authVersion?: number }, type: 'access' | 'refresh', opts?: { pwdPending?: boolean; sid?: string }) {
    const ttl = type === 'access' ? this.accessTtl : this.refreshTtlDays * 86400;
    const payload: Record<string, unknown> = {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      auth_version: Number(user.authVersion || 0),
      type,
      jti: randomBytes(16).toString('hex'),
    };
    if (opts?.pwdPending) payload.pwd_pending = true;
    if (opts?.sid) payload.sid = opts.sid;
    return this.jwt.sign(payload, { expiresIn: ttl });
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.env === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: this.refreshTtlDays * 86400 * 1000,
    });
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

    // 凭据校验：用户不存在与密码错误同一错误码 40104（不泄露区别，FR-ORG-01 验收②）
    const user = await this.userRepo.findOne({ where: { username } });
    // 管理员登录必须先消费一次验证码；没有任何管理权限的 legacy 员工
    // 继续兼容旧的 username/password 请求。若员工被配置了业务管理角色，
    // 也按管理员处理，不能靠把 system role 留为 employee 绕过验证码。
    const effectivePermissions = user && user.role === 'employee' ? await this.access.permissions(user.id) : [];
    const isAdminAccount = Boolean(user && (user.role !== 'employee' || effectivePermissions.length > 0));
    if (isAdminAccount) {
      if (!captchaId || !captchaCode || !(await this.captcha.verify(captchaId, captchaCode))) {
        throw Errors.param('验证码错误');
      }
    }
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      const fails = await this.redis.incrLoginFail(username, LOGIN_LOCK_SECONDS);
      this.audit.log({
        actor_id: user ? Number(user.id) : null, actor_name: username, action: 'auth.login',
        object_type: 'sys_user', object_id: user?.id ?? null, detail: { reason: 'bad_credentials' },
        result: 'failure', source_ip: ip,
      });
      if (fails >= LOGIN_MAX_FAILS) throw Errors.accountLocked(LOGIN_LOCK_SECONDS);
      throw Errors.badCredentials();
    }
    if (user.status === 0) {
      this.audit.log({
        actor_id: Number(user.id), actor_name: username, action: 'auth.login', object_type: 'sys_user',
        object_id: user.id, detail: { reason: 'disabled' }, result: 'failure', source_ip: ip,
      });
      throw Errors.accountDisabled();
    }

    await this.redis.clearLoginFail(username);
    // 真实密码登录（包括首次 pending 登录）都计入成功统计；refresh
    // 不经过这里，因此不会伪造登录次数/IP/时间。
    const loggedInUser = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SysUser);
      const current = await repo.findOne({ where: { id: String(user.id) } });
      if (!current || current.status === 0) throw Errors.accountDisabled();
      current.loginCount = Number(current.loginCount || 0) + 1;
      current.lastLoginAt = new Date();
      current.lastLoginIp = ip;
      return repo.save(current);
    });
    const firstLogin = this.passwordChangeRequired(loggedInUser);
    const core = { id: Number(loggedInUser.id), username: loggedInUser.username, role: loggedInUser.role, authVersion: this.authVersion(loggedInUser) };
    const session = await this.sessions.create(loggedInUser.id, ip, req.get('user-agent') || null);
    const access = this.sign(core, 'access', { pwdPending: firstLogin, sid: session.sid });
    const refresh = this.sign(core, 'refresh', { sid: session.sid });
    this.setRefreshCookie(res, refresh);
    this.audit.log({
      actor_id: Number(loggedInUser.id), actor_name: username, action: 'auth.login', object_type: 'sys_user',
      object_id: loggedInUser.id, detail: { first_login: firstLogin }, result: 'success', source_ip: ip,
    });
    return {
      access_token: access,
      expires_in: this.accessTtl,
      force_change_password: firstLogin,
      user: { ...this.sanitize(loggedInUser), permissions: await this.access.permissions(loggedInUser.id) },
    };
  }

  async refresh(token: string | undefined, ip: string | null, res: Response) {
    if (!token) throw Errors.refreshTokenInvalid();
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw Errors.refreshTokenInvalid();
    }
    if (payload?.type !== 'refresh') throw Errors.refreshTokenInvalid();
    // refresh 单令牌黑名单：登出时已吊销的 refresh 不可再轮换（07 册 2.1.4）
    const refreshJti = String(payload.jti ?? '');
    if (!KEY_COMPONENT_PATTERN.test(refreshJti)) throw Errors.refreshTokenInvalid();
    if (await this.redis.isTokenBlacklisted(refreshJti)) throw Errors.tokenRevoked();
    const sid = typeof payload.sid === 'string' ? payload.sid : undefined;
    if (sid && (!/^[a-f0-9]{48}$/.test(sid) || await this.sessions.isRevoked(sid))) throw Errors.tokenRevoked();
    const userId = Number(payload.sub);
    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user || user.status === 0) throw Errors.refreshTokenInvalid();
    if (Number(payload.auth_version ?? 0) !== this.authVersion(user)) throw Errors.tokenRevoked();
    // 用户级封禁同样适用于 refresh 轮换路径（07 册 2.1.4）
    const blockTs = await this.redis.getTokenBlockTs(userId);
    if (blockTs && Number(payload.iat) < Number(blockTs)) throw Errors.tokenRevoked();

    const core = { id: Number(user.id), username: user.username, role: user.role, authVersion: this.authVersion(user) };
    const firstLogin = this.passwordChangeRequired(user);
    const refreshRemaining = Math.max(1, this.refreshTtlDays * 86400 - (Math.floor(Date.now() / 1000) - Number(payload.iat || 0)));
    // Claim before minting either successor. This closes the GET/SET race in
    // which two simultaneous refresh requests both passed the blacklist read.
    if (!await this.redis.claimRefreshJti(refreshJti, refreshRemaining)) throw Errors.tokenRevoked();
    const session = sid ? { sid } : await this.sessions.create(user.id, ip, null);
    if (sid) await this.sessions.touch(sid);
    const access = this.sign(core, 'access', { pwdPending: firstLogin, sid: session.sid });
    const newRefresh = this.sign(core, 'refresh', { sid: session.sid });
    // 轮换必须废弃前一个 refresh，不能等到自然过期。
    await this.redis.blacklistJti(refreshJti, refreshRemaining);
    this.setRefreshCookie(res, newRefresh);
    return { access_token: access, expires_in: this.accessTtl, force_change_password: firstLogin };
  }

  async profile(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user) throw Errors.notFound();
    return { ...this.sanitize(user), permissions: await this.access.permissions(user.id) };
  }

  /** 修改本人密码（FR-ORG-06）：校验原密码；成功后同事务写 last_login_at、写封禁键、签发完整令牌 */
  async changePassword(userId: number, oldPassword: string, newPassword: string, ip: string | null, res: Response, currentUser?: AuthUser, refreshToken?: string, req?: Request) {
    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user) throw Errors.notFound();
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) throw Errors.param('原密码错误');
    this.validatePasswordStrength(newPassword, user);

    const hash = await bcrypt.hash(newPassword, 12);
    // 同一事务：覆写哈希、清除独立强制改密标志、递增认证世代、吊销
    // durable sessions，并创建新会话；提交后才写 Redis 快速吊销标记。
    const changed = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(SysUser);
      const u = await repo.findOne({ where: { id: String(userId) } });
      if (!u) throw Errors.notFound();
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
    const core = { id: userId, username: changed.user.username, role: changed.user.role, authVersion: this.authVersion(changed.user) };
    const access = this.sign(core, 'access', { sid: changed.session.sid });
    const refresh = this.sign(core, 'refresh', { sid: changed.session.sid });
    this.setRefreshCookie(res, refresh);
    this.audit.log({
      actor_id: userId, actor_name: changed.user.username, action: 'auth.password.change', object_type: 'sys_user',
      object_id: changed.user.id, detail: {}, result: 'success', source_ip: ip,
    });
    return { access_token: access, expires_in: this.accessTtl };
  }

  /** 登出：吊销所呈报 access（jti 黑名单）+ 吊销 Cookie 中的 refresh + 审计 + 清 Cookie（04 册 1.3 / 07 册 2.1.4） */
  async logout(user: AuthUser, ip: string | null, res: Response, refreshToken?: string) {
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = Math.max(1, this.accessTtl - (nowSec - user.iat));
    if (user.jti && KEY_COMPONENT_PATTERN.test(user.jti)) {
      await this.redis.blacklistJti(user.jti, remaining);
    }
    // refresh 同步吊销：否则已持有 Cookie 的会话在登出后仍可轮换新令牌（TTL = refresh 剩余有效期）
    if (refreshToken) {
      try {
        const payload: any = this.jwt.verify(refreshToken);
        if (payload?.type === 'refresh' && Number(payload.sub) === user.id) {
          const jti = String(payload.jti ?? '');
          if (KEY_COMPONENT_PATTERN.test(jti)) {
            const refreshRemaining = Math.max(1, this.refreshTtlDays * 86400 - (nowSec - Number(payload.iat || nowSec)));
            await this.redis.blacklistJti(jti, refreshRemaining);
          }
        }
      } catch { /* Cookie 中无有效 refresh：忽略 */ }
    }
    if (user.sid) await this.sessions.revokeBySid(user.sid, user.id);
    this.audit.log({
      actor_id: user.id, actor_name: user.username, action: 'auth.logout', object_type: 'sys_user',
      object_id: user.id, detail: {}, result: 'success', source_ip: ip,
    });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
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
