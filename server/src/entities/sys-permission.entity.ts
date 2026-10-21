import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sys_permission' })
export class SysPermission {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  code!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt!: Date;
}
