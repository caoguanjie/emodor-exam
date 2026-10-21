import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('paper_question')
export class PaperQuestion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'paper_id', type: 'bigint' })
  paperId: string;

  @Column({ name: 'question_id', type: 'bigint' })
  questionId: string;

  /** 组卷顺序（乱序呈现的基准） */
  @Column({ type: 'int', default: 0 })
  sort: number;

  /** 本题在本试卷中的分值（判分依据） */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  score: string;
}
