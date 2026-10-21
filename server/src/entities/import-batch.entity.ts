import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 可恢复导入批次。normalizedRows 只允许保存业务已规范化的数据；学生
 * 导入的密码在进入本字段前已替换为 password_hash，响应和审计不携带它。
 */
@Entity('import_batch')
export class ImportBatch {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId: string;

  @Column({ type: 'varchar', length: 32 })
  kind: 'students' | 'questions';

  @Column({ name: 'input_hash', type: 'char', length: 64 })
  inputHash: string;

  /** previewed / committing / committed / failed */
  @Column({ type: 'varchar', length: 16, default: 'previewed' })
  status: string;

  @Column({ name: 'normalized_rows', type: 'json', nullable: true })
  normalizedRows: Record<string, unknown>[] | null;

  @Column({ name: 'valid_rows', type: 'json', nullable: true })
  validRows: number[] | null;

  @Column({ type: 'json', nullable: true })
  errors: Array<{ row: number; message: string }> | null;

  @Column({ type: 'json', nullable: true })
  duplicates: number[] | null;

  @Column({ name: 'committed_rows', type: 'json', nullable: true })
  committedRows: number[] | null;

  @Column({ name: 'created_ids', type: 'json', nullable: true })
  createdIds: string[] | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
