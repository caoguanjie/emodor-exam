import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { LearningSessionService } from './learning-session.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';

class StartSessionDto {
  @IsString() regulation_id!: string;
}

class HeartbeatDto {
  @IsString() session_id!: string;
  @IsOptional() @IsArray() dwell_segments?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(100) scroll_percent?: number;
}

class PauseDto {
  @IsString() session_id!: string;
  @IsOptional() @IsArray() dwell_segments?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(100) scroll_percent?: number;
}

class ResumeDto {
  @IsString() session_id!: string;
}

class EndSessionDto {
  // 收口时顺带 flush 最终段位/滚动进度：前端离开页面时 heartbeat 可能撞 10 秒限流窗，
  // 把最后一次 flush 搭载在幂等的 end 调用上，避免「flush 失败 → end 未执行 → 会话悬挂」
  @IsOptional() @IsArray() dwell_segments?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(100) scroll_percent?: number;
}

/** /learning 学习行为管控模块（04 册 3.6，数据范围自动收口为本人） */
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningSessionService) {}

  @Get('regulations')
  myRegulations(@CurrentUser() user: AuthUser) {
    return this.learning.myRegulations(user.id);
  }

  @Get('records/:regulationId')
  progress(@Param('regulationId') regulationId: string, @CurrentUser() user: AuthUser) {
    return this.learning.progress(regulationId, user.id);
  }

  @Post('sessions/start')
  start(@Body(new DtoValidationPipe()) dto: StartSessionDto, @CurrentUser() user: AuthUser) {
    return this.learning.start(dto.regulation_id, user.id);
  }

  @Post('heartbeat')
  heartbeat(@Body(new DtoValidationPipe()) dto: HeartbeatDto, @CurrentUser() user: AuthUser) {
    return this.learning.heartbeat(dto.session_id, user.id, dto.dwell_segments || [], dto.scroll_percent);
  }

  @Post('heartbeat/pause')
  pause(@Body(new DtoValidationPipe()) dto: PauseDto, @CurrentUser() user: AuthUser) {
    return this.learning.pause(dto.session_id, user.id, dto.dwell_segments || [], dto.scroll_percent);
  }

  @Post('heartbeat/resume')
  resume(@Body(new DtoValidationPipe()) dto: ResumeDto, @CurrentUser() user: AuthUser) {
    return this.learning.resume(dto.session_id, user.id);
  }

  @Post('sessions/:id/end')
  end(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: EndSessionDto, @CurrentUser() user: AuthUser) {
    return this.learning.end(id, user.id, dto.dwell_segments || [], dto.scroll_percent);
  }
}
