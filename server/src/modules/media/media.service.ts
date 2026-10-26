import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaReference } from '../../entities/media-reference.entity';
import { IdentityVerificationSession } from '../../entities/identity-verification-session.entity';
import { SysUser } from '../../entities/sys-user.entity';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccessService } from '../access/access.service';
import { MediaStorageRouter } from './storage/media-storage.router';
import { LocalMediaStorage } from './storage/local-media-storage';
import { readCosMediaConfig } from './storage/cos-media.config';
import type { StorageLocator, StoredObject } from './storage/media-storage.port';
import { MediaPublisher, MediaPublishError } from './media-publisher.service';
import {
  assertMediaPurpose,
  assertPublicMediaPurpose,
  assertMediaSize,
  DEFAULT_MEDIA_LIMITS,
  mediaKindForPurpose,
  parseRange,
  type ByteRange,
  type MediaLimits,
  type MediaPurpose,
  type MediaUploadPurpose,
} from './media-policy';
import {
  MediaProbeService,
  MediaProbeUnavailableError,
  type ImageProbeResult,
  type VideoProbeResult,
} from './media-probe.service';

export type MediaId = string;
export type MediaUploadResult = {
  assetId: MediaId;
  status: 'processing' | 'ready' | 'failed';
  durationMs: number | null;
};

export type MediaOwnerAuthorizer = (actorId: MediaId, ownerId: MediaId) => boolean | Promise<boolean>;

export interface MediaContentDescriptor {
  asset: MediaAsset;
  size: number;
  range: ByteRange | null;
  stream: Readable;
}
export type ContentDescriptor = MediaContentDescriptor;

export type ReadyMediaInput = {
  ownerId: string;
  uploadedBy: string;
  purpose: MediaPurpose;
  mediaKind: 'image' | 'video';
  originalName: string | null;
  object: StoredObject;
  sha256: string;
  durationMs: number | null;
};

export interface MediaOwnerPolicy {
  allowedPurposes: readonly MediaPurpose[];
  authorizeRead: (actorId: MediaId, businessId: MediaId, assetId?: MediaId) => boolean | Promise<boolean>;
  authorizeTicket?: (actorId: MediaId, businessId: MediaId, assetId?: MediaId) => boolean | Promise<boolean>;
  validateBinding?: (manager: EntityManager, asset: MediaAsset, businessId: MediaId) => void | Promise<void>;
}

const MEDIA_DELETING_STATUS = 'deleting';
const MEDIA_TEMP_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.upload$/i;
const MEDIA_UNKNOWN_PUBLICATION = '媒体发布状态待核对';

function idOf(value: string | number): string {
  return String(value);
}

function safeOriginalName(value: string | undefined): string | null {
  if (!value) return null;
  const name = basename(value).replace(/[\u0000\r\n]/g, '').slice(0, 255);
  return name || null;
}

function extensionForMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'video/mp4') return '.mp4';
  return '.jpg';
}

function isProbeUnavailable(error: unknown): error is MediaProbeUnavailableError {
  return error instanceof MediaProbeUnavailableError;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly ownerPolicies = new Map<string, MediaOwnerPolicy>();
  private readonly activeTempPaths = new Set<string>();
  private readonly activeAssetIds = new Set<string>();
  private readonly storage: MediaStorageRouter;
  private readonly publisher: MediaPublisher;

  constructor(
    @InjectRepository(MediaAsset) private readonly assetRepo: Repository<MediaAsset>,
    @InjectRepository(MediaReference) private readonly referenceRepo: Repository<MediaReference>,
    private readonly dataSource: DataSource,
    private readonly config: AppConfig,
    private readonly probe: MediaProbeService,
    @Optional() storage?: MediaStorageRouter,
    @Optional() publisher?: MediaPublisher,
    @Optional() private readonly access?: AccessService,
  ) {
    if (this.config.cosMedia?.provider === 'cos' && (!storage || storage.config.provider !== 'cos')) {
      throw Errors.serviceUnavailable('COS 媒体存储驱动未配置');
    }
    // Five-argument legacy fixtures have an explicit local-only default. A
    // configured COS application can never silently acquire this fallback.
    this.storage = storage ?? new MediaStorageRouter(readCosMediaConfig({}), new LocalMediaStorage(resolve(this.config.upload?.dir || 'data')));
    this.publisher = publisher ?? new MediaPublisher(this.storage);
  }

  async assertUploadAllowed(actor: AuthUser, purpose: MediaUploadPurpose, ownerId?: string): Promise<{ ownerId: string }> {
    assertPublicMediaPurpose(purpose);
    const actorId = String(actor.id);
    const owner = ownerId ? String(ownerId) : actorId;
    if (!/^[1-9]\d{0,19}$/.test(actorId) || !/^[1-9]\d{0,19}$/.test(owner)) throw Errors.param('媒体上传主体无效');
    const current = await this.dataSource.getRepository(SysUser).findOne({ where: { id: actorId } });
    if (!current || Number(current.status) !== 1) throw Errors.forbidden('媒体上传账号不可用');
    if (owner !== actorId) {
      if (purpose !== 'avatar') throw Errors.forbidden('只能为本人上传该媒体用途');
      if (!this.access) throw Errors.serviceUnavailable('媒体权限服务不可用');
      await this.access.assertAllowed(actorId, 'students:write');
    } else if (purpose !== 'avatar') {
      if (!this.access) throw Errors.serviceUnavailable('媒体权限服务不可用');
      await this.access.assertAllowed(actorId, 'media:write');
    }
    return { ownerId: owner };
  }

  limits(): Record<string, unknown> {
    const media = this.mediaLimits();
    return {
      video_max_bytes: media.videoMaxBytes,
      image_max_bytes: media.imageMaxBytes,
      image_max_pixels: media.imageMaxPixels,
      probe_timeout_ms: media.probeTimeoutMs,
      allowed_image_types: [...media.allowedImageTypes],
      allowed_video_types: [...media.allowedVideoTypes],
      upload_mode: this.config.cosMedia?.provider === 'cos' ? 'direct' : 'proxy',
      multipart_threshold_bytes: this.config.mediaUpload?.multipartThresholdBytes ?? 16777216,
      part_size_bytes: this.config.mediaUpload?.partSizeBytes ?? 8388608,
      parallel_limit: this.config.mediaUpload?.parallelLimit ?? 3,
      upload_session_ttl_seconds: this.config.mediaUpload?.sessionTtlSeconds ?? 86400,
    };
  }

  registerOwnerPolicy(ownerType: string, policy: MediaOwnerPolicy): void {
    if (!ownerType || !policy || typeof policy.authorizeRead !== 'function' || !Array.isArray(policy.allowedPurposes) || !policy.allowedPurposes.length) {
      throw Errors.param('媒体业务归属注册无效');
    }
    for (const purpose of policy.allowedPurposes) assertMediaPurpose(purpose);
    this.ownerPolicies.set(ownerType, {
      allowedPurposes: [...new Set(policy.allowedPurposes)],
      authorizeRead: policy.authorizeRead,
      authorizeTicket: policy.authorizeTicket,
      validateBinding: policy.validateBinding,
    });
  }

  registerOwnerType(ownerType: string, policy: MediaOwnerPolicy | MediaOwnerAuthorizer): void {
    if (typeof policy === 'function') {
      this.registerOwnerPolicy(ownerType, { allowedPurposes: ['avatar', 'course_cover', 'video', 'question', 'branding'], authorizeRead: policy });
      return;
    }
    this.registerOwnerPolicy(ownerType, policy);
  }

  registerOwnerAuthorizer(ownerType: string, authorizer: MediaOwnerAuthorizer): void {
    this.registerOwnerType(ownerType, authorizer);
  }

  private ownerPolicy(ownerType: string): MediaOwnerPolicy {
    const policy = this.ownerPolicies.get(ownerType);
    if (!policy) throw Errors.forbidden('媒体业务归属类型未注册');
    return policy;
  }

  private mediaLimits(): MediaLimits {
    const config = this.config.media;
    return config ? {
      videoMaxBytes: config.videoMaxBytes,
      imageMaxBytes: config.imageMaxBytes,
      imageMaxPixels: config.imageMaxPixels ?? DEFAULT_MEDIA_LIMITS.imageMaxPixels,
      probeTimeoutMs: config.probeTimeoutMs,
      allowedImageTypes: config.allowedImageTypes,
      allowedVideoTypes: config.allowedVideoTypes,
    } : DEFAULT_MEDIA_LIMITS;
  }

  /** The interceptor uses the largest configured media limit for disk Multer. */
  uploadByteLimit(): number {
    const limits = this.mediaLimits();
    return Math.max(limits.videoMaxBytes, limits.imageMaxBytes);
  }

  private managedTempPath(value: string): string | null {
    const root = resolve(this.storageRoot(), 'tmp', 'media');
    const candidate = resolve(value);
    const rel = relative(root, candidate);
    if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`) || dirname(candidate) !== root || !MEDIA_TEMP_FILENAME.test(basename(candidate))) return null;
    return candidate;
  }

  markTempPath(value: string): void {
    const path = this.managedTempPath(value);
    if (path) this.activeTempPaths.add(path);
  }

  async cleanupTempPath(value: string | undefined): Promise<void> {
    if (!value) return;
    const path = this.managedTempPath(value);
    if (!path) return;
    this.activeTempPaths.delete(path);
    await rm(path, { force: true }).catch(() => undefined);
  }

  private async cleanupStaleTempFiles(graceMs = 24 * 60 * 60 * 1000): Promise<number> {
    const root = resolve(this.storageRoot(), 'tmp', 'media');
    const cutoff = Date.now() - Math.max(60_000, graceMs);
    let names: string[];
    try { names = await readdir(root); } catch { return 0; }
    let removed = 0;
    for (const name of names) {
      if (!MEDIA_TEMP_FILENAME.test(name)) continue;
      const path = this.managedTempPath(join(root, name));
      if (!path || this.activeTempPaths.has(path)) continue;
      const fileStat = await stat(path).catch(() => null);
      if (!fileStat?.isFile() || fileStat.mtimeMs >= cutoff) continue;
      try {
        await rm(path, { force: true });
        removed += 1;
      } catch (error) {
        this.logger.warn('媒体临时文件清理失败');
      }
    }
    return removed;
  }

  private storageRoot(): string {
    return resolve(this.config.upload.dir);
  }

  /** Mapping is authorization-free and performs no cloud or local reads. */
  assetLocator(asset: MediaAsset): StorageLocator {
    const provider = asset.storageProvider ?? 'local';
    if (!['local', 'cos'].includes(provider)) throw Errors.serviceUnavailable('媒体存储驱动无效');
    if (provider === 'cos' && (!asset.cosBucket || !asset.cosRegion)) throw Errors.serviceUnavailable('媒体存储定位不完整');
    return {
      provider, key: asset.storageKey,
      bucket: provider === 'cos' ? asset.cosBucket : null,
      region: provider === 'cos' ? asset.cosRegion : null,
      versionId: provider === 'cos' ? asset.cosVersionId ?? null : null,
    };
  }

  private finalLocator(purpose: MediaPurpose, mimeType: string): StorageLocator {
    const config = this.storage.config;
    const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extensionForMime(mimeType)}`;
    if (config.provider === 'cos') return {
      provider: 'cos', key: `${config.keyPrefix}${purpose.startsWith('identity_') ? 'identity' : 'media'}/${key}`,
      bucket: config.bucket, region: config.region, versionId: null,
    };
    return { provider: 'local', key: `media/${key}`, bucket: null, region: null, versionId: null };
  }

  private applyStoredObject(asset: MediaAsset, object: StoredObject): void {
    const locator = object.locator;
    asset.storageProvider = locator.provider;
    asset.storageKey = locator.key;
    asset.cosBucket = locator.bucket;
    asset.cosRegion = locator.region;
    asset.cosVersionId = locator.versionId;
    asset.etag = object.etag;
    asset.crc64 = object.crc64;
    asset.sizeBytes = String(object.sizeBytes);
  }

  /** The finalizer owns this transaction; no global repository is used here. */
  async createReadyAsset(manager: EntityManager, input: ReadyMediaInput): Promise<MediaAsset> {
    assertMediaPurpose(input.purpose);
    if (input.mediaKind !== mediaKindForPurpose(input.purpose) || !/^[a-f0-9]{64}$/.test(input.sha256)
      || !/^[1-9]\d{0,19}$/.test(input.ownerId) || !/^[1-9]\d{0,19}$/.test(input.uploadedBy)
      || !Number.isSafeInteger(input.object.sizeBytes) || input.object.sizeBytes < 0) throw Errors.param('媒体发布元数据无效');
    assertMediaSize(input.mediaKind, input.object.sizeBytes, this.mediaLimits());
    const allowedTypes = input.mediaKind === 'image' ? this.mediaLimits().allowedImageTypes : this.mediaLimits().allowedVideoTypes;
    if (!allowedTypes.includes(input.object.mimeType)
      || (input.mediaKind === 'video' && (!Number.isSafeInteger(input.durationMs) || input.durationMs! <= 0))
      || (input.mediaKind === 'image' && input.durationMs !== null)) throw Errors.param('媒体探测元数据无效');
    const locator = input.object.locator;
    const storageConfig = this.storage.config;
    if (!['local', 'cos'].includes(locator.provider) || !/^[A-Za-z0-9_./-]+$/.test(locator.key)
      || locator.key.split('/').some((part) => !part || part === '.' || part === '..')
      || (locator.provider === 'cos' && (locator.bucket !== storageConfig.bucket || locator.region !== storageConfig.region
        || !locator.key.startsWith(`${storageConfig.keyPrefix}${input.purpose.startsWith('identity_') ? 'identity' : 'media'}/`)))
      || (locator.provider === 'local' && (!locator.key.startsWith('media/') || locator.bucket !== null || locator.region !== null || locator.versionId !== null))) {
      throw Errors.param('媒体正式存储定位无效');
    }
    this.storage.forLocator(locator);
    const repo = manager.getRepository(MediaAsset);
    const asset = repo.create({ ownerId: input.ownerId, uploadedBy: input.uploadedBy,
      purpose: input.purpose, mediaKind: input.mediaKind, originalName: safeOriginalName(input.originalName ?? undefined),
      mimeType: input.object.mimeType, sha256: input.sha256, status: 'ready',
      durationMs: input.durationMs === null ? null : String(input.durationMs), probeError: null });
    this.applyStoredObject(asset, input.object);
    return repo.save(asset);
  }

  private async tempPath(): Promise<string> {
    const dir = join(this.storageRoot(), 'tmp', 'media');
    await mkdir(dir, { recursive: true });
    return join(dir, `${randomUUID()}.upload`);
  }

  private async materializeFile(file: Express.Multer.File): Promise<{ path: string; size: number; cleanup: boolean }> {
    if (file?.path) {
      // The HTTP interceptor creates this path under the private media temp
      // root. Do not let a caller smuggle an arbitrary local path through the
      // Express.Multer.File-compatible service boundary.
      const candidate = resolve(file.path);
      if (this.managedTempPath(candidate) !== candidate) throw Errors.param('媒体临时路径无效');
      const fileStat = await stat(candidate);
      this.markTempPath(candidate);
      return { path: candidate, size: fileStat.size, cleanup: true };
    }
    if (file?.buffer) {
      const path = await this.tempPath();
      await writeFile(path, file.buffer, { flag: 'wx', mode: 0o600 });
      this.markTempPath(path);
      return { path, size: file.buffer.length, cleanup: true };
    }
    throw Errors.param('缺少媒体文件');
  }

  private async sha256File(path: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolvePromise());
    });
    return hash.digest('hex');
  }

  private async updateProcessingAsset(id: string, apply: (asset: MediaAsset) => void): Promise<MediaAsset> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MediaAsset);
      const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current || current.status !== 'processing') throw Errors.serviceUnavailable('媒体处理状态已变化');
      apply(current);
      return repo.save(current);
    });
  }

  private async uploadForPurpose(
    actorId: string | number,
    purpose: MediaPurpose,
    file: Express.Multer.File,
    ownerId?: string | number,
  ): Promise<MediaUploadResult> {
    assertMediaPurpose(purpose);
    const actor = idOf(actorId);
    const owner = idOf(ownerId ?? actor);
    const kind = mediaKindForPurpose(purpose);
    const materialized = await this.materializeFile(file);
    let asset: MediaAsset | undefined;
    let publishing = false;
    let published: StoredObject | null = null;
    try {
      assertMediaSize(kind, materialized.size, this.mediaLimits());
      // Preserve the legacy processing/failed record with a real SHA, while
      // keeping its bytes private until probe and immutable publication finish.
      asset = await this.assetRepo.save(this.assetRepo.create({
        ownerId: owner,
        uploadedBy: actor,
        purpose,
        mediaKind: kind,
        originalName: safeOriginalName(file?.originalname),
        mimeType: file?.mimetype || (kind === 'video' ? 'video/mp4' : 'application/octet-stream'),
        storageKey: relative(this.storageRoot(), materialized.path).split(sep).join('/'),
        storageProvider: 'local', cosBucket: null, cosRegion: null, cosVersionId: null, etag: null, crc64: null,
        sizeBytes: String(materialized.size),
        sha256: await this.sha256File(materialized.path),
        status: 'processing',
        durationMs: null,
        probeError: null,
      }));
      this.activeAssetIds.add(String(asset.id));

      try {
        const result = await this.probe.probe(materialized.path, kind);
        if (kind === 'image') {
          const image = result as ImageProbeResult;
          if (!this.mediaLimits().allowedImageTypes.includes(image.mimeType)) throw new Error('图片类型不支持');
          asset.mimeType = image.mimeType;
        } else {
          const video = result as VideoProbeResult;
          if (!this.mediaLimits().allowedVideoTypes.includes(video.mimeType)) throw new Error('视频类型不支持');
          asset.mimeType = video.mimeType;
          asset.durationMs = String(video.durationMs);
        }
        const locator = this.finalLocator(purpose, asset.mimeType);
        const mimeType = asset.mimeType;
        const durationMs = asset.durationMs;
        // Persist the immutable target before cloud I/O. A crash after PUT may
        // then be reconciled without losing the only key identifying the bytes.
        asset = await this.updateProcessingAsset(String(asset.id), (current) => {
          this.applyStoredObject(current, { locator, sizeBytes: materialized.size, mimeType, etag: null, crc64: null });
          current.mimeType = mimeType;
          current.durationMs = durationMs;
          current.probeError = MEDIA_UNKNOWN_PUBLICATION;
        });
        publishing = true;
        published = await this.publisher.publishVerifiedFile({ filePath: materialized.path,
          locator, expectedSha256: asset.sha256, mimeType });
        asset = await this.updateProcessingAsset(String(asset.id), (current) => {
          this.applyStoredObject(current, published!);
          current.status = 'ready';
          current.probeError = null;
        });
        return { assetId: String(asset.id), status: 'ready', durationMs: asset.durationMs === null ? null : Number(asset.durationMs) };
      } catch (error) {
        // Probe diagnostics can contain the generated private path; keep only
        // a stable summary and map missing tools to a deployment error.
        const failureObject = error instanceof MediaPublishError ? error.object : published;
        const failureReason = isProbeUnavailable(error) ? '媒体探测工具不可用'
          : publishing ? (failureObject ? '媒体发布完整性核验失败' : MEDIA_UNKNOWN_PUBLICATION) : '媒体内容校验失败';
        try {
          await this.dataSource.transaction(async (manager) => {
            const repo = manager.getRepository(MediaAsset);
            const current = await repo.findOne({ where: { id: String(asset!.id) }, lock: { mode: 'pessimistic_write' } });
            // A concurrent delete is final; neither a late success nor failure
            // may resurrect it or turn its durable tombstone back to failed.
            if (!current || current.status !== 'processing') return;
            if (failureObject) this.applyStoredObject(current, failureObject);
            else if (error instanceof MediaPublishError) this.applyStoredObject(current, {
              locator: error.locator, sizeBytes: materialized.size, mimeType: asset!.mimeType, etag: null, crc64: null,
            });
            current.status = 'failed';
            current.probeError = failureReason;
            await repo.save(current);
          });
        } catch { throw Errors.serviceUnavailable('媒体处理状态暂未保存'); }
        if (isProbeUnavailable(error)) throw Errors.serviceUnavailable('媒体探测工具不可用');
        if (publishing || error instanceof MediaPublishError) throw Errors.serviceUnavailable('媒体发布暂未完成');
        throw Errors.param(failureReason);
      }
    } finally {
      if (asset) this.activeAssetIds.delete(String(asset.id));
      if (materialized.cleanup) await this.cleanupTempPath(materialized.path);
    }
  }

  async upload(
    actorId: string | number,
    purpose: MediaUploadPurpose,
    file: Express.Multer.File,
    ownerId?: string | number,
  ): Promise<MediaUploadResult> {
    return this.uploadForPurpose(actorId, purpose, file, ownerId);
  }

  /** Only the identity image processor may pass already sanitized JPEG bytes here. */
  async storeIdentityImage(actorId: string, purpose: 'identity_id_portrait' | 'identity_id_emblem' | 'identity_face', bytes: Buffer): Promise<MediaUploadResult> {
    const uploaded = await this.uploadForPurpose(actorId, purpose, { buffer: bytes, size: bytes.length, originalname: '', mimetype: 'image/jpeg' } as Express.Multer.File);
    await this.dataSource.transaction(async (manager) => this.bind(manager, uploaded.assetId, 'identity_verification_user', actorId));
    return uploaded;
  }

  async releaseIdentityImage(actorId: string, assetId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Same user lock as session creation prevents release racing a new submission.
      await manager.getRepository(SysUser).findOne({ where: { id: actorId }, lock: { mode: 'pessimistic_write' } });
      const repo = manager.getRepository(MediaAsset);
      const asset = await repo.findOne({ where: { id: assetId }, lock: { mode: 'pessimistic_write' } });
      if (!asset || asset.ownerId !== actorId || asset.uploadedBy !== actorId || !['identity_id_portrait', 'identity_id_emblem', 'identity_face'].includes(asset.purpose)) throw Errors.dataForbidden();
      const used = await manager.getRepository(IdentityVerificationSession).createQueryBuilder('s')
        .where('s.user_id = :actorId', { actorId })
        .andWhere('(s.face_asset_id = :assetId OR s.id_card_portrait_asset_id = :assetId OR s.id_card_emblem_asset_id = :assetId)', { assetId }).getCount();
      if (used) throw Errors.mediaReferenced('认证会话正在保留该材料');
      const refs = manager.getRepository(MediaReference);
      const own = await refs.findOne({ where: { assetId, ownerType: 'identity_verification_user', ownerId: actorId }, lock: { mode: 'pessimistic_write' } });
      if (!own || await refs.count({ where: { assetId } }) !== 1) throw Errors.mediaReferenced();
      await refs.delete({ assetId, ownerType: 'identity_verification_user', ownerId: actorId });
      asset.status = 'deleting'; await repo.save(asset);
    });
    await this.remove(actorId, assetId);
  }

  /** Maintenance entry: only 24h-old, never-submitted identity assets are released. */
  async cleanupTemporaryIdentityImages(): Promise<number> {
    const candidates = await this.assetRepo.createQueryBuilder('a').where('a.purpose IN (:...purposes)', { purposes: ['identity_id_portrait', 'identity_id_emblem', 'identity_face'] })
      .andWhere('a.created_at < :cutoff', { cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000) }).getMany();
    let removed = 0;
    for (const asset of candidates) {
      try { await this.releaseIdentityImage(asset.ownerId, String(asset.id)); removed++; }
      catch (error) { if (![40302, 40913].includes(Number((error as any)?.code))) this.logger.warn('临时认证材料清理暂未完成'); }
    }
    return removed;
  }

  /** Private, bounded identity access; neither HTTP route accepts a local path. */
  async readPrivateBytes(actorId: string, assetId: string, purpose: string): Promise<Buffer> {
    await this.assertUsable(actorId, assetId, purpose, actorId);
    const asset = await this.findAsset(assetId);
    if (asset.uploadedBy !== actorId || !purpose.startsWith('identity_')) throw Errors.dataForbidden();
    const locator = this.assetLocator(asset);
    const adapter = this.storage.forLocator(locator);
    const info = await adapter.stat(locator).catch(() => null);
    const limit = 10 * 1024 * 1024;
    if (!info || info.sizeBytes > limit) throw Errors.notFound('认证材料不存在');
    const stream = await adapter.open(info.locator);
    const parts: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > limit) throw Errors.notFound('认证材料不存在');
        parts.push(bytes);
      }
      if (size !== info.sizeBytes) throw Errors.notFound('认证材料不存在');
      return Buffer.concat(parts, size);
    } catch { throw Errors.notFound('认证材料不存在'); }
    finally { stream.destroy(); }
  }

  /** Tickets never inherit uploader ownership: they require an exact live business reference. */
  async authorizeTicket(actorId: string, assetId: string, ownerType: string, ownerId: string): Promise<MediaAsset> {
    const actor = await this.dataSource.getRepository(SysUser).findOne({ where: { id: actorId } });
    if (!actor || Number(actor.status) !== 1) throw Errors.dataForbidden('媒体访问账号不可用');
    const policy = this.ownerPolicy(ownerType);
    const asset = await this.findAsset(assetId);
    if (asset.status !== 'ready') throw Errors.notFound('媒体不存在或尚未就绪');
    if (!policy.allowedPurposes.includes(asset.purpose as MediaPurpose)) throw Errors.dataForbidden();
    if (asset.purpose === 'video' && ownerType !== 'lesson_version_video') throw Errors.dataForbidden();
    const authorize = policy.authorizeTicket ?? (asset.purpose === 'video' ? undefined : policy.authorizeRead);
    const reference = await this.referenceRepo.findOne({ where: { assetId, ownerType, ownerId } });
    if (!reference || !authorize || !await authorize(actorId, ownerId, assetId)) throw Errors.dataForbidden();
    return asset;
  }

  async openTicketContent(claims: { user: string; asset: string; purpose: string; ownerType: string; ownerId: string }, rangeHeader?: string): Promise<ContentDescriptor> {
    const asset = await this.authorizeTicket(claims.user, claims.asset, claims.ownerType, claims.ownerId);
    if (asset.purpose !== claims.purpose) throw Errors.dataForbidden();
    return this.openAssetContent(asset, rangeHeader);
  }

  private async findAsset(assetId: MediaId, manager?: EntityManager): Promise<MediaAsset> {
    const repo = manager?.getRepository(MediaAsset) || this.assetRepo;
    const asset = await repo.findOne({ where: { id: String(assetId) } });
    if (!asset) throw Errors.notFound('媒体不存在');
    return asset;
  }

  async assertUsable(
    actorId: string | number,
    assetId: MediaId,
    purpose: string,
    ownerId?: string | number,
    manager?: EntityManager,
  ): Promise<void> {
    assertMediaPurpose(purpose);
    const asset = await this.findAsset(String(assetId), manager);
    if (String(asset.status) !== 'ready') throw Errors.param('媒体尚未就绪');
    if (asset.purpose !== purpose) throw Errors.dataForbidden('媒体用途不匹配');
    if (asset.ownerId !== idOf(ownerId ?? actorId)) throw Errors.dataForbidden();
  }

  /** A5 may publish only probed image assets uploaded for the branding purpose. */
  async assertPublicBrandingCandidate(assetId: MediaId): Promise<void> {
    const asset = await this.findAsset(String(assetId));
    if (String(asset.status) !== 'ready') throw Errors.param('品牌媒体尚未就绪');
    if (asset.purpose !== 'branding' || asset.mediaKind !== 'image') throw Errors.param('品牌媒体用途不匹配');
  }

  async bind(manager: EntityManager, assetId: MediaId, ownerType: string, ownerId: MediaId): Promise<void> {
    const policy = this.ownerPolicy(ownerType);
    const asset = await manager.getRepository(MediaAsset).findOne({
      where: { id: String(assetId) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!asset || String(asset.status) !== 'ready') throw Errors.notFound('媒体不存在或尚未就绪');
    if (!policy.allowedPurposes.includes(asset.purpose as MediaPurpose)) throw Errors.dataForbidden('媒体用途不匹配');
    await policy.validateBinding?.(manager, asset, String(ownerId));
    // This must be a current locking read. Under REPEATABLE READ a plain read
    // can retain a snapshot from before a concurrent binder committed, then
    // attempt the same unique insert after waiting for the asset lock.
    const existing = await manager.getRepository(MediaReference).findOne({
      where: { assetId: String(assetId), ownerType, ownerId: String(ownerId) },
      lock: { mode: 'pessimistic_read' },
    });
    if (!existing) {
      await manager.getRepository(MediaReference).insert({ assetId: String(assetId), ownerType, ownerId: String(ownerId) });
    }
  }

  async unbind(manager: EntityManager, assetId: MediaId, ownerType: string, ownerId: MediaId): Promise<void> {
    await manager.getRepository(MediaReference).delete({ assetId: String(assetId), ownerType, ownerId: String(ownerId) });
  }

  private async canRead(actorId: string, asset: MediaAsset): Promise<boolean> {
    if (asset.purpose !== 'video' && asset.ownerId === actorId) return true;
    const refs = await this.referenceRepo.find({ where: { assetId: String(asset.id) } });
    // A delegated avatar upload is owned by the student before the form is
    // saved. Only its uploader may preview it, with current business access.
    if (!refs.length && asset.purpose === 'avatar' && asset.mediaKind === 'image' && asset.uploadedBy === actorId) {
      const policy = this.ownerPolicies.get('user_avatar');
      if (policy?.allowedPurposes.includes('avatar') && await policy.authorizeRead(actorId, asset.ownerId, String(asset.id))) return true;
    }
    for (const ref of refs) {
      if (asset.purpose === 'video' && ref.ownerType !== 'lesson_version_video') continue;
      const policy = this.ownerPolicies.get(ref.ownerType);
      if (!policy || !policy.allowedPurposes.includes(asset.purpose as MediaPurpose)) continue;
      if (await policy.authorizeRead(actorId, String(ref.ownerId), String(asset.id))) return true;
    }
    return false;
  }

  async metadata(actorId: string | number, assetId: MediaId) {
    const asset = await this.findAsset(String(assetId));
    if (String(asset.status) === MEDIA_DELETING_STATUS) throw Errors.notFound('媒体不存在');
    if (!await this.canRead(idOf(actorId), asset)) throw Errors.dataForbidden();
    return this.view(asset);
  }

  private view(asset: MediaAsset) {
    return {
      asset_id: String(asset.id),
      purpose: asset.purpose,
      media_kind: asset.mediaKind,
      original_name: asset.originalName,
      mime_type: asset.mimeType,
      size_bytes: Number(asset.sizeBytes),
      sha256: asset.sha256,
      status: asset.status,
      duration_ms: asset.durationMs === null ? null : Number(asset.durationMs),
      probe_error: asset.status === 'failed' ? asset.probeError : null,
      created_at: asset.createdAt,
    };
  }

  /** Authorization-only bridge for edge delivery; never opens object bytes. */
  async authorizeContent(actorId: string | number, assetId: MediaId): Promise<MediaAsset> {
    const asset = await this.findAsset(String(assetId));
    if (String(asset.status) !== 'ready') throw Errors.notFound('媒体不存在或尚未就绪');
    if (!await this.canRead(idOf(actorId), asset)) throw Errors.dataForbidden();
    return asset;
  }

  private async openAssetContent(asset: MediaAsset, rangeHeader?: string): Promise<MediaContentDescriptor> {
    const locator = this.assetLocator(asset);
    const adapter = this.storage.forLocator(locator);
    const info = await adapter.stat(locator).catch((error) => {
      if (this.isMissingObject(error)) throw Errors.notFound('媒体不存在');
      throw Errors.serviceUnavailable('媒体存储读取失败');
    });
    let range: ByteRange | null;
    try { range = parseRange(rangeHeader, info.sizeBytes); } catch { throw Errors.mediaRangeInvalid(); }
    const stream = await adapter.open(info.locator, range ?? undefined).catch(() => { throw Errors.serviceUnavailable('媒体存储读取失败'); });
    return { asset, size: info.sizeBytes, range, stream };
  }

  async openContent(actorId: string | number, assetId: MediaId, rangeHeader?: string): Promise<MediaContentDescriptor> {
    return this.openAssetContent(await this.authorizeContent(actorId, assetId), rangeHeader);
  }

  /**
   * Narrow anonymous bridge for A5 site branding. A ready branding purpose is
   * still private unless a current site_config reference exists.
   */
  async authorizePublicBrandingAsset(assetId: MediaId): Promise<MediaAsset> {
    const asset = await this.findAsset(String(assetId));
    if (String(asset.status) !== 'ready' || asset.purpose !== 'branding' || asset.mediaKind !== 'image') {
      throw Errors.notFound('公开品牌资源不存在');
    }
    const referenced = await this.referenceRepo.count({ where: { assetId: String(assetId), ownerType: 'site_config' } });
    if (!referenced) throw Errors.notFound('公开品牌资源不存在');
    return asset;
  }

  async openPublicBrandingContent(assetId: MediaId, rangeHeader?: string): Promise<MediaContentDescriptor> {
    return this.openAssetContent(await this.authorizePublicBrandingAsset(assetId), rangeHeader);
  }

  private isMissingObject(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      || (error as { statusCode?: number })?.statusCode === 404;
  }

  private async removeStoredAsset(asset: MediaAsset): Promise<void> {
    if (this.activeAssetIds.has(String(asset.id))) throw Errors.serviceUnavailable('媒体仍在处理中');
    let locator = this.assetLocator(asset);
    const adapter = this.storage.forLocator(locator);
    if (locator.provider === 'cos' && locator.versionId === null) {
      let object: StoredObject;
      try { object = await adapter.stat(locator); }
      catch (error) {
        if (this.isMissingObject(error) && asset.probeError !== MEDIA_UNKNOWN_PUBLICATION) return;
        throw error;
      }
      locator = object.locator;
      if (locator.versionId !== null) {
        await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(MediaAsset);
          const current = await repo.findOne({ where: { id: String(asset.id) }, lock: { mode: 'pessimistic_write' } });
          if (!current || current.status !== 'deleting' || current.storageKey !== asset.storageKey
            || await manager.getRepository(MediaReference).count({ where: { assetId: String(asset.id) } })) throw Errors.mediaReferenced();
          this.applyStoredObject(current, object);
          await repo.save(current);
        });
      }
    }
    await adapter.remove(locator);
  }

  async remove(actorId: string | number, assetId: MediaId): Promise<void> {
    let removing: MediaAsset | null = null;
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MediaAsset);
      const asset = await repo.findOne({ where: { id: String(assetId) }, lock: { mode: 'pessimistic_write' } });
      if (!asset) throw Errors.notFound('媒体不存在');
      if (asset.ownerId !== idOf(actorId)) throw Errors.dataForbidden();
      if (String(asset.status) !== MEDIA_DELETING_STATUS) {
        const count = await manager.getRepository(MediaReference).count({ where: { assetId: String(assetId) } });
        if (count > 0) throw Errors.mediaReferenced();
        (asset as any).status = MEDIA_DELETING_STATUS;
        await repo.save(asset);
      }
      removing = asset;
    });
    if (!removing) return;
    try {
      await this.removeStoredAsset(removing);
    } catch (error) {
      this.logger.warn('媒体文件清理失败');
      throw Errors.serviceUnavailable('媒体文件清理失败');
    }
    try {
      await this.deleteDeletingAsset(String(assetId));
    } catch (error) {
      if ((error as any)?.code === 40913) throw error;
      this.logger.warn('媒体删除记录清理失败');
      throw Errors.serviceUnavailable('媒体删除记录清理失败');
    }
  }

  /** Delete only stale unreferenced files; a reference row always wins the race. */
  async cleanupOrphans(graceMs = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(60_000, graceMs));
    const candidates = await this.assetRepo.createQueryBuilder('asset')
      .where('(asset.updated_at < :cutoff OR asset.status = :deleting)', { cutoff, deleting: MEDIA_DELETING_STATUS })
      .getMany();
    let removed = 0;
    for (const candidate of candidates) {
      if (this.activeAssetIds.has(String(candidate.id))) continue;
      let removing: MediaAsset | null = null;
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(MediaAsset);
        const asset = await manager.getRepository(MediaAsset).findOne({
          where: { id: String(candidate.id) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!asset) return;
        if (this.activeAssetIds.has(String(asset.id))) return;
        const count = await manager.getRepository(MediaReference).count({ where: { assetId: String(asset.id) } });
        if (count > 0 || (String(asset.status) !== MEDIA_DELETING_STATUS && asset.updatedAt >= cutoff)) return;
        if (String(asset.status) !== MEDIA_DELETING_STATUS) {
          (asset as any).status = MEDIA_DELETING_STATUS;
          await repo.save(asset);
        }
        removing = asset;
      });
      if (!removing) continue;
      try {
        await this.removeStoredAsset(removing);
        await this.deleteDeletingAsset(String(candidate.id));
        removed += 1;
      } catch (error) {
        this.logger.warn('媒体孤儿清理失败');
      }
    }
    return removed + await this.cleanupStaleTempFiles();
  }

  private async deleteDeletingAsset(assetId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MediaAsset);
      const asset = await repo.findOne({ where: { id: String(assetId) }, lock: { mode: 'pessimistic_write' } });
      if (!asset) return;
      if (String(asset.status) !== MEDIA_DELETING_STATUS) return;
      const count = await manager.getRepository(MediaReference).count({ where: { assetId: String(assetId) } });
      if (count > 0) throw Errors.mediaReferenced();
      await repo.delete({ id: String(assetId) });
    });
  }
}
