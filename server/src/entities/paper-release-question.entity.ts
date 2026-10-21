import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { PublishedQuestionSnapshot } from '../modules/exams/paper-release.service';

@Entity('paper_release_question')
@Index('uk_release_question_version', ['releaseId', 'questionVersionId'], { unique: true })
@Index('idx_release_question_pool', ['releaseId', 'difficulty', 'type'])
export class PaperReleaseQuestion {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'release_id', type: 'bigint', unsigned: true })
  releaseId: string;

  @Column({ name: 'question_id', type: 'bigint', unsigned: true })
  questionId: string;

  @Column({ name: 'question_version_id', type: 'bigint', unsigned: true })
  questionVersionId: string;

  @Column({ name: 'concept_id', type: 'bigint', unsigned: true, nullable: true })
  conceptId: string | null;

  @Column({ type: 'varchar', length: 16 })
  type: string;

  @Column({ type: 'varchar', length: 16 })
  difficulty: string;

  @Column({ name: 'score_cents', type: 'int', unsigned: true })
  scoreCents: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  position: number;

  @Column({ name: 'snapshot_json', type: 'json' })
  snapshotJson: PublishedQuestionSnapshot;
}
