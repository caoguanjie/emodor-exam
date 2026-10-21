import { describe, it, expect, afterEach } from 'vitest';
import { RedisService } from '../src/common/redis.service';
import { loadConfig } from '../src/config/configuration';

describe('RedisService key namespace', () => {
  afterEach(() => {
    delete process.env.REDIS_KEY_PREFIX;
  });

  it('uses REDIS_KEY_PREFIX for strings, hashes, counters, and prefix scans', async () => {
    const service = new RedisService({ redis: { enabled: false, host: '127.0.0.1', port: 6379, keyPrefix: 'a1:test:' } } as any);
    await service.set('stat:one', '1');
    await service.hset('learn:one', 'field', 'value');
    await service.incr('auth:one');

    const keys = [...(service as any).mem.keys()].sort();
    expect(keys).toEqual(['a1:test:auth:one', 'a1:test:learn:one', 'a1:test:stat:one']);
    expect(await service.hgetall('learn:one')).toEqual({ field: 'value' });
    await service.delByPrefix('stat:');
    expect(await service.get('stat:one')).toBeNull();
    expect(await service.hgetall('learn:one')).toEqual({ field: 'value' });
    await service.delByPrefix('learn:');
    expect(await service.hgetall('learn:one')).toEqual({});
    expect(await service.exists('auth:one')).toBe(true);
  });

  it('defaults to an empty prefix for existing deployments', () => {
    process.env.REDIS_KEY_PREFIX = '';
    expect(loadConfig().redis.keyPrefix).toBe('');
  });

  it('reads an explicitly supplied prefix without exposing credentials', () => {
    process.env.REDIS_KEY_PREFIX = 'run-123:';
    expect(loadConfig().redis.keyPrefix).toBe('run-123:');
  });
});
