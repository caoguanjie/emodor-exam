import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { SkipEnvelope } from '../../common/response.interceptor';
import { TrainingStatisticsService } from './training-statistics.service';
import { AdminDashboardService } from './admin-dashboard.service';
import {
  DASHBOARD_LEARNING_OPTIONS_QUERY_KEYS, DASHBOARD_LEARNING_SUMMARY_QUERY_KEYS, DASHBOARD_TREND_QUERY_KEYS,
  DashboardLearningOptionsQueryDto, DashboardLearningSummaryQueryDto, DashboardTrendQueryDto,
} from './admin-dashboard.dto';
import {
  TRAINING_STATISTICS_OVERVIEW_QUERY_KEYS, TRAINING_STATISTICS_QUERY_KEYS,
  TrainingStatisticsOverviewQueryDto, TrainingStatisticsQueryDto,
} from './training-statistics.dto';

function assertQueryKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param('统计查询必须是对象');
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`统计查询包含不支持的字段：${unknown.join(',')}`);
}

@Controller('statistics/training')
export class TrainingStatisticsController {
  constructor(private readonly statistics: TrainingStatisticsService, private readonly audit: AuditService) {}

  @Get('overview')
  @Permissions('statistics:read')
  overview(
    @Query(new StrictDtoValidationPipe(TRAINING_STATISTICS_OVERVIEW_QUERY_KEYS)) query: TrainingStatisticsOverviewQueryDto,
    @Req() req: Request,
  ) {
    assertQueryKeys(req.query, TRAINING_STATISTICS_OVERVIEW_QUERY_KEYS);
    return this.statistics.overview(query.toFilter());
  }

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
        sort_by: filter.sort_by || 'score',
        sort_order: filter.sort_order || 'desc',
        page: filter.page,
        page_size: filter.pageSize,
      },
      result: 'success',
      source_ip: req.ip || null,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('培训考试成绩排名.xlsx')}"`);
    res.end(buffer);
  }
}

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get()
  dashboard(@CurrentUser() user: AuthUser, @Req() req: Request) {
    assertQueryKeys(req.query, []);
    return this.dashboardService.overview(String(user.id));
  }

  @Get('exam-trend')
  @Permissions('statistics:read')
  examTrend(
    @CurrentUser() user: AuthUser,
    @Query(new StrictDtoValidationPipe(DASHBOARD_TREND_QUERY_KEYS)) query: DashboardTrendQueryDto,
    @Req() req: Request,
  ) {
    assertQueryKeys(req.query, DASHBOARD_TREND_QUERY_KEYS);
    return this.dashboardService.examTrend(String(user.id), query.days);
  }

  @Get('learning-options')
  @Permissions('statistics:read')
  learningOptions(
    @CurrentUser() user: AuthUser,
    @Query(new StrictDtoValidationPipe(DASHBOARD_LEARNING_OPTIONS_QUERY_KEYS)) query: DashboardLearningOptionsQueryDto,
    @Req() req: Request,
  ) {
    assertQueryKeys(req.query, DASHBOARD_LEARNING_OPTIONS_QUERY_KEYS);
    return this.dashboardService.learningOptions(String(user.id), query.toFilter());
  }

  @Get('learning-summary')
  @Permissions('statistics:read')
  learningSummary(
    @CurrentUser() user: AuthUser,
    @Query(new StrictDtoValidationPipe(DASHBOARD_LEARNING_SUMMARY_QUERY_KEYS)) query: DashboardLearningSummaryQueryDto,
    @Req() req: Request,
  ) {
    assertQueryKeys(req.query, DASHBOARD_LEARNING_SUMMARY_QUERY_KEYS);
    return this.dashboardService.learningSummary(String(user.id), query.paper_id, query.release_id);
  }

  @Get('recent-exams')
  @Permissions('statistics:read')
  recentExams(@CurrentUser() user: AuthUser, @Req() req: Request) {
    assertQueryKeys(req.query, []);
    return this.dashboardService.recentExams(String(user.id));
  }
}
