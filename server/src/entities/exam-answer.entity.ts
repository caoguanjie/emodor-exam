import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('exam_answer')
export class ExamAnswer {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'exam_record_id', type: 'bigint' })
  examRecordId: string;

  @Column({ name: 'question_id', type: 'bigint' })
  questionId: string;

  /** 考生所选选项（已还原为原始下标数组）；NULL/[] = 未作答 */
  @Column({ type: 'json', nullable: true })
  selected: number[] | null;

  /** 1=全对，0=非全对（含漏选得部分分），NULL=未作答 */
  @Column({ name: 'is_correct', type: 'tinyint', width: 1, nullable: true })
  isCorrect: number | null;

  @Column({ name: 'gained_score', type: 'decimal', precision: 5, scale: 2, default: 0 })
  gainedScore: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;
}
