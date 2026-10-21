import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Migration metadata is operational state, not a training-domain business table. */
@Entity('schema_migration')
export class SchemaMigration {
  @PrimaryColumn({ name: 'migration_id', type: 'varchar', length: 128 })
  migrationId: string;

  @Column({ type: 'char', length: 64 })
  checksum: string;

  /** applying / applied / failed */
  @Column({ type: 'varchar', length: 16, default: 'applied' })
  status: string;

  @Column({ name: 'started_at', type: 'datetime', precision: 3, nullable: true })
  startedAt: Date | null;

  @Column({ name: 'applied_at', type: 'datetime', precision: 3, nullable: true })
  appliedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  /** Stable step ids whose completion probes have been verified. */
  @Column({ type: 'json', nullable: true })
  progress: string[] | null;
}
