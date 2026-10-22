import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Regulation } from '../../entities/regulation.entity';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { Errors } from '../../common/errors';
import { AuditService } from '../../common/audit.service';
import { AppConfig } from '../../config/configuration';
import { mkdirSync, renameSync, rmSync, writeFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

export interface UploadResult {
  version_id: string;
  version_no: number;
  file_type: string;
  file_hash: string;
  parse_status: string;
  duplicate_hint: string | null;
}

/**
 * Shared immutable-file version storage for question materials and legacy content reads.
 * 上传校验链（大小 ≤ 50MB → 扩展名 + 魔数 → SHA-256 → 重复检测提示不阻断 → 事务创建版本）；
 * 本地卷目录规则 {UPLOAD_DIR}/regulations/{regulation_id}/{version_no}_{hash8}.{ext}；
 * New uploads are append-only; the slimmed application exposes no current-version switch.
 */
@Injectable()
export class RegulationVersionService {
  constructor(
    @InjectRepository(Regulation) private readonly regRepo: Repository<Regulation>,
    @InjectRepository(RegulationVersion) private readonly versionRepo: Repository<RegulationVersion>,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /** 扩展名 + 魔数双重校验（07 册 4.3.1）：pdf 以 %PDF- 头；docx 为 zip（PK）且含 [Content_Types].xml */
  private detectType(filename: string, buffer: Buffer): 'pdf' | 'docx' {
    const ext = extname(filename).toLowerCase().replace('.', '');
    const isPdfMagic = buffer.length > 5 && buffer.slice(0, 5).toString('latin1') === '%PDF-';
    const isZipMagic = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
    if (ext === 'pdf' && isPdfMagic) return 'pdf';
    if (ext === 'docx' && isZipMagic) {
      // zip 内部结构校验由解析侧 mammoth 打开时兜底（docx 必含 [Content_Types].xml）
      return 'docx';
    }
    throw Errors.fileFormat('仅支持 pdf / docx 文件');
  }

  /** 规则 2：扩展名允许 pdf/docx 但魔数不符（伪装文件）单独提示 */
  private static checkMagicOnly(buffer: Buffer): string | null {
    const isPdfMagic = buffer.length > 5 && buffer.slice(0, 5).toString('latin1') === '%PDF-';
    const isZipMagic = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (isPdfMagic) return 'pdf';
    if (isZipMagic) return 'docx';
    return null;
  }

  async upload(regulationId: string, file: Express.Multer.File, actor: { id: number; name: string }, ip: string | null): Promise<UploadResult> {
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('资料不存在');
    if (!file || !file.buffer || !file.buffer.length) throw Errors.param('缺少上传文件');

    // 校验 2：大小 ≤ 50MB（nginx client_max_body_size 同步配置，05 册 3.4.1）
    if (file.buffer.length > this.config.upload.maxUploadSizeMb * 1024 * 1024) {
      throw Errors.fileTooLarge(`文件超过 ${this.config.upload.maxUploadSizeMb}MB 上限`);
    }
    // 校验 3：扩展名 + 魔数双重校验
    const ext = extname(file.originalname).toLowerCase().replace('.', '');
    const magicType = RegulationVersionService.checkMagicOnly(file.buffer);
    let fileType: 'pdf' | 'docx';
    try {
      fileType = this.detectType(file.originalname, file.buffer);
    } catch (e) {
      if (magicType) throw Errors.fileFormat(`文件扩展名 .${ext} 与实际格式不符，请上传真实的 ${ext} 文件`);
      throw e;
    }
    // 校验 4：流式计算 SHA-256
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    // 校验 5：重复检测（同制度同 hash → 提示但不阻断，FR-REG-02 验收③）
    let duplicateHint: string | null = null;
    const dup = await this.versionRepo.findOne({ where: { regulationId, fileHash } });
    if (dup) duplicateHint = `与版本 v${dup.versionNo} 文件内容相同`;

    // 校验 6：事务落库 + 文件从临时区移入正式目录
    const versionNo = (await this.nextVersionNo(regulationId)) as number;
    const relativePath = join('regulations', String(regulationId), `${versionNo}_${fileHash.slice(0, 8)}.${fileType}`);
    const absPath = join(this.config.upload.dir, relativePath);
    mkdirSync(join(absPath, '..'), { recursive: true });
    const tmpPath = join(this.config.upload.dir, 'tmp', `${Date.now()}_${fileHash.slice(0, 8)}.${fileType}`);
    mkdirSync(join(tmpPath, '..'), { recursive: true });
    writeFileSync(tmpPath, file.buffer);

    let version: RegulationVersion;
    try {
      version = await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(RegulationVersion);
        const entity = repo.create({
          regulationId,
          versionNo,
          filePath: relativePath,
          fileType,
          fileHash,
          parseStatus: 'pending',
          createdBy: String(actor.id),
        });
        return repo.save(entity);
      });
      renameSync(tmpPath, absPath);
    } catch (e: any) {
      if (String(e?.code) !== 'ER_DUP_ENTRY') {
        // 非唯一键冲突：清理临时文件后原样抛出
        try { rmSync(tmpPath, { force: true }); } catch { /* 清理失败可忽略 */ }
        throw e;
      }
      // uk_regulation_version_no 兜底并发上传：冲突时重读重分配（保留 tmp 供重试事务搬移）
      try {
        const retryNo = (await this.nextVersionNo(regulationId)) as number;
        const retryPath = join('regulations', String(regulationId), `${retryNo}_${fileHash.slice(0, 8)}.${fileType}`);
        const retryAbs = join(this.config.upload.dir, retryPath);
        mkdirSync(join(retryAbs, '..'), { recursive: true });
        version = await this.dataSource.transaction(async (m) => {
          const repo = m.getRepository(RegulationVersion);
          const entity = repo.create({
            regulationId,
            versionNo: retryNo,
            filePath: retryPath,
            fileType,
            fileHash,
            parseStatus: 'pending',
            createdBy: String(actor.id),
          });
          const saved = await repo.save(entity);
          renameSync(tmpPath, retryAbs);
          return saved;
        });
      } catch (e2: any) {
        // 重试仍失败：清理临时文件后抛出（此时 tmp 可能已被搬移，force 跳过 ENOENT）
        try { rmSync(tmpPath, { force: true }); } catch { /* 清理失败可忽略 */ }
        throw e2;
      }
    }

    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'regulation.version.upload', object_type: 'regulation_version',
      object_id: version.id, detail: { regulation_id: String(regulationId), version_no: version.versionNo, file_hash: fileHash },
      result: 'success', source_ip: ip,
    });
    return {
      version_id: String(version.id),
      version_no: version.versionNo,
      file_type: version.fileType,
      file_hash: fileHash,
      parse_status: version.parseStatus,
      duplicate_hint: duplicateHint,
    };
  }

  private async nextVersionNo(regulationId: string): Promise<number> {
    const qb = await this.versionRepo
      .createQueryBuilder('v')
      .select('COALESCE(MAX(v.version_no), 0)', 'maxNo')
      .where('v.regulation_id = :rid', { rid: regulationId })
      .getRawOne();
    return Number(qb?.maxNo || 0) + 1;
  }

  /** 解析失败重试：failed → pending 重新入队（retry_count +1，05 册 3.4.3） */
  async retryParse(regulationId: string, versionId: string, actor: { id: number; name: string }, ip: string | null) {
    const version = await this.versionRepo.findOne({ where: { id: versionId, regulationId } });
    if (!version) throw Errors.notFound('版本不存在');
    if (version.parseStatus !== 'failed') throw Errors.param('仅解析失败的版本可重试');
    version.parseStatus = 'pending';
    version.retryCount += 1;
    await this.versionRepo.save(version);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'regulation.version.retry', object_type: 'regulation_version',
      object_id: versionId, detail: { retry_count: version.retryCount }, result: 'success', source_ip: ip,
    });
    return { version_id: String(version.id), parse_status: version.parseStatus, retry_count: version.retryCount };
  }

  /** PDF 文件受控流式下发（05 册 3.4.6：不暴露静态 URL，经应用层鉴权后提供） */
  async openFileStream(regulationId: string, versionId: string) {
    const version = await this.versionRepo.findOne({ where: { id: versionId, regulationId } });
    if (!version) throw Errors.notFound('版本不存在');
    const absPath = join(this.config.upload.dir, version.filePath);
    if (!existsSync(absPath)) throw Errors.notFound('文件不存在');
    const stat = statSync(absPath);
    const stream = createReadStream(absPath);
    return { stream: stream as unknown as Readable, size: stat.size, fileType: version.fileType };
  }
}
