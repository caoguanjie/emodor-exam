import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration';
import { IdentityCrypto } from '../src/modules/identity/identity-crypto';

const NAMES = [
  'NODE_ENV', 'JWT_SECRET', 'EXAM_SHUFFLE_SECRET', 'APP_ENCRYPTION_KEY',
  'IDENTITY_PROVIDER', 'IDENTITY_DATA_ENCRYPTION_KEY', 'IDENTITY_FINGERPRINT_SECRET',
  'IDENTITY_SESSION_TTL_SECONDS', 'MEDIA_TICKET_SECRET', 'MEDIA_TICKET_TTL_SECONDS',
  'TENCENT_ID_CARD_OCR_ENABLED', 'TENCENT_ID_CARD_OCR_SECRET_ID', 'TENCENT_ID_CARD_OCR_SECRET_KEY',
  'TENCENT_ID_CARD_OCR_TOKEN', 'TENCENT_ID_CARD_OCR_ENDPOINT', 'TENCENT_ID_CARD_OCR_HTTP_TIMEOUT_SECONDS',
  'TENCENT_FACEID_ENABLED', 'TENCENT_FACEID_SECRET_ID', 'TENCENT_FACEID_SECRET_KEY',
  'TENCENT_FACEID_TOKEN', 'TENCENT_FACEID_ENDPOINT', 'TENCENT_FACEID_HTTP_TIMEOUT_SECONDS',
] as const;

async function withEnv(values: Partial<Record<(typeof NAMES)[number], string>>, action: () => unknown | Promise<unknown>) {
  const before = new Map(NAMES.map((name) => [name, process.env[name]]));
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, values);
  try { return await action(); }
  finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe.sequential('identity and media-ticket configuration', () => {
  it('defaults to disabled with process-local 32-byte secrets and official endpoints', async () => {
    await withEnv({ NODE_ENV: 'test' }, () => {
      const config = loadConfig();
      expect(config.identity.provider).toBe('disabled');
      expect(Buffer.from(config.identity.dataEncryptionKey, 'base64')).toHaveLength(32);
      expect(Buffer.from(config.identity.fingerprintSecret, 'base64')).toHaveLength(32);
      expect(Buffer.from(config.mediaTicket.secret, 'base64')).toHaveLength(32);
      expect(config.identity.sessionTtlSeconds).toBe(600);
      expect(config.mediaTicket.ttlSeconds).toBe(300);
      expect(config.identity.idCardOcr.endpoint).toBe('https://ocr.tencentcloudapi.com/');
      expect(config.identity.faceId.endpoint).toBe('https://faceid.tencentcloudapi.com/');
    });
  });

  it('requires both fully configured Tencent adapters', async () => {
    await withEnv({ NODE_ENV: 'test', IDENTITY_PROVIDER: 'tencent' }, () => {
      expect(() => loadConfig()).toThrow(/同时启用/);
    });
    await withEnv({ NODE_ENV: 'test', TENCENT_FACEID_ENABLED: 'true' }, () => {
      expect(() => loadConfig()).toThrow(/FaceID/);
    });
  });

  it('accepts Tencent only with official HTTPS endpoints and both credential groups', async () => {
    const values = {
      NODE_ENV: 'test', IDENTITY_PROVIDER: 'tencent',
      IDENTITY_DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), IDENTITY_FINGERPRINT_SECRET: randomBytes(32).toString('base64'),
      TENCENT_ID_CARD_OCR_ENABLED: 'true', TENCENT_ID_CARD_OCR_SECRET_ID: 'ocr-id', TENCENT_ID_CARD_OCR_SECRET_KEY: 'ocr-key',
      TENCENT_FACEID_ENABLED: 'true', TENCENT_FACEID_SECRET_ID: 'face-id', TENCENT_FACEID_SECRET_KEY: 'face-key',
    } as const;
    await withEnv(values, () => expect(loadConfig().identity.provider).toBe('tencent'));
    await withEnv({ ...values, TENCENT_FACEID_ENDPOINT: 'http://127.0.0.1:9000' }, () => {
      expect(() => loadConfig()).toThrow(/腾讯官方 HTTPS/);
    });
  });

  it.each(['development', 'test'])('requires durable identity keys for Tencent in %s', async (env) => {
    const provider = { NODE_ENV: env, IDENTITY_PROVIDER: 'tencent',
      TENCENT_ID_CARD_OCR_ENABLED: 'true', TENCENT_ID_CARD_OCR_SECRET_ID: 'synthetic-ocr-id', TENCENT_ID_CARD_OCR_SECRET_KEY: 'synthetic-ocr-key',
      TENCENT_FACEID_ENABLED: 'true', TENCENT_FACEID_SECRET_ID: 'synthetic-face-id', TENCENT_FACEID_SECRET_KEY: 'synthetic-face-key' };
    await withEnv(provider, () => expect(() => loadConfig()).toThrow(/IDENTITY_DATA_ENCRYPTION_KEY/));
    await withEnv({ ...provider, IDENTITY_DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') }, () => expect(() => loadConfig()).toThrow(/IDENTITY_FINGERPRINT_SECRET/));
  });

  it('uses explicitly injected keys across fresh config loads without requiring a persistent nonproduction media key', async () => {
    await withEnv({ NODE_ENV: 'development', IDENTITY_PROVIDER: 'tencent',
      IDENTITY_DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), IDENTITY_FINGERPRINT_SECRET: randomBytes(32).toString('base64'),
      TENCENT_ID_CARD_OCR_ENABLED: 'true', TENCENT_ID_CARD_OCR_SECRET_ID: 'synthetic-ocr-id', TENCENT_ID_CARD_OCR_SECRET_KEY: 'synthetic-ocr-key',
      TENCENT_FACEID_ENABLED: 'true', TENCENT_FACEID_SECRET_ID: 'synthetic-face-id', TENCENT_FACEID_SECRET_KEY: 'synthetic-face-key' }, () => {
      const first = new IdentityCrypto(loadConfig()); const second = new IdentityCrypto(loadConfig());
      const encrypted = first.encrypt({ realName: '合成主体', idNumber: 'SYNTHETIC-DOCUMENT' });
      expect(second.decrypt(encrypted)).toEqual({ realName: '合成主体', idNumber: 'SYNTHETIC-DOCUMENT' });
      expect(second.fingerprint('SYNTHETIC-DOCUMENT')).toBe(first.fingerprint('SYNTHETIC-DOCUMENT'));
    });
  });

  it('rejects malformed secrets, booleans and TTLs without echoing their values', async () => {
    await withEnv({ NODE_ENV: 'test', IDENTITY_DATA_ENCRYPTION_KEY: 'private-not-base64' }, () => {
      expect(() => loadConfig()).toThrow(/IDENTITY_DATA_ENCRYPTION_KEY/);
    });
    await withEnv({ NODE_ENV: 'test', TENCENT_FACEID_ENABLED: 'yes' }, () => {
      expect(() => loadConfig()).toThrow(/TENCENT_FACEID_ENABLED/);
    });
    await withEnv({ NODE_ENV: 'test', MEDIA_TICKET_TTL_SECONDS: '0' }, () => {
      expect(() => loadConfig()).toThrow(/MEDIA_TICKET_TTL_SECONDS/);
    });
  });

  it('requires all three identity/media secrets in production', async () => {
    const common = {
      NODE_ENV: 'production', JWT_SECRET: randomBytes(32).toString('base64'),
      EXAM_SHUFFLE_SECRET: randomBytes(32).toString('base64'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    };
    await withEnv(common, () => expect(() => loadConfig()).toThrow(/IDENTITY_DATA_ENCRYPTION_KEY/));
  });
});
