import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lesson_version')
@Index('uk_lesson_version_number', ['lessonId', 'versionNo'], { unique: true })
@Index('idx_lesson_version_asset', ['assetId'])
export class LessonVersion {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'lesson_id', type: 'bigint', unsigned: true })
  lessonId: string;

  @Column({ name: 'version_no', type: 'int', unsigned: true })
  versionNo: number;

  @Column({ name: 'asset_id', type: 'bigint', unsigned: true })
  assetId: string;

  @Column({ name: 'duration_ms', type: 'bigint', unsigned: true })
  durationMs: string;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;
}
