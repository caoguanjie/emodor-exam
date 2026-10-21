import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('exam_paper')
export class ExamPaper {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'regulation_id', type: 'bigint' })
  regulationId: string;

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

  /** draft / published / archived */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
