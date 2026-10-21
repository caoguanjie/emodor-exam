import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('media_reference')
@Index('uk_media_reference_owner', ['assetId', 'ownerType', 'ownerId'], { unique: true })
@Index('idx_media_reference_asset', ['assetId'])
@Index('idx_media_reference_owner', ['ownerType', 'ownerId'])
export class MediaReference {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'asset_id', type: 'bigint', unsigned: true })
  assetId: string;

  @Column({ name: 'owner_type', type: 'varchar', length: 64 })
  ownerType: string;

  @Column({ name: 'owner_id', type: 'bigint', unsigned: true })
  ownerId: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;
}
