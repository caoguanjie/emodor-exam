import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('regulation')
export class Regulation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'varchar', length: 32 })
  category: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  /** draft / published / archived */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  @Column({ name: 'current_version_id', type: 'bigint', nullable: true })
  currentVersionId: string | null;

  /** 规定有效学习时长阈值（分钟），≥ 1 */
  @Column({ name: 'required_minutes', type: 'int', default: 10 })
  requiredMinutes: number;

  /** 滚动分段数（本期固定 10，配置项前向保留） */
  @Column({ name: 'scroll_segments', type: 'int', default: 10 })
  scrollSegments: number;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @Column({ name: 'published_at', type: 'datetime', precision: 3, nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
