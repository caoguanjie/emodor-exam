import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MediaAsset } from '../src/entities/media-asset.entity';
import { MediaReference } from '../src/entities/media-reference.entity';
import { MediaPublisher } from '../src/modules/media/media-publisher.service';
import { MediaStorageRouter } from '../src/modules/media/storage/media-storage.router';
import { LocalMediaStorage } from '../src/modules/media/storage/local-media-storage';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

async function fixture(checkpoint?: (event: string) => Promise<void>) {
  const { MediaStorageMigrationService } = await import('../src/modules/media/migration/media-storage-migration.service');
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-migration-test-')); roots.push(root);
  await mkdir(join(root, 'media')); await writeFile(join(root, 'media/source.png'), 'fixture', { mode: 0o600 });
  const assets = new Map<string, any>([['1', { id: '1', ownerId: '7', uploadedBy: '7', purpose: 'question', mediaKind: 'image', mimeType: 'image/png', storageProvider: 'local', storageKey: 'media/source.png', cosBucket: null, cosRegion: null, cosVersionId: null, sizeBytes: '7', sha256: digest('fixture'), status: 'ready', updatedAt: new Date('2026-01-01T00:00:00.000Z') }]]);
  const objects = new Map<string, Buffer>();
  const cos = {
    stat: vi.fn(async (locator: any) => {
      const body = objects.get(locator.key);
      if (!body) throw Object.assign(new Error('absent'), { statusCode: 404, code: 'NoSuchKey' });
      return { locator: { ...locator, versionId: 'version-1' }, sizeBytes: body.length, mimeType: 'image/png', etag: 'etag', crc64: '123' };
    }),
    putFile: vi.fn(async (locator: any, path: string, mimeType: string) => { objects.set(locator.key, await readFile(path)); return { ...(await cos.stat(locator)), mimeType }; }),
    open: vi.fn(async (locator: any) => Readable.from(objects.get(locator.key)!)),
    remove: vi.fn(async (locator: any) => { objects.delete(locator.key); }),
  };
  const config = { provider: 'cos' as const, bucket: 'fixture-123456', region: 'ap-test', keyPrefix: 'ruleexam/', secretId: 'not-real', secretKey: 'not-real', sessionToken: null };
  const router = new MediaStorageRouter(config, new LocalMediaStorage(root), cos as any);
  const repo: any = {
    findOne: async ({ where }: any) => [...assets.values()].map((asset) => ({ ...asset })).find((asset) => Object.entries(where).every(([key, value]) => asset[key] === value)) || null,
    save: async (asset: any) => { const current = { ...asset, updatedAt: new Date() }; assets.set(asset.id, current); return { ...current }; },
    createQueryBuilder: () => {
      let after = '0'; let take = 50;
      const builder: any = { where: () => builder, andWhere: (_sql: string, params: any) => { if (params?.after) after = params.after; return builder; }, orderBy: () => builder, take: (size: number) => { take = size; return builder; }, getMany: async () => [...assets.values()].filter((asset) => asset.storageProvider === 'local' && BigInt(asset.id) > BigInt(after)).slice(0, take) };
      return builder;
    },
  };
  const references = [{ assetId: '1', ownerType: 'exam_record_question', ownerId: '88' }];
  const refs = { count: async ({ where }: any) => references.filter((ref) => ref.assetId === where.assetId).length };
  const manager = { getRepository: (entity: unknown) => entity === MediaAsset ? repo : entity === MediaReference ? refs : null };
  const source: any = { getRepository: manager.getRepository, transaction: async (work: any) => work(manager) };
  const values = new Map<string, any>();
  const manifest: any = { exclusive: true, get: async (id: string) => values.has(id) ? structuredClone(values.get(id)) : null, save: async (value: any) => { values.set(value.item.assetId, structuredClone(value)); } };
  const service = new MediaStorageMigrationService(source, router, new MediaPublisher(router), { sourceRoot: root, onCheckpoint: async (event: string) => checkpoint?.(event) });
  const plan = async () => { const rows: any[] = []; for await (const item of service.plan()) rows.push(item); return rows; };
  return { service, root, assets, objects, cos, manifest, values, references, plan };
}

describe('local media storage migration', () => {
  it('reports every local state and missing or changed source without publishing bytes', async () => {
    const f = await fixture(); const first = f.assets.get('1');
    for (const [id, fields] of [
      ['2', { status: 'processing' }], ['3', { status: 'failed' }], ['4', { status: 'deleting' }],
      ['5', { storageKey: 'media/missing.png' }], ['6', { sha256: 'a'.repeat(64) }],
    ] as const) f.assets.set(id, { ...first, id, ...fields });
    const items = await f.plan();
    expect(items).toHaveLength(6);
    expect(items[0]).toMatchObject({ anomaly: null, referenceCount: 1, status: 'ready' });
    expect(items.slice(1).map((item) => item.anomaly)).toEqual(['STATUS_PROCESSING', 'STATUS_FAILED', 'STATUS_DELETING', 'SOURCE_MISSING', 'SOURCE_HASH_MISMATCH']);
    expect(f.cos.putFile).not.toHaveBeenCalled();
    expect(await f.service.apply(items[4], f.manifest)).toMatchObject({ state: 'skipped', reason: 'SOURCE_MISSING' });
  });

  it('switches only the locator while preserving asset ID and historical references', async () => {
    const f = await fixture(); const [item] = await f.plan(); const before = structuredClone(f.references);
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'switched', verifiedSha256: digest('fixture') });
    expect(f.assets.get('1')).toMatchObject({ id: '1', ownerId: '7', uploadedBy: '7', purpose: 'question', storageProvider: 'cos', cosVersionId: 'version-1', sha256: digest('fixture') });
    expect(f.references).toEqual(before);
    expect(await readFile(join(f.root, 'media/source.png'), 'utf8')).toBe('fixture');
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'switched' });
    expect(f.cos.putFile).toHaveBeenCalledTimes(1);
  });

  it('crash_after_put_resumes_same_candidate without another cloud write', async () => {
    let interrupt = true;
    const f = await fixture(async (event) => { if (event === 'after-upload' && interrupt) { interrupt = false; throw new Error('simulated crash'); } });
    const [item] = await f.plan();
    await expect(f.service.apply(item, f.manifest)).rejects.toThrow('simulated crash');
    const candidate = (await f.manifest.get('1')).target.key;
    expect(f.objects.has(candidate)).toBe(true);
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'switched', target: expect.objectContaining({ key: candidate }) });
    expect(f.cos.putFile).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a candidate key that was already occupied before the first attempt', async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (event) => {
      if (event === 'candidate-recorded') {
        const cp = await f.manifest.get('1');
        f.objects.set(cp.target.key, Buffer.from('foreign'));
      }
    });
    const [item] = await f.plan();
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'failed', reason: 'TARGET_ALREADY_EXISTS' });
    expect(f.cos.putFile).not.toHaveBeenCalled();
    expect(f.cos.remove).not.toHaveBeenCalled();
  });

  it('retains an unknown write and never blindly repeats PUT while HEAD is still absent', async () => {
    const f = await fixture(); const [item] = await f.plan();
    f.cos.putFile.mockRejectedValue(new Error('unknown write response'));
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'failed', cleanupPending: true });
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'failed', reason: 'WRITE_STATE_UNKNOWN', cleanupPending: true });
    expect(f.cos.putFile).toHaveBeenCalledTimes(1);
  });

  it('rejects local bytes changed after copy while keeping the original row local', async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (event) => { if (event === 'verified') await writeFile(join(f.root, 'media/source.png'), 'changed'); });
    const [item] = await f.plan();
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'skipped', reason: 'SOURCE_HASH_MISMATCH' });
    expect(f.assets.get('1').storageProvider).toBe('local');
  });

  it('reconciles a DB switch committed before the manifest receipt was saved', async () => {
    let interrupt = true;
    const f = await fixture(async (event) => { if (event === 'after-switch' && interrupt) { interrupt = false; throw new Error('switch reply lost'); } });
    const [item] = await f.plan();
    await expect(f.service.apply(item, f.manifest)).rejects.toThrow('switch reply lost');
    expect(f.assets.get('1').storageProvider).toBe('cos');
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'switched' });
    expect(f.cos.putFile).toHaveBeenCalledTimes(1);
  });

  it('delete_race_does_not_resurrect_row and cleans only its unused exact candidate version', async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (event) => { if (event === 'verified') f.assets.delete('1'); });
    const [item] = await f.plan();
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'skipped', reason: 'ROW_CHANGED' });
    expect(f.assets.size).toBe(0);
    expect(f.cos.remove).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version-1' }));
  });

  it('keeps an unused candidate if another asset has adopted its object key', async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (event) => {
      if (event !== 'verified') return;
      const cp = await f.manifest.get('1');
      f.assets.set('2', { ...f.assets.get('1'), id: '2', storageProvider: 'cos', storageKey: cp.target.key, cosBucket: cp.target.bucket, cosRegion: cp.target.region, cosVersionId: cp.target.versionId });
      f.assets.delete('1');
    });
    const [item] = await f.plan();
    expect(await f.service.apply(item, f.manifest)).toMatchObject({ state: 'skipped', cleanupPending: true });
    expect(f.cos.remove).not.toHaveBeenCalled();
  });

  it('rollback_requires_matching_local_sha and never claims a COS-only upload as a local backup', async () => {
    const f = await fixture(); const [item] = await f.plan(); await f.service.apply(item, f.manifest);
    await writeFile(join(f.root, 'media/source.png'), 'changed');
    expect(await f.service.rollback(item, f.manifest)).toMatchObject({ state: 'failed', reason: 'SOURCE_HASH_MISMATCH' });
    expect(f.assets.get('1').storageProvider).toBe('cos');
    await writeFile(join(f.root, 'media/source.png'), 'fixture');
    expect(await f.service.rollback(item, f.manifest)).toMatchObject({ state: 'rolled_back' });
    expect(f.assets.get('1')).toMatchObject({ id: '1', storageProvider: 'local', storageKey: 'media/source.png' });
    expect(await f.service.rollback({ ...item, source: { ...item.source, provider: 'cos' } }, f.manifest)).toMatchObject({ state: 'failed', reason: 'NO_LOCAL_ROLLBACK' });
  });

  it('uses a separate private migration prefix for identity material', async () => {
    const f = await fixture(); f.assets.get('1').purpose = 'identity_face';
    const [item] = await f.plan(); const result = await f.service.apply(item, f.manifest);
    expect(result.target.key).toMatch(/^ruleexam\/identity\/migration\/1\//);
  });
});

describe('private atomic migration manifest', () => {
  it('atomically writes 0600 outside the repository and excludes unrecognized secret fields', async () => {
    const { FileMigrationManifest } = await import('../src/modules/media/migration/migration-manifest');
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-manifest-test-')); roots.push(root);
    const file = join(root, 'batch.json'); const manifest = new FileMigrationManifest(file, process.cwd());
    const f = await fixture(); const [item] = await f.plan();
    await manifest.withExclusive(async () => {
      await manifest.save({ item, target: null, state: 'planned', verifiedSha256: null, reason: null, secretKey: 'should-never-be-written' } as any);
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain('should-never-be-written');
    expect(await manifest.get('1')).toMatchObject({ item: { assetId: '1' }, state: 'planned' });
    expect(await readdir(root)).toEqual(['batch.json']);
  });

  it('refuses repository paths and concurrent holders rather than stealing the lock', async () => {
    const { FileMigrationManifest } = await import('../src/modules/media/migration/migration-manifest');
    expect(() => new FileMigrationManifest(join(process.cwd(), 'batch.json'), process.cwd())).toThrow();
    expect(() => new FileMigrationManifest(join(process.cwd(), '..reports/batch.json'), process.cwd())).toThrow();
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-manifest-lock-')); roots.push(root);
    const first = new FileMigrationManifest(join(root, 'batch.json'), process.cwd());
    const second = new FileMigrationManifest(join(root, 'batch.json'), process.cwd());
    await first.withExclusive(async () => {
      await expect(second.withExclusive(async () => {})).rejects.toThrow('MANIFEST_LOCKED');
    });
  });
});
