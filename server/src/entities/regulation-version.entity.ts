import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('regulation_version')
export class RegulationVersion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'regulation_id', type: 'bigint' })
  regulationId: string;

  @Column({ name: 'version_no', type: 'int' })
  versionNo: number;

  /** 文件存储相对路径（{UPLOAD_DIR}/regulations/{regulation_id}/{version_no}_{hash8}.{ext}，05 册 3.4.2） */
  @Column({ name: 'file_path', type: 'varchar', length: 255 })
  filePath: string;

  /** pdf / docx */
  @Column({ name: 'file_type', type: 'varchar', length: 8 })
  fileType: string;

  /** 文件 SHA-256（十六进制 64 字符） */
  @Column({ name: 'file_hash', type: 'char', length: 64 })
  fileHash: string;

  @Column({ name: 'content_html', type: 'mediumtext', nullable: true })
  contentHtml: string | null;

  @Column({ name: 'text_content', type: 'mediumtext', nullable: true })
  textContent: string | null;

  /** pending / parsed / failed */
  @Column({ name: 'parse_status', type: 'varchar', length: 16, default: 'pending' })
  parseStatus: string;

  @Column({ name: 'parsed_at', type: 'datetime', precision: 3, nullable: true })
  parsedAt: Date | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
