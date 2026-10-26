import { describe, expect, it } from 'vitest';
import { readCosMediaConfig } from '../src/modules/media/storage/cos-media.config';

const configured = {
  MEDIA_STORAGE_PROVIDER: 'cos', COS_BUCKET: 'fixture-1234567890', COS_REGION: 'ap-guangzhou',
  COS_KEY_PREFIX: 'ruleexam/test/', COS_SECRET_ID: 'unusable-fixture-id', COS_SECRET_KEY: 'unusable-fixture-key',
};

describe('media storage configuration', () => {
  it('defaults to local and does not invent COS credentials', () => {
    expect(readCosMediaConfig({})).toEqual({ provider: 'local', bucket: null, region: null, keyPrefix: null, secretId: null, secretKey: null, sessionToken: null });
  });
  it('requires complete COS configuration instead of silently falling back', () => {
    expect(() => readCosMediaConfig({ MEDIA_STORAGE_PROVIDER: 'cos' })).toThrow(/COS_/);
    for (const key of ['COS_BUCKET', 'COS_REGION', 'COS_KEY_PREFIX', 'COS_SECRET_ID', 'COS_SECRET_KEY']) {
      expect(() => readCosMediaConfig({ ...configured, [key]: '' })).toThrow(key);
    }
  });
  it('rejects unsafe prefixes and unsupported drivers before SDK use', () => {
    for (const prefix of ['/', 'ruleexam', '../other/', 'ruleexam/../other/', 'ruleexam//test/', '/ruleexam/', 'ruleexam/%2fother/', 'ruleexam\\test/']) {
      expect(() => readCosMediaConfig({ ...configured, COS_KEY_PREFIX: prefix })).toThrow(/COS_KEY_PREFIX/);
    }
    expect(() => readCosMediaConfig({ MEDIA_STORAGE_PROVIDER: 's3' })).toThrow(/MEDIA_STORAGE_PROVIDER/);
  });
  it('preserves credential values and accepts an explicit temporary session token', () => {
    expect(readCosMediaConfig({ ...configured, COS_SESSION_TOKEN: 'unusable-token' })).toMatchObject({
      provider: 'cos', bucket: configured.COS_BUCKET, region: configured.COS_REGION,
      keyPrefix: configured.COS_KEY_PREFIX, secretId: configured.COS_SECRET_ID,
      secretKey: configured.COS_SECRET_KEY, sessionToken: 'unusable-token',
    });
  });
});
