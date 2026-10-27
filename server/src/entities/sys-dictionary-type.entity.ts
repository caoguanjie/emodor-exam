import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('sys_dictionary_type')
@Index('uk_sys_dictionary_type_label', ['label'], { unique: true })
@Index('idx_sys_dictionary_type_sort', ['sort', 'type'])
export class SysDictionaryType {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'varchar', length: 128 })
  label: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 1000 })
  sort: number;

  @Column({ name: 'is_system', type: 'tinyint', default: 0 })
  isSystem: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;
}
