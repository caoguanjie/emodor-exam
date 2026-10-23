import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type IdentitySessionState = 'created' | 'provider_pending' | 'provider_unknown' | 'provider_verified' | 'verified' | 'rejected' | 'expired';
@Entity('identity_verification_session')
@Index('idx_identity_session_user_created', ['userId', 'createdAt'])
@Index('idx_identity_session_material', ['userId', 'materialFingerprint'])
@Index('uk_identity_session_bound_event', ['boundEventId'], { unique: true })
export class IdentityVerificationSession {
  @PrimaryColumn({ type: 'char', length: 36 }) id: string;
  @Column({ name: 'user_id', type: 'bigint', unsigned: true }) userId: string;
  @Column({ name: 'face_asset_id', type: 'bigint', unsigned: true }) faceAssetId: string;
  @Column({ name: 'id_card_portrait_asset_id', type: 'bigint', unsigned: true }) idCardPortraitAssetId: string;
  @Column({ name: 'id_card_emblem_asset_id', type: 'bigint', unsigned: true }) idCardEmblemAssetId: string;
  @Column({ name: 'material_fingerprint', type: 'char', length: 64 }) materialFingerprint: string;
  @Column({ type: 'varchar', length: 24 }) status: IdentitySessionState;
  @Column({ type: 'varchar', length: 32 }) provider: string;
  @Column({ name: 'provider_request_id', type: 'varchar', length: 128, nullable: true }) providerRequestId: string | null;
  @Column({ name: 'provider_result_encrypted', type: 'text', nullable: true }) providerResultEncrypted: string | null;
  @Column({ name: 'provider_lease_until', type: 'datetime', precision: 3, nullable: true }) providerLeaseUntil: Date | null;
  @Column({ name: 'reason_code', type: 'varchar', length: 64, nullable: true }) reasonCode: string | null;
  @Column({ name: 'expires_at', type: 'datetime', precision: 3 }) expiresAt: Date;
  @Column({ name: 'bound_at', type: 'datetime', precision: 3, nullable: true }) boundAt: Date | null;
  @Column({ name: 'bound_event_id', type: 'char', length: 36, nullable: true }) boundEventId: string | null;
  @CreateDateColumn({ name: 'created_at', precision: 3 }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', precision: 3 }) updatedAt: Date;
}
