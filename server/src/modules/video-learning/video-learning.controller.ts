import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import {
  StartVideoSessionDto,
  VIDEO_HEARTBEAT_KEYS,
  VIDEO_START_KEYS,
  VideoHeartbeatDto,
} from './video-learning.dto';
import { VideoSessionService } from './video-session.service';

function assertKeys(value: unknown, allowed: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label}必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label}包含不支持的字段：${unknown.join(',')}`);
}

function id(value: string, label: string): string {
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) throw Errors.param(`${label}必须是字符串 ID`);
  return normalized;
}

@Controller('me')
export class VideoLearningController {
  constructor(private readonly sessions: VideoSessionService) {}

  @Post('video-sessions')
  start(
    @Body(new StrictDtoValidationPipe(VIDEO_START_KEYS)) dto: StartVideoSessionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, VIDEO_START_KEYS, '视频学习请求');
    return this.sessions.start(String(user.id), dto.lesson_id);
  }

  @Post('video-sessions/:id/heartbeat')
  heartbeat(
    @Param('id') sessionId: string,
    @Body(new StrictDtoValidationPipe(VIDEO_HEARTBEAT_KEYS)) dto: VideoHeartbeatDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, VIDEO_HEARTBEAT_KEYS, '视频心跳请求');
    return this.sessions.heartbeat(String(user.id), id(sessionId, 'session_id'), dto);
  }

  @Post('video-sessions/:id/close')
  close(@Param('id') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.sessions.close(String(user.id), id(sessionId, 'session_id'));
  }

  @Get('courses/:id/progress')
  progress(@Param('id') courseId: string, @CurrentUser() user: AuthUser) {
    return this.sessions.progress(String(user.id), id(courseId, 'course_id'));
  }
}
