import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { SkipEnvelope } from '../../common/response.interceptor';
import { TrainingStatisticsService } from './training-statistics.service';
import { TRAINING_STATISTICS_QUERY_KEYS, TrainingStatisticsQueryDto } from './training-statistics.dto';

function assertQueryKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param('统计查询必须是对象');
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`统计查询包含不支持的字段：${unknown.join(',')}`);
}

@Controller('statistics/training')
export class TrainingStatisticsController {
  constructor(private readonly statistics: TrainingStatisticsService, private readonly audit: AuditService) {}

  @Get('options')
  @Permissions('statistics:read')
  options(@Req() req: Request) {
    assertQueryKeys(req.query, []);
    return this.statistics.options();
  }

  @Get('summary')
  @Permissions('statistics:read')
  summary(
    @Query(new StrictDtoValidationPipe(TRAINING_STATISTICS_QUERY_KEYS)) query: TrainingStatisticsQueryDto,
    @Req() req: Request,
  ) {
    assertQueryKeys(req.query, TRAINING_STATISTICS_QUERY_KEYS);
    return this.statistics.examSummary(query.toFilter());
  }

  @Get('ranking')
  @Permissions('statistics:read')
  ranking(
    @Query(new StrictDtoValidationPipe(TRAINING_STATISTICS_QUERY_KEYS)) query: TrainingStatisticsQueryDto,
    @Req() req: Request,
  ) {
    assertQueryKeys(req.query, TRAINING_STATISTICS_QUERY_KEYS);
    return this.statistics.ranking(query.toFilter());
  }

  @Get('export')
  @Permissions('statistics:export')
  @SkipEnvelope()
  async export(
    @Query(new StrictDtoValidationPipe(TRAINING_STATISTICS_QUERY_KEYS)) query: TrainingStatisticsQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    assertQueryKeys(req.query, TRAINING_STATISTICS_QUERY_KEYS);
    const filter = query.toFilter();
    const buffer = await this.statistics.export(filter);
    this.audit.log({
      actor_id: user.id,
      actor_name: user.username,
      action: 'statistics.training.export',
      object_type: 'exam_paper',
      object_id: filter.paperId,
      detail: {
        category_id: filter.categoryId || null,
        source: filter.source || null,
        difficulty: filter.difficulty || null,
        page: filter.page,
        page_size: filter.pageSize,
      },
      result: 'success',
      source_ip: req.ip || null,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('培训考试难度排名.xlsx')}"`);
    res.end(buffer);
  }
}

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly statistics: TrainingStatisticsService) {}

  @Get()
  dashboard(@CurrentUser() user: AuthUser, @Req() req: Request) {
    assertQueryKeys(req.query, []);
    return this.statistics.dashboard(String(user.id));
  }
}
