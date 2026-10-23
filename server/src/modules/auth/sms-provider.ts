import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export interface SmsProvider {
  sendLoginCode(phone: string): Promise<{ providerRequestId: string }>;
  verifyLoginCode(phone: string, code: string): Promise<void>;
}

@Injectable()
export class YunxinSmsProvider implements SmsProvider {
  constructor(private readonly config: AppConfig) {}

  private async post(path: string, data: Record<string, string>): Promise<Record<string, unknown>> {
    if (this.config.sms.provider !== 'yunxin') throw Errors.serviceUnavailable('短信服务暂未开启');
    const { appKey, appSecret, baseUrl, timeoutSeconds } = this.config.sms;
    const nonce = randomBytes(16).toString('hex');
    const curTime = String(Math.floor(Date.now() / 1000));
    let response: globalThis.Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutSeconds * 1000),
        headers: {
          AppKey: appKey!, Nonce: nonce, CurTime: curTime,
          CheckSum: createHash('sha1').update(`${appSecret}${nonce}${curTime}`).digest('hex'),
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        body: new URLSearchParams(data).toString(),
      });
    } catch { throw Errors.serviceUnavailable('短信服务暂不可用'); }
    if (!response.ok) throw Errors.serviceUnavailable('短信服务暂不可用');
    let payload: Record<string, unknown>;
    try { payload = await response.json() as Record<string, unknown>; }
    catch { throw Errors.serviceUnavailable('短信服务响应异常'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Errors.serviceUnavailable('短信服务响应异常');
    const code = Number(payload.code);
    if (code === 413) throw Errors.param('验证码错误');
    if (code === 416) throw Errors.tooManyRequests('短信请求过于频繁，请稍后重试');
    if (code !== 200) throw Errors.serviceUnavailable('短信服务暂不可用');
    // Never log vendor messages or request bodies: they can contain credentials or PII.
    return payload;
  }

  async sendLoginCode(phone: string) {
    const payload = await this.post('/sms/sendcode.action', {
      mobile: phone, templateid: this.config.sms.templateId!, codeLen: '6',
    });
    return { providerRequestId: typeof payload.msg === 'string' || typeof payload.msg === 'number' ? String(payload.msg) : '' };
  }

  async verifyLoginCode(phone: string, code: string): Promise<void> {
    await this.post('/sms/verifycode.action', { mobile: phone, code });
  }
}
