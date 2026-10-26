import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DesignerLayoutV1 } from '../common/question-authoring';

@Entity('exam_paper')
@Index('idx_regulation_status', ['regulationId', 'status'])
@Index('idx_paper_training_pool', ['categoryId', 'businessScope', 'mode', 'status'])
export class ExamPaper {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'regulation_id', type: 'bigint', unsigned: true, nullable: true })
  regulationId: string | null;

  /** regulation keeps the original fixed-paper contract; training uses releases. */
  @Column({ name: 'business_scope', type: 'varchar', length: 16, default: 'regulation' })
  businessScope: string;

  @Column({ type: 'varchar', length: 16, default: 'fixed' })
  mode: string;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true, nullable: true })
  categoryId: string | null;

  @Column({ name: 'requires_learning', type: 'tinyint', unsigned: true, default: 1 })
  requiresLearning: number;

  @Column({ name: 'regulation_ids', type: 'json', nullable: true })
  regulationIds: string[] | null;

  @Column({ name: 'course_ids', type: 'json', nullable: true })
  courseIds: string[] | null;

  @Column({ name: 'rule_config', type: 'json', nullable: true })
  ruleConfig: import('../common/training-contracts').RuleSnapshot | null;

  @Column({ name: 'designer_layout', type: 'json', nullable: true })
  designerLayout: DesignerLayoutV1 | null;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  /** 恒为 100.00（固定 100 分制） */
  @Column({ name: 'total_score', type: 'decimal', precision: 5, scale: 2, default: 100 })
  totalScore: string;

  /** 及格线 (0, 100]，默认 60 */
  @Column({ name: 'pass_score', type: 'decimal', precision: 5, scale: 2, default: 60 })
  passScore: string;

  @Column({ name: 'duration_minutes', type: 'int', default: 30 })
  durationMinutes: number;

  /** 最大作答次数（含首次），默认 3 */
  @Column({ name: 'max_attempts', type: 'int', default: 3 })
  maxAttempts: number;

  /** 多选漏选部分分比例 [0.00, 1.00]，默认 0.50 */
  @Column({ name: 'partial_credit_ratio', type: 'decimal', precision: 4, scale: 2, default: 0.5 })
  partialCreditRatio: string;

  /** 新流程 draft / published；withdrawn / archived 仅历史只读兼容。 */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
