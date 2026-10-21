import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ExamDifficulty, QuestionType } from '../common/training-contracts';
import type { PublishedQuestionSnapshot } from '../modules/exams/paper-release.service';

@Entity('exam_record_question')
@Index('uk_exam_record_question_position', ['recordId', 'position'], { unique: true })
export class ExamRecordQuestion {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'record_id', type: 'bigint', unsigned: true })
  recordId: string;

  @Column({ name: 'question_id', type: 'bigint', unsigned: true })
  questionId: string;

  @Column({ name: 'question_version_id', type: 'bigint', unsigned: true, nullable: true })
  questionVersionId: string | null;

  @Column({ type: 'varchar', length: 16 })
  type: QuestionType;

  @Column({ type: 'varchar', length: 16 })
  difficulty: ExamDifficulty;

  @Column({ name: 'score_cents', type: 'int', unsigned: true })
  scoreCents: number;

  @Column({ type: 'int', unsigned: true })
  position: number;

  /** display position -> original option index; persisted so secret rotation cannot change a live paper. */
  @Column({ name: 'display_to_original', type: 'json' })
  displayToOriginal: number[];

  @Column({ name: 'snapshot_json', type: 'json' })
  snapshotJson: PublishedQuestionSnapshot;
}
