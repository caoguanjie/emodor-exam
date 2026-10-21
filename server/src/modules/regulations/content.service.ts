import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Regulation } from '../../entities/regulation.entity';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { Errors, RegulationStatus } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { RegulationScopeService } from './regulation-scope.service';

/**
 * 在线阅读内容服务（05 册 3.4.6）：
 * 校验链 ① JWT（守卫承担）→ ② status=published（preview 跳过）→ ③ 范围可见性（管理员不受限）
 * → ④ 按生效版本取产物：docx → content_html（Redis 缓存，换版失效）；pdf → 受控文件流。
 */
@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(Regulation) private readonly regRepo: Repository<Regulation>,
    @InjectRepository(RegulationVersion) private readonly versionRepo: Repository<RegulationVersion>,
    private readonly scopeService: RegulationScopeService,
    private readonly redis: RedisService,
  ) {}

  /** 员工端阅读内容（GET /regulations/{id}/content） */
  async readingContent(regulationId: string, user: { id: number; role: string; departmentId: string | null }, preview: boolean, previewVersionId?: string) {
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');

    // ② 员工侧仅 published 可见；管理端 preview 跳过该检查（仅角色校验，FR-REG-03 验收④）
    if (!preview && regulation.status !== RegulationStatus.PUBLISHED) {
      throw Errors.contentInvisible('制度未发布或已归档');
    }
    // ③ 范围可见性：super_admin / regulation_admin 不受范围限制（05 册 3.4.6）
    const isAdmin = user.role === 'super_admin' || user.role === 'regulation_admin';
    if (!isAdmin) {
      const inScope = await this.scopeService.isUserInScope(regulationId, user);
      if (!inScope) throw Errors.contentInvisible('不在该制度的发布范围内');
    }

    // ④ 取版本：preview 指定 versionId 优先；缺省为当前生效版本（归属校验防跨制度 versionId 错配）
    const versionId = preview && previewVersionId ? previewVersionId : regulation.currentVersionId;
    if (!versionId) throw Errors.contentInvisible('制度暂无生效版本');
    const version = await this.versionRepo.findOne({ where: { id: versionId, regulationId } });
    if (!version) throw Errors.notFound('版本不存在');

    const meta = {
      regulation_id: Number(regulation.id),
      title: regulation.title,
      version_id: Number(version.id),
      version_no: version.versionNo,
      file_type: version.fileType,
      parse_status: version.parseStatus,
      required_minutes: regulation.requiredMinutes,
      scroll_segments: regulation.scrollSegments,
      regulation_status: regulation.status,
    };

    if (version.parseStatus !== 'parsed') {
      return { ...meta, content_html: null, file_download_url: null };
    }
    if (version.fileType === 'docx') {
      // Redis 缓存（版本不可变天然适合缓存，TTL + 换版失效，03 册 6.5）
      const cacheKey = `content:html:${version.id}`;
      let html = await this.redis.get(cacheKey);
      if (!html) {
        html = version.contentHtml || '';
        await this.redis.set(cacheKey, html, 3600);
      }
      return { ...meta, content_html: html, file_download_url: null };
    }
    // pdf：返回受控下载地址（由 content 端点以流响应，见 controller file 端点）
    return {
      ...meta,
      content_html: null,
      file_download_url: `/api/v1/regulations/${regulationId}/content/file`,
    };
  }
}
