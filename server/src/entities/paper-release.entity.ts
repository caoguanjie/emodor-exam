import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { RuleSnapshot } from '../common/training-contracts';

@Entity('paper_release')
@Index('uk_paper_release_version', ['paperId', 'versionNo'], { unique: true })
@Index('idx_paper_release_category', ['categoryId'])
export class PaperRelease {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'paper_id', type: 'bigint', unsigned: true })
  paperId: string;

  @Column({ name: 'version_no', type: 'int', unsigned: true })
  versionNo: number;

  @Column({ name: 'business_scope', type: 'varchar', length: 16 })
  businessScope: string;

  @Column({ type: 'varchar', length: 16 })
  mode: string;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true, nullable: true })
  categoryId: string | null;

  @Column({ name: 'requires_learning', type: 'tinyint', unsigned: true, default: 0 })
  requiresLearning: number;

  @Column({ name: 'rule_snapshot', type: 'json' })
  ruleSnapshot: RuleSnapshot;

  @Column({ name: 'regulation_ids', type: 'json', nullable: true })
  regulationIds: string[] | null;

  @Column({ name: 'course_ids', type: 'json', nullable: true })
  courseIds: string[] | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy: string;

  @CreateDateColumn({ name: 'released_at', type: 'datetime', precision: 3 })
  releasedAt: Date;
}
