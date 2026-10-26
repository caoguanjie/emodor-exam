import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../../config/configuration';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { Errors } from '../../../common/errors';
import { RedisService } from '../../../common/redis.service';
import { SysUser } from '../../../entities/sys-user.entity';
import { AccessService } from '../../access/access.service';
import { SessionService } from '../../auth/session.service';
import { MediaService } from '../media.service';
import { CosDownloadUrlAdapter } from './cos-download-url.adapter';
import { mediaDeliverySettings, MediaTicketView } from './media-delivery.contract';

interface PreviewClaims {
  v: 1; kind: 'pc-preview'; asset: string; user: string;
  jti: string; iat: number; authVersion: number; sid?: string; exp: number;
}
const DECIMAL_ID = /^[1-9]\d{0,19}$/;
const TOKEN_ID = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class PcMediaTicketService {
  constructor(
    private readonly media: MediaService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    @InjectRepository(SysUser) private readonly users: Repository<SysUser>,
    private readonly access: AccessService,
    private readonly urls: CosDownloadUrlAdapter,
  ) {}

  private signature(payload: string): Buffer {
    const secret = Buffer.from(this.config.mediaTicket?.secret || '', 'base64');
    if (secret.length < 32) throw Errors.serviceUnavailable('媒体票据安全配置不可用');
    // A learner ticket cannot be replayed as a PC preview ticket with the same key.
    return createHmac('sha256', secret).update(`pc-media-preview-v1.${payload}`).digest();
  }

  private async assertActor(actor: Pick<AuthUser, 'id' | 'jti' | 'iat' | 'authVersion' | 'sid' | 'pwdPending' | 'client' | 'authMethod'>): Promise<void> {
    if ((actor.client || 'pc') !== 'pc' || (actor.authMethod || 'password') !== 'password') throw Errors.forbidden();
    if (!Number.isSafeInteger(actor.id) || actor.id <= 0 || !TOKEN_ID.test(actor.jti)
      || !Number.isSafeInteger(actor.iat) || actor.iat < 0
      || !Number.isInteger(actor.authVersion ?? 0) || (actor.authVersion ?? 0) < 0
      || (actor.sid !== undefined && !/^[a-f0-9]{48}$/.test(actor.sid))) throw Errors.unauthenticated();
    const user = await this.users.findOne({ where: { id: String(actor.id) } });
    if (!user) throw Errors.unauthenticated();
    if (user.status === 0) throw Errors.accountDisabled();
    if ((actor.authVersion ?? 0) !== Number(user.authVersion || 0)) throw Errors.tokenRevoked();
    if (user.role === 'employee' && !(await this.access.permissions(user.id, { useCache: false })).length) throw Errors.forbidden('学员请使用手机验证码登录');
    if (await this.redis.isTokenBlacklisted(actor.jti)) throw Errors.tokenRevoked();
    const blockedAt = await this.redis.getTokenBlockTs(actor.id);
    if (blockedAt && actor.iat < Number(blockedAt)) throw Errors.tokenRevoked();
    if (actor.sid !== undefined && !await this.sessions.isActiveFor(actor.sid, String(actor.id), 'pc', 'password')) throw Errors.tokenRevoked();
    const passwordPending = user.forcePasswordChange === undefined ? user.lastLoginAt === null : Number(user.forcePasswordChange) === 1;
    if (actor.pwdPending || passwordPending) throw Errors.forbidden('首次登录请先修改密码');
  }

  async issue(actor: AuthUser, assetId: string): Promise<MediaTicketView> {
    if (typeof assetId !== 'string' || !DECIMAL_ID.test(assetId)) throw Errors.param('媒体 ID 非法');
    await this.assertActor(actor);
    const asset = await this.media.authorizeContent(String(actor.id), assetId);
    const signed = this.urls.issue(asset);
    if (signed) return signed;
    const settings = mediaDeliverySettings(this.config);
    const ttl = asset.mediaKind === 'video' ? settings.videoUrlTtlSeconds : settings.readUrlTtlSeconds;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const claims: PreviewClaims = {
      v: 1, kind: 'pc-preview', asset: String(asset.id), user: String(actor.id),
      jti: actor.jti, iat: actor.iat, authVersion: actor.authVersion ?? 0,
      ...(actor.sid === undefined ? {} : { sid: actor.sid }), exp,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const ticket = `${payload}.${this.signature(payload).toString('base64url')}`;
    return { content_url: `/api/v1/media/preview-tickets/${ticket}/content`, expires_at: new Date(exp * 1000).toISOString() };
  }

  private verify(ticket: string): PreviewClaims {
    try {
      if (typeof ticket !== 'string' || ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) throw new Error();
      const [payload, signed] = ticket.split('.');
      const expected = this.signature(payload); const actual = Buffer.from(signed, 'base64url');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
      const claims: PreviewClaims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (claims.v !== 1 || claims.kind !== 'pc-preview'
        || typeof claims.asset !== 'string' || !DECIMAL_ID.test(claims.asset)
        || typeof claims.user !== 'string' || !DECIMAL_ID.test(claims.user) || !Number.isSafeInteger(Number(claims.user))
        || typeof claims.jti !== 'string' || !TOKEN_ID.test(claims.jti)
        || !Number.isSafeInteger(claims.iat) || claims.iat < 0
        || !Number.isInteger(claims.authVersion) || claims.authVersion < 0
        || (claims.sid !== undefined && (typeof claims.sid !== 'string' || !/^[a-f0-9]{48}$/.test(claims.sid)))
        || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error();
      return claims;
    } catch (error) {
      if ((error as any)?.code === 50004) throw error;
      throw Errors.dataForbidden('媒体预览票据无效或已过期');
    }
  }

  async open(ticket: string, range?: string) {
    const claims = this.verify(ticket);
    await this.assertActor({ id: Number(claims.user), jti: claims.jti, iat: claims.iat,
      authVersion: claims.authVersion, sid: claims.sid, client: 'pc', authMethod: 'password' });
    return this.media.openContent(claims.user, claims.asset, range);
  }
}
