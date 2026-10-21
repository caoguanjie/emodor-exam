import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('sys_menu')
@Index('idx_sys_menu_parent_sort', ['parentId', 'sort'])
@Index('idx_sys_menu_permission', ['permissionCode'])
export class SysMenu {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'parent_id', type: 'bigint', unsigned: true, nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  type: 'directory' | 'menu' | 'button';

  @Column({ name: 'route_path', type: 'varchar', length: 255, nullable: true })
  routePath: string | null;

  @Column({ name: 'permission_code', type: 'varchar', length: 128, nullable: true })
  permissionCode: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  icon: string | null;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'tinyint', default: 1 })
  status: number;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
