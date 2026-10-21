import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { QuestionOption } from '../common/training-contracts';

@Entity('question_version')
@Index('uk_question_version_revision', ['questionId', 'revision'], { unique: true })
@Index('idx_question_version_candidate', ['categoryId', 'type', 'difficulty', 'status'])
@Index('idx_question_version_regulation', ['regulationId'])
export class QuestionVersion {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'question_id', type: 'bigint', unsigned: true })
  questionId: string;

  @Column({ type: 'int', unsigned: true })
  revision: number;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true, nullable: true })
  categoryId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  difficulty: string | null;

  @Column({ type: 'varchar', length: 16 })
  type: string;

  @Column({ type: 'text' })
  stem: string;

  @Column({ type: 'json' })
  options: QuestionOption[];

  @Column({ type: 'json' })
  answer: number[];

  @Column({ type: 'text', nullable: true })
  analysis: string | null;

  @Column({ type: 'text', nullable: true })
  rubric: string | null;

  @Column({ name: 'score_cents', type: 'int', unsigned: true })
  scoreCents: number;

  @Column({ name: 'concept_id', type: 'bigint', unsigned: true, nullable: true })
  conceptId: string | null;

  @Column({ name: 'regulation_id', type: 'bigint', unsigned: true, nullable: true })
  regulationId: string | null;

  @Column({ name: 'regulation_version_id', type: 'bigint', unsigned: true, nullable: true })
  regulationVersionId: string | null;

  @Column({ name: 'source_page_group', type: 'int', unsigned: true, nullable: true })
  sourcePageGroup: number | null;

  @Column({ name: 'source_page_start', type: 'int', unsigned: true, nullable: true })
  sourcePageStart: number | null;

  @Column({ name: 'source_page_end', type: 'int', unsigned: true, nullable: true })
  sourcePageEnd: number | null;

  @Column({ type: 'varchar', length: 16 })
  source: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'datetime', precision: 3, nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'reviewed_by', type: 'bigint', unsigned: true, nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'datetime', precision: 3, nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'review_reason', type: 'varchar', length: 1000, nullable: true })
  reviewReason: string | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy: string;

  @Column({ name: 'legacy_captured_at', type: 'datetime', precision: 3, nullable: true })
  legacyCapturedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
