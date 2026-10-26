import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { MediaTicketService } from '../src/modules/media/media-ticket.service';
import { mediaDeliverySettings } from '../src/modules/media/delivery/media-delivery.contract';
import { Errors } from '../src/common/errors';

const settings = () => ({ mediaTicket: { secret: randomBytes(32).toString('base64'), ttlSeconds: 300 }, mediaDelivery: { mode: 'cos-signed', readUrlTtlSeconds: 300, videoUrlTtlSeconds: 300 }, cosMedia: { provider: 'cos', bucket: 'fixture-123456', region: 'ap-test', keyPrefix: 'ruleexam/', secretId: 'not-real-id', secretKey: 'not-real-secret', sessionToken: null } });
const asset = (overrides = {}) => ({ id: '41', ownerId: '7', uploadedBy: '7', purpose: 'question', mediaKind: 'image', mimeType: 'image/png', storageProvider: 'cos', storageKey: 'ruleexam/media/image.png', cosBucket: 'fixture-123456', cosRegion: 'ap-test', cosVersionId: 'version-1', status: 'ready', ...overrides });

describe('COS signed delivery', () => {
  afterEach(() => vi.useRealTimers());
  it('locally signs only the exact host, GET key/version and safe response headers', async () => {
    const { CosDownloadUrlAdapter } = await import('../src/modules/media/delivery/cos-download-url.adapter');
    const config = settings(); const signer = new CosDownloadUrlAdapter(config as any);
    const result = signer.issue(asset() as any)!;
    const url = new URL(result.content_url);
    expect(url.protocol === 'https:' && url.host === 'fixture-123456.cos.ap-test.myqcloud.com').toBe(true);
    expect(url.pathname === '/ruleexam/media/image.png').toBe(true);
    expect(url.searchParams.get('versionId') === 'version-1').toBe(true);
    expect(url.searchParams.get('q-url-param-list')?.split(';').sort()).toEqual(['response-cache-control', 'versionid']);
    expect(url.searchParams.get('response-cache-control') === 'private, no-store').toBe(true);
    expect(result.content_url.includes(config.cosMedia.secretKey)).toBe(false);
    expect(result.content_url.includes('access_token')).toBe(false);
    const [start, end] = url.searchParams.get('q-sign-time')!.split(';').map(Number);
    expect(end - start).toBe(300);
    expect(Date.parse(result.expires_at) >= end * 1000).toBe(true);
    expect([...url.searchParams.keys()].filter((key) => key.startsWith('q-')).length).toBe(7);
    const canonicalQuery = `response-cache-control=${encodeURIComponent('private, no-store')}&versionid=version-1`;
    const canonical = ['get', '/ruleexam/media/image.png', canonicalQuery, `host=${url.host}`, ''].join('\n');
    const interval = url.searchParams.get('q-sign-time')!;
    const signKey = createHmac('sha1', config.cosMedia.secretKey).update(interval).digest('hex');
    const signature = createHmac('sha1', signKey).update(['sha1', interval, createHash('sha1').update(canonical).digest('hex'), ''].join('\n')).digest('hex');
    expect(url.searchParams.get('q-signature') === signature).toBe(true);
  });

  it.each([1, 499, 500, 999])('keeps the supported 1s TTL live at millisecond boundary %s without extending its lifetime', async (millis) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000 + millis));
    const { CosDownloadUrlAdapter } = await import('../src/modules/media/delivery/cos-download-url.adapter');
    const config = settings(); config.mediaDelivery.readUrlTtlSeconds = 1;
    const result = new CosDownloadUrlAdapter(config as any).issue(asset() as any)!;
    const expires = Date.parse(result.expires_at);
    expect(expires > Date.now() && expires <= Date.now() + 1000).toBe(true);
  });

  it.each([null, 'null'])('supports COS version value %s without replacing the unique object key', async (version) => {
    const { CosDownloadUrlAdapter } = await import('../src/modules/media/delivery/cos-download-url.adapter');
    const config = settings();
    const result = new CosDownloadUrlAdapter(config as any).issue(asset({ cosVersionId: version }) as any)!;
    const url = new URL(result.content_url);
    expect(url.pathname === '/ruleexam/media/image.png').toBe(true);
    expect(url.searchParams.has('versionId')).toBe(version !== null);
    expect(url.searchParams.get('versionId') === version).toBe(true);
    expect(url.searchParams.get('q-url-param-list')).toBe(version === null ? 'response-cache-control' : 'response-cache-control;versionid');
    const query = `response-cache-control=${encodeURIComponent('private, no-store')}${version === null ? '' : '&versionid=null'}`;
    const canonical = ['get', '/ruleexam/media/image.png', query, `host=${url.host}`, ''].join('\n');
    const interval = url.searchParams.get('q-sign-time')!;
    const signKey = createHmac('sha1', config.cosMedia.secretKey).update(interval).digest('hex');
    const signature = createHmac('sha1', signKey).update(['sha1', interval, createHash('sha1').update(canonical).digest('hex'), ''].join('\n')).digest('hex');
    expect(url.searchParams.get('q-signature') === signature).toBe(true);
  });

  it('uses the video TTL and caps public branding cache and lifetime at 300 seconds', async () => {
    const { CosDownloadUrlAdapter } = await import('../src/modules/media/delivery/cos-download-url.adapter');
    const config = settings(); config.mediaDelivery.readUrlTtlSeconds = 3600; config.mediaDelivery.videoUrlTtlSeconds = 1800;
    const signer = new CosDownloadUrlAdapter(config as any);
    const video = new URL(signer.issue(asset({ purpose: 'video', mediaKind: 'video' }) as any)!.content_url);
    const [videoStart, videoEnd] = video.searchParams.get('q-sign-time')!.split(';').map(Number);
    expect(videoEnd - videoStart).toBe(1800);
    const branding = new URL(signer.issue(asset({ purpose: 'branding' }) as any, { branding: true })!.content_url);
    const [start, end] = branding.searchParams.get('q-sign-time')!.split(';').map(Number);
    expect(end - start).toBe(300); expect(branding.searchParams.get('response-cache-control') === 'public, max-age=300').toBe(true);
  });

  it('never creates COS read links for identity/local data or foreign/mutable prefixes', async () => {
    const { CosDownloadUrlAdapter } = await import('../src/modules/media/delivery/cos-download-url.adapter');
    const signer = new CosDownloadUrlAdapter(settings() as any);
    expect(signer.issue(asset({ purpose: 'identity_face', storageKey: 'ruleexam/identity/face.jpg' }) as any)).toBeNull();
    expect(signer.issue(asset({ storageProvider: 'local' }) as any)).toBeNull();
    for (const fields of [{ storageKey: 'other-project/media/image.png' }, { storageKey: 'ruleexam/staging/image.png' }, { cosBucket: 'other-123456' }, { storageKey: 'ruleexam/media/../identity/face.jpg' }]) {
      expect(() => signer.issue(asset(fields) as any)).toThrow();
    }
  });

  it('keeps mixed learner delivery and repeats exact authorization before every renewal', async () => {
    const { CosDownloadUrlAdapter } = await import('../src/modules/media/delivery/cos-download-url.adapter');
    const config = settings(); let allowed = true;
    const media: any = { authorizeTicket: vi.fn(async () => { if (!allowed) throw Object.assign(new Error('denied'), { code: 40302 }); return asset(); }) };
    const learner = new MediaTicketService(media, config as any, new CosDownloadUrlAdapter(config as any));
    const issued = await learner.issue('7', '41', 'exam_record_question', '11');
    expect(issued.content_url.startsWith('https://fixture-123456.cos.ap-test.myqcloud.com/')).toBe(true);
    allowed = false; await expect(learner.issue('7', '41', 'exam_record_question', '11')).rejects.toMatchObject({ code: 40302 });
    expect(media.authorizeTicket.mock.calls).toHaveLength(2);
    allowed = true; media.authorizeTicket.mockResolvedValueOnce(asset({ purpose: 'identity_face' }));
    expect((await learner.issue('7', '41', 'identity_verification_user', '7')).content_url.startsWith('/api/v1/media/tickets/')).toBe(true);
  });

  it('preserves duplicate batch positions and denies one owner without sharing another owner authorization', async () => {
    const { MediaDeliveryService } = await import('../src/modules/media/delivery/media-delivery.service');
    const tickets = { issue: vi.fn(async (_user, _asset, _type, owner) => {
      if (owner === '12') throw Errors.dataForbidden();
      return { content_url: '/api/v1/media/tickets/test/content', expires_at: '2030-01-01T00:00:00.000Z' };
    }) };
    const delivery = new MediaDeliveryService(tickets as any, {} as any);
    const first = { asset_id: '41', owner_type: 'exam_record_question', owner_id: '11' };
    const results = await delivery.issueLearnerBatch({ id: 7, client: 'mobile' } as any, [first, { ...first, owner_id: '12' }, first]);
    expect(results.map((item) => [item.index, item.ticket !== null, item.error?.code ?? null])).toEqual([[0, true, null], [1, false, 40302], [2, true, null]]);
    expect(tickets.issue).toHaveBeenCalledTimes(3);
    await expect(delivery.issueLearnerBatch({ id: 7, client: 'pc' } as any, [first])).rejects.toMatchObject({ code: 40301 });
    await expect(delivery.issueLearnerBatch({ id: 7, client: 'mobile' } as any, Array(51).fill(first))).rejects.toMatchObject({ code: 40001 });
  });

  it('accepts only bounded explicit delivery settings', () => {
    expect(mediaDeliverySettings({}).mode).toBe('proxy');
    for (const value of [0, 3601, NaN]) expect(() => mediaDeliverySettings({ mediaDelivery: { mode: 'cos-signed', readUrlTtlSeconds: value, videoUrlTtlSeconds: 300 } })).toThrow();
  });
});
