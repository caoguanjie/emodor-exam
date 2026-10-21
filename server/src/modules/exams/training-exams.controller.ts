import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';
import { AttemptService } from './attempt.service';

class AttemptPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(TRAINING_DEFAULTS.maxPageSize)
  page_size?: number;
}

@Controller('me')
export class TrainingExamsController {
  constructor(private readonly attempts: AttemptService) {}

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
}
