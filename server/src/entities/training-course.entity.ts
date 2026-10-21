import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type CourseStatus = 'draft' | 'published' | 'offline';

@Entity('training_course')
@Index('idx_training_course_category_status', ['categoryId', 'status'])
@Index('idx_training_course_recommended_sort', ['isRecommended', 'sortOrder'])
export class TrainingCourse {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true })
  categoryId: string;

  @Column({ name: 'cover_asset_id', type: 'bigint', unsigned: true, nullable: true })
  coverAssetId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Informational source links only; they never create an exam or learning gate. */
  @Column({ name: 'regulation_ids', type: 'json', nullable: true })
  regulationIds: string[] | null;

  @Column({ name: 'is_recommended', type: 'tinyint', unsigned: true, default: 0 })
  isRecommended: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status: CourseStatus;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy: string;

  @Column({ name: 'published_at', type: 'datetime', precision: 3, nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
