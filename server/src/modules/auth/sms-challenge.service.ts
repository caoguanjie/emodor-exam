import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { maskPhone, normalizeChinaMobile } from './phone';
import { SMS_PROVIDER, SmsProvider } from './sms-provider';

@Injectable()
export class SmsChallengeService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
  ) {}

  private hash(value: string): string {
    return createHmac('sha256', this.config.jwt.secret).update(value).digest('hex');
  }

  private key(value: string): string { return `${this.config.sms.redisKeyPrefix}${value}`; }
  private ready() {
    if (this.config.sms.provider === 'disabled') throw Errors.serviceUnavailable('短信服务暂未开启');
  }

  async issue(input: string, ip: string) {
    const phone = normalizeChinaMobile(input);
    this.ready();
    const settings = this.config.sms;
    const phoneHash = this.hash(phone);
    const resendKey = this.key(`resend:${phoneHash}`);
    const challengeId = randomBytes(24).toString('hex');
    if (!await this.redis.setNx(resendKey, challengeId, settings.resendSeconds)) throw Errors.tooManyRequests('请稍后重新获取验证码');
    try {
      if (await this.redis.incr(this.key(`phone-day:${phoneHash}`), 86400) > settings.phoneDailyLimit) throw Errors.tooManyRequests('今日短信次数已达上限');
      if (await this.redis.incr(this.key(`ip-day:${this.hash(ip)}`), 86400) > settings.ipDailyLimit) throw Errors.tooManyRequests('今日短信次数已达上限');
      await this.provider.sendLoginCode(phone);
      const activeKey = this.key(`active:${phoneHash}`);
      const previous = await this.redis.get(activeKey);
      if (previous && /^[a-f0-9]{48}$/.test(previous)) await this.redis.del(this.key(`challenge:${previous}`));
      // No code or full phone is persisted in the challenge store.
      await this.redis.set(this.key(`challenge:${challengeId}`), phoneHash, settings.verifyTtlSeconds);
      await this.redis.set(activeKey, challengeId, settings.verifyTtlSeconds);
    } catch (error) {
      await this.redis.compareAndDelete(resendKey, challengeId);
      throw error;
    }
    return { challenge_id: challengeId, expires_in: settings.verifyTtlSeconds, retry_after: settings.resendSeconds, masked_phone: maskPhone(phone) };
  }

  async verify(challengeId: string, input: string, code: string): Promise<void> {
    const phone = normalizeChinaMobile(input);
    this.ready();
    if (typeof challengeId !== 'string' || !/^[a-f0-9]{48}$/.test(challengeId)) throw Errors.param('验证码会话已失效，请重新获取');
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw Errors.param('请输入6位短信验证码');
    const phoneHash = this.hash(phone);
    const key = this.key(`challenge:${challengeId}`);
    if (await this.redis.get(key) !== phoneHash || await this.redis.get(this.key(`active:${phoneHash}`)) !== challengeId) throw Errors.param('验证码会话已失效，请重新获取');
    const attempts = await this.redis.incr(this.key(`attempts:${challengeId}`), this.config.sms.verifyTtlSeconds);
    if (attempts > this.config.sms.maxVerifyAttempts) throw Errors.tooManyRequests('验证码尝试次数已达上限，请重新获取');
    await this.provider.verifyLoginCode(phone, code);
    if (await this.redis.get(this.key(`active:${phoneHash}`)) !== challengeId || await this.redis.getAndDelete(key) !== phoneHash) throw Errors.param('验证码会话已失效，请重新获取');
  }
}
