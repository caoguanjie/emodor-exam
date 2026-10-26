import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { MediaUploadPurpose } from '../modules/media/media-policy';
import type { StorageLocator } from '../modules/media/storage/media-storage.port';
import type { MediaUploadCandidate, UploadMode, UploadResult, UploadState } from '../modules/media/uploads/media-upload.contract';

@Entity('media_upload_session')
@Index('uk_media_upload_request', ['uploadedBy', 'clientRequestId'], { unique: true })
@Index('idx_media_upload_queue', ['state', 'leaseUntil'])
@Index('idx_media_upload_expiry', ['state', 'expiresAt'])
@Index('idx_media_upload_credentials', ['state', 'lastCredentialExpiresAt'])
@Index('idx_media_upload_receipt', ['state', 'receiptExpiresAt'])
export class MediaUploadSession {
  @PrimaryColumn({ type: 'char', length: 36, charset: 'ascii', collation: 'ascii_bin' }) id: string;
  @Column({ name: 'owner_id', type: 'bigint', unsigned: true }) ownerId: string;
  @Column({ name: 'uploaded_by', type: 'bigint', unsigned: true }) uploadedBy: string;
  @Column({ name: 'client_request_id', type: 'char', length: 36, charset: 'ascii', collation: 'ascii_bin' }) clientRequestId: string;
  @Column({ name: 'request_digest', type: 'char', length: 64, charset: 'ascii', collation: 'ascii_bin' }) requestDigest: string;
  @Column({ type: 'varchar', length: 32 }) purpose: MediaUploadPurpose;
  @Column({ name: 'original_name', type: 'varchar', length: 255, nullable: true }) originalName: string | null;
  @Column({ name: 'mime_type', type: 'varchar', length: 128 }) mimeType: string;
  @Column({ name: 'size_bytes', type: 'bigint', unsigned: true }) sizeBytes: string;
  @Column({ name: 'fingerprint_sha256', type: 'char', length: 64, charset: 'ascii', collation: 'ascii_bin' }) fingerprintSha256: string;
  @Column({ type: 'varchar', length: 16 }) mode: UploadMode;
  @Column({ name: 'part_size', type: 'int', unsigned: true }) partSize: number;
  @Column({ name: 'parallel_limit', type: 'tinyint', unsigned: true, default: 3 }) parallelLimit: number;
  @Column({ name: 'staging_locator', type: 'json', nullable: true }) stagingLocator: StorageLocator | null;
  @Column({ name: 'upload_id', type: 'varchar', length: 255, nullable: true }) uploadId: string | null;
  @Column({ type: 'varchar', length: 16, default: 'uploading' }) state: UploadState;
  @Column({ name: 'expires_at', type: 'datetime', precision: 3 }) expiresAt: Date;
  @Column({ name: 'last_credential_expires_at', type: 'datetime', precision: 3, nullable: true }) lastCredentialExpiresAt: Date | null;
  @Column({ name: 'claim_id', type: 'char', length: 36, charset: 'ascii', collation: 'ascii_bin', nullable: true }) claimId: string | null;
  @Column({ name: 'lease_until', type: 'datetime', precision: 3, nullable: true }) leaseUntil: Date | null;
  @Column({ name: 'finalize_attempts', type: 'tinyint', unsigned: true, default: 0 }) finalizeAttempts: number;
  @Column({ name: 'candidate_objects', type: 'json', nullable: true }) candidateObjects: MediaUploadCandidate[] | null;
  @Column({ name: 'asset_id', type: 'bigint', unsigned: true, nullable: true }) assetId: string | null;
  @Column({ type: 'json', nullable: true }) receipt: UploadResult | null;
  @Column({ name: 'receipt_expires_at', type: 'datetime', precision: 3, nullable: true }) receiptExpiresAt: Date | null;
  @Column({ name: 'reason_code', type: 'varchar', length: 64, nullable: true }) reasonCode: string | null;
  @Column({ name: 'error_message', type: 'varchar', length: 512, nullable: true }) errorMessage: string | null;
  @Column({ name: 'finalized_at', type: 'datetime', precision: 3, nullable: true }) finalizedAt: Date | null;
  @Column({ name: 'cleaned_at', type: 'datetime', precision: 3, nullable: true }) cleanedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', precision: 3 }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', precision: 3 }) updatedAt: Date;
}
