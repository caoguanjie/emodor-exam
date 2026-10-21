import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface QuestionOption {
  key: string;
  text: string;
}

@Entity('question')
export class Question {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'regulation_id', type: 'bigint' })
  regulationId: string;

  @Column({ name: 'version_id', type: 'bigint' })
  versionId: string;

  /** single / multiple */
  @Column({ type: 'varchar', length: 16 })
  type: string;

  @Column({ type: 'text' })
  stem: string;

  /** 选项数组 [{key,text}]，下标为判分语义锚点（03 册 4.1） */
  @Column({ type: 'json' })
  options: QuestionOption[];

  /** 正确答案（原始选项下标数组）：single 恰 1 元素；multiple ≥ 2 元素升序（03 册 4.2） */
  @Column({ type: 'json' })
  answer: number[];

  @Column({ type: 'text', nullable: true })
  analysis: string | null;

  /** 题库建议分值；实际判分以 paper_question.score 为准 */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  score: string;

  /** pending / approved / rejected */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  /** ai / manual */
  @Column({ type: 'varchar', length: 16 })
  source: string;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
