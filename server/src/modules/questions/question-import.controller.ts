import {
  Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors, RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';
import { SkipEnvelope } from '../../common/response.interceptor';
import { ImportBatchService } from '../imports/import-batch.service';
import type { QuestionImportFormat, QuestionImportTemplatePurpose } from './question-import-format';
import { QuestionImportService } from './question-import.service';

class ImportFormatQueryDto {
  @IsIn(['xlsx', 'txt']) format!: QuestionImportFormat;
  @IsOptional() @IsIn(['ai']) purpose?: 'ai';
}

class QuestionImportCommitDto {
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) row_numbers!: number[];
}

function assertKeys(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label} 必须是对象`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label} 包含不支持的字段：${unknown.join(',')}`);
  return record;
}

function formatOf(value: unknown): QuestionImportFormat {
  if (value !== 'xlsx' && value !== 'txt') throw Errors.param('format 必须是 xlsx 或 txt');
  return value;
}

function purposeOf(value: unknown): QuestionImportTemplatePurpose {
  if (value === undefined || value === '') return 'human';
  if (value !== 'ai') throw Errors.param('purpose 必须是 ai');
  return value;
}

function defaultsOf(body: Record<string, unknown>): { categoryId: string } {
  if (body.category_id === undefined || body.category_id === '') throw Errors.param('category_id 必填');
  const categoryId = String(body.category_id);
  if (!/^[1-9]\d*$/.test(categoryId)) throw Errors.param('category_id 非法');
  return { categoryId };
}

@Controller('admin/questions')
@Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
export class QuestionImportController {
  constructor(
    private readonly importer: QuestionImportService,
    private readonly batches: ImportBatchService,
  ) {}

  @Get('import-template')
  @Permissions('questions:write')
  @SkipEnvelope()
  async template(
    @Query(new StrictDtoValidationPipe(['format', 'purpose'])) query: ImportFormatQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    assertKeys(req.query, ['format', 'purpose'], '模板查询');
    const format = formatOf(query.format);
    const purpose = purposeOf(query.purpose);
    const buffer = await this.importer.buildTemplate(format, purpose);
    res.setHeader('Content-Type', format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="question-import-template.${format}"`);
    res.end(buffer);
  }

  @Get('import-batches/:id')
  @Permissions('questions:write')
  status(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.importer.readBatch(String(user.id), id);
  }

  @Post('import-preview')
  @Permissions('questions:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!file?.buffer) throw Errors.param('缺少上传文件');
    const values = assertKeys(req.body || body || {}, ['format', 'category_id'], '导入请求');
    return this.importer.preview(
      String(user.id),
      file.buffer,
      formatOf(values.format),
      defaultsOf(values),
    );
  }

  @Post('import-batches/:id/commit')
  @Permissions('questions:write')
  commit(
    @Param('id') id: string,
    @Body(new StrictDtoValidationPipe(['row_numbers'])) body: QuestionImportCommitDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, ['row_numbers'], '导入确认请求');
    return this.batches.commitQuestions(String(user.id), id, body.row_numbers);
  }
}
