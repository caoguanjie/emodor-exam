import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { AnswerDraftService } from './answer-draft.service';
import { AttemptHeartbeatDto, DraftInputDto, SubmitAttemptDto } from './attempt.dto';
import { AttemptService } from './attempt.service';
import { SubmissionService } from './submission.service';

class AttemptPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(TRAINING_DEFAULTS.maxPageSize)
  page_size?: number;
}

@Controller('me')
export class TrainingExamsController {
  constructor(
    private readonly attempts: AttemptService,
    private readonly drafts: AnswerDraftService,
    private readonly submissions: SubmissionService,
  ) {}

  @Get('exams')
  list(@CurrentUser() user: AuthUser, @Query(new DtoValidationPipe()) query: AttemptPageDto) {
    return this.attempts.list(
      String(user.id),
      query.page || 1,
      query.page_size || TRAINING_DEFAULTS.pageSize,
    );
  }

  @Post('exams/:id/start')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.attempts.start(String(user.id), String(id));
  }

  @Get('exam-records/:id')
  recover(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.attempts.recover(String(user.id), String(id));
  }

  @Put('exam-records/:id/draft')
  saveDraft(
    @Param('id') id: string,
    @Body(new DtoValidationPipe()) dto: DraftInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.drafts.save(String(user.id), String(id), dto);
  }

  @Post('exam-records/:id/heartbeat')
  heartbeat(
    @Param('id') id: string,
    @Body(new DtoValidationPipe()) dto: AttemptHeartbeatDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.submissions.heartbeat(String(user.id), String(id), dto.device_summary);
  }

  @Post('exam-records/:id/switch')
  switchReport(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.submissions.reportSwitch(String(user.id), String(id));
  }

  @Post('exam-records/:id/submit')
  submit(
    @Param('id') id: string,
    @Body(new DtoValidationPipe()) dto: SubmitAttemptDto,
    @CurrentUser() user: AuthUser,
  ) {
    const draft = dto?.draft();
    if (draft === null) throw Errors.param('revision 与 answers 必须同时提供');
    return this.submissions.submit(String(user.id), String(id), draft);
  }

  @Get('exam-records/:id/result')
  result(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.submissions.result(String(user.id), String(id));
  }
}
