import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../../common/redis.service';
import { Errors } from '../../common/errors';

export const CAPTCHA_TTL_SECONDS = 120;
const CAPTCHA_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface CaptchaIssue {
  captcha_id: string;
  image: string;
  expires_in: number;
}

/**
 * 管理员登录验证码。
 * 答案只写入短 TTL Redis 键，不随 HTTP 响应返回；verify 使用 GETDEL 一次消费。
 */
@Injectable()
export class CaptchaService {
  constructor(private readonly redis: RedisService) {}

  private key(captchaId: string): string {
    return `auth:captcha:${captchaId}`;
  }

  private code(): string {
    const bytes = randomBytes(5);
    return Array.from(bytes, (value) => CAPTCHA_ALPHABET[value % CAPTCHA_ALPHABET.length]).join('');
  }

  private image(code: string): string {
    const letters = [...code].map((letter, index) => {
      const x = 24 + index * 24;
      const rotate = (index % 2 === 0 ? -1 : 1) * (4 + index);
      return `<text x="${x}" y="39" transform="rotate(${rotate} ${x} 39)">${letter}</text>`;
    }).join('');
    const noise = Array.from({ length: 5 }, (_, index) => {
      const x1 = 5 + index * 22;
      const y1 = 10 + (index * 13) % 35;
      const x2 = 110 - index * 15;
      const y2 = 8 + (index * 19) % 45;
      return `<path d="M${x1} ${y1} L${x2} ${y2}"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="56" viewBox="0 0 128 56"><rect width="128" height="56" rx="8" fill="#f2f5fb"/><g stroke="#a8b4ca" stroke-width="1">${noise}</g><g fill="#1c3874" font-family="Arial,sans-serif" font-size="25" font-weight="700">${letters}</g></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  async issue(scope = 'anonymous', previousCaptchaId?: string): Promise<CaptchaIssue> {
    if (previousCaptchaId !== undefined && !/^[a-f0-9]{32}$/.test(String(previousCaptchaId))) {
      throw Errors.param('验证码标识非法');
    }
    const count = await this.redis.incr(`auth:captcha:ip:${scope || 'anonymous'}`, 60);
    if (count > 10) throw Errors.tooManyRequests('验证码请求过于频繁');
    const captchaId = randomBytes(16).toString('hex');
    const answer = this.code();
    await this.redis.set(this.key(captchaId), answer, CAPTCHA_TTL_SECONDS);
    if (previousCaptchaId) await this.redis.del(this.key(previousCaptchaId));
    return { captcha_id: captchaId, image: this.image(answer), expires_in: CAPTCHA_TTL_SECONDS };
  }

  async verify(captchaId: string, answer: string): Promise<boolean> {
    if (!/^[a-f0-9]{32}$/.test(String(captchaId)) || typeof answer !== 'string' || !answer.trim()) return false;
    const expected = await this.redis.getAndDelete(this.key(captchaId));
    return expected !== null && expected === answer.trim().toUpperCase();
  }
}
