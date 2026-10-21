import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('exam_record')
export class ExamRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'paper_id', type: 'bigint' })
  paperId: string;

  /** 制度冗余快照（开考时随 paper 写入、不再变更，03 册 3.4.4） */
  @Column({ name: 'regulation_id', type: 'bigint' })
  regulationId: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

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
