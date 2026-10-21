import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'auth_session' })
export class AuthSession {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  sid!: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'last_seen_at', type: 'datetime', precision: 3 })
  lastSeenAt!: Date;

  @Column({ name: 'expires_at', type: 'datetime', precision: 3 })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'datetime', precision: 3, nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt!: Date;
}
