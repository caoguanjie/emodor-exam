import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('media_asset')
@Index('uk_media_asset_storage_key', ['storageKey'], { unique: true })
@Index('idx_media_asset_owner_purpose', ['ownerId', 'purpose'])
@Index('idx_media_asset_status', ['status'])
export class MediaAsset {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'owner_id', type: 'bigint', unsigned: true })
  ownerId: string;

  @Column({ name: 'uploaded_by', type: 'bigint', unsigned: true })
  uploadedBy: string;

  @Column({ type: 'varchar', length: 32 })
  purpose: string;

  @Column({ name: 'media_kind', type: 'varchar', length: 16 })
  mediaKind: 'image' | 'video';

  @Column({ name: 'original_name', type: 'varchar', length: 255, nullable: true })
  originalName: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ name: 'size_bytes', type: 'bigint', unsigned: true })
  sizeBytes: string;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'varchar', length: 16, default: 'processing' })
  status: 'processing' | 'ready' | 'failed' | 'deleting';

  @Column({ name: 'duration_ms', type: 'bigint', unsigned: true, nullable: true })
  durationMs: string | null;

  @Column({ name: 'probe_error', type: 'varchar', length: 512, nullable: true })
  probeError: string | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
