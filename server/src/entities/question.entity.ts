import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { QuestionContentV2 } from '../common/training-contracts';
import type { QuestionContentV3 } from '../common/question-content-v3';

export interface QuestionOption {
  key: string;
  text: string;
}

@Entity('question')
export class Question {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'regulation_id', type: 'bigint', unsigned: true, nullable: true })
  regulationId: string | null;

  /** Legacy compatibility alias for the source regulation_version id. */
  @Column({ name: 'version_id', type: 'bigint', unsigned: true, nullable: true })
  versionId: string | null;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true, nullable: true })
  categoryId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  difficulty: string | null;

  @Column({ name: 'concept_id', type: 'bigint', unsigned: true, nullable: true })
  conceptId: string | null;

  @Column({ name: 'current_version_id', type: 'bigint', unsigned: true, nullable: true })
  currentVersionId: string | null;

  @Column({ name: 'is_enabled', type: 'tinyint', width: 1, default: true })
  isEnabled: boolean;

  /** Current-bank visibility only; historical reads must never be implicitly filtered. */
  @Column({ name: 'deleted_at', type: 'datetime', precision: 3, nullable: true })
  deletedAt: Date | null;

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

  @Column({ name: 'content_schema_version', type: 'tinyint', unsigned: true, default: 1 })
  contentSchemaVersion: number;

  @Column({ name: 'content_json', type: 'json', nullable: true })
  contentJson: QuestionContentV2 | QuestionContentV3 | null;

  /** 仅保留旧题分值；新题与修订为 NULL，实际判分以卷内分值为准。 */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  score: string | null;

  /** pending / approved / rejected */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  /** ai / manual */
  @Column({ type: 'varchar', length: 16 })
  source: string;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
