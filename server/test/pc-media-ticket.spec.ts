import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Errors } from '../src/common/errors';
import { MediaTicketService } from '../src/modules/media/media-ticket.service';

async function fixture(mode: 'proxy' | 'cos-signed' = 'proxy') {
  const { PcMediaTicketService } = await import('../src/modules/media/delivery/pc-media-ticket.service');
  const actor = { id: 7, username: 'admin', role: 'super_admin', client: 'pc', authMethod: 'password', jti: 'access-id', iat: Math.floor(Date.now() / 1000), sid: 'a'.repeat(48), authVersion: 2 };
  const current: any = { id: '7', username: 'admin', role: 'super_admin', status: 1, authVersion: 2, forcePasswordChange: 0 };
  let currentUser: any = current;
  const asset = { id: '41', purpose: 'question', mediaKind: 'image', status: 'ready', storageProvider: mode === 'proxy' ? 'local' : 'cos' };
  const media = { authorizeContent: vi.fn(async () => asset), openContent: vi.fn(async () => ({ size: 64 })) };
  const redis = { isTokenBlacklisted: vi.fn(async () => false), getTokenBlockTs: vi.fn(async () => 0) };
  const sessions = { isActiveFor: vi.fn(async () => true) };
  const users = { findOne: vi.fn(async () => currentUser) };
  const access = { permissions: vi.fn(async () => ['media:write']) };
  const urls = { issue: vi.fn(() => mode === 'cos-signed' ? { content_url: 'https://fixture-123456.cos.ap-test.myqcloud.com/signed', expires_at: new Date(Date.now() + 300_000).toISOString() } : null) };
  const config = { mediaTicket: { secret: randomBytes(32).toString('base64'), ttlSeconds: 300 }, mediaDelivery: { mode, readUrlTtlSeconds: 300, videoUrlTtlSeconds: 1200 } };
  const service = new PcMediaTicketService(media as any, config as any, redis as any, sessions as any, users as any, access as any, urls as any);
  const issue = () => service.issue(actor as any, '41');
  return { service, actor, current, media, redis, sessions, users, access, urls, config, issue, setUser: (value) => { currentUser = value; } };
}

describe('PC media preview tickets', () => {
  afterEach(() => vi.useRealTimers());

  it('isolates its proxy ticket from learner tickets and rechecks precise content permission on every Range read', async () => {
    const f = await fixture(); const issued = await f.issue();
    expect(issued.content_url).toMatch(/^\/api\/v1\/media\/preview-tickets\/[^/]+\/content$/);
    const token = issued.content_url.split('/')[5];
    expect(token).not.toMatch(/Bearer|eyJhbGci/);
    await f.service.open(token, 'bytes=10-19');
    expect(f.media.openContent).toHaveBeenCalledWith('7', '41', 'bytes=10-19');
    expect(f.sessions.isActiveFor).toHaveBeenLastCalledWith(f.actor.sid, '7', 'pc', 'password');
    const learner = new MediaTicketService({ authorizeTicket: async () => ({ id: '41', purpose: 'question' }) } as any, f.config as any);
    expect(() => learner.verify(token)).toThrow();
    const learnerToken = (await learner.issue('7', '41', 'exam_record_question', '11')).content_url.split('/')[5];
    await expect(f.service.open(learnerToken)).rejects.toMatchObject({ code: 40302 });
    f.media.openContent.mockRejectedValueOnce(Errors.dataForbidden());
    await expect(f.service.open(token)).rejects.toMatchObject({ code: 40302 });
  });

  it.each(['disabled', 'deleted', 'auth-version', 'jti', 'block', 'session', 'password', 'learner-role'])('rejects an already-issued proxy ticket after %s changes', async (change) => {
    const f = await fixture(); const token = (await f.issue()).content_url.split('/')[5];
    if (change === 'disabled') f.current.status = 0;
    if (change === 'deleted') f.setUser(null);
    if (change === 'auth-version') f.current.authVersion += 1;
    if (change === 'jti') f.redis.isTokenBlacklisted.mockResolvedValue(true);
    if (change === 'block') f.redis.getTokenBlockTs.mockResolvedValue(f.actor.iat + 1);
    if (change === 'session') f.sessions.isActiveFor.mockResolvedValue(false);
    if (change === 'password') f.current.forcePasswordChange = 1;
    if (change === 'learner-role') { f.current.role = 'employee'; f.access.permissions.mockResolvedValue([]); }
    await expect(f.service.open(token)).rejects.toThrow();
    expect(f.media.openContent).not.toHaveBeenCalled();
  });

  it('rejects tampering, expiry, mobile identity and pending-password actors before opening bytes', async () => {
    vi.useFakeTimers(); const f = await fixture(); const token = (await f.issue()).content_url.split('/')[5];
    await expect(f.service.open(token.slice(0, -2) + 'XX')).rejects.toMatchObject({ code: 40302 });
    await expect(f.service.issue({ ...f.actor, client: 'mobile' } as any, '41')).rejects.toMatchObject({ code: 40301 });
    await expect(f.service.issue({ ...f.actor, pwdPending: true } as any, '41')).rejects.toMatchObject({ code: 40301 });
    await vi.advanceTimersByTimeAsync(300_000);
    await expect(f.service.open(token)).rejects.toMatchObject({ code: 40302 });
    expect(f.media.openContent).not.toHaveBeenCalled();
  });

  it('signs COS from authorization alone and rejects a renewal after current session revocation', async () => {
    const f = await fixture('cos-signed');
    expect((await f.issue()).content_url.startsWith('https://fixture-123456.cos.ap-test.myqcloud.com/')).toBe(true);
    expect(f.media.authorizeContent).toHaveBeenCalledWith('7', '41');
    expect(f.media.openContent).not.toHaveBeenCalled();
    f.sessions.isActiveFor.mockResolvedValue(false);
    await expect(f.issue()).rejects.toMatchObject({ code: 40107 });
    expect(f.urls.issue).toHaveBeenCalledTimes(1);
  });
});
