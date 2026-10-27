import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { ArrayMinSize, IsArray, IsInt } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors, RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';
import { SkipEnvelope } from '../../common/response.interceptor';
import { AiQuestionImportService } from './ai-question-import.service';
import type { AiImportContentPatch } from './question-import.service';
import type { QuestionImportFormat } from './question-import-format';

class AiImportCommitDto {
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) row_numbers!: number[];
}

function keys(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param('请求参数必须是对象');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw Errors.param('请求包含不支持的字段');
  return body;
}

function formatOf(value: unknown): QuestionImportFormat {
  if (value !== 'xlsx' && value !== 'txt') throw Errors.param('format 必须是 xlsx 或 txt');
  return value;
}

function categoryIdOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw Errors.param('category_id 非法');
  return value;
}

function rowOf(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 2) throw Errors.param('行号非法');
  return Number(value);
}

@Controller('admin/questions')
@Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
export class AiQuestionImportController {
  constructor(private readonly importer: AiQuestionImportService) {}

  @Post('ai-import-tasks')
  @Permissions('ai:write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async start(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file?.buffer) throw Errors.param('缺少上传文件');
    try {
      const values = keys(body, ['format', 'category_id']);
      return await this.importer.start(
        String(user.id),
        file.buffer,
        formatOf(values.format),
        categoryIdOf(values.category_id),
      );
    } finally {
      file.buffer.fill(0);
    }
  }

  @Get('ai-import-tasks/:id')
  @Permissions('ai:read')
  status(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.importer.status(String(user.id), id);
  }

  @Get('ai-import-batches/:id')
  @Permissions('ai:read')
  batch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.importer.readBatch(String(user.id), id);
  }

  @Post('ai-import-batches/:id/commit')
  @Permissions('questions:write')
  commit(
    @Param('id') id: string,
    @Body(new StrictDtoValidationPipe(['row_numbers'])) body: AiImportCommitDto,
    @CurrentUser() user: AuthUser, @Req() req: Request,
  ) {
    keys(req.body, ['row_numbers']);
    return this.importer.commit(String(user.id), id, body.row_numbers);
  }

  @Patch('ai-import-batches/:id/rows/:row')
  @Permissions('ai:write')
  update(
    @Param('id') id: string, @Param('row') row: string,
    @Body() body: AiImportContentPatch, @CurrentUser() user: AuthUser,
  ) {
    keys(body, ['stem', 'options', 'answer', 'analysis']);
    return this.importer.updateRow(String(user.id), id, rowOf(row), body);
  }

  @Post('ai-import-batches/:id/rows/:row/regenerate')
  @Permissions('ai:write')
  regenerate(
    @Param('id') id: string, @Param('row') row: string,
    @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser,
  ) {
    keys(body || {}, []);
    return this.importer.regenerateRow(String(user.id), id, rowOf(row));
  }

  @Get('ai-import-batches/:id/download')
  @Permissions('ai:read')
  @SkipEnvelope()
  async download(
    @Param('id') id: string, @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser, @Res() res: Response,
  ) {
    const values = keys(query, ['format']);
    const format = formatOf(values.format);
    const buffer = await this.importer.download(String(user.id), id, format);
    res.setHeader('Content-Type', format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ai-question-import.${format}"`);
    res.end(buffer);
  }
}
