import {
  Body, Controller, Delete, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { SkipEnvelope } from '../../common/response.interceptor';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { MediaService } from './media.service';
import { sendMediaContent } from './media-content.response';
import { MEDIA_UPLOAD_PURPOSES, type MediaUploadPurpose } from './media-policy';
import { MediaUploadInterceptor } from './media-upload.interceptor';

class MediaUploadDto {
  @IsString() @IsIn([...MEDIA_UPLOAD_PURPOSES]) purpose!: MediaUploadPurpose;
  @IsOptional() @IsString() @MaxLength(32) owner_id?: string;
}

function assertBodyKeys(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Errors.param('上传参数必须是对象');
  const unknown = Object.keys(body as object).filter((key) => !['purpose', 'owner_id'].includes(key));
  if (unknown.length) throw Errors.param(`上传请求包含不支持的字段：${unknown.join(',')}`);
}

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('limits')
  limits() {
    return this.media.limits();
  }

  @Post('upload')
  @UseInterceptors(MediaUploadInterceptor())
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new StrictDtoValidationPipe(['purpose', 'owner_id'])) dto: MediaUploadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertBodyKeys(req.body);
    if (!file) throw Errors.param('缺少上传文件');
    const actorId = String(user.id);
    const { ownerId } = await this.media.assertUploadAllowed(user, dto.purpose, dto.owner_id);
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
    sendMediaContent(res, descriptor);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.media.remove(String(user.id), id);
    return null;
  }
}
