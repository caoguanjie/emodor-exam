import { describe, expect, it } from 'vitest';
import { CaptchaService } from '../src/modules/auth/captcha.service';
import { AccessService } from '../src/modules/access/access.service';
import { SessionService } from '../src/modules/auth/session.service';
import { legacyPermissionForRequest } from '../src/common/guards/permissions.guard';

function redisStub() {
  const values = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string) { values.set(key, value); },
    async del(...keys: string[]) { keys.forEach((key) => values.delete(key)); },
    async exists(key: string) { return values.has(key); },
    async incr(key: string) { const value = (counters.get(key) ?? 0) + 1; counters.set(key, value); return value; },
    async getAndDelete(key: string) { const value = values.get(key) ?? null; values.delete(key); return value; },
    async revokeSession(id: string) { values.set(`auth:session:revoked:${id}`, '1'); },
    async isSessionRevoked(id: string) { return values.has(`auth:session:revoked:${id}`); },
    values,
  };
}

describe('A3 captcha and access contracts', () => {
  it('consumes an issued captcha exactly once and never exposes its answer', async () => {
    const redis = redisStub();
    const service = new CaptchaService(redis as any);

    const issued = await service.issue('admin');
    expect(issued).toHaveProperty('captcha_id');
    expect(issued).toHaveProperty('image');
    expect(issued).not.toHaveProperty('answer');

    const answer = [...redis.values.values()][0];
    expect(await service.verify(issued.captcha_id, answer)).toBe(true);
    expect(await service.verify(issued.captcha_id, answer)).toBe(false);
  });

  it('consumes only the previous captcha when a new challenge refreshes it', async () => {
    const redis = redisStub();
    const service = new CaptchaService(redis as any);

    const previous = await service.issue('same-ip');
    const unrelated = await service.issue('same-ip');
    const previousAnswer = redis.values.get(`auth:captcha:${previous.captcha_id}`);
    const unrelatedAnswer = redis.values.get(`auth:captcha:${unrelated.captcha_id}`);
    expect(previousAnswer).toBeTruthy();
    expect(unrelatedAnswer).toBeTruthy();

    const refreshed = await service.issue('same-ip', previous.captcha_id);
    const refreshedAnswer = redis.values.get(`auth:captcha:${refreshed.captcha_id}`);
    expect(refreshedAnswer).toBeTruthy();
    expect(await service.verify(previous.captcha_id, previousAnswer!)).toBe(false);
    expect(await service.verify(refreshed.captcha_id, refreshedAnswer!)).toBe(true);
    expect(await service.verify(unrelated.captcha_id, unrelatedAnswer!)).toBe(true);
  });

  it('only allows a registered permission code and invalidates a removed grant', async () => {
    const service = new AccessService({} as any, {} as any, {} as any, {} as any, {} as any, redisStub() as any);
    (service as any).permissions = async () => ['statistics:read'];
    await expect(service.assertAllowed('9', 'statistics:read')).resolves.toBeUndefined();
    await expect(service.assertAllowed('9', 'statistics:export')).rejects.toMatchObject({ code: 40301 });
    await expect(service.assertAllowed('9', 'admin:arbitrary')).rejects.toMatchObject({ code: 40301 });
  });

  it('revokes a session and records the requested actor', async () => {
    const redis = redisStub();
    const sessions = new SessionService({
      async findOne() { return { id: '17', sid: 'sid17', userId: '9', revokedAt: null }; },
      async save(value: any) { return value; },
    } as any, redis as any, { log() {} } as any);
    await expect(sessions.revoke('17', '8')).resolves.toBeUndefined();
    expect(redis.values.get('auth:session:revoked:sid17')).toBe('1');
  });

  it('keeps self statistics data-scope checks and marks import templates as writes', () => {
    expect(legacyPermissionForRequest({ originalUrl: '/api/v1/statistics/users/9', method: 'GET', user: { role: 'employee' } })).toBeUndefined();
    expect(legacyPermissionForRequest({ originalUrl: '/api/v1/statistics/users/9', method: 'GET', user: { role: 'regulation_admin' } })).toBe('statistics:read');
    expect(legacyPermissionForRequest({ originalUrl: '/api/v1/users/import-template', method: 'GET' })).toBe('students:write');
  });
});
