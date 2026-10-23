import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { EntityManager, Repository } from 'typeorm';
import { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { SysUser } from '../../entities/sys-user.entity';
import { AuthSession } from '../../entities/auth-session.entity';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { KEY_COMPONENT_PATTERN, REFRESH_COOKIE, MOBILE_REFRESH_COOKIE } from '../../common/guards/jwt-auth.guard';
import { AccessService } from '../access/access.service';
import { SessionService } from './session.service';

export type SessionClient = 'pc' | 'mobile';
export interface SessionInput { client: SessionClient; authMethod: 'password' | 'sms' | 'debug'; ip: string | null; userAgent: string | null }

export function parseExpirySeconds(expr: string): number {
  const match = expr.trim().match(/^(\d+)([smhd])?$/);
  if (!match) return 7200;
  return Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2] || 's'] || 1);
}

/** The only JWT minting and refresh rotation core used by password/SMS/debug. */
@Injectable()
export class SessionIssuerService {
  readonly accessTtl: number;
  readonly refreshTtlSeconds: number;

  constructor(
    @InjectRepository(SysUser) private readonly users: Repository<SysUser>,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
  ) {
    this.accessTtl = parseExpirySeconds(config.jwt.expiresIn);
    this.refreshTtlSeconds = config.jwt.refreshExpiresDays * 86400;
  }

  passwordPending(user: SysUser): boolean {
    return user.forcePasswordChange === undefined ? user.lastLoginAt === null : Number(user.forcePasswordChange) === 1;
  }

  async assertMobileUser(user: SysUser, manager?: EntityManager): Promise<void> {
    if (Number(user.status) !== 1) throw Errors.accountDisabled();
    if (user.role !== 'employee' || (await this.access.permissions(user.id, { manager, useCache: false })).length) throw Errors.forbidden('此账号请使用管理端账号密码登录');
  }

  private cookie(client: SessionClient) {
    return { name: client === 'mobile' ? MOBILE_REFRESH_COOKIE : REFRESH_COOKIE, path: client === 'mobile' ? '/api/v1/mobile/auth' : '/api/v1/auth' };
  }

  async issue(user: SysUser, input: SessionInput, res: Response, existing?: AuthSession | { sid: string }, pwdPending = false) {
    const session = existing || await this.sessions.create(user.id, input.ip, input.userAgent, undefined, input);
    const claims = { sub: String(user.id), username: user.username, role: user.role, auth_version: Number(user.authVersion || 0), sid: session.sid, client: input.client, auth_method: input.authMethod };
    const access = this.jwt.sign({ ...claims, type: 'access', jti: randomBytes(16).toString('hex'), ...(input.client === 'pc' && pwdPending ? { pwd_pending: true } : {}) }, { expiresIn: this.accessTtl });
    const refresh = this.jwt.sign({ ...claims, type: 'refresh', jti: randomBytes(16).toString('hex') }, { expiresIn: this.refreshTtlSeconds });
    const cookie = this.cookie(input.client);
    res.cookie(cookie.name, refresh, { httpOnly: true, secure: this.config.env === 'production', sameSite: 'strict', path: cookie.path, maxAge: this.refreshTtlSeconds * 1000 });
    return { access_token: access, expires_in: this.accessTtl };
  }

  async refresh(token: string | undefined, client: SessionClient, ip: string | null, res: Response) {
    if (!token) throw Errors.refreshTokenInvalid();
    let payload: any;
    try { payload = this.jwt.verify(token); } catch { throw Errors.refreshTokenInvalid(); }
    if (payload?.type !== 'refresh' || (payload.client || 'pc') !== client) throw Errors.refreshTokenInvalid();
    const jti = String(payload.jti || '');
    if (!KEY_COMPONENT_PATTERN.test(jti) || !/^[1-9]\d*$/.test(String(payload.sub || ''))) throw Errors.refreshTokenInvalid();
    if (await this.redis.isTokenBlacklisted(jti)) throw Errors.tokenRevoked();
    const method = payload.auth_method || 'password';
    if (client === 'mobile' ? !['sms', 'debug'].includes(method) : method !== 'password') throw Errors.refreshTokenInvalid();
    const sid = payload.sid;
    if (client === 'mobile' && typeof sid !== 'string') throw Errors.tokenRevoked();
    if (sid !== undefined && (typeof sid !== 'string' || !/^[a-f0-9]{48}$/.test(sid) || !await this.sessions.isActiveFor(sid, payload.sub, client, method))) throw Errors.tokenRevoked();
    const user = await this.users.findOne({ where: { id: String(payload.sub) } });
    if (!user || Number(user.status) !== 1) throw Errors.refreshTokenInvalid();
    if (Number(payload.auth_version ?? 0) !== Number(user.authVersion || 0)) throw Errors.tokenRevoked();
    const blockTs = await this.redis.getTokenBlockTs(Number(user.id));
    if (blockTs && Number(payload.iat) < Number(blockTs)) throw Errors.tokenRevoked();
    if (client === 'mobile') await this.assertMobileUser(user);
    if (client === 'pc' && user.role === 'employee' && !(await this.access.permissions(user.id, { useCache: false })).length) {
      throw Errors.forbidden('学员请使用手机验证码登录');
    }
    const remaining = Math.max(1, Number(payload.exp) - Math.floor(Date.now() / 1000));
    if (!await this.redis.claimRefreshJti(jti, remaining)) throw Errors.tokenRevoked();
    const session = sid ? { sid } : await this.sessions.create(user.id, ip, null, undefined, { client, authMethod: method });
    if (sid) await this.sessions.touch(sid, true);
    const pwdPending = client === 'pc' && this.passwordPending(user);
    const pair = await this.issue(user, { client, authMethod: method, ip, userAgent: null }, res, session, pwdPending);
    await this.redis.blacklistJti(jti, remaining);
    return { ...pair, user, force_change_password: pwdPending };
  }

  async revoke(user: AuthUser, res: Response, refreshToken?: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const client = user.client || 'pc';
    if (user.jti && KEY_COMPONENT_PATTERN.test(user.jti)) await this.redis.blacklistJti(user.jti, Math.max(1, this.accessTtl - (now - user.iat)));
    if (refreshToken) {
      let payload: any;
      try { payload = this.jwt.verify(refreshToken); } catch { /* invalid cookies do not prevent logout */ }
      if (payload?.type === 'refresh' && Number(payload.sub) === user.id && (payload.client || 'pc') === client && (!user.sid || payload.sid === user.sid) && KEY_COMPONENT_PATTERN.test(String(payload.jti || ''))) {
        await this.redis.blacklistJti(payload.jti, Math.max(1, Number(payload.exp) - now));
      }
    }
    if (user.sid) await this.sessions.revokeBySid(user.sid, user.id);
    res.clearCookie(this.cookie(client).name, { path: this.cookie(client).path });
  }

  /** Logout does not need a live access token; only its own signed mobile cookie authorizes revocation. */
  async revokeMobileCookie(token: string | undefined, res: Response): Promise<number | null> {
    try {
      if (!token) return null;
      let payload: any;
      try { payload = this.jwt.verify(token, { ignoreExpiration: true }); } catch { return null; }
      if (payload?.type !== 'refresh' || payload.client !== 'mobile' || !['sms', 'debug'].includes(payload.auth_method)
        || !/^[1-9]\d*$/.test(String(payload.sub || '')) || !KEY_COMPONENT_PATTERN.test(String(payload.jti || ''))
        || !/^[a-f0-9]{48}$/.test(String(payload.sid || ''))) return null;
      const remaining = Math.max(1, Number(payload.exp || 0) - Math.floor(Date.now() / 1000));
      await this.redis.blacklistJti(payload.jti, remaining);
      if (await this.sessions.isActiveFor(payload.sid, payload.sub, 'mobile', payload.auth_method)) await this.sessions.revokeBySid(payload.sid, payload.sub);
      return Number(payload.sub);
    } finally {
      res.clearCookie(MOBILE_REFRESH_COOKIE, { path: '/api/v1/mobile/auth' });
    }
  }
}
