import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DesignerLayoutV1 } from '../common/question-authoring';

@Entity('exam_paper')
@Index('idx_regulation_status', ['regulationId', 'status'])
@Index('idx_paper_training_pool', ['categoryId', 'businessScope', 'mode', 'status'])
export class ExamPaper {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'exam_purpose', type: 'varchar', length: 16, default: 'formal' })
  examPurpose?: import('../common/training-contracts').ExamPurpose;

  @Column({ name: 'regulation_id', type: 'bigint', unsigned: true, nullable: true })
  regulationId: string | null;

  /** regulation keeps the original fixed-paper contract; training uses releases. */
  @Column({ name: 'business_scope', type: 'varchar', length: 16, default: 'regulation' })
  businessScope: string;

  @Column({ type: 'varchar', length: 16, default: 'fixed' })
  mode: string;

  @Column({ name: 'pool_scope', type: 'varchar', length: 16, default: 'category' })
  poolScope?: import('../common/training-contracts').PoolScope;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true, nullable: true })
  categoryId: string | null;

  @Column({ name: 'requires_learning', type: 'tinyint', unsigned: true, default: 1 })
  requiresLearning: number;

  /** 培训卷考前有效视频累计分钟；关闭或历史未配置时为 NULL。 */
  @Column({ name: 'required_learning_minutes', type: 'int', unsigned: true, nullable: true })
  requiredLearningMinutes: number | null;

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

  @Column({ type: 'varchar', length: 1000, nullable: true })
  remark: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** 培训试卷目标总分，默认 100.00；发布时与各题合计一致 */
  @Column({ name: 'total_score', type: 'decimal', precision: 5, scale: 2, default: 100 })
  totalScore: string;

  /** 及格线 (0, totalScore]，默认 60 */
  @Column({ name: 'pass_score', type: 'decimal', precision: 5, scale: 2, default: 60 })
  passScore: string;

  @Column({ name: 'duration_minutes', type: 'int', default: 30 })
  durationMinutes: number;

  /** 最大作答次数（含首次），默认 3 */
  @Column({ name: 'max_attempts', type: 'int', nullable: true, default: 3 })
  maxAttempts: number | null;

  /** 多选漏选部分分比例 [0.00, 1.00]，默认 0.50 */
  @Column({ name: 'partial_credit_ratio', type: 'decimal', precision: 4, scale: 2, default: 0.5 })
  partialCreditRatio: string;

  /** 培训流程 draft / published，撤回回到 draft；withdrawn / archived 历史兼容，legacy 不开放撤回。 */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  /** 最后修改培训试卷配置、题单或发布状态的服务端操作者；历史未知为 NULL。 */
  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
