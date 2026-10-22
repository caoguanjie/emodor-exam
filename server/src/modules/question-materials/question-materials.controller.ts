import {
  Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { QuestionMaterialsService } from './question-materials.service';

const QueryNumber = () => Transform(({ value }) => (
  value === undefined || value === null || value === '' ? undefined : Number(value)
));

class QuestionMaterialListQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

class CreateQuestionMaterialDto {
  @IsString() @MinLength(1) @MaxLength(128) title!: string;
  @IsOptional() @IsString() @MaxLength(512) description?: string;
}

const LIST_KEYS = ['page', 'page_size', 'keyword'] as const;
const CREATE_KEYS = ['title', 'description'] as const;

function assertKeys(value: unknown, allowed: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label} 包含不支持的字段：${unknown.join(',')}`);
}

@Controller('admin/question-materials')
export class QuestionMaterialsController {
  constructor(private readonly materials: QuestionMaterialsService) {}

  @Get()
  @Permissions('ai:read')
  list(
    @Query(new StrictDtoValidationPipe(LIST_KEYS)) query: QuestionMaterialListQueryDto,
    @Req() request: Request,
  ) {
    assertKeys(request.query, LIST_KEYS, '资料查询');
    return this.materials.list(query);
  }

  @Post()
  @Permissions('ai:write')
  create(
    @Body(new StrictDtoValidationPipe(CREATE_KEYS)) body: CreateQuestionMaterialDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    assertKeys(request.body, CREATE_KEYS, '资料请求');
    return this.materials.create(body, { id: user.id, name: user.username }, request.ip || null);
  }

  @Get(':id')
  @Permissions('ai:read')
  detail(@Param('id') id: string) {
    return this.materials.detail(id);
  }

  @Post(':id/versions')
  @Permissions('ai:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    if (!file) throw Errors.param('缺少上传文件');
    return this.materials.upload(id, file, { id: user.id, name: user.username }, request.ip || null);
  }

  @Get(':id/versions/:versionId/status')
  @Permissions('ai:read')
  status(@Param('id') id: string, @Param('versionId') versionId: string) {
    return this.materials.status(id, versionId);
  }

  @Post(':id/versions/:versionId/retry')
  @Permissions('ai:write')
  retry(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.materials.retry(id, versionId, { id: user.id, name: user.username }, request.ip || null);
  }
}
