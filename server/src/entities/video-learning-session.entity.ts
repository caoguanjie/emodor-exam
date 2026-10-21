import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { VideoPlaybackState } from '../modules/video-learning/video-learning.dto';

@Entity('video_learning_session')
@Index('uk_video_learning_session_active_user', ['activeUserId'], { unique: true })
@Index('idx_video_learning_session_user_started', ['userId', 'startedAt'])
@Index('idx_video_learning_session_last_heartbeat', ['lastHeartbeatAt'])
@Index('idx_video_learning_session_record', ['recordId'])
export class VideoLearningSession {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'record_id', type: 'bigint', unsigned: true })
  recordId: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: string;

  @Column({ name: 'lesson_version_id', type: 'bigint', unsigned: true })
  lessonVersionId: string;

  /** NULL marks an ended/non-owning session; unique non-NULL user enforces one active video. */
  @Column({ name: 'active_user_id', type: 'bigint', unsigned: true, nullable: true })
  activeUserId: string | null;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt: Date;

  @Column({ name: 'last_heartbeat_at', type: 'datetime', precision: 3 })
  lastHeartbeatAt: Date;

  @Column({ name: 'ended_at', type: 'datetime', precision: 3, nullable: true })
  endedAt: Date | null;

  @Column({ name: 'last_seq', type: 'int', unsigned: true, default: 0 })
  lastSeq: number;

  @Column({ name: 'anchor_position_ms', type: 'bigint', unsigned: true, default: 0 })
  anchorPositionMs: string;

  @Column({ name: 'anchor_state', type: 'varchar', length: 32, default: 'playing' })
  anchorState: VideoPlaybackState;

  @Column({ name: 'credited_ms', type: 'bigint', unsigned: true, default: 0 })
  creditedMs: string;
}
