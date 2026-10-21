import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('media_reference')
export class MediaReference {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'asset_id', type: 'bigint' })
  assetId: string;

  @Column({ name: 'owner_type', type: 'varchar', length: 64 })
  ownerType: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;
}
