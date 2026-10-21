import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('exam_review_event')
@Unique('uk_exam_review_event_version', ['examRecordId', 'recordQuestionId', 'gradingVersion'])
@Index('idx_exam_review_event_record_created', ['examRecordId', 'createdAt'])
export class ExamReviewEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'exam_record_id', type: 'bigint', unsigned: true })
  examRecordId: string;

  @Column({ name: 'record_question_id', type: 'bigint', unsigned: true })
  recordQuestionId: string;

  @Column({ name: 'reviewer_id', type: 'bigint', unsigned: true })
  reviewerId: string;

  @Column({ name: 'before_score', type: 'decimal', precision: 5, scale: 2, nullable: true })
  beforeScore: string | null;

  @Column({ name: 'after_score', type: 'decimal', precision: 5, scale: 2 })
  afterScore: string;

  @Column({ name: 'before_comment', type: 'text', nullable: true })
  beforeComment: string | null;

  @Column({ name: 'after_comment', type: 'text', nullable: true })
  afterComment: string | null;

  @Column({ name: 'grading_version', type: 'int', unsigned: true })
  gradingVersion: number;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;
}
