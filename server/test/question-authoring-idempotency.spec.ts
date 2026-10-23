import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import express from 'express';
import { QuestionAuthoringController } from '../src/modules/questions/question-authoring.controller';
import { QuestionAuthoringService, normalizeAuthoringRequestId } from '../src/modules/questions/question-authoring.service';
import { canonicalAuthoringHash } from '../src/modules/questions/question-authoring-codec';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { GlobalExceptionFilter } from '../src/common/http-exception.filter';
import type { AuthoringBundle, AuthoringReceipt } from '../src/common/question-authoring';

function input(count = 1): AuthoringBundle {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  return { document: { schema_version: 1, content: { type: 'doc', content: Array.from({ length: count }, (_, n) => ({ type: 'questionBlock', attrs: { client_id: `q${n}` }, content: [
    { type: 'questionStem', content: doc('题干').content }, { type: 'questionOption', attrs: { option_id: 'A', checked: true }, content: doc('是').content }, { type: 'questionOption', attrs: { option_id: 'B', checked: false }, content: doc('否').content },
  ] })) }, questions: Object.fromEntries(Array.from({ length: count }, (_, n) => [`q${n}`, { category_id: '11', type: 'single', difficulty: 'easy', concept_id: null, regulation_id: null, regulation_version_id: null, analysis: doc('解析'), score_cents: 500 }])) }, option_ids: {}, identities: {}, layouts: {} };
}

describe('authoring request identity', () => {
  it('normalizes valid UUIDs and rejects arbitrary strings before a write', () => {
    expect(normalizeAuthoringRequestId('75D17F2E-1C29-4BF7-B5DA-660A3B116EBA')).toBe('75d17f2e-1c29-4bf7-b5da-660a3b116eba');
    expect(() => normalizeAuthoringRequestId('request-1')).toThrow('UUID');
  });
  it('hashes object key order consistently but distinguishes option order and checked answers', () => {
    const first = input(); const reordered = { ...first, document: { questions: first.document.questions, content: first.document.content, schema_version: 1 as const } };
    expect(canonicalAuthoringHash(first)).toBe(canonicalAuthoringHash(reordered));
    const changed = structuredClone(first); changed.document.content.content![0].content!.reverse();
    expect(canonicalAuthoringHash(first)).not.toBe(canonicalAuthoringHash(changed));
  });
});

describe('authoring HTTP body and receipt boundary', () => {
  let app: INestApplication; let origin = ''; let writes = 0;
  const rows = new Map<string, any>();
  const repository = { insert: async (row: any) => {
    const key = `${row.ownerId}:${row.requestId}`;
    if (rows.has(key)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    rows.set(key, { ...row });
  }, findOne: async ({ where }: any) => rows.get(`${where.ownerId}:${where.requestId}`) || null,
    save: async (row: any) => { rows.set(`${row.ownerId}:${row.requestId}`, row); return row; } };
  beforeAll(async () => {
    const data: any = { getRepository: () => repository, transaction: async (callback: (m: unknown) => Promise<unknown>) => callback(data) };
    const service = new QuestionAuthoringService(data, { lockAuthoringBatch: async () => undefined,
      writeAuthoringInTransaction: async (_m: unknown, write: any) => { writes++; return { client_id: write.client_id, question_id: String(writes), saved_version_id: String(100 + writes), revision: 1, bundle: write.bundle }; } } as any,
      { permissions: async () => ['questions:write', 'questions:read'] } as any);
    const module = await Test.createTestingModule({ controllers: [QuestionAuthoringController], providers: [{ provide: QuestionAuthoringService, useValue: service }] }).compile();
    app = module.createNestApplication({ bodyParser: false });
    app.use(express.json({ limit: '2mb' }));
    app.use((req: any, _res: any, next: () => void) => { req.user = { id: 9, role: 'super_admin' }; next(); });
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector())); app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  const id = '75d17f2e-1c29-4bf7-b5da-660a3b116eba';
  it('returns a uniform envelope and recovers the same receipt after a lost response', async () => {
    const request = { request_id: id, bundle: input() };
    const saved = await fetch(`${origin}/admin/question-documents/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }).then((r) => r.json());
    expect(saved).toMatchObject({ code: 0, data: { request_id: id, items: [{ saved_version_id: '101' }] } });
    const recovered = await fetch(`${origin}/admin/question-documents/commits/${id}`).then((r) => r.json());
    expect(recovered).toEqual(saved);
    const replayed = await fetch(`${origin}/admin/question-documents/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }).then((r) => r.json());
    expect(replayed).toEqual(saved); expect(writes).toBe(1);
  });
  it('rejects unknown wrapper/source fields through the real DTO boundary', async () => {
    const response = await fetch(`${origin}/admin/question-documents/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: id, bundle: input(), source: 'ai' }) });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 40001 });
  });
  it('accepts a complete request just below 2 MiB and rejects the same body crossing that limit', async () => {
    const body = { request_id: '84df8ef9-32a9-4112-ac24-3e8f5d2ef711', bundle: input(23) };
    const target = 2 * 1024 * 1024 - 32;
    let remaining = target - Buffer.byteLength(JSON.stringify(body));
    for (const block of body.bundle.document.content.content!) {
      const text = block.content![0].content![0].content![0]; const added = Math.min(remaining, 95_000);
      text.text += 'x'.repeat(added); remaining -= added;
    }
    expect(remaining).toBe(0);
    const serialized = JSON.stringify(body); expect(Buffer.byteLength(serialized)).toBe(target);
    const valid = await fetch(`${origin}/admin/question-documents/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: serialized });
    expect(valid.status).toBe(200); expect(await valid.json()).toMatchObject({ code: 0 });
    const count = writes;
    const tooLarge = await fetch(`${origin}/admin/question-documents/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: serialized + ' '.repeat(64) });
    expect(tooLarge.status).toBe(413); expect(writes).toBe(count);
  });
});
