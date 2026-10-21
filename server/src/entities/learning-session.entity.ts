import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('learning_session')
export class LearningSession {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'regulation_id', type: 'bigint' })
  regulationId: string;

  @Column({ name: 'version_id', type: 'bigint' })
  versionId: string;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt: Date;

  /** NULL=进行中或待兜底收口 */
  @Column({ name: 'ended_at', type: 'datetime', precision: 3, nullable: true })
  endedAt: Date | null;

  /** 容差校验后的累计有效时长（秒） */
  @Column({ name: 'duration_seconds', type: 'int', default: 0 })
  durationSeconds: number;
}
