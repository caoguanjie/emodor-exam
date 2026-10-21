import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { AppConfig } from '../../config/configuration';

const execFileAsync = promisify(execFile);

export interface PdfVisionPageGroup {
  startPage: number;
  endPage: number;
  images: string[];
}

export interface PdfVisionDocument {
  pageCount: number;
  groupCount: number;
  renderGroup(index: number): Promise<PdfVisionPageGroup>;
  cleanup(): Promise<void>;
}

/**
 * 扫描版 PDF 的多模态输入适配器。
 *
 * OpenAI 兼容的 chat/completions 通常不直接接收 application/pdf，
 * 因此这里用 Poppler 将 PDF 页面渲染成 PNG data URL，再由 AI 网关
 * 以 image_url 内容块发送给支持视觉输入的模型。
 */
@Injectable()
export class PdfVisionService {
  constructor(private readonly config: AppConfig) {}

  shouldUseVision(version: RegulationVersion, text: string): boolean {
    if (!this.config.ai.multimodalEnabled || version.fileType !== 'pdf') return false;
    const chars = (text || '').replace(/\s/g, '').length;
    return chars < this.config.ai.multimodalTriggerChars;
  }

  async prepare(version: RegulationVersion): Promise<PdfVisionDocument> {
    const pdfPath = this.resolveUploadPath(version.filePath);
    const tempDir = await this.createTempDir();
    try {
      const pageCount = await this.readPageCount(pdfPath);
      if (pageCount < 1) throw new Error('PDF 没有可读取的页面');
      if (pageCount > this.config.ai.multimodalMaxPages) {
        throw new Error(`PDF 页数 ${pageCount} 超过多模态出题上限 ${this.config.ai.multimodalMaxPages}`);
      }

      const pagesPerGroup = this.config.ai.multimodalPagesPerRequest;
      const groupCount = Math.ceil(pageCount / pagesPerGroup);
      return {
        pageCount,
        groupCount,
        renderGroup: async (index: number) => {
          if (!Number.isInteger(index) || index < 0 || index >= groupCount) {
            throw new Error(`PDF 页面分组索引越界：${index}`);
          }
          const startPage = index * pagesPerGroup + 1;
          const endPage = Math.min(pageCount, startPage + pagesPerGroup - 1);
          return this.renderGroup(pdfPath, tempDir, index, startPage, endPage);
        },
        cleanup: async () => {
          await rm(tempDir, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw this.normalizeToolError(error);
    }
  }

  private async createTempDir(): Promise<string> {
    const { mkdtemp } = await import('node:fs/promises');
    return mkdtemp(join(tmpdir(), 'ruleexam-ai-pdf-'));
  }

  private resolveUploadPath(filePath: string): string {
    const root = resolve(this.config.upload.dir);
    const absolute = resolve(root, filePath);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
      throw new Error('制度文件路径越界，无法进行多模态解析');
    }
    return absolute;
  }

  private async readPageCount(pdfPath: string): Promise<number> {
    await stat(pdfPath);
    try {
      const { stdout } = await execFileAsync('pdfinfo', [pdfPath], {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      });
      const match = String(stdout).match(/^Pages:\s+(\d+)/m);
      const pageCount = match ? Number(match[1]) : 0;
      if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('无法读取 PDF 页数');
      return pageCount;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new Error('多模态 PDF 需要 Poppler，请先安装 pdfinfo 和 pdftoppm');
      }
      throw error;
    }
  }

  private async renderGroup(
    pdfPath: string,
    tempDir: string,
    index: number,
    startPage: number,
    endPage: number,
  ): Promise<PdfVisionPageGroup> {
    const prefix = join(tempDir, `group-${index}`);
    const prefixName = basename(prefix);
    let files: string[] = [];
    try {
      await execFileAsync('pdftoppm', [
        '-png',
        '-r',
        String(this.config.ai.multimodalDpi),
        '-f',
        String(startPage),
        '-l',
        String(endPage),
        pdfPath,
        prefix,
      ], {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });

      files = (await readdir(tempDir))
        .filter((name) => name.startsWith(`${prefixName}-`) && name.endsWith('.png'))
        .sort((a, b) => this.pageNumber(a) - this.pageNumber(b));
      const expected = endPage - startPage + 1;
      if (files.length !== expected) {
        throw new Error(`PDF 页面渲染不完整：期望 ${expected} 页，实际 ${files.length} 页`);
      }

      const images: string[] = [];
      for (const file of files) {
        const path = join(tempDir, file);
        const info = await stat(path);
        if (info.size > this.config.ai.multimodalMaxImageBytes) {
          throw new Error(`第 ${this.pageNumber(file)} 页图片过大，请降低 AI_MULTIMODAL_DPI`);
        }
        const image = await readFile(path);
        images.push(`data:image/png;base64,${image.toString('base64')}`);
      }
      return { startPage, endPage, images };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new Error('多模态 PDF 需要 Poppler，请先安装 pdfinfo 和 pdftoppm');
      }
      throw this.normalizeToolError(error);
    } finally {
      await Promise.all(files.map((file) => rm(join(tempDir, file), { force: true })));
    }
  }

  private pageNumber(file: string): number {
    const match = file.match(/-(\d+)\.png$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  private normalizeToolError(error: any): Error {
    if (error?.code === 'ENOENT') {
      return new Error('多模态 PDF 需要 Poppler，请先安装 pdfinfo 和 pdftoppm');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
