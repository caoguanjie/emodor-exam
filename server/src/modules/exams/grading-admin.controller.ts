import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';
import { ExamHistoryService } from './exam-history.service';
import { GradingQueueDto, ManualScoreDto } from './grading.dto';
import { ManualGradingService } from './manual-grading.service';

@Controller('admin')
export class GradingAdminController {
  constructor(
    private readonly grading: ManualGradingService,
    private readonly history: ExamHistoryService,
  ) {}

  @Get('grading')
  @Permissions('exam_records:review')
  queue(@CurrentUser() user: AuthUser, @Query(new DtoValidationPipe()) query: GradingQueueDto) {
    return this.grading.queue(String(user.id), {
      page: query.page || 1,
      pageSize: query.page_size || TRAINING_DEFAULTS.pageSize,
      paperId: query.paper_id,
      source: query.source,
      state: query.status,
    });
  }

  @Put('exam-records/:id/grades/:itemId')
  @Permissions('exam_records:review')
  score(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new DtoValidationPipe()) dto: ManualScoreDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.grading.score(String(user.id), String(id), String(itemId), {
      scoreCents: dto.score_cents,
      comment: dto.comment,
      expectedVersion: dto.expected_version,
    });
  }

  // C5 may additionally authorize exam_records:read. The service deliberately
  // evaluates the OR policy; declaring review here would turn it into AND.
  @Get('exam-records/:id/result')
  result(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.history.adminResult(String(user.id), String(id));
  }
}
