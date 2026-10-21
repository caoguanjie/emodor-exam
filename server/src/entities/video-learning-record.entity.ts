import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('video_learning_record')
@Index('uk_video_learning_record_user_version', ['userId', 'lessonVersionId'], { unique: true })
@Index('idx_video_learning_record_user_completed', ['userId', 'completed'])
@Index('idx_video_learning_record_version', ['lessonVersionId'])
export class VideoLearningRecord {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: string;

  @Column({ name: 'lesson_version_id', type: 'bigint', unsigned: true })
  lessonVersionId: string;

  @Column({ name: 'duration_ms', type: 'bigint', unsigned: true })
  durationMs: string;

  @Column({ name: 'credited_ms', type: 'bigint', unsigned: true, default: 0 })
  creditedMs: string;

  @Column({ name: 'coverage_intervals', type: 'json' })
  coverageIntervals: [number, number][];

  @Column({ name: 'coverage_ms', type: 'bigint', unsigned: true, default: 0 })
  coverageMs: string;

  @Column({ name: 'confirmed_position_ms', type: 'bigint', unsigned: true, default: 0 })
  confirmedPositionMs: string;

  @Column({ name: 'is_completed', type: 'tinyint', unsigned: true, default: 0 })
  completed: number;

  @Column({ name: 'completed_at', type: 'datetime', precision: 3, nullable: true })
  completedAt: Date | null;

  @Column({ name: 'last_learn_at', type: 'datetime', precision: 3, nullable: true })
  lastLearnAt: Date | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
