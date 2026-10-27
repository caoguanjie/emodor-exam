import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthSession } from '../src/entities/auth-session.entity';
import { SessionService } from '../src/modules/auth/session.service';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';

const now = new Date('2026-10-27T06:00:00.000Z');
const source = new DataSource({ type: 'mysql', database: 'session_unit_test', entities: [AuthSession] });
beforeAll(async () => { await (source as any).buildMetadatas(); });
afterEach(() => { vi.useRealTimers(); });

function fixture(rows: any[] = []) {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const qb = source.getRepository(AuthSession).createQueryBuilder('s');
  const queries: Record<string, [string, any[]]> = {};
  qb.getCount = vi.fn(async () => { queries.count = qb.getQueryAndParameters(); return rows.length; });
  qb.getRawMany = vi.fn(async () => { queries.items = qb.getQueryAndParameters(); return rows; }) as any;
  qb.getMany = vi.fn(async () => { queries.items = qb.getQueryAndParameters(); return rows.map(row => ({ id: row.id, sid: row.sid, userId: row.user_id,
    userAgent: row.user_agent, ipAddress: row.ip_address, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at, expiresAt: row.expires_at })); }) as any;
  return { service: new SessionService({ createQueryBuilder: () => qb } as any, {} as any), queries };
}

function row(overrides: Record<string, unknown> = {}) {
  return { id: '9007199254740993', sid: 'a'.repeat(48), user_id: '7', username: 'admin', real_name: '管理员', client: 'pc',
    user_agent: 'browser', ip_address: '127.0.0.1', created_at: new Date('2026-10-25T06:00:00.000Z'),
    last_seen_at: now, expires_at: new Date(now.getTime() + 1000), revoked_at: null, ...overrides };
}

describe('online session list read model', () => {
  it('returns only display identity fields and marks the exact requesting session', async () => {
    const f = fixture([row(), row({ id: '2', sid: 'b'.repeat(48), username: null, real_name: null, client: 'mobile' })]);
    const result = await (f.service.list as any)(1, 20, {}, 'a'.repeat(48));
    expect(result.items[0]).toMatchObject({ id: '9007199254740993', user_id: '7', username: 'admin', real_name: '管理员', client: 'pc', is_current: true, status: 'active' });
    expect(result.items[1]).toMatchObject({ user_id: '7', username: null, real_name: null, client: 'mobile', is_current: false });
    expect(Object.keys(result.items[0]).sort()).toEqual(['id','sid','user_id','username','real_name','client','is_current','user_agent','ip_address','created_at','last_seen_at','revoked_at','expires_at','status'].sort());
    expect(f.queries.items[0]).toContain('LEFT JOIN `sys_user`');
    expect(f.queries.items[0]).not.toMatch(/password|phone|email|identity/i);
  });

  it('defaults to active sessions and applies identical filters before count and pagination', async () => {
    const f = fixture();
    await (f.service.list as any)(3, 10, { keyword: '  a%_!\\b  ' });
    const [query, params] = f.queries.items;
    const sql = query.replaceAll('`', '');
    expect(sql).toContain("ESCAPE '!'");
    expect(params).toContain('%a!%!_!!\\b%');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toMatch(/COALESCE\(.+expires_at.+DATE_ADD/s);
    expect(params).toContainEqual(now);
    expect(sql).toMatch(/ORDER BY.+created_at.+DESC.+id.+DESC.+LIMIT 10 OFFSET 20/s);
    expect(f.queries.count[0]).not.toContain('LIMIT');
    expect(f.queries.count[1]).toEqual(params);
  });

  it.each(['expired', 'revoked', 'all'])('supports %s status without broadening the other filters', async status => {
    const f = fixture();
    await (f.service.list as any)(1, 20, { keyword: '张三', status });
    const [query, params] = f.queries.items;
    const sql = query.replaceAll('`', '');
    expect(params).toContain('%张三%');
    if (status === 'expired') { expect(sql).toContain('revoked_at IS NULL'); expect(sql).toMatch(/<=/); }
    if (status === 'revoked') expect(sql).toContain('revoked_at IS NOT NULL');
    if (status === 'all') expect(sql).not.toMatch(/revoked_at IS (NOT )?NULL/);
  });

  it('keeps revocation precedence, exact expiry boundaries, and legacy expiry fallback', async () => {
    const f = fixture([
      row({ revoked_at: new Date(now.getTime() - 1000), expires_at: new Date(now.getTime() - 1000) }),
      row({ id: '2', expires_at: now }),
      row({ id: '3', expires_at: null, client: null }),
    ]);
    const result = await (f.service.list as any)(1, 20, { status: 'all' });
    expect(result.items.map((item: any) => item.status)).toEqual(['revoked','expired','active']);
    expect(result.items[2].expires_at).toEqual(new Date('2026-11-01T06:00:00.000Z'));
    expect(result.items[2].client).toBe('pc');
    expect(result.items.every((item: any) => item.is_current === false)).toBe(true);
  });
});

describe('online session audit attribution', () => {
  it('records the administrator who manually revokes a session', async () => {
    const session: any = { id: '88', sid: 'a'.repeat(48), userId: '17', revokedAt: null };
    const repo = { findOne: vi.fn(async () => session), save: vi.fn(async (value) => value) };
    const redis = { revokeSession: vi.fn(async () => undefined) };
    const audit = { log: vi.fn() };
    const service = new SessionService(repo as any, redis as any, audit as any, { jwt: { refreshExpiresDays: 7 } } as any);

    await service.revoke('88', { id: 5, name: 'admin', sourceIp: '127.0.0.1' } as any);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: 5,
      actor_name: 'admin',
      source_ip: '127.0.0.1',
      action: 'auth.session.force_revoke',
      object_id: '88',
    }));
  });
});

describe('online session query boundary', () => {
  it('defaults and trims the scalar query while retaining strict numeric ranges', async () => {
    const { SessionListQueryDto, SESSION_LIST_QUERY_KEYS } = await import('../src/modules/auth/session-query.dto');
    const pipe = new StrictDtoValidationPipe(SESSION_LIST_QUERY_KEYS);
    const parse = (value: unknown) => pipe.transform(value, { type: 'query', metatype: SessionListQueryDto });
    expect(await parse({})).toMatchObject({ page: 1, page_size: 20, status: 'active' });
    expect(await parse({ page: '2', page_size: '100', status: 'all', keyword: '  张三  ' })).toMatchObject({ page: 2, page_size: 100, status: 'all', keyword: '张三' });
    for (const value of [{ page: '0' }, { page: '1000001' }, { page: '1.1' }, { page: '' }, { page: null }, { page_size: '101' },
      { page_size: ['20'] }, { keyword: {} }, { keyword: 'x'.repeat(129) }, { status: 'online' }, { status: ['active'] }, { unused: '1' }]) {
      await expect(parse(value)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects repeated, nested, unknown and non-scalar raw query parameters', async () => {
    const { assertSessionListQueryRequest } = await import('../src/modules/auth/session-query.dto');
    expect(() => assertSessionListQueryRequest({ status: 'all' }, '/api/v1/admin/sessions?status=all')).not.toThrow();
    for (const [query, url] of [
      [{ page: ['1', '2'] }, '/admin/sessions?page=1&page=2'],
      [{ page: '2' }, '/admin/sessions?page=1&page=2'],
      [{ keyword: {} }, '/admin/sessions?keyword[x]=1'],
      [{ unknown: '1' }, '/admin/sessions?unknown=1'],
    ] as const) expect(() => assertSessionListQueryRequest(query, url)).toThrow();
  });
});
