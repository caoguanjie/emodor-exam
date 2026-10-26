import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/configuration';
import { MediaService } from '../src/modules/media/media.service';

afterEach(() => vi.unstubAllEnvs());

describe('media runtime configuration', () => {
  it('keeps COS read URL lifetime configurable without accepting an unbounded URL', () => {
    vi.stubEnv('MEDIA_STORAGE_PROVIDER', 'local');
    vi.stubEnv('MEDIA_DELIVERY_MODE', 'cos-signed');
    for (const [name, value] of Object.entries({ COS_BUCKET: 'fixture-1234567890', COS_REGION: 'ap-guangzhou', COS_KEY_PREFIX: 'ruleexam/test/', COS_SECRET_ID: 'unusable-fixture-id', COS_SECRET_KEY: 'unusable-fixture-key' })) vi.stubEnv(name, value);
    vi.stubEnv('MEDIA_READ_URL_TTL_SECONDS', '300');
    vi.stubEnv('MEDIA_VIDEO_URL_TTL_SECONDS', '3600');
    expect(loadConfig().mediaDelivery).toEqual({ mode: 'cos-signed', readUrlTtlSeconds: 300, videoUrlTtlSeconds: 3600 });
    vi.stubEnv('MEDIA_VIDEO_URL_TTL_SECONDS', '3601');
    expect(() => loadConfig()).toThrow(/MEDIA_VIDEO_URL_TTL_SECONDS/);
    vi.stubEnv('MEDIA_VIDEO_URL_TTL_SECONDS', '300');
    vi.stubEnv('MEDIA_DELIVERY_MODE', 'public');
    expect(() => loadConfig()).toThrow(/MEDIA_DELIVERY_MODE/);
    vi.stubEnv('MEDIA_DELIVERY_MODE', 'cos-signed');
    vi.stubEnv('COS_SECRET_KEY', undefined);
    expect(() => loadConfig()).toThrow(/COS_SECRET_KEY/);
  });

  it('advertises proxy fallback and the same upload limits used by the session service', () => {
    vi.stubEnv('MEDIA_STORAGE_PROVIDER', 'local');
    vi.stubEnv('MEDIA_UPLOAD_PART_SIZE_BYTES', '4194304');
    const config = loadConfig();
    const service = new MediaService(null as any, null as any, null as any, config, null as any);
    expect(service.limits()).toMatchObject({ upload_mode: 'proxy', part_size_bytes: 4194304, parallel_limit: 3, upload_session_ttl_seconds: 86400 });
  });

  it('rejects a partial COS configuration during application startup', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('MEDIA_STORAGE_PROVIDER', 'cos');
    for (const key of ['COS_BUCKET', 'COS_REGION', 'COS_KEY_PREFIX', 'COS_SECRET_ID', 'COS_SECRET_KEY']) {
      vi.stubEnv(key, undefined);
    }
    expect(() => loadConfig()).toThrow(/COS/);
  });

  it('loads bounded upload settings and rejects a lease that cannot be renewed safely', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('MEDIA_STORAGE_PROVIDER', 'local');
    vi.stubEnv('MEDIA_UPLOAD_PARALLEL_LIMIT', '4');
    vi.stubEnv('MEDIA_FINALIZER_LEASE_SECONDS', '120');
    vi.stubEnv('MEDIA_FINALIZER_RENEW_SECONDS', '70');
    expect(() => loadConfig()).toThrow(/MEDIA_FINALIZER/);
    vi.stubEnv('MEDIA_FINALIZER_RENEW_SECONDS', '30');
    const config = loadConfig();
    expect(config.mediaUpload.parallelLimit).toBe(4);
    expect(config.mediaUpload.leaseSeconds).toBe(120);
    expect(config.mediaUpload.renewSeconds).toBe(30);
    vi.stubEnv('MEDIA_UPLOAD_PARALLEL_LIMIT', '0');
    expect(() => loadConfig()).toThrow(/MEDIA_UPLOAD_PARALLEL_LIMIT/);
  });
});
