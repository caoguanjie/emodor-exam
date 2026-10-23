import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { MediaService } from './media.service';

export interface MediaTicketSettings { secret: string; ttlSeconds: number }
export interface MediaTicketClaims { v: 1; asset: string; user: string; purpose: string; ownerType: string; ownerId: string; exp: number }
@Injectable()
export class MediaTicketService {
  constructor(private readonly media: MediaService, private readonly config: AppConfig) {}
  private settings(): MediaTicketSettings { return (this.config as AppConfig & { mediaTicket: MediaTicketSettings }).mediaTicket; }
  private signature(payload: string): Buffer {
    const secret = Buffer.from(this.settings()?.secret || '', 'base64');
    if (secret.length < 32) throw Errors.serviceUnavailable('媒体票据安全配置不可用');
    return createHmac('sha256', secret).update(payload).digest();
  }
  async issue(userId: string, assetId: string, ownerType: string, ownerId: string) {
    const asset = await this.media.authorizeTicket(userId, assetId, ownerType, ownerId);
    const ttl = this.settings()?.ttlSeconds || 300;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const claims: MediaTicketClaims = { v: 1, asset: String(asset.id), user: userId, purpose: asset.purpose, ownerType, ownerId, exp };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const ticket = `${payload}.${this.signature(payload).toString('base64url')}`;
    return { content_url: `/api/v1/media/tickets/${ticket}/content`, expires_at: new Date(exp * 1000).toISOString() };
  }
  verify(ticket: string): MediaTicketClaims {
    try {
      if (typeof ticket !== 'string' || ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) throw new Error();
      const [payload, signed] = ticket.split('.');
      const expected = this.signature(payload); const actual = Buffer.from(signed, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new Error();
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (claims.v !== 1 || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)
        || !['asset', 'user', 'ownerId'].every((key) => typeof claims[key] === 'string' && /^[1-9]\d{0,19}$/.test(claims[key]))
        || typeof claims.purpose !== 'string' || typeof claims.ownerType !== 'string') throw new Error();
      return claims;
    } catch (error) {
      if ((error as any)?.code === 50004) throw error;
      throw Errors.dataForbidden('媒体票据无效或已过期');
    }
  }
  open(ticket: string, range?: string) { return this.media.openTicketContent(this.verify(ticket), range); }
}
