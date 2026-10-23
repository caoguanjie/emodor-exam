import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const ID_PATTERN = /^[1-9]\d*$/;

export type VideoPlaybackState = 'playing' | 'paused' | 'buffering' | 'background' | 'ended';

export interface VideoHeartbeat {
  seq: number;
  position_ms: number;
  state: VideoPlaybackState;
}

export class StartVideoSessionDto {
  @IsString() @Matches(ID_PATTERN) lesson_id!: string;
}

export class VideoHeartbeatDto implements VideoHeartbeat {
  @IsInt() @Min(1) @Max(4_294_967_295) seq!: number;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) position_ms!: number;
  @IsString() @IsIn(['playing', 'paused', 'buffering', 'background', 'ended']) state!: VideoPlaybackState;
}

const QueryNumber = () => Transform(({ value }) => (
  value === undefined || value === null || value === '' ? undefined : Number(value)
));

export class VideoRecordQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
}

export interface VideoProgress {
  confirmed_position_ms: number;
  credited_ms: number;
  coverage_ms: number;
  duration_ms: number;
  completed: boolean;
  last_seq: number;
}

export interface VideoSessionView {
  session_id: string;
  version_id: string;
  heartbeat_interval_ms: 30_000;
  media: {
    asset_id: string;
    ticket: { content_url: string; expires_at: string };
  };
  progress: VideoProgress;
}

export interface CourseLessonProgress extends VideoProgress {
  lesson_id: string;
  version_id: string;
}

export interface CourseProgress {
  required: number;
  completed: number;
  completion_rate: number | null;
  lessons: CourseLessonProgress[];
}

export interface VideoRecordView {
  record_id: string;
  lesson_id: string;
  version_id: string;
  progress: VideoProgress;
}

export const VIDEO_START_KEYS = ['lesson_id'] as const;
export const VIDEO_HEARTBEAT_KEYS = ['seq', 'position_ms', 'state'] as const;
export const VIDEO_RECORD_QUERY_KEYS = ['page', 'page_size'] as const;
