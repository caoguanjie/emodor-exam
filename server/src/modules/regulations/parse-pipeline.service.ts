import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import * as mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { AppConfig } from '../../config/configuration';
import { RedisService } from '../../common/redis.service';

const PARSE_MIN_TEXT_CHARS = 50; // 产物体检阈值（05 册 3.4.3：空产物判 failed）

/**
 * 异步解析流水线（05 册 3.4.3，AD-03）：
 * pdf → unpdf 提取 text_content（content_html 置 NULL，阅读走 pdfjs-dist）；
 * docx → mammoth 双产物（convertToHtml → content_html、extractRawText → text_content）；
 * 产物体检（去空白后 < 50 字符判 failed）；瞬时异常自动重试 1 次；Redis 锁防并发双解析；
 * 进程内任务队列并发上限 2（CPU 密集任务与事件循环隔离，02 册 3.3 R1）。
 */
@Injectable()
export class ParsePipelineService {
  private readonly logger = new Logger(ParsePipelineService.name);
  private queue: string[] = [];
  private running = 0;
  private readonly maxConcurrency = 2;

  constructor(
    @InjectRepository(RegulationVersion) private readonly versionRepo: Repository<RegulationVersion>,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  /** 上传事务提交后投递（事件立即触发；每分钟兜底扫描双通道，05 册 3.4.3） */
  enqueue(versionId: string) {
    if (!this.queue.includes(versionId)) this.queue.push(versionId);
    this.pump();
  }

  /** 兜底扫描：pending 且 created_at < now - 2 分钟（防事件丢失，避免与刚投递任务抢跑） */
  async scanStalled() {
    const rows = await this.versionRepo.find({
      where: { parseStatus: 'pending', createdAt: LessThan(new Date(Date.now() - 2 * 60 * 1000)) },
      take: 20,
      order: { id: 'ASC' },
    });
    for (const row of rows) this.enqueue(row.id);
  }

  private pump() {
    while (this.running < this.maxConcurrency && this.queue.length) {
      const versionId = this.queue.shift()!;
      this.running++;
      this.process(versionId)
        .catch((e) => this.logger.error(`解析任务异常 version=${versionId}: ${e?.message}`))
        .finally(() => {
          this.running--;
          setImmediate(() => this.pump());
        });
    }
  }

  private async process(versionId: string) {
    // 任务抢占：SET parse:lock:{version_id} NX EX 600（05 册 3.4.3；双通道触发下防并发双解析）
    const locked = await this.redis.setNx(`parse:lock:${versionId}`, '1', 600);
    if (!locked) return;

    try {
      const version = await this.versionRepo.findOne({ where: { id: versionId } });
      if (!version) return;
      if (version.parseStatus === 'parsed') return; // 已成功不重复解析（防 failed 覆盖 parsed）
      if (version.parseStatus === 'failed') {
        // failed 仅由管理端 retry 重新入队（retry 时 parseStatus 已回 pending）
        return;
      }

      const absPath = join(this.config.upload.dir, version.filePath);
      let contentHtml: string | null = null;
      let textContent: string;
      const parseOnce = async (): Promise<string> => {
        const buffer = await readFile(absPath);
        if (version.fileType === 'pdf') {
          // unpdf（内置现代 pdf.js）：旧依赖 pdf-parse 捆绑的 2015 版 pdf.js 对部分合法 PDF
          // 确定性抛 bad XRef entry；content_html 置 NULL，阅读走 pdfjs-dist 前端渲染（05 册 3.4.3）
          const { extractText } = await import('unpdf');
          const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
          contentHtml = null;
          return text || '';
        }
        // mammoth 双产物一次成型（05 册 3.4.3）：convertToHtml → content_html；extractRawText → text_content
        const html = await mammoth.convertToHtml({ buffer });
        const raw = await mammoth.extractRawText({ buffer });
        contentHtml = this.sanitize(html.value || '');
        return raw.value || '';
      };
      try {
        textContent = await parseOnce();
      } catch (e: any) {
        // 瞬时异常自动重试 1 次（05 册 3.4.3 失败重试）
        this.logger.warn(`解析失败（首次）version=${versionId}: ${e?.message}`);
        try {
          contentHtml = null;
          textContent = await parseOnce();
        } catch (e2: any) {
          await this.markFailed(version, e2?.message);
          return;
        }
      }

      // 产物体检：文本不足时，启用多模态的 PDF 保留为 parsed，交给 AI 出题时逐页视觉理解；
      // 未启用多模态时仍按原规则失败，避免把空文本误当成可命题内容。
      const stripped = (textContent || '').replace(/\s/g, '');
      if (stripped.length < PARSE_MIN_TEXT_CHARS) {
        if (version.fileType === 'pdf' && this.config.ai.multimodalEnabled) {
          version.contentHtml = contentHtml;
          version.textContent = textContent || '';
          version.parseStatus = 'parsed';
          version.parsedAt = new Date();
          await this.versionRepo.save(version);
          this.logger.warn(`文本层不足，保留为多模态解析 version=${versionId} chars=${stripped.length}`);
          return;
        }
        await this.markFailed(version, '未提取到有效文本（可能为扫描版 PDF 或空文档），请上传含可复制文本的文件');
        return;
      }

      // 产物只在首次成功时写入 + parsed_at（NFR-04 耗时度量口径 parsed_at − created_at）
      version.contentHtml = contentHtml;
      version.textContent = textContent;
      version.parseStatus = 'parsed';
      version.parsedAt = new Date();
      await this.versionRepo.save(version);
      this.logger.log(`解析成功 version=${versionId} chars=${stripped.length}`);
    } finally {
      await this.redis.del(`parse:lock:${versionId}`);
    }
  }

  private async markFailed(version: RegulationVersion, reason: string) {
    version.parseStatus = 'failed';
    await this.versionRepo.save(version);
    this.logger.warn(`解析失败 version=${version.id}: ${reason}`);
  }

  /**
   * content_html 服务端白名单净化（07 册 4.3.2）：
   * 仅保留语义标签；剥离 script/iframe/style/on* 事件/javascript: 协议；
   * data:image/ 图片放行且单图 base64 ≤ 2MB、总数 ≤ 50；<a> 强制 rel="noopener noreferrer" 并移除 target。
   */
  private sanitize(html: string): string {
    const imgMatches: string[] = html.match(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g) || [];
    const oversized = imgMatches.filter((m) => m.length > 2 * 1024 * 1024).length;
    if (imgMatches.length > 50 || oversized > 0) {
      // 超限：剥离全部内嵌图片，保留文字结构（防 MEDIUMTEXT 撑爆与浏览器内存放大）
      html = html.replace(/<img[^>]*>/gi, '');
    }
    return sanitizeHtml(html, {
      allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'strong', 'em', 'b', 'i', 'u', 'br', 'hr', 'blockquote', 'span', 'a', 'img', 'caption'],
      allowedAttributes: {
        a: ['href'],
        img: ['src', 'alt'],
        span: ['style'],
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan'],
      },
      allowedSchemes: ['http', 'https', 'data'],
      allowedSchemesByTag: { img: ['data'] },
      transformTags: {
        a: (tagName, attribs) => {
          const out: Record<string, string> = { rel: 'noopener noreferrer' }; // 强制注入（07 册 4.3.2）
          if (attribs.href && attribs.href.startsWith('http')) out.href = attribs.href; // 内网部署：仅放行 http(s) 外链
          return { tagName: 'a', attribs: out };
        },
      },
      allowedStyles: {
        span: { 'text-align': [/^(left|center|right|justify)$/] },
      },
    });
  }
}
