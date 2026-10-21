import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity('exam_answer')
@Unique('uk_record_question', ['examRecordId', 'questionId'])
@Index('uk_record_item', ['examRecordId', 'recordQuestionId'], { unique: true })
export class ExamAnswer {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'exam_record_id', type: 'bigint', unsigned: true })
  examRecordId: string;

  @Column({ name: 'question_id', type: 'bigint', unsigned: true })
  questionId: string;

  @Column({ name: 'record_question_id', type: 'bigint', unsigned: true, nullable: true })
  recordQuestionId: string | null;

  /** 考生所选选项（已还原为原始下标数组）；NULL/[] = 未作答 */
  @Column({ type: 'json', nullable: true })
  selected: number[] | null;

  @Column({ name: 'asset_ids', type: 'json', nullable: true })
  assetIds: string[] | null;

  /** 1=全对，0=非全对（含漏选得部分分），NULL=未作答 */
  @Column({ name: 'is_correct', type: 'tinyint', width: 1, nullable: true })
  isCorrect: number | null;

  @Column({ name: 'gained_score', type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  gainedScore: string | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ name: 'grading_version', type: 'int', unsigned: true, default: 0 })
  gradingVersion: number;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
