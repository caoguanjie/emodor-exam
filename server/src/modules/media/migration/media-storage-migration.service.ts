import { createHash, randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import type { DataSource } from 'typeorm';
import { MediaAsset } from '../../../entities/media-asset.entity';
import { MediaReference } from '../../../entities/media-reference.entity';
import { MEDIA_PURPOSES } from '../media-policy';
import { MediaPublisher, MediaPublishError } from '../media-publisher.service';
import { MediaStorageRouter } from '../storage/media-storage.router';
import type { StorageLocator, StoredObject } from '../storage/media-storage.port';
import type { MigrationCheckpoint, MigrationItem, MigrationManifest } from './migration-manifest';

type Options = { sourceRoot: string; batchSize?: number; onCheckpoint?: (event: string, value: MigrationCheckpoint) => void | Promise<void> };
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const sameLocator = (a: StorageLocator, b: StorageLocator) => ['provider', 'key', 'bucket', 'region', 'versionId'].every((key) => a[key] === b[key]);
const iso = (value: unknown): string => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : '';
const missing = (error: any): boolean => error?.code === 'ENOENT' || error?.statusCode === 404;

/** Operational tool: no Nest application, schedulers, or business-wide locks. */
export class MediaStorageMigrationService {
  constructor(private readonly dataSource: DataSource, private readonly storage: MediaStorageRouter,
    private readonly publisher: MediaPublisher, private readonly options: Options) {}

  private locator(asset: MediaAsset): StorageLocator {
    return { provider: asset.storageProvider ?? 'local', key: asset.storageKey,
      bucket: asset.storageProvider === 'cos' ? asset.cosBucket : null,
      region: asset.storageProvider === 'cos' ? asset.cosRegion : null,
      versionId: asset.storageProvider === 'cos' ? asset.cosVersionId ?? null : null };
  }
  private sourcePath(item: MigrationItem): string {
    const key = item.source.key;
    if (!key || isAbsolute(key) || /[\\\0]/.test(key) || key.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('SOURCE_PATH_INVALID');
    const path = resolve(this.options.sourceRoot, key);
    const rel = relative(resolve(this.options.sourceRoot), path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('SOURCE_PATH_INVALID');
    return path;
  }
  private validItem(item: MigrationItem): boolean {
    return /^[1-9]\d{0,19}$/.test(item.assetId) && /^[a-f0-9]{64}$/.test(item.sha256)
      && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0
      && Number.isFinite(Date.parse(item.updatedAt)) && item.source.provider === 'local'
      && item.source.bucket === null && item.source.region === null && item.source.versionId === null
      && (MEDIA_PURPOSES as readonly string[]).includes(item.purpose);
  }
  private async hash(locator: StorageLocator, expectedSize: number): Promise<string> {
    const stream = await this.storage.forLocator(locator).open(locator);
    const digest = createHash('sha256'); let size = 0;
    try {
      for await (const chunk of stream) {
        const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += body.length;
        if (size > expectedSize) throw new Error('BODY_SIZE_MISMATCH');
        digest.update(body);
      }
      if (size !== expectedSize) throw new Error('BODY_SIZE_MISMATCH');
      return digest.digest('hex');
    } finally { stream.destroy(); }
  }
  private async sourceAnomaly(item: MigrationItem): Promise<string | null> {
    try {
      this.sourcePath(item);
      const info = await this.storage.forLocator(item.source).stat(item.source);
      if (info.sizeBytes !== item.sizeBytes) return 'SOURCE_SIZE_MISMATCH';
      if (await this.hash(info.locator, item.sizeBytes) !== item.sha256) return 'SOURCE_HASH_MISMATCH';
      return null;
    } catch (error) { return missing(error) ? 'SOURCE_MISSING' : 'SOURCE_UNAVAILABLE'; }
  }

  /** All local media states are reported; only anomaly-free ready rows can move. */
  async *plan(): AsyncIterable<MigrationItem> {
    const repo = this.dataSource.getRepository(MediaAsset);
    let after = '0'; const batch = Math.max(1, Math.min(500, this.options.batchSize ?? 100));
    while (true) {
      const assets = await repo.createQueryBuilder('a').where('a.storage_provider = :provider', { provider: 'local' })
        .andWhere('a.id > :after', { after }).orderBy('a.id', 'ASC').take(batch).getMany();
      if (!assets.length) return;
      for (const asset of assets) {
        const size = Number(asset.sizeBytes);
        const item: MigrationItem = { assetId: String(asset.id), purpose: asset.purpose, source: this.locator(asset),
          sha256: asset.sha256, sizeBytes: Number.isSafeInteger(size) ? size : -1, updatedAt: iso(asset.updatedAt),
          status: asset.status, mediaKind: asset.mediaKind, mimeType: asset.mimeType,
          referenceCount: await this.dataSource.getRepository(MediaReference).count({ where: { assetId: String(asset.id) } }), anomaly: null };
        if (asset.status !== 'ready') item.anomaly = `STATUS_${String(asset.status).toUpperCase()}`;
        else if (!this.validItem(item)) item.anomaly = 'INVALID_METADATA';
        else if (!EXTENSIONS[asset.mimeType] || !['image', 'video'].includes(asset.mediaKind)
          || !asset.mimeType.startsWith(`${asset.mediaKind}/`)) item.anomaly = 'OUT_OF_SCOPE';
        else item.anomaly = await this.sourceAnomaly(item);
        yield item;
        after = String(asset.id);
      }
      if (assets.length < batch) return;
    }
  }

  private sameItem(a: MigrationItem, b: MigrationItem): boolean {
    return a.assetId === b.assetId && a.purpose === b.purpose && a.sha256 === b.sha256 && a.sizeBytes === b.sizeBytes
      && a.updatedAt === b.updatedAt && sameLocator(a.source, b.source);
  }
  private originalRow(asset: MediaAsset | null, item: MigrationItem): asset is MediaAsset {
    return !!asset && asset.status === 'ready' && sameLocator(this.locator(asset), item.source)
      && asset.sha256 === item.sha256 && Number(asset.sizeBytes) === item.sizeBytes && asset.purpose === item.purpose
      && iso(asset.updatedAt) === item.updatedAt && (!item.mimeType || asset.mimeType === item.mimeType)
      && (!item.mediaKind || asset.mediaKind === item.mediaKind);
  }
  private targetRow(asset: MediaAsset | null, item: MigrationItem, target: StorageLocator): asset is MediaAsset {
    return !!asset && asset.status === 'ready' && sameLocator(this.locator(asset), target)
      && asset.sha256 === item.sha256 && Number(asset.sizeBytes) === item.sizeBytes && asset.purpose === item.purpose
      && (!item.mimeType || asset.mimeType === item.mimeType) && (!item.mediaKind || asset.mediaKind === item.mediaKind);
  }
  private target(item: MigrationItem): StorageLocator {
    const config = this.storage.config;
    if (!config.bucket || !config.region || !config.keyPrefix) throw new Error('COS_MIGRATION_CONFIG_MISSING');
    const partition = item.purpose.startsWith('identity_') ? 'identity' : 'media';
    return { provider: 'cos', bucket: config.bucket, region: config.region, versionId: null,
      key: `${config.keyPrefix}${partition}/migration/${item.assetId}/${randomUUID()}.${EXTENSIONS[item.mimeType!] ?? 'bin'}` };
  }
  private ownedTarget(item: MigrationItem, target: StorageLocator): boolean {
    const config = this.storage.config;
    const prefix = `${config.keyPrefix}${item.purpose.startsWith('identity_') ? 'identity' : 'media'}/migration/${item.assetId}/`;
    const leaf = target.key.startsWith(prefix) ? target.key.slice(prefix.length) : '';
    return target.provider === 'cos' && target.bucket === config.bucket && target.region === config.region
      && new RegExp(`^${uuid}\\.(jpg|png|webp|mp4|bin)$`).test(leaf);
  }
  private async save(manifest: MigrationManifest, cp: MigrationCheckpoint, fields: Partial<MigrationCheckpoint>): Promise<MigrationCheckpoint> {
    const result = { ...cp, ...fields }; await manifest.save(result); return result;
  }
  private async event(event: string, cp: MigrationCheckpoint): Promise<void> { await this.options.onCheckpoint?.(event, cp); }
  private initial(item: MigrationItem): MigrationCheckpoint {
    return { item, target: null, state: 'planned', verifiedSha256: null, reason: null };
  }
  private async targetObject(item: MigrationItem, target: StorageLocator): Promise<StoredObject> {
    const object = await this.storage.forLocator(target).stat(target);
    if (object.sizeBytes !== item.sizeBytes || await this.hash(object.locator, item.sizeBytes) !== item.sha256) throw new Error('TARGET_HASH_MISMATCH');
    return { ...object, mimeType: item.mimeType ?? object.mimeType };
  }

  /** Only this manifest's exact candidate, never a generic project-prefix sweep. */
  private async cleanCandidate(cp: MigrationCheckpoint, manifest: MigrationManifest): Promise<boolean> {
    if (!cp.target) return true;
    if (!manifest.exclusive || !this.ownedTarget(cp.item, cp.target) || !cp.object
      || !sameLocator(cp.object.locator, cp.target)) return false;
    const used = await this.dataSource.getRepository(MediaAsset).findOne({ where: {
      storageProvider: 'cos', storageKey: cp.target.key, cosBucket: cp.target.bucket!, cosRegion: cp.target.region!,
    } });
    if (used) return false;
    try { await this.storage.forLocator(cp.target).remove(cp.target); return true; }
    catch { return false; }
  }
  private async skipped(cp: MigrationCheckpoint, manifest: MigrationManifest, reason: string): Promise<MigrationCheckpoint> {
    const cleaned = await this.cleanCandidate(cp, manifest);
    return this.save(manifest, cp, { state: 'skipped', reason, cleanupPending: !cleaned });
  }

  async apply(item: MigrationItem, manifest: MigrationManifest): Promise<MigrationCheckpoint> {
    let cp = await manifest.get(item.assetId) ?? this.initial(item);
    if (!this.sameItem(cp.item, item)) return { ...cp, state: 'failed', reason: 'MANIFEST_ITEM_CONFLICT' };
    if (item.anomaly) return this.save(manifest, cp, { state: 'skipped', reason: item.anomaly });
    if (!this.validItem(item)) return { ...cp, state: 'failed', reason: 'INVALID_PLAN_ITEM' };
    if (cp.target && !this.ownedTarget(item, cp.target)) return { ...cp, state: 'failed', reason: 'TARGET_NOT_OWNED' };
    const repo = this.dataSource.getRepository(MediaAsset);
    const before = await repo.findOne({ where: { id: item.assetId } });
    if (cp.target && this.targetRow(before, item, cp.target)) {
      try {
        const object = await this.targetObject(item, cp.target);
        return this.save(manifest, cp, { target: object.locator, object, state: 'switched', verifiedSha256: item.sha256,
          switchedUpdatedAt: iso(before.updatedAt), reason: null, cleanupPending: false });
      } catch { return this.save(manifest, cp, { state: 'failed', reason: 'TARGET_VERIFICATION_FAILED' }); }
    }
    if (!this.originalRow(before, item)) return this.skipped(cp, manifest, 'ROW_CHANGED');
    // Revalidate serialized plan fields against the authoritative current row.
    if (!EXTENSIONS[before.mimeType] || !['image', 'video'].includes(before.mediaKind)
      || !before.mimeType.startsWith(`${before.mediaKind}/`)) return this.save(manifest, cp, { state: 'skipped', reason: 'OUT_OF_SCOPE' });
    const anomaly = await this.sourceAnomaly(item);
    if (anomaly) return this.save(manifest, cp, { state: 'failed', reason: anomaly });
    if (!cp.target) {
      cp = await this.save(manifest, cp, { target: this.target({ ...item, mimeType: before.mimeType }), state: 'planned' });
      await this.event('candidate-recorded', cp);
    }
    let object: StoredObject;
    if (cp.uploadStartedAt) {
      try { object = await this.targetObject(item, cp.target!); }
      catch { return this.save(manifest, cp, { state: 'failed', reason: 'WRITE_STATE_UNKNOWN', cleanupPending: true }); }
    } else {
      let occupied = false;
      try { await this.storage.forLocator(cp.target!).stat(cp.target!); occupied = true; }
      catch (error) {
        if (!missing(error)) return this.save(manifest, cp, { state: 'failed', reason: 'TARGET_UNAVAILABLE', cleanupPending: true });
      }
      if (occupied) return this.save(manifest, cp, { state: 'failed', reason: 'TARGET_ALREADY_EXISTS', cleanupPending: true });
      cp = await this.save(manifest, cp, { uploadStartedAt: new Date().toISOString() });
      try {
        object = await this.publisher.publishVerifiedFile({ filePath: this.sourcePath(item), locator: cp.target!,
          expectedSha256: item.sha256, mimeType: before.mimeType });
      } catch (error) {
        const fields: Partial<MigrationCheckpoint> = { state: 'failed', reason: 'PUBLISH_FAILED', cleanupPending: true };
        if (error instanceof MediaPublishError) { fields.target = error.locator; fields.object = error.object; }
        return this.save(manifest, cp, fields);
      }
      // Exception here simulates a lost response or crash after a successful PUT.
      await this.event('after-upload', cp);
    }
    cp = await this.save(manifest, cp, { object, target: object.locator, state: 'uploaded', reason: null });
    await this.event('uploaded', cp);
    cp = await this.save(manifest, cp, { state: 'verified', verifiedSha256: item.sha256 });
    await this.event('verified', cp);
    const afterCopy = await this.sourceAnomaly(item);
    if (afterCopy) return this.skipped(cp, manifest, afterCopy);
    let switched: MediaAsset | null = null;
    try {
      switched = await this.dataSource.transaction(async (manager) => {
        const assets = manager.getRepository(MediaAsset);
        const current = await assets.findOne({ where: { id: item.assetId }, lock: { mode: 'pessimistic_write' } });
        if (!this.originalRow(current, item)) return null;
        current.storageProvider = 'cos'; current.storageKey = object.locator.key;
        current.cosBucket = object.locator.bucket; current.cosRegion = object.locator.region;
        current.cosVersionId = object.locator.versionId; current.etag = object.etag; current.crc64 = object.crc64;
        return assets.save(current);
      });
    } catch {
      // A commit response can be lost; never delete the candidate on ambiguity.
      return this.save(manifest, cp, { state: 'failed', reason: 'SWITCH_STATE_UNKNOWN', cleanupPending: true });
    }
    if (!switched) return this.skipped(cp, manifest, 'ROW_CHANGED');
    await this.event('after-switch', cp);
    return this.save(manifest, cp, { state: 'switched', switchedUpdatedAt: iso(switched.updatedAt), reason: null, cleanupPending: false });
  }

  async rollback(item: MigrationItem, manifest: MigrationManifest): Promise<MigrationCheckpoint> {
    let cp = await manifest.get(item.assetId) ?? this.initial(item);
    if (item.source.provider !== 'local') return { ...cp, state: 'failed', reason: 'NO_LOCAL_ROLLBACK' };
    if (!this.sameItem(cp.item, item) || !this.validItem(item) || !cp.target || !this.ownedTarget(item, cp.target)) {
      return { ...cp, state: 'failed', reason: 'NO_LOCAL_ROLLBACK' };
    }
    const anomaly = await this.sourceAnomaly(item);
    if (anomaly) return this.save(manifest, cp, { state: 'failed', reason: anomaly });
    const before = await this.dataSource.getRepository(MediaAsset).findOne({ where: { id: item.assetId } });
    if (before && before.status === 'ready' && sameLocator(this.locator(before), item.source)
      && before.sha256 === item.sha256 && Number(before.sizeBytes) === item.sizeBytes) {
      // A prior rollback may have committed before its receipt or cleanup.
      // Reuse the same exact-candidate ownership/reference checks on recovery.
      const cleaned = await this.cleanCandidate(cp, manifest);
      return this.save(manifest, cp, { state: 'rolled_back', reason: null, cleanupPending: !cleaned });
    }
    if (!this.targetRow(before, item, cp.target)) return { ...cp, state: 'failed', reason: 'ROW_CHANGED' };
    const expectedUpdatedAt = cp.switchedUpdatedAt ?? iso(before.updatedAt);
    let switched: MediaAsset | null;
    try {
      switched = await this.dataSource.transaction(async (manager) => {
        const assets = manager.getRepository(MediaAsset);
        const current = await assets.findOne({ where: { id: item.assetId }, lock: { mode: 'pessimistic_write' } });
        if (!this.targetRow(current, item, cp.target!) || iso(current.updatedAt) !== expectedUpdatedAt) return null;
        current.storageProvider = 'local'; current.storageKey = item.source.key;
        current.cosBucket = null; current.cosRegion = null; current.cosVersionId = null; current.etag = null; current.crc64 = null;
        return assets.save(current);
      });
    } catch { return this.save(manifest, cp, { state: 'failed', reason: 'ROLLBACK_STATE_UNKNOWN', cleanupPending: true }); }
    if (!switched) return { ...cp, state: 'failed', reason: 'ROW_CHANGED' };
    cp = await this.save(manifest, cp, { state: 'rolled_back', reason: null });
    // The verified local copy remains; only an unused exact COS candidate may go.
    const cleaned = await this.cleanCandidate(cp, manifest);
    return this.save(manifest, cp, { cleanupPending: !cleaned });
  }
}
