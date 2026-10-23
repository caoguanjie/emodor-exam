import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../errors';
import { RedisService } from '../redis.service';
import { SessionService } from '../../modules/auth/session.service';
import { SysUser } from '../../entities/sys-user.entity';
import { AuthUser } from '../decorators/current-user.decorator';
import { PUBLIC_KEY } from './public.decorator';
import { AccessService } from '../../modules/access/access.service';

/** refresh token 的 HttpOnly Cookie 名（04 册 4.1：Path=/api/v1/auth） */
export const REFRESH_COOKIE = 'ruleexam_refresh';
export const MOBILE_REFRESH_COOKIE = 'ruleexam_mobile_refresh';

/** 键白名单：jti / sub 仅允许令牌签发时的安全字符集，上限 64 字符（防键注入） */
export const KEY_COMPONENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 全局 JWT 认证守卫（守卫链第一级，07 册 2.3.2）：
 * ① 验签（JWT_SECRET + 过渡期 JWT_SECRET_PRIOR）→ ② exp 校验 → ③ jti 黑名单
 * → ④ 用户级封禁判定（token.iat < block_ts 拒绝，07 册 2.1.4）
 * → ⑤ 首次登录受限令牌（pwd_pending）仅放行 PUT /auth/password。
 * 黑名单 / 封禁键的读写统一封装于 RedisService 安全方法。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly access: AccessService,
  ) {}

  /** 验签：先主密钥后轮换过渡旧密钥（07 册 2.1.3），过期与伪造分别映射 40102/40101 */
  private verifyToken(token: string): any {
    try {
      return this.jwt.verify(token, { secret: this.config.jwt.secret });
    } catch (e: any) {
      if (e?.name === 'TokenExpiredError') throw Errors.tokenExpired();
      if (this.config.jwt.priorSecret) {
        try {
          return this.jwt.verify(token, { secret: this.config.jwt.priorSecret });
        } catch (e2: any) {
          if (e2?.name === 'TokenExpiredError') throw Errors.tokenExpired();
        }
      }
      return null;
    }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (isPublic) return true;

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw Errors.unauthenticated();

    const payload = this.verifyToken(token);
    if (!payload) throw Errors.unauthenticated();

    // 仅接受 access 令牌作为接口凭证：refresh 只允许经 /auth/refresh 的 HttpOnly Cookie 轮换，
    // 防止 7 天有效期的 refresh token 被直接当作 Bearer 绕过单令牌吊销与首登强制改密（07 册 2.1）
    if (payload.type !== 'access') throw Errors.unauthenticated();

    // 白名单校验后才可进入 Redis 键拼装（防键注入）
    const subKey = String(payload.sub ?? '');
    if (!KEY_COMPONENT_PATTERN.test(subKey)) throw Errors.unauthenticated();
    const userId = Number(subKey);
    const client = payload.client || 'pc';
    const authMethod = payload.auth_method || 'password';
    if (!['pc', 'mobile'].includes(client) || (client === 'mobile' ? !['sms', 'debug'].includes(authMethod) : authMethod !== 'password')) throw Errors.unauthenticated();
    // Express route matching is case-insensitive by default, so the client boundary
    // must normalize exactly the same path variants before checking prefixes.
    const path = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api\/v1/i, '').toLowerCase();
    if ((path.startsWith('/mobile/') && client !== 'mobile') || (client === 'mobile' && (path.startsWith('/admin/') || path.startsWith('/auth/')))) throw Errors.forbidden();

    // The database is authoritative for status, system role and auth generation;
    // token role/version fields are only compatibility hints for old tokens.
    const currentUser = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!currentUser) throw Errors.unauthenticated();
    if (currentUser.status === 0) throw Errors.accountDisabled();
    if (client === 'mobile' && (currentUser.role !== 'employee' || (await this.access.permissions(currentUser.id, { useCache: false })).length > 0)) throw Errors.forbidden('此账号请使用管理端账号密码登录');
    if (client === 'pc' && currentUser.role === 'employee' && !(await this.access.permissions(currentUser.id, { useCache: false })).length) throw Errors.forbidden('学员请使用手机验证码登录');
    const tokenVersion = Number(payload.auth_version ?? 0);
    const currentVersion = Number(currentUser.authVersion || 0);
    if (!Number.isInteger(tokenVersion) || tokenVersion !== currentVersion) throw Errors.tokenRevoked();

    // ③ 单令牌黑名单（登出吊销，07 册 2.1.4）
    const jti = String(payload.jti ?? '');
    if (!KEY_COMPONENT_PATTERN.test(jti)) throw Errors.unauthenticated();
    if (await this.redis.isTokenBlacklisted(jti)) throw Errors.tokenRevoked();

    // ④ 用户级封禁（改密/重置/停用后，iat 早于封禁时刻的令牌一律失效）
    const blockTs = await this.redis.getTokenBlockTs(userId);
    if (blockTs && Number(payload.iat) < Number(blockTs)) throw Errors.tokenRevoked();

    // 新令牌绑定 auth_session；旧的无 sid 令牌继续走原有黑名单/用户封禁兼容路径。
    const sid = payload.sid === undefined ? undefined : String(payload.sid);
    if (client === 'mobile' && !sid) throw Errors.tokenRevoked();
    if (sid !== undefined) {
      if (!/^[a-f0-9]{48}$/.test(sid) || !await this.sessions.isActiveFor(sid, userId, client, authMethod)) throw Errors.tokenRevoked();
      await this.sessions.touch(sid);
    }

    // ⑤ 受限令牌（首次登录强制改密，07 册 2.2.3）：仅放行修改本人密码
    const forcePasswordChange = currentUser.forcePasswordChange === undefined
      ? currentUser.lastLoginAt === null
      : Number(currentUser.forcePasswordChange) === 1;
    if (client === 'pc' && (payload.pwd_pending === true || forcePasswordChange)) {
      const path = (req.baseUrl || '') + (req.route?.path || req.url || '');
      const allowed = req.method === 'PUT' && path.replace('/api/v1', '').startsWith('/auth/password');
      if (!allowed) throw Errors.forbidden('首次登录请先修改密码');
    }

    req.user = {
      id: userId,
      username: currentUser.username,
      role: currentUser.role,
      jti: String(payload.jti ?? ''),
      iat: Number(payload.iat ?? 0),
      sid,
      authVersion: currentVersion,
      pwdPending: client === 'pc' && (payload.pwd_pending === true || forcePasswordChange),
      client, authMethod,
    };
    return true;
  }
}
