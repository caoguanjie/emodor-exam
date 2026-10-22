import 'reflect-metadata';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { CaptchaService } from '../src/modules/auth/captcha.service';
import { AccessService } from '../src/modules/access/access.service';
import { SessionService } from '../src/modules/auth/session.service';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { legacyPermissionForRequest, PermissionsGuard } from '../src/common/guards/permissions.guard';
import { RoleEnum } from '../src/common/errors';
import { PERMISSION_SET } from '../src/modules/access/permission-catalog';

const require = createRequire(import.meta.url);
const { AuthController } = require('../dist/modules/auth/auth.controller.js') as {
  AuthController: Function;
};

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

  it('rejects non-string previous captcha ids before regex coercion', async () => {
    const redis = redisStub();
    const service = new CaptchaService(redis as any);
    const validId = 'a'.repeat(32);

    for (const malformed of [[validId], { toString: () => validId }, 7, null]) {
      await expect(service.issue('same-ip', malformed as any)).rejects.toMatchObject({ code: 40001 });
    }
  });

  it('keeps captcha body metadata typed so malformed fields reach validation', async () => {
    const paramTypes = Reflect.getMetadata('design:paramtypes', AuthController.prototype, 'captchaImage');
    expect(paramTypes?.[0]?.name).toBe('CaptchaRequestDto');
    expect(paramTypes?.[0]).not.toBe(Object);

    const pipe = new DtoValidationPipe();
    for (const malformed of [[ 'a'.repeat(32) ], { toString: () => 'a'.repeat(32) }, 7, null]) {
      await expect(pipe.transform(
        { previous_captcha_id: malformed },
        { type: 'body', metatype: paramTypes[0] },
      )).rejects.toMatchObject({ response: { fields: { previous_captcha_id: expect.any(Array) } } });
    }
    await expect(pipe.transform(
      {},
      { type: 'body', metatype: paramTypes[0] },
    )).resolves.toEqual({});
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

  it('creates a session with one JS timestamp for created, updated, and last-seen fields', async () => {
    const created: any[] = [];
    const repo = {
      create(value: any) { created.push(value); return value; },
      async save(value: any) { return value; },
    };
    const sessions = new SessionService(repo as any, redisStub() as any, undefined, { jwt: { refreshExpiresDays: 7 } } as any);
    const session = await sessions.create('9', '127.0.0.1', 'test-agent');
    expect(created).toHaveLength(1);
    expect(session.createdAt).toBe(session.lastSeenAt);
    expect(session.updatedAt).toBe(session.lastSeenAt);
    expect(session.expiresAt.getTime()).toBe(session.lastSeenAt.getTime() + 7 * 86400 * 1000);
  });

  it('keeps self statistics data-scope checks without mapping removed management routes', () => {
    expect(legacyPermissionForRequest({ originalUrl: '/api/v1/statistics/users/9', method: 'GET', user: { role: 'employee' } })).toBeUndefined();
    expect(legacyPermissionForRequest({ originalUrl: '/api/v1/statistics/users/9', method: 'GET', user: { role: 'regulation_admin' } })).toBe('statistics:read');
    for (const path of ['/api/v1/users/import-template', '/api/v1/departments', '/api/v1/regulations/7/publish']) {
      expect(legacyPermissionForRequest({ originalUrl: path, method: 'POST' })).toBeUndefined();
    }
    expect(legacyPermissionForRequest({ originalUrl: '/api/v1/regulations/7/content', method: 'GET' })).toBeUndefined();
  });

  it('removes canceled management and exam-review capabilities from the permission registry', () => {
    for (const code of [
      'departments:read', 'departments:write',
      'regulations:read', 'regulations:write', 'regulations:publish',
      'exam_records:monitor', 'exam_records:review',
    ]) {
      expect(PERMISSION_SET.has(code)).toBe(false);
    }
  });

  it('fails closed if a removed role-gated management controller is accidentally registered again', async () => {
    const reflector = {
      getAllAndOverride: vi.fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([RoleEnum.SUPER_ADMIN]),
    };
    const access = { assertAllowed: vi.fn() };
    const permissions = new PermissionsGuard(reflector as any, access as any);
    const context = (request: any) => ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

    await expect(permissions.canActivate(context({
      originalUrl: '/api/v1/departments', method: 'POST', user: { id: 9, role: RoleEnum.SUPER_ADMIN },
    }))).rejects.toMatchObject({ code: 40301 });
    expect(access.assertAllowed).not.toHaveBeenCalled();
  });
});
