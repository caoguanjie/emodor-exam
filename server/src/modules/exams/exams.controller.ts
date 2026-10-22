import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ExamService } from './exam.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';

/** 单题作答元素：嵌套校验拦截恶意载荷（对齐 ai.controller 口径），防 selected 非数组穿透判分层抛 50001 */
class ExamAnswerItemDto {
  @Type(() => Number) @IsInt() question_id!: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) selected?: number[];
}

class HeartbeatAnswersDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExamAnswerItemDto)
  answers?: ExamAnswerItemDto[];
}

class SubmitDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ExamAnswerItemDto)
  answers!: ExamAnswerItemDto[];
}

/** /exams 考试评分模块（04 册 3.7，数据范围自动收口为本人） */
@Controller('exams')
export class ExamsController {
  constructor(private readonly exams: ExamService) {}

  @Get('papers')
  listPapers(@CurrentUser() user: AuthUser) {
    return this.exams.listAvailablePapers(user.id);
  }

  @Post('papers/:id/start')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.exams.start(id, user.id);
  }

  @Get('records')
  myRecords(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.exams.myRecords(user.id, query);
  }

  @Get('records/:id')
  recover(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.exams.recover(id, user.id);
  }

  @Post('records/:id/heartbeat')
  heartbeat(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: HeartbeatAnswersDto, @CurrentUser() user: AuthUser) {
    return this.exams.heartbeat(id, user.id, dto.answers || []);
  }

  @Post('records/:id/submit')
  submit(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: SubmitDto, @CurrentUser() user: AuthUser) {
    return this.exams.submit(id, user.id, dto.answers);
  }

  @Get('records/:id/result')
  result(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.exams.result(id, user.id, user.role);
  }
}
