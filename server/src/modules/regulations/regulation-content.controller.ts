import { Controller, Get, Param, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';
import { Readable } from 'node:stream';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Errors, RoleEnum } from '../../common/errors';
import { SkipEnvelope } from '../../common/response.interceptor';
import { SysUser } from '../../entities/sys-user.entity';
import { ContentService } from './content.service';
import { RegulationVersionService } from './regulation-version.service';

/** Legacy learner-only regulation content. Management mutations live nowhere in the slimmed application. */
@Controller('regulations')
export class RegulationContentController {
  constructor(
    private readonly content: ContentService,
    private readonly versions: RegulationVersionService,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
  ) {}

  private async learnerContext(user: AuthUser): Promise<{ id: number; role: string; departmentId: string | null }> {
    if (user.role === RoleEnum.SUPER_ADMIN) {
      return { id: user.id, role: user.role, departmentId: null };
    }
    const account = await this.userRepo.findOne({ where: { id: String(user.id) } });
    return { id: user.id, role: RoleEnum.EMPLOYEE, departmentId: account?.departmentId ?? null };
  }

  @Get(':id/content')
  async readContent(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.content.readingContent(id, await this.learnerContext(user), false);
  }

  @Get(':id/content/file')
  @SkipEnvelope()
  async readFile(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const metadata = await this.content.readingContent(id, await this.learnerContext(user), false);
    if (!metadata.file_download_url) throw Errors.contentInvisible('该版本无 PDF 文件');
    const { stream, size } = await this.versions.openFileStream(id, String(metadata.version_id));
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(size));
    this.pipeFileStream(response, stream);
  }

  private pipeFileStream(response: Response, stream: Readable): void {
    response.on('close', () => stream.destroy());
    stream.on('error', () => {
      if (response.headersSent) response.destroy();
      else response.status(500).json({ code: 50001, message: '文件读取失败', data: null });
    });
    stream.pipe(response);
  }
}
