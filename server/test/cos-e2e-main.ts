import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { mkdirSync } from 'node:fs';

// This entry point is test-only. It replaces vendor-facing COS and STS
// adapters while leaving the Nest controllers, repositories and transactions
// on the real application path.
const { AppModule } = require('../dist/app.module');
const { loadConfig } = require('../dist/config/configuration');
const { CosMediaStorage } = require('../dist/modules/media/storage/cos-media-storage');
const { CosUploadGrantAdapter } = require('../dist/modules/media/storage/cos-upload-grant.adapter');
const { MediaUploadFinalizerService } = require('../dist/modules/media/uploads/media-upload-finalizer.service');
const { ensureSeedData } = require('../dist/seed');
const { DataSource } = require('typeorm');

type Locator = { provider: 'cos'; key: string; bucket: string; region: string; versionId: string | null };
type ObjectValue = { bytes: Buffer; mimeType: string; versionId: string | null };

function objectKey(locator: Locator): string {
  return `${locator.bucket}/${locator.region}/${locator.key}/${locator.versionId || ''}`;
}

class FixtureCosStorage {
  readonly config: any;
  readonly objects = new Map<string, ObjectValue>();
  readonly multipart = new Map<string, { locator: Locator; mimeType: string; parts: Map<number, Buffer> }>();

  constructor(config: any) { this.config = config; }
  private assert(locator: Locator) {
    if (locator.provider !== 'cos' || locator.bucket !== this.config.bucket || locator.region !== this.config.region
      || !locator.key.startsWith(this.config.keyPrefix) || locator.key.includes('..')) throw new Error('fixture locator outside project');
  }
  putDirect(locator: Locator, bytes: Buffer, mimeType: string) {
    this.assert(locator);
    this.objects.set(objectKey({ ...locator, versionId: null }), { bytes: Buffer.from(bytes), mimeType, versionId: null });
  }
  async stat(locator: Locator) {
    this.assert(locator);
    const found = this.objects.get(objectKey(locator));
    if (!found) { const error: any = new Error('missing fixture object'); error.statusCode = 404; error.code = 'NoSuchKey'; throw error; }
    return { locator: { ...locator, versionId: found.versionId }, sizeBytes: found.bytes.length, mimeType: found.mimeType, etag: 'fixture-etag', crc64: null };
  }
  async open(locator: Locator, range?: { start: number; end: number }) {
    const found = this.objects.get(objectKey(locator));
    if (!found) { const error: any = new Error('missing fixture object'); error.statusCode = 404; error.code = 'NoSuchKey'; throw error; }
    const start = range?.start || 0, end = range ? range.end + 1 : found.bytes.length;
    return Readable.from(found.bytes.subarray(start, end));
  }
  async putFile(locator: Locator, filePath: string, mimeType: string) {
    this.assert(locator);
    const bytes = await readFile(filePath);
    const versionId = 'fixture-v1';
    this.objects.set(objectKey({ ...locator, versionId }), { bytes, mimeType, versionId });
    return this.stat({ ...locator, versionId });
  }
  async remove(locator: Locator) { this.objects.delete(objectKey(locator)); }
  async begin(locator: Locator, mimeType: string) {
    const uploadId = `fixture-${randomUUID()}`;
    this.multipart.set(uploadId, { locator, mimeType, parts: new Map() });
    return { uploadId };
  }
  async parts(locator: Locator, uploadId: string) {
    const item = this.multipart.get(uploadId);
    if (!item || item.locator.key !== locator.key) return [];
    return [...item.parts.entries()].sort(([a], [b]) => a - b).map(([partNumber, bytes]) => ({ partNumber, etag: `etag-${partNumber}`, sizeBytes: bytes.length }));
  }
  async complete(locator: Locator, uploadId: string, parts: Array<{ partNumber: number }>) {
    const item = this.multipart.get(uploadId); if (!item) throw new Error('fixture upload missing');
    const bytes = Buffer.concat(parts.map(part => item.parts.get(part.partNumber) || Buffer.alloc(0)));
    this.putDirect(locator, bytes, item.mimeType); this.multipart.delete(uploadId); return this.stat(locator);
  }
  async abort(_locator: Locator, uploadId: string) { this.multipart.delete(uploadId); }
  async listMultipartUploads(locator: Locator) {
    return [...this.multipart.entries()].filter(([, item]) => item.locator.key === locator.key).map(([uploadId]) => ({ uploadId, initiatedAt: new Date().toISOString() }));
  }
  async removeStagingVersions(locator: Locator) { this.objects.delete(objectKey(locator)); }
}

function controlGuard(secret: Buffer, req: express.Request, res: express.Response): boolean {
  const remote = req.socket.remoteAddress;
  const value = String(req.headers['x-cos-test-control'] || '');
  const supplied = /^[a-f0-9]{64}$/.test(value) ? Buffer.from(value, 'hex') : Buffer.alloc(0);
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote || '') || supplied.length !== secret.length || !timingSafeEqual(secret, supplied)) { res.status(403).end(); return false; }
  return true;
}

async function bootstrap() {
  if (process.env.NODE_ENV !== 'test') throw new Error('COS test bootstrap requires test environment');
  const config = loadConfig();
  if (!/^ruleexam_test_[A-Za-z0-9_]+$/.test(config.db.database)) throw new Error('COS test bootstrap requires an isolated test database');
  const storage = new FixtureCosStorage(config.cosMedia);
  const controlSecret = createHmac('sha256', config.jwt.secret).update('cos-test-control').digest();
  const base = `http://127.0.0.1:${config.port}`;
  const grant = {
    async issue(input: any) {
      const query = new URLSearchParams({ key: input.locator.key, bucket: input.locator.bucket!, region: input.locator.region! });
      return { mode: 'simple', method: 'PUT', url: `${base}/__cos-test/put?${query}`, headers: { 'Content-Type': input.mimeType, 'x-cos-test-control': controlSecret.toString('hex') }, expires_at: new Date(Math.min(input.expiresAt.getTime(), Date.now() + 60_000)).toISOString() };
    },
  };
  @Global()
  @Module({ providers: [{ provide: CosUploadGrantAdapter, useValue: grant }], exports: [CosUploadGrantAdapter] })
  class FixtureCosModule {}
  const server = express(); server.set('trust proxy', 1);
  server.use(express.json({ limit: '2mb' })); server.use(express.urlencoded({ extended: true, limit: '2mb' })); server.use(cookieParser());
  server.put('/__cos-test/put', express.raw({ type: '*/*', limit: '600mb' }), (req, res) => {
    if (!controlGuard(controlSecret, req, res)) return;
    const key = String(req.query.key || ''), bucket = String(req.query.bucket || ''), region = String(req.query.region || '');
    const locator: Locator = { provider: 'cos', key, bucket, region, versionId: null };
    try { storage.putDirect(locator, Buffer.from(req.body || []), String(req.headers['content-type'] || 'application/octet-stream')); res.status(200).json({ ok: true }); }
    catch { res.status(400).end(); }
  });
  server.post('/__cos-test/finalize', async (req, res) => {
    if (!controlGuard(controlSecret, req, res)) return;
    try { res.json(await app.get(MediaUploadFinalizerService).runOnce()); } catch { res.status(500).json({ ok: false }); }
  });
  const testing = await Test.createTestingModule({
    imports: [FixtureCosModule, AppModule],
  }).overrideProvider(CosMediaStorage).useValue(storage).compile();
  const app = testing.createNestApplication(new ExpressAdapter(server), { logger: ['warn', 'error'] });
  app.setGlobalPrefix('api/v1'); app.enableShutdownHooks();
  for (const dir of [config.upload.dir, `${config.upload.dir}/tmp/media`, `${config.upload.dir}/media`, config.dataDir, config.logDir]) mkdirSync(dir, { recursive: true });
  await app.init(); await ensureSeedData(app.get(DataSource)); await app.listen(config.port, '127.0.0.1');
  console.log(`[cos-test] api listening on :${config.port}`);
}
void bootstrap().catch((error) => { console.error(`COS test bootstrap failed: ${error?.message || 'unknown'}`); process.exitCode = 1; });
