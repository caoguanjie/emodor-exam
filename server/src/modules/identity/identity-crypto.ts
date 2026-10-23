import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import type { IdentitySettings } from './identity-provider';

@Injectable()
export class IdentityCrypto {
  constructor(private readonly config: AppConfig) {}
  private settings(): IdentitySettings { return (this.config as AppConfig & { identity: IdentitySettings }).identity; }
  private key(value: string | undefined): Buffer {
    const decoded = Buffer.from(value || '', 'base64');
    if (decoded.length !== 32) throw Errors.serviceUnavailable('实名认证安全配置不可用');
    return decoded;
  }
  encrypt(value: unknown): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(this.settings()?.dataEncryptionKey), nonce);
    cipher.setAAD(Buffer.from('ruleexam:identity:v1'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }
  decrypt<T = any>(value: string): T {
    try {
      const parts = value.split('.');
      if (parts.length !== 4 || parts[0] !== 'v1') throw new Error();
      const nonce = Buffer.from(parts[1], 'base64url'); const tag = Buffer.from(parts[2], 'base64url');
      if (nonce.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key(this.settings()?.dataEncryptionKey), nonce);
      decipher.setAAD(Buffer.from('ruleexam:identity:v1')); decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8'));
    } catch { throw Errors.serviceUnavailable('实名认证安全数据不可读取'); }
  }
  fingerprint(idNumber: string): string {
    return createHmac('sha256', this.key(this.settings()?.fingerprintSecret)).update(idNumber.trim().toUpperCase()).digest('hex');
  }
}
