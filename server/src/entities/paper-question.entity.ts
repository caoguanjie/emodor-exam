import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('paper_question')
@Index('uk_paper_question', ['paperId', 'questionId'], { unique: true })
@Index('idx_question', ['questionId'])
@Index('idx_paper_question_version', ['questionVersionId'])
@Index('idx_paper_question_concept', ['conceptId'])
export class PaperQuestion {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'paper_id', type: 'bigint', unsigned: true })
  paperId: string;

  @Column({ name: 'question_id', type: 'bigint', unsigned: true })
  questionId: string;

  @Column({ name: 'question_version_id', type: 'bigint', unsigned: true, nullable: true })
  questionVersionId: string | null;

  @Column({ name: 'concept_id', type: 'bigint', unsigned: true, nullable: true })
  conceptId: string | null;

  /** 组卷顺序（乱序呈现的基准） */
  @Column({ type: 'int', default: 0 })
  sort: number;

  /** 本题在本试卷中的分值（判分依据） */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  score: string;
}
