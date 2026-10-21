import {
  Body, Controller, Delete, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { SkipEnvelope } from '../../common/response.interceptor';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { AccessService } from '../access/access.service';
import { MediaService, type MediaUploadPurpose } from './media.service';

class MediaUploadDto {
  @IsString() @IsIn(['avatar', 'course_cover', 'video', 'question', 'branding']) purpose!: MediaUploadPurpose;
  @IsOptional() @IsString() @MaxLength(32) owner_id?: string;
}

function assertBodyKeys(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Errors.param('上传参数必须是对象');
  const unknown = Object.keys(body as object).filter((key) => !['purpose', 'owner_id'].includes(key));
  if (unknown.length) throw Errors.param(`上传请求包含不支持的字段：${unknown.join(',')}`);
}

function uploadTempRoot(): string {
  const root = process.env.UPLOAD_DIR || './data/uploads';
  const path = join(root, 'tmp', 'media');
  mkdirSync(path, { recursive: true });
  return path;
}

@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly access: AccessService,
  ) {}

  @Get('limits')
  limits() {
    return this.media.limits();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, callback) => callback(null, uploadTempRoot()),
      filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`),
    }),
    // The service applies the configured image limit and the exact video limit.
    // Multer itself stays bounded at the maximum supported video size.
    limits: { fileSize: 512 * 1024 * 1024 },
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new StrictDtoValidationPipe(['purpose', 'owner_id'])) dto: MediaUploadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertBodyKeys(req.body);
    if (!file) throw Errors.param('缺少上传文件');
    const actorId = String(user.id);
    const ownerId = dto.owner_id ? String(dto.owner_id) : actorId;
    if (ownerId !== actorId) {
      if (dto.purpose !== 'avatar') throw Errors.forbidden('只能为本人上传该媒体用途');
      // The final managed-student boundary is repeated by UsersService during
      // avatar bind. This check only protects the generic upload endpoint.
      await this.access.assertAllowed(actorId, 'students:write');
    } else if (dto.purpose !== 'avatar') {
      await this.access.assertAllowed(actorId, 'media:write');
    }
    const result = await this.media.upload(actorId, dto.purpose, file, ownerId);
    return {
      asset_id: result.assetId,
      status: result.status,
      duration_ms: result.durationMs,
    };
  }

  @Get(':id')
  async metadata(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.media.metadata(String(user.id), id);
  }

  @Get(':id/content')
  @SkipEnvelope()
  async content(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request, @Res() res: Response) {
    const descriptor = await this.media.openContent(String(user.id), id, req.headers.range);
    const start = descriptor.range?.start ?? 0;
    const end = descriptor.range?.end ?? descriptor.size - 1;
    res.status(descriptor.range ? 206 : 200);
    res.setHeader('Content-Type', descriptor.asset.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(end - start + 1));
    res.setHeader('Cache-Control', 'private, no-store');
    if (descriptor.range) res.setHeader('Content-Range', `bytes ${start}-${end}/${descriptor.size}`);
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(descriptor.path, { acceptRanges: true }, (error) => {
      if (error && !res.headersSent) res.status(404).end();
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.media.remove(String(user.id), id);
    return null;
  }
}
