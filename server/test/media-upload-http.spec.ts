import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

// npm test builds first. Load that production output so this HTTP regression
// exercises tsc's actual DTO/parameter metadata as well as the global pipe.
const { MediaUploadSessionController } = require('../dist/modules/media/uploads/media-upload-session.controller');
const { MediaUploadSessionService } = require('../dist/modules/media/uploads/media-upload-session.service');
const { MediaUploadGrantService } = require('../dist/modules/media/uploads/media-upload-grant.service');
const { DtoValidationPipe } = require('../dist/common/dto-validation.pipe');
const { GlobalExceptionFilter } = require('../dist/common/http-exception.filter');
const { ResponseInterceptor } = require('../dist/common/response.interceptor');
const { Errors } = require('../dist/common/errors');

describe('upload session HTTP request bodies', () => {
  let app: INestApplication; let origin: string;
  let operations = 0;
  const result = { state: 'verifying' };
  const perform = async (_actor: unknown, id: string) => {
    operations += 1;
    if (id === 'forbidden') throw Errors.dataForbidden('无权操作上传会话');
    return result;
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [MediaUploadSessionController], providers: [
      { provide: MediaUploadSessionService, useValue: { begin: async () => result, complete: perform } },
      { provide: MediaUploadGrantService, useValue: { issue: perform } },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => { req.user = { id: 7, client: 'pc' }; next(); });
    app.useGlobalPipes(new DtoValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  const post = (path: string, body?: unknown) => fetch(`${origin}/media/upload-sessions${path}`, {
    method: 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

  it.each(['credentials', 'complete'])('accepts an empty JSON object and an absent body for %s', async (operation) => {
    for (const body of [{}, undefined]) {
      const response = await post(`/upload-id/${operation}`, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ code: 0, data: result });
    }
  });

  it.each(['credentials', 'complete'])('rejects unexpected fields, arrays and prototype keys for %s', async (operation) => {
    const before = operations;
    for (const body of [{ unexpected: true }, [], JSON.parse('{"__proto__":{}}'), { constructor: {} }]) {
      const response = await post(`/upload-id/${operation}`, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 40001 });
    }
    expect(operations).toBe(before);
  });

  it.each(['credentials', 'complete'])('keeps business permission errors in the response envelope for %s', async (operation) => {
    const response = await post(`/forbidden/${operation}`, {});
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 40302, message: '无权操作上传会话', data: null });
  });

  it('keeps the begin DTO and raw unknown-field validation strict', async () => {
    const body = { client_request_id: 'b1fc968b-d6e1-4af3-b397-86105daa443c', purpose: 'question', filename: 'image.png', mime_type: 'image/png', size_bytes: 1, fingerprint_sha256: 'a'.repeat(64) };
    const invalid = await post('', { ...body, unexpected: true });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ code: 40001 });
    const valid = await post('', body);
    expect(valid.status).toBe(200); expect(await valid.json()).toMatchObject({ code: 0 });
  });

  it('rejects non-plain runtime bodies before invoking business services', () => {
    const controller = new MediaUploadSessionController({ complete: perform }, { issue: perform });
    const body = Object.create({ inherited: true });
    // Locate @Req from actual runtime method metadata to cover the old and new
    // parameter positions without making the test depend on the fix's signature.
    for (const method of ['credentials', 'complete']) {
      const metadata = Reflect.getMetadata('__routeArguments__', MediaUploadSessionController, method);
      const request = Object.entries(metadata).find(([key]) => key.startsWith('0:'))![1] as any;
      const args: unknown[] = [{ id: 7 }, 'upload-id']; args[request.index] = { body };
      expect(() => controller[method](...args)).toThrow();
    }
  });
});
