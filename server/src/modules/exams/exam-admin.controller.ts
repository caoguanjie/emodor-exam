import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';
import { ExamHistoryService } from './exam-history.service';
import { ExamRecordsService, type ExamRecordResultStatus } from './exam-records.service';

const QueryNumber = () => Transform(({ value }) => (
  value === undefined || value === null || value === '' ? undefined : Number(value)
));

export class ExamRecordPurposeQueryDto {
  @IsOptional() @IsIn(['formal', 'practice'])
  exam_purpose?: import('../../common/training-contracts').ExamPurpose;
}

export class ExamRecordListQueryDto {
  @IsOptional() @IsIn(['formal', 'practice'])
  exam_purpose?: import('../../common/training-contracts').ExamPurpose;

  @IsOptional() @QueryNumber() @IsInt() @Min(1)
  page?: number;

  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(TRAINING_DEFAULTS.maxPageSize)
  page_size?: number;

  @IsOptional() @IsString() @MaxLength(128)
  keyword?: string;

  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/)
  paper_id?: string;

  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/)
  user_id?: string;

  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/)
  category_id?: string;

  @IsOptional() @IsIn(['institution', 'external'])
  source?: string;

  @IsOptional() @IsIn(['easy', 'medium', 'hard', 'mixed', 'unknown'])
  difficulty?: string;

  @IsOptional() @IsIn(['in_progress', 'submitted', 'passed', 'failed', 'timeout'])
  status?: string;

  @IsOptional() @IsIn(['not_submitted', 'finalized'])
  grading_state?: string;

  @IsOptional() @IsIn(['in_progress', 'passed', 'failed', 'timeout'])
  result_status?: ExamRecordResultStatus;

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date_from?: string;

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date_to?: string;
}

const RECORD_QUERY_KEYS = [
  'page', 'page_size', 'keyword', 'paper_id', 'source', 'difficulty', 'status', 'grading_state',
  'exam_purpose', 'user_id', 'category_id', 'result_status', 'date_from', 'date_to',
] as const;

function assertQueryKeys(request: Request, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(request.query || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label}包含不支持的字段：${unknown.join(',')}`);
}

function positiveId(value: string, label: string): string {
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) throw Errors.param(`${label}必须是字符串 ID`);
  return normalized;
}

@Controller('admin')
export class ExamAdminController {
  constructor(
    private readonly recordsService: ExamRecordsService,
    private readonly historyService: ExamHistoryService,
  ) {}

  @Get('exam-records')
  @Permissions('exam_records:read')
  records(
    @CurrentUser() user: AuthUser,
    @Query(new StrictDtoValidationPipe(RECORD_QUERY_KEYS)) query: ExamRecordListQueryDto,
    @Req() request: Request,
  ) {
    assertQueryKeys(request, RECORD_QUERY_KEYS, '考试记录查询');
    return this.recordsService.list(String(user.id), query);
  }

  @Get('exam-records/options')
  @Permissions('exam_records:read')
  options(@CurrentUser() user: AuthUser, @Query(new StrictDtoValidationPipe(['exam_purpose'])) query: ExamRecordPurposeQueryDto = {}) {
    return this.recordsService.options(String(user.id), query.exam_purpose);
  }

  @Get('exam-records/:id')
  @Permissions('exam_records:read')
  record(@Param('id') recordId: string, @CurrentUser() user: AuthUser) {
    return this.recordsService.detail(String(user.id), positiveId(recordId, 'record_id'));
  }

  @Get('exam-records/:id/result')
  @Permissions('exam_records:read')
  async result(@Param('id') recordId: string, @CurrentUser() user: AuthUser) {
    const actorId = String(user.id);
    const id = positiveId(recordId, 'record_id');
    await this.recordsService.detail(actorId, id);
    return this.historyService.adminResult(actorId, id);
  }
}
