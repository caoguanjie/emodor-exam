import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ExamDifficulty, LearnerSource, RuleSnapshot } from '../common/training-contracts';

@Entity('exam_assignment')
@Index('uk_exam_assignment_paper_user', ['paperId', 'userId'], { unique: true })
@Index('idx_exam_assignment_user', ['userId'])
@Index('idx_exam_assignment_release', ['releaseId'])
export class ExamAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'paper_id', type: 'bigint', unsigned: true })
  paperId: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: string;

  @Column({ name: 'release_id', type: 'bigint', unsigned: true, nullable: true })
  releaseId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  source: LearnerSource | null;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true, nullable: true })
  categoryId: string | null;

  @Column({ type: 'varchar', length: 16 })
  difficulty: ExamDifficulty;

  @Column({ name: 'rule_snapshot', type: 'json' })
  ruleSnapshot: RuleSnapshot;

  @Column({ name: 'snapshot_origin', type: 'varchar', length: 32 })
  snapshotOrigin: 'release' | 'legacy_start';

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;
}
