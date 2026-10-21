import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { AccessService } from '../access/access.service';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaReference } from '../../entities/media-reference.entity';
import {
  assertMediaPurpose,
  assertMediaSize,
  assertOwnerTypeRegistered,
  DEFAULT_MEDIA_LIMITS,
  mediaKindForPurpose,
  parseRange,
  type ByteRange,
  type MediaLimits,
  type MediaPurpose,
} from './media-policy';
import { MediaProbeService, type ImageProbeResult, type VideoProbeResult } from './media-probe.service';

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

@Injectable()
export class MediaService {
  private readonly ownerAuthorizers = new Map<string, MediaOwnerAuthorizer>();

  constructor(
    @InjectRepository(MediaAsset) private readonly assetRepo: Repository<MediaAsset>,
    @InjectRepository(MediaReference) private readonly referenceRepo: Repository<MediaReference>,
    private readonly dataSource: DataSource,
    private readonly config: AppConfig,
    private readonly probe: MediaProbeService,
    private readonly access?: AccessService,
  ) {
    // Self-owned avatars are the only owner type implemented in A4. All future
    // course/exam answer owners must register their own business checker.
    this.registerOwnerType('user_avatar', async (actorId, ownerId) => {
      if (actorId === ownerId) return true;
      // A managed-student avatar can be previewed by an authenticated staff
      // member with student read/write authority; future business references
      // still need to register their own authorizer explicitly.
      if (!this.access) return false;
      const permissions = await this.access.permissions(actorId);
      return permissions.includes('students:read') || permissions.includes('students:write');
    });
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

  registerOwnerType(ownerType: string, authorizer: MediaOwnerAuthorizer): void {
    if (!ownerType || typeof authorizer !== 'function') throw Errors.param('媒体业务归属注册无效');
    this.ownerAuthorizers.set(ownerType, authorizer);
  }

  registerOwnerAuthorizer(ownerType: string, authorizer: MediaOwnerAuthorizer): void {
    this.registerOwnerType(ownerType, authorizer);
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
      const tempRoot = resolve(this.storageRoot(), 'tmp', 'media');
      const candidate = resolve(file.path);
      const rel = relative(tempRoot, candidate);
      if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) throw Errors.param('媒体临时路径无效');
      const fileStat = await stat(candidate);
      return { path: candidate, size: fileStat.size, cleanup: true };
    }
    if (file?.buffer) {
      const path = await this.tempPath();
      await writeFile(path, file.buffer);
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
        // ffprobe diagnostics can contain the generated private path; keep only
        // a stable user-facing summary and never persist filesystem details.
        asset.probeError = '媒体内容校验失败';
        await this.assetRepo.save(asset);
        throw Errors.param(asset.probeError);
      }
    } catch (error) {
      if (finalPath) await rm(finalPath, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      if (materialized.cleanup) await rm(materialized.path, { force: true }).catch(() => undefined);
    }
  }

  private async findAsset(assetId: MediaId, manager?: EntityManager): Promise<MediaAsset> {
    const repo = manager?.getRepository(MediaAsset) || this.assetRepo;
    const asset = await repo.findOne({ where: { id: String(assetId) } });
    if (!asset) throw Errors.notFound('媒体不存在');
    return asset;
  }

  async assertUsable(actorId: string | number, assetId: MediaId, purpose: string, ownerId?: string | number): Promise<void> {
    assertMediaPurpose(purpose);
    const asset = await this.findAsset(String(assetId));
    if (asset.status !== 'ready') throw Errors.param('媒体尚未就绪');
    if (asset.purpose !== purpose) throw Errors.dataForbidden('媒体用途不匹配');
    if (asset.ownerId !== idOf(ownerId ?? actorId)) throw Errors.dataForbidden();
  }

  async bind(manager: EntityManager, assetId: MediaId, ownerType: string, ownerId: MediaId): Promise<void> {
    assertOwnerTypeRegistered(this.ownerAuthorizers, ownerType);
    const asset = await manager.getRepository(MediaAsset).findOne({
      where: { id: String(assetId) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!asset || asset.status !== 'ready') throw Errors.notFound('媒体不存在或尚未就绪');
    if (asset.ownerId !== String(ownerId)) throw Errors.dataForbidden();
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
      const authorizer = this.ownerAuthorizers.get(ref.ownerType);
      if (!authorizer) continue;
      if (await authorizer(actorId, String(ref.ownerId))) return true;
    }
    return false;
  }

  async metadata(actorId: string | number, assetId: MediaId) {
    const asset = await this.findAsset(String(assetId));
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
    if (asset.status !== 'ready') throw Errors.notFound('媒体不存在或尚未就绪');
    if (!await this.canRead(idOf(actorId), asset)) throw Errors.dataForbidden();
    const path = this.storagePath(asset.storageKey);
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile()) throw Errors.notFound('媒体不存在');
    let range: ByteRange | null = null;
    try { range = parseRange(rangeHeader, fileStat.size); } catch { throw Errors.param('媒体 Range 无效'); }
    return { asset, path, size: fileStat.size, range };
  }

  async remove(actorId: string | number, assetId: MediaId): Promise<void> {
    let key: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      const asset = await manager.getRepository(MediaAsset).findOne({ where: { id: String(assetId) }, lock: { mode: 'pessimistic_write' } });
      if (!asset) throw Errors.notFound('媒体不存在');
      if (asset.ownerId !== idOf(actorId)) throw Errors.dataForbidden();
      const count = await manager.getRepository(MediaReference).count({ where: { assetId: String(assetId) } });
      if (count > 0) throw Errors.mediaReferenced();
      key = asset.storageKey;
      await manager.getRepository(MediaAsset).delete({ id: String(assetId) });
    });
    if (key) await rm(this.storagePath(key), { force: true }).catch(() => undefined);
  }

  /** Delete only stale unreferenced files; a reference row always wins the race. */
  async cleanupOrphans(graceMs = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(60_000, graceMs));
    const candidates = await this.assetRepo.createQueryBuilder('asset')
      .where('asset.updated_at < :cutoff', { cutoff })
      .getMany();
    let removed = 0;
    for (const candidate of candidates) {
      let key: string | null = null;
      let deleted = false;
      await this.dataSource.transaction(async (manager) => {
        const asset = await manager.getRepository(MediaAsset).findOne({
          where: { id: String(candidate.id) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!asset) return;
        const count = await manager.getRepository(MediaReference).count({ where: { assetId: String(asset.id) } });
        if (count > 0 || asset.updatedAt >= cutoff) return;
        key = asset.storageKey;
        await manager.getRepository(MediaAsset).delete({ id: String(asset.id) });
        deleted = true;
      });
      if (deleted && key) {
        await rm(this.storagePath(key), { force: true }).catch(() => undefined);
        removed += 1;
      }
    }
    return removed;
  }
}
