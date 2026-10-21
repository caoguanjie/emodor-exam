import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ExamDifficulty, LearnerSource, RuleSnapshot } from '../common/training-contracts';

@Entity('exam_record')
@Index('uk_paper_user_attempt', ['paperId', 'userId', 'attemptNo'], { unique: true })
@Index('uk_assignment_attempt', ['assignmentId', 'attemptNo'], { unique: true })
@Index('uk_active_assignment', ['activeAssignmentId'], { unique: true })
export class ExamRecord {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'paper_id', type: 'bigint', unsigned: true })
  paperId: string;

  /** 制度冗余快照（开考时随 paper 写入、不再变更，03 册 3.4.4） */
  @Column({ name: 'regulation_id', type: 'bigint', unsigned: true, nullable: true })
  regulationId: string | null;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: string;

  @Column({ name: 'assignment_id', type: 'bigint', unsigned: true, nullable: true })
  assignmentId: string | null;

  /** Equals assignment_id only while this row is active; NULL in every terminal state. */
  @Column({ name: 'active_assignment_id', type: 'bigint', unsigned: true, nullable: true })
  activeAssignmentId: string | null;

  @Column({ name: 'release_id', type: 'bigint', unsigned: true, nullable: true })
  releaseId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  source: LearnerSource | null;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true, nullable: true })
  categoryId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  difficulty: ExamDifficulty | null;

  @Column({ name: 'rule_snapshot', type: 'json', nullable: true })
  ruleSnapshot: RuleSnapshot | null;

  @Column({ name: 'snapshot_origin', type: 'varchar', length: 32, default: 'legacy_unavailable' })
  snapshotOrigin: 'release' | 'legacy_start' | 'legacy_unavailable';

  @Column({ name: 'attempt_no', type: 'int', default: 1 })
  attemptNo: number;

  /** in_progress / submitted / passed / failed / timeout */
  @Column({ type: 'varchar', length: 16, default: 'in_progress' })
  status: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  score: string | null;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt: Date;

  /** 交卷截止时刻快照 = started_at + duration_minutes × 60，写入后不变（防限时调整误判在考记录） */
  @Column({ name: 'deadline_at', type: 'datetime', precision: 3 })
  deadlineAt: Date;

  @Column({ name: 'submitted_at', type: 'datetime', precision: 3, nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'switch_count', type: 'int', default: 0 })
  switchCount: number;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
