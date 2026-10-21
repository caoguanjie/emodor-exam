import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';
import { ExamMonitorService } from './exam-monitor.service';

const QueryNumber = () => Transform(({ value }) => (
  value === undefined || value === null || value === '' ? undefined : Number(value)
));

export class ExamRecordListQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1)
  page?: number;

  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(TRAINING_DEFAULTS.maxPageSize)
  page_size?: number;

  @IsOptional() @IsString() @MaxLength(128)
  keyword?: string;

  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/)
  paper_id?: string;

  @IsOptional() @IsIn(['institution', 'external'])
  source?: string;

  @IsOptional() @IsIn(['easy', 'medium', 'hard', 'mixed', 'unknown'])
  difficulty?: string;

  @IsOptional() @IsIn(['in_progress', 'submitted', 'passed', 'failed', 'timeout'])
  status?: string;

  @IsOptional() @IsIn(['not_submitted', 'pending_manual', 'finalized'])
  grading_state?: string;
}

export class ExamMonitorPageQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1)
  page?: number;

  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(TRAINING_DEFAULTS.maxPageSize)
  page_size?: number;
}

export class ExamMonitorOptionsQueryDto extends ExamMonitorPageQueryDto {
  @IsOptional() @IsString() @MaxLength(128)
  keyword?: string;
}

const RECORD_QUERY_KEYS = [
  'page', 'page_size', 'keyword', 'paper_id', 'source', 'difficulty', 'status', 'grading_state',
] as const;
const MONITOR_QUERY_KEYS = ['page', 'page_size'] as const;
const MONITOR_OPTIONS_QUERY_KEYS = ['page', 'page_size', 'keyword'] as const;

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
  constructor(private readonly monitorService: ExamMonitorService) {}

  @Get('exam-records')
  @Permissions('exam_records:read')
  records(
    @CurrentUser() user: AuthUser,
    @Query(new StrictDtoValidationPipe(RECORD_QUERY_KEYS)) query: ExamRecordListQueryDto,
    @Req() request: Request,
  ) {
    assertQueryKeys(request, RECORD_QUERY_KEYS, '考试记录查询');
    return this.monitorService.listRecords(String(user.id), query);
  }

  @Get('exam-records/:id')
  @Permissions('exam_records:read')
  record(@Param('id') recordId: string, @CurrentUser() user: AuthUser) {
    return this.monitorService.detail(String(user.id), positiveId(recordId, 'record_id'));
  }

  @Get('exams/monitor-options')
  @Permissions('exam_records:monitor')
  monitorOptions(
    @CurrentUser() user: AuthUser,
    @Query(new StrictDtoValidationPipe(MONITOR_OPTIONS_QUERY_KEYS)) query: ExamMonitorOptionsQueryDto,
    @Req() request: Request,
  ) {
    assertQueryKeys(request, MONITOR_OPTIONS_QUERY_KEYS, '监控试卷查询');
    return this.monitorService.paperOptions(String(user.id), query);
  }

  @Get('exams/:id/monitor')
  @Permissions('exam_records:monitor')
  monitor(
    @Param('id') paperId: string,
    @CurrentUser() user: AuthUser,
    @Query(new StrictDtoValidationPipe(MONITOR_QUERY_KEYS)) query: ExamMonitorPageQueryDto,
    @Req() request: Request,
  ) {
    assertQueryKeys(request, MONITOR_QUERY_KEYS, '考试监控查询');
    return this.monitorService.list(
      String(user.id),
      positiveId(paperId, 'paper_id'),
      query.page || 1,
      query.page_size || TRAINING_DEFAULTS.pageSize,
    );
  }
}
