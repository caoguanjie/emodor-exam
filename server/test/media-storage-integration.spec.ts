import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import express from 'express';
import { MediaService } from '../src/modules/media/media.service';
import { MediaAsset } from '../src/entities/media-asset.entity';
import { MediaReference } from '../src/entities/media-reference.entity';
import { DEFAULT_MEDIA_LIMITS } from '../src/modules/media/media-policy';
import { MediaStorageRouter } from '../src/modules/media/storage/media-storage.router';
import { LocalMediaStorage } from '../src/modules/media/storage/local-media-storage';
import type { StorageLocator, StoredObject } from '../src/modules/media/storage/media-storage.port';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-storage-flow-')); roots.push(root);
  const objects = new Map<string, Buffer>();
  const assets = new Map<string, any>();
  const cosConfig = { provider: 'cos' as const, bucket: 'fixture-123456', region: 'ap-test', keyPrefix: 'ruleexam/', secretId: 'not-a-real-id', secretKey: 'not-a-real-key', sessionToken: null };
  const cos = {
    stat: vi.fn(async (locator: StorageLocator): Promise<StoredObject> => {
      const bytes = objects.get(locator.key);
      if (!bytes) throw Object.assign(new Error('absent'), { statusCode: 404, code: 'NoSuchKey' });
      return { locator: { ...locator, versionId: 'fixture-version' }, sizeBytes: bytes.length, mimeType: 'image/png', etag: 'etag', crc64: '123' };
    }),
    putFile: vi.fn(async (locator: StorageLocator, path: string, mimeType: string) => {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      objects.set(locator.key, await readFile(path));
      return { ...(await cos.stat(locator)), mimeType };
    }),
    open: vi.fn(async (locator: StorageLocator, range?: { start: number; end: number }) => {
      const bytes = objects.get(locator.key)!;
      return Readable.from(range ? bytes.subarray(range.start, range.end + 1) : bytes);
    }),
    remove: vi.fn(async (locator: StorageLocator) => { objects.delete(locator.key); }),
  };
  const router = new MediaStorageRouter(cosConfig, new LocalMediaStorage(root), cos as any);
  let next = 1;
  const assetRepo: any = {
    create: (value: any) => ({ ...value, id: String(next++), createdAt: new Date(), updatedAt: new Date() }),
    save: async (value: any) => { assets.set(value.id, { ...value }); return value; },
    findOne: async ({ where }: any) => assets.has(where.id) ? { ...assets.get(where.id) } : null,
    delete: async ({ id }: any) => { assets.delete(id); },
    createQueryBuilder: () => { const builder: any = { where: () => builder, getMany: async () => [...assets.values()] }; return builder; },
  };
  const references = { find: async () => [], count: vi.fn(async () => 0) };
  const manager: any = { getRepository: (entity: unknown) => entity === MediaAsset ? assetRepo : references };
  const dataSource: any = { transaction: async (work: any) => work(manager), getRepository: () => ({ findOne: async () => ({ id: '7', status: 1 }) }) };
  const probe = { probe: vi.fn(async () => ({ mimeType: 'image/png', width: 1, height: 1 })) };
  const access = { assertAllowed: vi.fn(async (_actor: string, _permission: string) => {}) };
  const media = new MediaService(assetRepo, references as any, dataSource,
    { upload: { dir: root }, media: DEFAULT_MEDIA_LIMITS, cosMedia: cosConfig } as any,
    probe as any, router, undefined, access as any);
  return { root, media, assets, objects, cos, router, probe, access, manager, assetRepo, references };
}

describe('media storage integration', () => {
  it('cos_upload_preserves_owner_and_probe and publishes the actual private bytes', async () => {
    const f = await fixture(); const bytes = Buffer.from('controlled-image');
    const result = await f.media.upload('7', 'avatar', { buffer: bytes, originalname: 'name.png', mimetype: 'image/jpeg' } as any, '9');
    expect(result).toMatchObject({ assetId: '1', status: 'ready' });
    const asset = f.assets.get(result.assetId);
    expect(asset).toMatchObject({ ownerId: '9', uploadedBy: '7', mimeType: 'image/png', sha256: hash(bytes), storageProvider: 'cos', cosBucket: 'fixture-123456', cosVersionId: 'fixture-version' });
    expect(f.objects.get(asset.storageKey)).toEqual(bytes);
    expect(asset.storageKey).toMatch(/^ruleexam\/media\//);
    expect(await readdir(join(f.root, 'tmp', 'media'))).toEqual([]);
  });

  it('probe failure retains the old failed metadata but never publishes a ready COS asset', async () => {
    const f = await fixture(); f.probe.probe.mockRejectedValue(new Error('private path from a tool'));
    await expect(f.media.upload('7', 'question', { buffer: Buffer.from('invalid'), originalname: 'image.png' } as any)).rejects.toMatchObject({ code: 40001 });
    expect([...f.assets.values()].filter((asset) => asset.status === 'ready')).toHaveLength(0);
    expect([...f.assets.values()]).toEqual([expect.objectContaining({ status: 'failed', probeError: '媒体内容校验失败', sha256: hash(Buffer.from('invalid')) })]);
    expect(f.cos.putFile).not.toHaveBeenCalled();
  });

  it('mixed_drivers_read_by_row and invalid ranges never start an object stream', async () => {
    const f = await fixture(); await writeFile(join(f.root, 'legacy.png'), 'legacy');
    f.assets.set('1', { id: '1', ownerId: '7', purpose: 'avatar', status: 'ready', storageKey: 'legacy.png', storageProvider: 'local' });
    const local = await f.media.openContent('7', '1', 'bytes=1-3');
    expect(local.range).toEqual({ start: 1, end: 3 });
    const localParts: Buffer[] = []; for await (const chunk of local.stream) localParts.push(Buffer.from(chunk));
    expect(Buffer.concat(localParts).toString()).toBe('ega');
    expect(f.cos.open).not.toHaveBeenCalled();
    f.objects.set('ruleexam/media/current.png', Buffer.from('object'));
    f.assets.set('2', { id: '2', ownerId: '7', purpose: 'avatar', status: 'ready', storageKey: 'ruleexam/media/current.png', storageProvider: 'cos', cosBucket: 'fixture-123456', cosRegion: 'ap-test', cosVersionId: 'fixture-version' });
    const cloud = await f.media.openContent('7', '2', 'bytes=2-4');
    const cloudParts: Buffer[] = []; for await (const chunk of cloud.stream) cloudParts.push(Buffer.from(chunk));
    expect(Buffer.concat(cloudParts).toString()).toBe('jec');
    expect(f.cos.open).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'fixture-version' }), { start: 2, end: 4 });
    f.cos.open.mockClear();
    await expect(f.media.openContent('7', '2', 'bytes=99-100')).rejects.toMatchObject({ code: 41601 });
    expect(f.cos.open).not.toHaveBeenCalled();
  });

  it('identity_uses_private_bounded_read for both declared and unexpectedly large object bodies', async () => {
    const f = await fixture(); const key = 'ruleexam/identity/face.jpg';
    f.objects.set(key, Buffer.from('private'));
    f.assets.set('1', { id: '1', ownerId: '7', uploadedBy: '7', purpose: 'identity_face', status: 'ready', storageKey: key, storageProvider: 'cos', cosBucket: 'fixture-123456', cosRegion: 'ap-test', cosVersionId: 'fixture-version' });
    expect(await f.media.readPrivateBytes('7', '1', 'identity_face')).toEqual(Buffer.from('private'));
    f.cos.stat.mockResolvedValueOnce({ locator: { provider: 'cos', key, bucket: 'fixture-123456', region: 'ap-test', versionId: 'fixture-version' }, sizeBytes: 10 * 1024 * 1024 + 1, mimeType: 'image/jpeg', etag: null, crc64: null });
    f.cos.open.mockClear();
    await expect(f.media.readPrivateBytes('7', '1', 'identity_face')).rejects.toMatchObject({ code: 40401 });
    expect(f.cos.open).not.toHaveBeenCalled();
    const overrun = Readable.from([Buffer.alloc(10 * 1024 * 1024), Buffer.from('x')]);
    f.cos.open.mockResolvedValueOnce(overrun);
    await expect(f.media.readPrivateBytes('7', '1', 'identity_face')).rejects.toMatchObject({ code: 40401 });
    expect(overrun.destroyed).toBe(true);
  });

  it('shares original upload permissions while rejecting cross-owner non-avatar purposes', async () => {
    const f = await fixture(); const actor = { id: 7 } as any;
    await expect(f.media.assertUploadAllowed(actor, 'avatar')).resolves.toEqual({ ownerId: '7' });
    expect(f.access.assertAllowed).not.toHaveBeenCalled();
    await f.media.assertUploadAllowed(actor, 'question');
    await f.media.assertUploadAllowed(actor, 'avatar', '9');
    expect(f.access.assertAllowed.mock.calls).toEqual([['7', 'media:write'], ['7', 'students:write']]);
    await expect(f.media.assertUploadAllowed(actor, 'video', '9')).rejects.toMatchObject({ code: 40301 });
    f.access.assertAllowed.mockRejectedValueOnce(new Error('revoked'));
    await expect(f.media.assertUploadAllowed(actor, 'question')).rejects.toThrow('revoked');
  });

  it('keeps an unknown COS publication locator until exact-key reconciliation can find its version', async () => {
    const f = await fixture();
    f.cos.putFile.mockRejectedValue(new Error('unknown write result'));
    await expect(f.media.upload('7', 'avatar', { buffer: Buffer.from('private'), originalname: 'name.png' } as any)).rejects.toMatchObject({ code: 50004 });
    const asset = f.assets.get('1');
    expect(asset).toMatchObject({ status: 'failed', storageProvider: 'cos', cosVersionId: null });
    expect(asset.storageKey).toMatch(/^ruleexam\/media\//);
    await expect(f.media.remove('7', '1')).rejects.toMatchObject({ code: 50004 });
    expect(f.assets.get('1').status).toBe('deleting');
    expect(f.cos.remove).not.toHaveBeenCalled();
    f.objects.set(asset.storageKey, Buffer.from('private'));
    await f.media.remove('7', '1');
    expect(f.cos.remove).toHaveBeenCalledWith(expect.objectContaining({ key: asset.storageKey, versionId: 'fixture-version' }));
    expect(f.assets.has('1')).toBe(false);
  });

  it('creates finalizer ready assets in the caller transaction and rejects mutable staging', async () => {
    const f = await fixture();
    const input: any = { ownerId: '7', uploadedBy: '7', purpose: 'question', mediaKind: 'image', originalName: 'question.png', object: { locator: { provider: 'cos', key: 'ruleexam/media/verified.png', bucket: 'fixture-123456', region: 'ap-test', versionId: 'version-1' }, sizeBytes: 7, mimeType: 'image/png', etag: 'verified', crc64: '123' }, sha256: hash(Buffer.from('fixture')), durationMs: null };
    expect(await f.media.createReadyAsset(f.manager, input)).toMatchObject({ id: '1', status: 'ready', storageProvider: 'cos', cosVersionId: 'version-1' });
    input.object.locator.key = 'ruleexam/staging/client-writable.png';
    await expect(f.media.createReadyAsset(f.manager, input)).rejects.toMatchObject({ code: 40001 });
    expect(f.assets.size).toBe(1);
  });

  it.each([
    { bucket: 'other-project-123456' },
    { region: 'ap-other' },
    { key: 'ruleexam/media/../staging/image.png' },
  ])('does not register a ready asset with a foreign or traversing locator %j', async (invalid) => {
    const f = await fixture();
    await expect(f.media.createReadyAsset(f.manager, {
      ownerId: '7', uploadedBy: '7', purpose: 'question', mediaKind: 'image', originalName: null,
      object: { locator: { provider: 'cos', key: 'ruleexam/media/image.png', bucket: 'fixture-123456', region: 'ap-test', versionId: 'version-1', ...invalid }, sizeBytes: 7, mimeType: 'image/png', etag: null, crc64: null },
      sha256: hash(Buffer.from('fixture')), durationMs: null,
    })).rejects.toMatchObject({ code: 40001 });
    expect(f.assets.size).toBe(0);
  });

  it('persists the unique cloud intent before a write and retains it if the ready transaction fails', async () => {
    const f = await fixture(); const save = f.assetRepo.save;
    f.assetRepo.save = async (value: any) => {
      if (value.status === 'ready') throw new Error('simulated ready commit failure');
      return save(value);
    };
    f.cos.putFile.mockImplementationOnce(async (locator, path, mimeType) => {
      expect(f.assets.get('1')).toMatchObject({ status: 'processing', storageProvider: 'cos', storageKey: locator.key });
      f.objects.set(locator.key, await readFile(path));
      return { ...(await f.cos.stat(locator)), mimeType };
    });
    await expect(f.media.upload('7', 'avatar', { buffer: Buffer.from('private'), originalname: 'image.png' } as any)).rejects.toMatchObject({ code: 50004 });
    expect(f.assets.get('1')).toMatchObject({ status: 'failed', storageProvider: 'cos', cosVersionId: 'fixture-version' });
  });

  it('a concurrent delete wins over a late ready save and does not resurrect the resource', async () => {
    const f = await fixture();
    f.cos.putFile.mockImplementationOnce(async (locator, path, mimeType) => {
      const current = f.assets.get('1');
      f.assets.set('1', { ...current, status: 'deleting' });
      f.objects.set(locator.key, await readFile(path));
      return { ...(await f.cos.stat(locator)), mimeType };
    });
    await expect(f.media.upload('7', 'avatar', { buffer: Buffer.from('private'), originalname: 'image.png' } as any)).rejects.toMatchObject({ code: 50004 });
    expect(f.assets.get('1').status).toBe('deleting');
  });

  it('protects an active processing asset and its private probe input during orphan cleanup', async () => {
    const f = await fixture(); let release!: () => void; let reached!: (path: string) => void;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const probing = new Promise<string>((resolve) => { reached = resolve; });
    (f.probe.probe as any).mockImplementationOnce(async (path: string) => { reached(path); await pause; return { mimeType: 'image/png', width: 1, height: 1 }; });
    const upload = f.media.upload('7', 'avatar', { buffer: Buffer.from('private'), originalname: 'image.png' } as any);
    const path = await probing;
    try {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      f.assets.get('1').updatedAt = old;
      await utimes(path, old, old);
      expect(await f.media.cleanupOrphans(60_000)).toBe(0);
      expect(f.assets.get('1').status).toBe('processing');
      expect(await readFile(path)).toEqual(Buffer.from('private'));
    } finally { release(); await upload; }
  });

  it('reconciles a stale processing intent but lets a business reference win cleanup', async () => {
    const f = await fixture(); const key = 'ruleexam/media/crashed.png';
    f.objects.set(key, Buffer.from('private'));
    f.assets.set('99', { id: '99', ownerId: '7', uploadedBy: '7', purpose: 'avatar', mediaKind: 'image', status: 'processing', storageProvider: 'cos', storageKey: key, cosBucket: 'fixture-123456', cosRegion: 'ap-test', cosVersionId: null, probeError: '媒体发布状态待核对', updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    f.references.count.mockResolvedValue(1);
    expect(await f.media.cleanupOrphans()).toBe(0);
    expect(f.objects.has(key)).toBe(true);
    f.references.count.mockResolvedValue(0);
    expect(await f.media.cleanupOrphans()).toBe(1);
    expect(f.assets.has('99')).toBe(false);
    expect(f.cos.remove).toHaveBeenCalledWith(expect.objectContaining({ key, versionId: 'fixture-version' }));
  });
});

describe('verified publishing and streaming responses', () => {
  it('rejects corrupt formal readback but retains the exact version for guarded durable cleanup', async () => {
    const f = await fixture(); const { MediaPublisher, MediaPublishError } = await import('../src/modules/media/media-publisher.service');
    const path = join(f.root, 'source'); await writeFile(path, 'source', { mode: 0o600 });
    f.cos.open.mockResolvedValueOnce(Readable.from(Buffer.from('wrong!')));
    const publisher = new MediaPublisher(f.router);
    await expect(publisher.publishVerifiedFile({ filePath: path, expectedSha256: hash(Buffer.from('source')), mimeType: 'image/png', locator: { provider: 'cos', key: 'ruleexam/media/new.png', bucket: 'fixture-123456', region: 'ap-test', versionId: null } })).rejects.toMatchObject({
      constructor: MediaPublishError,
      locator: expect.objectContaining({ key: 'ruleexam/media/new.png', versionId: 'fixture-version' }),
      object: expect.objectContaining({ locator: expect.objectContaining({ versionId: 'fixture-version' }) }),
    });
    expect(f.cos.remove).not.toHaveBeenCalled();
    expect(f.objects.has('ruleexam/media/new.png')).toBe(true);
  });

  it('range_and_disconnect_release_stream with real HTTP response headers', async () => {
    const { sendMediaContent } = await import('../src/modules/media/media-content.response');
    const source = new PassThrough(); const closed = once(source, 'close');
    const app = express();
    app.get('/partial', (_req, res) => sendMediaContent(res, { asset: { mimeType: 'video/mp4' } as any, size: 100, range: { start: 10, end: 99 }, stream: source }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address() as any;
    try {
      const headers = await new Promise<any>((resolve, reject) => {
        const req = request(`http://127.0.0.1:${address.port}/partial`, (res) => {
          res.once('data', () => { resolve({ status: res.statusCode, ...res.headers }); res.destroy(); });
        }); req.once('error', reject); req.end();
        source.write('first');
      });
      expect(headers).toMatchObject({ status: 206, 'content-range': 'bytes 10-99/100', 'content-length': '90', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store' });
      await closed; expect(source.destroyed).toBe(true);
    } finally { source.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('does not consume a video body for HEAD and preserves public branding cache headers', async () => {
    const { sendMediaContent } = await import('../src/modules/media/media-content.response');
    let reads = 0; const source = new Readable({ read() { reads++; this.push('ignored'); this.push(null); } });
    const app = express(); app.get('/head', (_req, res) => { res.setHeader('Cache-Control', 'public, max-age=300'); sendMediaContent(res, { asset: { mimeType: 'video/mp4' } as any, size: 7, range: null, stream: source }); });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/head`, { method: 'HEAD' });
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('public, max-age=300');
      expect(reads).toBe(0); expect(source.destroyed).toBe(true);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
