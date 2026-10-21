import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaReference } from '../../entities/media-reference.entity';
import {
  assertMediaPurpose,
  assertMediaSize,
  DEFAULT_MEDIA_LIMITS,
  mediaKindForPurpose,
  parseRange,
  type ByteRange,
  type MediaLimits,
  type MediaPurpose,
} from './media-policy';
import {
  MediaProbeService,
  MediaProbeUnavailableError,
  type ImageProbeResult,
  type VideoProbeResult,
} from './media-probe.service';

export type MediaId = string;
export type MediaUploadPurpose = MediaPurpose;

export type MediaUploadResult = {
  assetId: MediaId;
  status: 'processing' | 'ready' | 'failed';
  durationMs: number | null;
};

export type MediaOwnerAuthorizer = (actorId: MediaId, ownerId: MediaId) => boolean | Promise<boolean>;

export interface ContentDescriptor {
  asset: MediaAsset;
  path: string;
  size: number;
  range: ByteRange | null;
}

export interface MediaOwnerPolicy {
  allowedPurposes: readonly MediaPurpose[];
  authorizeRead: (actorId: MediaId, businessId: MediaId) => boolean | Promise<boolean>;
  validateBinding?: (manager: EntityManager, asset: MediaAsset, businessId: MediaId) => void | Promise<void>;
}

const MEDIA_DELETING_STATUS = 'deleting';
const MEDIA_TEMP_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.upload$/i;

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

  constructor(
    @InjectRepository(MediaAsset) private readonly assetRepo: Repository<MediaAsset>,
    @InjectRepository(MediaReference) private readonly referenceRepo: Repository<MediaReference>,
    private readonly dataSource: DataSource,
    private readonly config: AppConfig,
    private readonly probe: MediaProbeService,
  ) {
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
      validateBinding: policy.validateBinding,
    });
  }

  registerOwnerType(ownerType: string, policy: MediaOwnerPolicy | MediaOwnerAuthorizer): void {
    if (typeof policy === 'function') {
      this.registerOwnerPolicy(ownerType, { allowedPurposes: ['avatar', 'course_cover', 'video', 'question', 'answer', 'branding'], authorizeRead: policy });
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

  private storagePath(key: string): string {
    const root = this.storageRoot();
    const path = resolve(root, key);
    const rel = relative(root, path);
    if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) throw Errors.internal('媒体存储路径无效');
    return path;
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
      await writeFile(path, file.buffer);
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

  async upload(
    actorId: string | number,
    purpose: MediaUploadPurpose,
    file: Express.Multer.File,
    ownerId?: string | number,
  ): Promise<MediaUploadResult> {
    assertMediaPurpose(purpose);
    const actor = idOf(actorId);
    const owner = idOf(ownerId ?? actor);
    const kind = mediaKindForPurpose(purpose);
    const materialized = await this.materializeFile(file);
    let finalPath: string | undefined;
    try {
      assertMediaSize(kind, materialized.size, this.mediaLimits());
      const key = `media/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${kind === 'video' ? '.mp4' : '.upload'}`;
      finalPath = this.storagePath(key);
      await mkdir(join(finalPath, '..'), { recursive: true });
      await rename(materialized.path, finalPath);
      this.activeTempPaths.delete(materialized.path);
      materialized.cleanup = false;

      const asset = await this.assetRepo.save(this.assetRepo.create({
        ownerId: owner,
        uploadedBy: actor,
        purpose,
        mediaKind: kind,
        originalName: safeOriginalName(file?.originalname),
        mimeType: file?.mimetype || (kind === 'video' ? 'video/mp4' : 'application/octet-stream'),
        storageKey: key,
        sizeBytes: String(materialized.size),
        sha256: await this.sha256File(finalPath),
        status: 'processing',
        durationMs: null,
        probeError: null,
      }));

      try {
        const result = await this.probe.probe(finalPath, kind);
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
        asset.status = 'ready';
        await this.assetRepo.save(asset);
        return { assetId: String(asset.id), status: asset.status, durationMs: asset.durationMs === null ? null : Number(asset.durationMs) };
      } catch (error) {
        asset.status = 'failed';
        // Probe diagnostics can contain the generated private path; keep only
        // a stable summary and map missing tools to a deployment error.
        asset.probeError = isProbeUnavailable(error) ? '媒体探测工具不可用' : '媒体内容校验失败';
        await this.assetRepo.save(asset);
        if (isProbeUnavailable(error)) throw Errors.serviceUnavailable('媒体探测工具不可用');
        throw Errors.param(asset.probeError);
      }
    } catch (error) {
      if (finalPath) await rm(finalPath, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      if (materialized.cleanup) await this.cleanupTempPath(materialized.path);
    }
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
    const existing = await manager.getRepository(MediaReference).findOne({ where: { assetId: String(assetId), ownerType, ownerId: String(ownerId) } });
    if (!existing) {
      await manager.getRepository(MediaReference).insert({ assetId: String(assetId), ownerType, ownerId: String(ownerId) });
    }
  }

  async unbind(manager: EntityManager, assetId: MediaId, ownerType: string, ownerId: MediaId): Promise<void> {
    await manager.getRepository(MediaReference).delete({ assetId: String(assetId), ownerType, ownerId: String(ownerId) });
  }

  private async canRead(actorId: string, asset: MediaAsset): Promise<boolean> {
    if (asset.ownerId === actorId) return true;
    const refs = await this.referenceRepo.find({ where: { assetId: String(asset.id) } });
    for (const ref of refs) {
      const policy = this.ownerPolicies.get(ref.ownerType);
      if (!policy || !policy.allowedPurposes.includes(asset.purpose as MediaPurpose)) continue;
      if (await policy.authorizeRead(actorId, String(ref.ownerId))) return true;
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

  async openContent(actorId: string | number, assetId: MediaId, rangeHeader?: string): Promise<ContentDescriptor> {
    const asset = await this.findAsset(String(assetId));
    if (String(asset.status) !== 'ready') throw Errors.notFound('媒体不存在或尚未就绪');
    if (!await this.canRead(idOf(actorId), asset)) throw Errors.dataForbidden();
    const path = this.storagePath(asset.storageKey);
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile()) throw Errors.notFound('媒体不存在');
    let range: ByteRange | null = null;
    try { range = parseRange(rangeHeader, fileStat.size); } catch { throw Errors.mediaRangeInvalid(); }
    return { asset, path, size: fileStat.size, range };
  }

  /**
   * Narrow anonymous bridge for A5 site branding. A ready branding purpose is
   * still private unless a current site_config reference exists.
   */
  async openPublicBrandingContent(assetId: MediaId, rangeHeader?: string): Promise<ContentDescriptor> {
    const asset = await this.findAsset(String(assetId));
    if (String(asset.status) !== 'ready' || asset.purpose !== 'branding' || asset.mediaKind !== 'image') {
      throw Errors.notFound('公开品牌资源不存在');
    }
    const referenced = await this.referenceRepo.count({ where: { assetId: String(assetId), ownerType: 'site_config' } });
    if (!referenced) throw Errors.notFound('公开品牌资源不存在');
    const path = this.storagePath(asset.storageKey);
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile()) throw Errors.notFound('公开品牌资源不存在');
    let range: ByteRange | null = null;
    try { range = parseRange(rangeHeader, fileStat.size); } catch { throw Errors.mediaRangeInvalid(); }
    return { asset, path, size: fileStat.size, range };
  }

  async remove(actorId: string | number, assetId: MediaId): Promise<void> {
    let key: string | null = null;
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
      key = asset.storageKey;
    });
    if (!key) return;
    try {
      await rm(this.storagePath(key), { force: true });
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
      let key: string | null = null;
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(MediaAsset);
        const asset = await manager.getRepository(MediaAsset).findOne({
          where: { id: String(candidate.id) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!asset) return;
        const count = await manager.getRepository(MediaReference).count({ where: { assetId: String(asset.id) } });
        if (count > 0 || (String(asset.status) !== MEDIA_DELETING_STATUS && asset.updatedAt >= cutoff)) return;
        if (String(asset.status) !== MEDIA_DELETING_STATUS) {
          (asset as any).status = MEDIA_DELETING_STATUS;
          await repo.save(asset);
        }
        key = asset.storageKey;
      });
      if (!key) continue;
      try {
        await rm(this.storagePath(key), { force: true });
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
