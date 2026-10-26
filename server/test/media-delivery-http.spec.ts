import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Readable } from 'node:stream';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { GlobalExceptionFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { MediaTicketController } from '../src/modules/media/media-ticket.controller';
import { MediaTicketService } from '../src/modules/media/media-ticket.service';
import { SystemService } from '../src/modules/system/system.service';
import { SiteConfigController } from '../src/modules/system/system.controller';

describe('media delivery HTTP boundaries', () => {
  let app: INestApplication; let origin: string;
  const ticket = { content_url: '/api/v1/media/tickets/fixture/content', expires_at: '2030-01-01T00:00:00.000Z' };
  const learner = { issue: vi.fn(async () => ticket) };
  const delivery = { issuePreview: vi.fn(async () => ticket), issueLearnerBatch: vi.fn(async () => []) };
  beforeAll(async () => {
    const { MediaDeliveryController } = await import('../src/modules/media/delivery/media-delivery.controller');
    const { MediaDeliveryService } = await import('../src/modules/media/delivery/media-delivery.service');
    const { MediaTicketBatchDto } = await import('../src/modules/media/delivery/media-delivery.dto');
    // Vitest's transformer omits emitted decorator metadata; reproduce the
    // production tsc metadata so the real global whitelist runs before raw checks.
    Reflect.defineMetadata('design:paramtypes', [MediaTicketBatchDto, Object, Object], MediaDeliveryController.prototype, 'batch');
    const module = await Test.createTestingModule({ controllers: [MediaDeliveryController, MediaTicketController], providers: [
      { provide: MediaDeliveryService, useValue: delivery }, { provide: MediaTicketService, useValue: learner },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => { req.user = { id: 7, client: req.headers['x-test-client'] || 'mobile' }; next(); });
    app.useGlobalPipes(new DtoValidationPipe()); app.useGlobalInterceptors(new ResponseInterceptor(new Reflector())); app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  const post = async (path: string, body: any, client = 'mobile') => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-client': client }, body: JSON.stringify(body) });

  it('returns the normal envelope for PC preview and learner batch', async () => {
    const preview = await post('/media/41/preview-ticket', {}, 'pc');
    expect(preview.status).toBe(200); expect(await preview.json()).toMatchObject({ code: 0, data: ticket });
    const batch = await post('/media/tickets/batch', { items: [{ asset_id: '41', owner_type: 'exam_record_question', owner_id: '11' }] });
    expect(batch.status).toBe(200); expect(await batch.json()).toMatchObject({ code: 0, data: [] });
  });

  it.each([
    ['/media/41/preview-ticket', { asset_id: '42' }],
    ['/media/tickets/batch', { items: [], source: 'unknown' }],
    ['/media/tickets/batch', { items: [{ asset_id: '41', owner_type: 'exam_record_question', owner_id: '11', source: 'unknown' }] }],
    ['/media/41/tickets', { owner_type: 'exam_record_question', owner_id: '11', source: 'unknown' }],
  ])('rejects raw unknown fields at %s even with the global whitelist pipe', async (path, body) => {
    const response = await post(path, body);
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 40001 });
  });

  it('rejects malformed identifiers and over-sized batches before invoking delivery', async () => {
    const calls = delivery.issueLearnerBatch.mock.calls.length;
    for (const body of [{ items: [{ asset_id: '../41', owner_type: 'exam_record_question', owner_id: '11' }] }, { items: Array(51).fill({ asset_id: '41', owner_type: 'exam_record_question', owner_id: '11' }) }]) {
      const response = await post('/media/tickets/batch', body);
      expect(response.status).toBe(400);
    }
    expect(delivery.issueLearnerBatch.mock.calls.length).toBe(calls);
  });
});

describe('public branding redirect', () => {
  let app: INestApplication; let origin: string;
  const rows: any[] = [{ id: '1', key: 'logo_asset_id', value: '41' }, { id: '2', key: 'banners', value: [] }];
  const asset: any = { id: '41', purpose: 'branding', mediaKind: 'image', status: 'ready' };
  const media = { registerOwnerPolicy: vi.fn(), authorizePublicBrandingAsset: vi.fn(async () => asset), openPublicBrandingContent: vi.fn(async () => ({ asset: { mimeType: 'image/png' }, size: 1, range: null, stream: Readable.from(Buffer.from('x')) })) };
  const urls = { issue: vi.fn(() => ({ content_url: 'https://fixture-123456.cos.ap-test.myqcloud.com/ruleexam/media/logo.png?fixture=1', expires_at: '2030-01-01T00:00:00.000Z' })) };
  beforeAll(async () => {
    const system = new SystemService({} as any, {} as any, { find: async () => rows } as any, {} as any, {} as any, {} as any, media as any, {} as any, {} as any, urls as any);
    const module = await Test.createTestingModule({ controllers: [SiteConfigController], providers: [{ provide: SystemService, useValue: system }] }).compile();
    app = module.createNestApplication(); app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  it('rechecks the current whitelist before an empty 307 response and never opens object bytes', async () => {
    const response = await fetch(`${origin}/site-config/assets/41/content`, { redirect: 'manual' });
    expect(response.status).toBe(307); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('location')?.startsWith('https://fixture-123456.cos.ap-test.myqcloud.com/')).toBe(true);
    expect(await response.text()).toBe(''); expect(media.authorizePublicBrandingAsset).toHaveBeenCalledWith('41');
    expect(media.openPublicBrandingContent).not.toHaveBeenCalled(); expect(urls.issue).toHaveBeenCalledWith(asset, { branding: true });
    rows[0].value = null;
    const removed = await fetch(`${origin}/site-config/assets/41/content`, { redirect: 'manual' });
    expect(removed.status).toBe(404); expect(urls.issue).toHaveBeenCalledTimes(1);
  });
});
