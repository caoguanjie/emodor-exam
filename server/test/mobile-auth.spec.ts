import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { normalizeChinaMobile, normalizeOptionalChinaMobile } from '../src/modules/auth/phone';
import { AppConfig } from '../src/config/configuration';
import { RedisService } from '../src/common/redis.service';
import { Errors } from '../src/common/errors';
import { SmsChallengeService } from '../src/modules/auth/sms-challenge.service';
import { SmsProvider, YunxinSmsProvider } from '../src/modules/auth/sms-provider';
import { JwtService } from '@nestjs/jwt';
import { SysUser } from '../src/entities/sys-user.entity';
import { AuthSession } from '../src/entities/auth-session.entity';
import { SysUserRole } from '../src/entities/sys-user-role.entity';
import { SessionService } from '../src/modules/auth/session.service';
import { SessionIssuerService } from '../src/modules/auth/session-issuer.service';
import { MobileAuthService } from '../src/modules/auth/mobile-auth.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';
import * as bcrypt from 'bcryptjs';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { MobileSmsLoginDto } from '../src/modules/auth/mobile-auth.dto';
import { UsersService } from '../src/modules/users/users.service';
import { ImportBatchService } from '../src/modules/imports/import-batch.service';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function config(overrides: Record<string, unknown> = {}): AppConfig {
  return {
    env: 'test', debugLoginEnabled: false,
    redis: { enabled: false, keyPrefix: '' },
    jwt: { secret: randomBytes(48).toString('hex'), expiresIn: '2h', refreshExpiresDays: 7 },
    sms: {
      provider: 'yunxin', appKey: randomBytes(16).toString('hex'), appSecret: randomBytes(24).toString('hex'),
      templateId: 'fixture-template', baseUrl: 'https://sms.yunxinapi.com', timeoutSeconds: 5,
      resendSeconds: 60, verifyTtlSeconds: 300, maxVerifyAttempts: 5,
      phoneDailyLimit: 10, ipDailyLimit: 100, redisKeyPrefix: 'sms:login:',
    }, ...overrides,
  } as AppConfig;
}

/** Only the external SMS network is replaced; challenge and Redis semantics stay real. */
class FakeSmsProvider implements SmsProvider {
  readonly code = randomBytes(4).readUInt32BE() % 1_000_000;
  failSend = false;
  async sendLoginCode() {
    if (this.failSend) throw Errors.serviceUnavailable();
    return { providerRequestId: randomBytes(12).toString('hex') };
  }
  async verifyLoginCode(_phone: string, code: string) {
    if (code !== String(this.code).padStart(6, '0')) throw Errors.param('验证码错误');
  }
}

function challengeFixture(overrides: Record<string, unknown> = {}) {
  const settings = config(overrides);
  const redis = new RedisService(settings);
  const provider = new FakeSmsProvider();
  return { settings, redis, provider, service: new SmsChallengeService(redis, settings, provider) };
}

describe('mobile phone identity', () => {
  it('normalizes formatting without accepting a different country or malformed number', () => {
    expect(normalizeChinaMobile('138 0013-8000')).toBe('13800138000');
    for (const phone of ['123', '+8613800138000', '12800138000', '', null, 13800138000]) {
      expect(() => normalizeChinaMobile(phone as string)).toThrow();
    }
    expect(normalizeOptionalChinaMobile('  ')).toBeNull();
    expect(normalizeOptionalChinaMobile(null)).toBeNull();
  });

  it('rejects malformed SMS login fields before reaching the provider', async () => {
    const pipe = new DtoValidationPipe();
    await expect(pipe.transform({ phone: '13800138000', challenge_id: 'a'.repeat(48), code: '12345' }, { type: 'body', metatype: MobileSmsLoginDto })).rejects.toBeDefined();
    await expect(pipe.transform({ phone: ['13800138000'], challenge_id: 'a'.repeat(48), code: '123456' }, { type: 'body', metatype: MobileSmsLoginDto })).rejects.toBeDefined();
  });
});

describe('SMS challenges', () => {
  it('returns a masked challenge, never a code, and consumes it once under concurrency', async () => {
    const { service, provider } = challengeFixture();
    const challenge = await service.issue('138 0013-8000', '198.51.100.1');
    expect(challenge).toEqual({
      challenge_id: expect.stringMatching(/^[a-f0-9]{48}$/), expires_in: 300, retry_after: 60, masked_phone: '138****8000',
    });
    const attempts = await Promise.allSettled([1, 2].map(() => service.verify(challenge.challenge_id, '13800138000', String(provider.code).padStart(6, '0'))));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(service.verify(challenge.challenge_id, '13800138000', String(provider.code).padStart(6, '0'))).rejects.toMatchObject({ code: 40001 });
  });

  it('enforces six digits, phone binding, expiry, resend interval and five attempts', async () => {
    vi.useFakeTimers();
    const { service, provider } = challengeFixture();
    const issued = await service.issue('13800138000', '198.51.100.1');
    await expect(service.issue('13800138000', '198.51.100.2')).rejects.toMatchObject({ code: 42901 });
    await expect(service.verify(issued.challenge_id, '13900138000', String(provider.code).padStart(6, '0'))).rejects.toMatchObject({ code: 40001 });
    await expect(service.verify(issued.challenge_id, '13800138000', '12')).rejects.toMatchObject({ code: 40001 });
    const wrongCode = String((provider.code + 1) % 1_000_000).padStart(6, '0');
    for (let attempt = 0; attempt < 5; attempt++) await expect(service.verify(issued.challenge_id, '13800138000', wrongCode)).rejects.toMatchObject({ code: 40001 });
    await expect(service.verify(issued.challenge_id, '13800138000', String(provider.code).padStart(6, '0'))).rejects.toMatchObject({ code: 42901 });
    await vi.advanceTimersByTimeAsync(60_000);
    const second = await service.issue('13800138000', '198.51.100.1');
    await vi.advanceTimersByTimeAsync(300_000);
    await expect(service.verify(second.challenge_id, '13800138000', String(provider.code).padStart(6, '0'))).rejects.toMatchObject({ code: 40001 });
  });

  it('enforces rolling phone/IP daily quotas and resets after a day', async () => {
    vi.useFakeTimers();
    const { service } = challengeFixture();
    for (let index = 0; index < 10; index++) {
      await service.issue('13800138000', '198.51.100.1');
      await vi.advanceTimersByTimeAsync(60_000);
    }
    await expect(service.issue('13800138000', '198.51.100.1')).rejects.toMatchObject({ code: 42901 });
    const ipFixture = challengeFixture();
    for (let index = 0; index < 100; index++) await ipFixture.service.issue(`139${String(index).padStart(8, '0')}`, '198.51.100.2');
    await expect(ipFixture.service.issue('13999999999', '198.51.100.2')).rejects.toMatchObject({ code: 42901 });
    await vi.advanceTimersByTimeAsync(86_400_000);
    await expect(service.issue('13800138000', '198.51.100.1')).resolves.toHaveProperty('challenge_id');
  });

  it('invalidates an older challenge after resend and releases failed sends for retry', async () => {
    vi.useFakeTimers();
    const { service, provider } = challengeFixture();
    provider.failSend = true;
    await expect(service.issue('13800138000', '198.51.100.1')).rejects.toMatchObject({ code: 50004 });
    provider.failSend = false;
    const first = await service.issue('13800138000', '198.51.100.1');
    await vi.advanceTimersByTimeAsync(60_000);
    const second = await service.issue('13800138000', '198.51.100.1');
    await expect(service.verify(first.challenge_id, '13800138000', String(provider.code).padStart(6, '0'))).rejects.toMatchObject({ code: 40001 });
    await expect(service.verify(second.challenge_id, '13800138000', String(provider.code).padStart(6, '0'))).resolves.toBeUndefined();
  });

  it('fails closed when SMS is disabled', async () => {
    const settings = config(); settings.sms.provider = 'disabled';
    const service = new SmsChallengeService(new RedisService(settings), settings, new FakeSmsProvider());
    await expect(service.issue('13800138000', '198.51.100.1')).rejects.toMatchObject({ code: 50004 });
  });
});

describe('Yunxin network boundary', () => {
  it('uses the code endpoint with six digits and maps provider responses without exposing their raw message', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const responses = [{ code: 200, msg: 'send-id' }, { code: 413, msg: 'sensitive external message' }, { code: 416 }, { code: 403 }];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    const provider = new YunxinSmsProvider(config());
    expect(await provider.sendLoginCode('13800138000')).toEqual({ providerRequestId: 'send-id' });
    expect(requests[0].url).toBe('https://sms.yunxinapi.com/sms/sendcode.action');
    expect(new URLSearchParams(requests[0].init.body as string).get('codeLen')).toBe('6');
    await expect(provider.verifyLoginCode('13800138000', '012345')).rejects.toMatchObject({ code: 40001, message: '验证码错误' });
    await expect(provider.sendLoginCode('13800138000')).rejects.toMatchObject({ code: 42901 });
    await expect(provider.sendLoginCode('13800138000')).rejects.toMatchObject({ code: 50004 });
  });
});

function authFixture() {
  const settings = config({ debugLoginEnabled: true });
  const redis = new RedisService(settings);
  const users: SysUser[] = [];
  const rows: AuthSession[] = [];
  const permissions = new Map<string, string[]>();
  const userRepo = {
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      if (!value.id) {
        if (users.some((user) => user.phone === value.phone)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        value.id = String(users.length + 1); users.push(value);
      }
      return value;
    },
    findOne: async ({ where }: any) => users.find((user) => Object.entries(where).every(([key, value]) => (user as any)[key] === value)) || null,
    createQueryBuilder: () => {
      let where: Record<string, unknown>;
      const query: any = { setLock: () => query, where: (_sql: string, params: any) => { where = params.userId ? { id: params.userId } : params; return query; }, getOne: () => userRepo.findOne({ where }) };
      return query;
    },
  };
  const sessionRepo = {
    create: (value: any) => ({ ...value }),
    save: async (value: any) => { if (!value.id) { value.id = String(rows.length + 1); rows.push(value); } return value; },
    findOne: async ({ where }: any) => rows.find((row) => Object.entries(where).every(([key, value]) => (row as any)[key] === value)) || null,
    update: async ({ sid }: any, patch: any) => Object.assign(rows.find((row) => row.sid === sid)!, patch),
    find: async ({ where }: any) => rows.filter((row) => row.userId === where.userId && !row.revokedAt),
    createQueryBuilder: () => {
      let patch: any; let userId: string;
      const query: any = { update: () => query, set: (value: any) => { patch = value; return query; }, where: (_sql: string, params: any) => { userId = params.userId; return query; }, execute: async () => { rows.filter((row) => row.userId === userId && !row.revokedAt).forEach((row) => Object.assign(row, patch)); } };
      return query;
    },
  };
  const manager = { findOne: (_entity: any, options: any) => userRepo.findOne(options), getRepository: (entity: any) => entity === SysUser ? userRepo : entity === SysUserRole ? { findOne: async () => null } : sessionRepo };
  // Transactions are serialized by the fake store; the integration suite exercises actual MySQL uniqueness.
  let tail = Promise.resolve();
  const dataSource = { transaction: (callback: any) => {
    const operation = tail.then(() => callback(manager)); tail = operation.catch(() => undefined); return operation;
  } };
  const access = { permissions: async (id: string) => permissions.get(String(id)) || [] };
  const jwt = new JwtService({ secret: settings.jwt.secret });
  const sessions = new SessionService(sessionRepo as any, redis, undefined, settings);
  const issuer = new SessionIssuerService(userRepo as any, jwt, redis, settings, sessions, access as any);
  const smsProvider = new FakeSmsProvider();
  const challenges = new SmsChallengeService(redis, settings, smsProvider);
  const service = new MobileAuthService(userRepo as any, dataSource as any, settings, challenges, sessions, issuer, { log: () => undefined } as any);
  const cookies: Array<{ name: string; token: string; options: any }> = [];
  const cleared: string[] = [];
  const response = { cookie: (name: string, token: string, options: any) => cookies.push({ name, token, options }), clearCookie: (name: string) => cleared.push(name) } as any;
  const seed = (patch: Partial<SysUser> = {}) => {
    const user = { id: String(users.length + 1), username: 'learner', realName: '', phone: '13800138000', status: 1, role: 'employee', source: 'institution', categoryId: null, authVersion: 0, forcePasswordChange: 1, lastLoginAt: null, ...patch } as SysUser;
    users.push(user); return user;
  };
  return { settings, redis, users, rows, permissions, userRepo, dataSource, jwt, sessions, issuer, service, response, cookies, cleared, seed, access, smsProvider };
}

describe('mobile sessions', () => {
  it('logs out through its refresh cookie without an access token and preserves PC sessions', async () => {
    const f = authFixture(); const user = f.seed();
    await f.service.debugLogin(user.phone!, null, null, f.response);
    const mobileCookie = f.cookies[0].token;
    await f.issuer.issue(user, { client: 'pc', authMethod: 'password', ip: null, userAgent: null }, f.response);
    await expect(f.service.logout(mobileCookie as any, null, f.response)).resolves.toBeNull();
    expect(f.cleared).toEqual(['ruleexam_mobile_refresh']);
    expect(await f.sessions.isRevoked(f.rows[0].sid)).toBe(true);
    expect(await f.sessions.isRevoked(f.rows[1].sid)).toBe(false);
    await expect(f.service.refresh(mobileCookie, null, f.response)).rejects.toMatchObject({ code: 40107 });
    await expect(f.service.logout(mobileCookie as any, null, f.response)).resolves.toBeNull();
  });

  it('clears only the mobile cookie for invalid, absent or PC refresh cookies', async () => {
    const f = authFixture(); const user = f.seed();
    await f.issuer.issue(user, { client: 'pc', authMethod: 'password', ip: null, userAgent: null }, f.response);
    for (const cookie of [undefined, 'invalid-cookie', f.cookies[0].token]) await expect(f.service.logout(cookie as any, null, f.response)).resolves.toBeNull();
    expect(f.cleared).toEqual(['ruleexam_mobile_refresh', 'ruleexam_mobile_refresh', 'ruleexam_mobile_refresh']);
    expect(await f.sessions.isRevoked(f.rows[0].sid)).toBe(false);
  });

  it('exchanges the real challenge flow for an SMS mobile session and rejects challenge replay', async () => {
    const f = authFixture(); f.seed();
    const challenge = await f.service.send('13800138000', '198.51.100.1');
    const code = String(f.smsProvider.code).padStart(6, '0');
    const result = await f.service.login('13800138000', challenge.challenge_id, code, null, null, f.response);
    expect(f.jwt.verify(result.access_token)).toMatchObject({ client: 'mobile', auth_method: 'sms' });
    expect(result.user.identity_status).toBe('unverified');
    await expect(f.service.login('13800138000', challenge.challenge_id, code, null, null, f.response)).rejects.toMatchObject({ code: 40001 });
    expect(f.rows).toHaveLength(1);
  });

  it.each(['employee', 'super_admin', 'regulation_admin'])('keeps %s administrator password login on the shared issuer with forced change', async (role) => {
    const f = authFixture();
    const password = randomBytes(24).toString('hex');
    const user = f.seed({ role: role as SysUser['role'], passwordHash: await bcrypt.hash(password, 4) });
    if (role === 'employee') f.permissions.set(user.id, ['students:read']);
    const auth = new AuthService(f.userRepo as any, f.jwt, f.redis, { log: () => undefined } as any, f.settings, f.dataSource as any, { verify: async () => true } as any, f.sessions, f.access as any, f.issuer);
    const result = await auth.login('learner', password, null, { get: () => 'test-agent' } as any, f.response, 'fixture', 'fixture');
    expect(result.force_change_password).toBe(true);
    expect(f.jwt.verify(result.access_token)).toMatchObject({ client: 'pc', auth_method: 'password', pwd_pending: true, sid: f.rows[0].sid });
    expect(f.cookies[0].name).toBe('ruleexam_refresh');
  });

  it('rejects learner password login even with a valid historical password without creating a session', async () => {
    const f = authFixture();
    const password = randomBytes(24).toString('hex');
    const user = f.seed({ passwordHash: await bcrypt.hash(password, 4), loginCount: 0 });
    const auth = new AuthService(f.userRepo as any, f.jwt, f.redis, { log: () => undefined } as any, f.settings, f.dataSource as any, {} as any, f.sessions, f.access as any, f.issuer);
    await expect(auth.login(user.username, password, null, { get: () => null } as any, f.response)).rejects.toMatchObject({ code: 40104 });
    expect(f.rows).toHaveLength(0);
    expect(f.cookies).toHaveLength(0);
    expect(user.loginCount).toBe(0);
  });

  it('allows a business administrator to change password but rejects a learner before mutating credentials', async () => {
    const f = authFixture();
    const password = randomBytes(24).toString('hex');
    const user = f.seed({ passwordHash: await bcrypt.hash(password, 4) });
    const originalHash = user.passwordHash;
    const auth = new AuthService(f.userRepo as any, f.jwt, f.redis, { log: () => undefined } as any, f.settings, f.dataSource as any, {} as any, f.sessions, f.access as any, f.issuer);
    const replacement = `Z9${randomBytes(24).toString('hex')}`;
    await expect(auth.changePassword(1, password, replacement, null, f.response)).rejects.toMatchObject({ code: 40301 });
    expect(user.passwordHash).toBe(originalHash);
    expect(f.rows).toHaveLength(0);
    f.permissions.set(user.id, ['students:write']);
    await expect(auth.changePassword(1, password, replacement, null, f.response)).resolves.toHaveProperty('access_token');
    expect(await bcrypt.compare(replacement, user.passwordHash)).toBe(true);
    expect(user.authVersion).toBe(1);
  });

  it.each([true, false])('rejects old learner PC access and refresh (durable session: %s)', async (durable) => {
    const f = authFixture(); const user = f.seed({ forcePasswordChange: 0 });
    const pair = await f.issuer.issue(user, { client: 'pc', authMethod: 'password', ip: null, userAgent: null }, f.response);
    const legacy = (token: string) => {
      if (durable) return token;
      const payload = f.jwt.verify(token);
      delete payload.sid; delete payload.client; delete payload.auth_method;
      return f.jwt.sign(payload);
    };
    const accessToken = legacy(pair.access_token);
    const refreshToken = legacy(f.cookies[0].token);
    const guard = new JwtAuthGuard(f.jwt, { getAllAndOverride: () => false } as any, f.redis, f.settings, f.sessions, f.userRepo as any, f.access as any);
    const ctx = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${accessToken}` }, originalUrl: '/api/v1/auth/profile', method: 'GET' }) }) } as any;
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 40301 });
    await expect(f.issuer.refresh(refreshToken, 'pc', null, f.response)).rejects.toMatchObject({ code: 40301 });
    f.permissions.set(user.id, ['students:read']);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(f.issuer.refresh(refreshToken, 'pc', null, f.response)).resolves.toHaveProperty('access_token');
    f.permissions.set(user.id, []);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 40301 });
  });

  it('issues isolated cookies and durable client/method claims while keeping PC forced change', async () => {
    const f = authFixture(); const user = f.seed();
    const mobile = await f.service.debugLogin(user.phone!, null, null, f.response);
    expect(mobile.user).toMatchObject({ id: 1, phone_masked: '138****8000', identity_status: 'unverified' });
    expect(f.jwt.verify(mobile.access_token)).toMatchObject({ client: 'mobile', auth_method: 'debug', sid: f.rows[0].sid });
    expect(f.jwt.verify(mobile.access_token)).not.toHaveProperty('pwd_pending');
    expect(f.rows[0]).toMatchObject({ client: 'mobile', authMethod: 'debug' });
    expect(f.cookies[0]).toMatchObject({ name: 'ruleexam_mobile_refresh', options: { path: '/api/v1/mobile/auth', httpOnly: true, sameSite: 'strict' } });
    const pc = await f.issuer.issue(user, { client: 'pc', authMethod: 'password', ip: null, userAgent: null }, f.response, undefined, true);
    expect(f.jwt.verify(pc.access_token)).toMatchObject({ client: 'pc', auth_method: 'password', pwd_pending: true });
    expect(f.cookies[1]).toMatchObject({ name: 'ruleexam_refresh', options: { path: '/api/v1/auth' } });
    expect(user.forcePasswordChange).toBe(1);
    await expect(f.issuer.refresh(f.cookies[1].token, 'mobile', null, f.response)).rejects.toMatchObject({ code: 40103 });
    await expect(f.issuer.refresh(f.cookies[0].token, 'pc', null, f.response)).rejects.toMatchObject({ code: 40103 });
  });

  it('keeps new debug users unverified and links repeated/concurrent logins to one account', async () => {
    const f = authFixture();
    const results = await Promise.all([1, 2].map(() => f.service.debugLogin('13800138000', null, null, f.response)));
    expect(f.users).toHaveLength(1);
    expect(results.map((result) => result.user.id)).toEqual([1, 1]);
    expect(results[0].user).toMatchObject({ source: 'external', identity_status: 'unverified', category_id: null });
    expect(f.users[0].username).not.toContain('13800138000');
    expect(f.users[0].passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects disabled, non-employee and effective management permissions before issuing sessions', async () => {
    for (const patch of [{ status: 0 }, { role: 'super_admin' }, { role: 'regulation_admin' }]) {
      const f = authFixture(); f.seed(patch);
      await expect(f.service.debugLogin('13800138000', null, null, f.response)).rejects.toBeDefined();
      expect(f.rows).toHaveLength(0);
    }
    const f = authFixture(); const user = f.seed(); f.permissions.set(user.id, ['students:read']);
    await expect(f.service.debugLogin('13800138000', null, null, f.response)).rejects.toMatchObject({ code: 40301 });
    expect(f.rows).toHaveLength(0);
  });

  it('does not query/create users when debug is off and rejects production opt-in', async () => {
    const f = authFixture(); f.settings.debugLoginEnabled = false;
    f.userRepo.createQueryBuilder = () => { throw new Error('user store touched'); };
    await expect(f.service.debugLogin('13800138000', null, null, f.response)).rejects.toMatchObject({ code: 50004 });
    expect(f.users).toHaveLength(0);
    f.settings.debugLoginEnabled = true; f.settings.env = 'production';
    expect(() => new MobileAuthService(f.userRepo as any, f.dataSource as any, f.settings, {} as any, f.sessions, f.issuer, {} as any)).toThrow(/debug|Debug|调试/);
  });

  it('rotates refresh only once and rejects a mobile session after permission elevation or revocation', async () => {
    const f = authFixture(); const user = f.seed();
    await f.service.debugLogin(user.phone!, null, null, f.response);
    const oldRefresh = f.cookies[0].token;
    const attempts = await Promise.allSettled([1, 2].map(() => f.service.refresh(oldRefresh, null, f.response)));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.cookies).toHaveLength(2);
    f.permissions.set(user.id, ['roles:read']);
    await expect(f.service.refresh(f.cookies[1].token, null, f.response)).rejects.toMatchObject({ code: 40301 });
    f.permissions.set(user.id, []);
    await f.sessions.revokeBySid(f.rows[0].sid, user.id);
    await expect(f.service.refresh(f.cookies[1].token, null, f.response)).rejects.toMatchObject({ code: 40107 });
  });

  it('requires a bound mobile session and rechecks effective permissions on every access', async () => {
    const f = authFixture(); const user = f.seed();
    const signed = await f.service.debugLogin(user.phone!, null, null, f.response);
    const guard = new JwtAuthGuard(f.jwt, { getAllAndOverride: () => false } as any, f.redis, f.settings, f.sessions, f.userRepo as any, f.access as any);
    const context = (token: string, path = '/api/v1/me/profile') => ({ getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` }, originalUrl: path, url: path, method: 'GET' }) }) }) as any;
    await expect(guard.canActivate(context(signed.access_token))).resolves.toBe(true);
    const payload = f.jwt.verify(signed.access_token); delete payload.sid; delete payload.iat; delete payload.exp;
    await expect(guard.canActivate(context(f.jwt.sign(payload)))).rejects.toMatchObject({ code: 40107 });
    await expect(guard.canActivate(context(signed.access_token, '/api/v1/admin/students'))).rejects.toMatchObject({ code: 40301 });
    f.permissions.set(user.id, ['students:read']);
    await expect(guard.canActivate(context(signed.access_token))).rejects.toMatchObject({ code: 40301 });
  });
});

describe('phone writes outside mobile login', () => {
  it('normalizes managed-student creation and rejects self-service phone replacement', async () => {
    const f = authFixture();
    const users = new UsersService(f.userRepo as any, f.dataSource as any, f.redis, { log: () => undefined } as any, f.settings, { lockActive: async () => undefined } as any, f.sessions, f.access as any, { registerOwnerPolicy: () => undefined } as any);
    const result = await users.createStudent({ username: 'phone_fixture', real_name: '合成学员', category_id: '1', source: 'institution', phone: '138 0013-8000' }, { id: 9, name: 'fixture' }, null);
    expect(result.phone).toBe('13800138000');
    await expect(users.updateSelfProfile(result.id, { phone: '13900138000' } as any)).rejects.toMatchObject({ code: 40001 });
    expect(f.users[0].phone).toBe('13800138000');
  });

  it('revokes existing sessions when a manager replaces the phone login identity', async () => {
    const f = authFixture(); const user = f.seed();
    await f.service.debugLogin(user.phone!, null, null, f.response);
    const users = new UsersService(f.userRepo as any, f.dataSource as any, f.redis, { log: () => undefined } as any, f.settings, {} as any, f.sessions, f.access as any, { registerOwnerPolicy: () => undefined } as any);
    const updated = await users.updateStudent(user.id, { phone: '139 0013-8000' }, { id: 9, name: 'fixture' }, null);
    expect(updated.phone).toBe('13900138000');
    expect(user.authVersion).toBe(1);
    expect(await f.sessions.isRevoked(f.rows[0].sid)).toBe(true);
  });

  it('rejects an invalid phone at import preview instead of committing a new login identity', async () => {
    const saved: any[] = [];
    const batches = { create: (row: any) => ({ id: '1', ...row }), save: async (row: any) => { saved.push(row); return row; } };
    const service = new ImportBatchService(batches as any, { findOne: async () => null } as any, { findOne: async () => ({ id: '1', status: 1 }) } as any, { query: async () => [] } as any, { log: () => undefined } as any, {} as any);
    const result = await service.preview('1', 'students', [{ username: 'import-fixture', real_name: '合成学员', source: 'external', category_id: '1', phone: '123' }]);
    expect(result.valid_rows).toEqual([]);
    expect(result.errors[0]).toMatchObject({ row: 2, message: expect.stringContaining('手机号') });
    expect(saved[0].normalizedRows).toEqual([]);
  });
});
