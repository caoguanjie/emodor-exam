import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('learner_identity')
@Index('uk_learner_identity_user', ['userId'], { unique: true })
@Index('uk_learner_identity_fingerprint', ['idFingerprint'], { unique: true })
@Index('uk_learner_identity_session', ['sessionId'], { unique: true })
export class LearnerIdentity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id: string;
  @Column({ name: 'user_id', type: 'bigint', unsigned: true }) userId: string;
  @Column({ name: 'id_fingerprint', type: 'char', length: 64 }) idFingerprint: string;
  @Column({ name: 'identity_encrypted', type: 'text' }) identityEncrypted: string;
  @Column({ name: 'session_id', type: 'char', length: 36 }) sessionId: string;
  @Column({ name: 'provider_request_id', type: 'varchar', length: 128 }) providerRequestId: string;
  @CreateDateColumn({ name: 'verified_at', precision: 3 }) verifiedAt: Date;
}
