import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { AttemptService } from './attempt.service';
import { SubmissionService } from './submission.service';
import { ExamHistoryService } from './exam-history.service';
import { HistoryPageDto } from './grading.dto';
import { readContentCapability } from './question-content-capability';

class AttemptPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(TRAINING_DEFAULTS.maxPageSize)
  page_size?: number;
}

function mobileLearner(user: AuthUser): void { if (user.client !== 'mobile' || user.role !== 'employee') throw Errors.forbidden(); }
function decimalId(value: string): string { if (!/^[1-9]\d*$/.test(value)) throw Errors.param('必须是十进制 ID 字符串'); return value; }

@Controller('me')
export class TrainingExamsController {
  constructor(
    private readonly attempts: AttemptService,
    private readonly submissions: SubmissionService,
    private readonly history: ExamHistoryService,
  ) {}

  @Get('exams')
  list(@CurrentUser() user: AuthUser, @Query(new DtoValidationPipe()) query: AttemptPageDto) {
    mobileLearner(user);
    return this.attempts.list(
      String(user.id),
      query.page || 1,
      query.page_size || TRAINING_DEFAULTS.pageSize,
    );
  }

  @Post('exams/:id/start')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser, @Headers('x-question-content-version') header?: unknown) {
    mobileLearner(user);
    return this.attempts.start(String(user.id), decimalId(id), true, readContentCapability(header));
  }

  @Get('exam-records')
  historyList(@CurrentUser() user: AuthUser, @Query(new DtoValidationPipe()) query: HistoryPageDto) {
    mobileLearner(user);
    return this.history.history(
      String(user.id),
      query.page || 1,
      query.page_size || TRAINING_DEFAULTS.pageSize,
    );
  }

  @Get('wrong-questions')
  wrongQuestions(@CurrentUser() user: AuthUser, @Query(new DtoValidationPipe()) query: HistoryPageDto, @Headers('x-question-content-version') header?: unknown) {
    mobileLearner(user);
    return this.history.wrongItems(
      String(user.id),
      query.page || 1,
      query.page_size || TRAINING_DEFAULTS.pageSize,
      readContentCapability(header),
    );
  }

  @Get('exam-records/:id')
  recover(@Param('id') id: string, @CurrentUser() user: AuthUser, @Headers('x-question-content-version') header?: unknown) {
    mobileLearner(user);
    return this.attempts.recover(String(user.id), decimalId(id), true, readContentCapability(header));
  }

  @Post('exam-records/:id/submit')
  submit(
    @Param('id') id: string,
    @Body() dto: unknown,
    @CurrentUser() user: AuthUser,
    @Headers('x-question-content-version') header?: unknown,
  ) {
    mobileLearner(user);
    return this.submissions.submit(String(user.id), decimalId(id), dto, readContentCapability(header));
  }

  @Get('exam-records/:id/result')
  result(@Param('id') id: string, @CurrentUser() user: AuthUser, @Headers('x-question-content-version') header?: unknown) {
    mobileLearner(user);
    return this.history.result(String(user.id), decimalId(id), readContentCapability(header));
  }
}
