import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sys_role_permission' })
export class SysRolePermission {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'role_id', type: 'bigint' })
  roleId!: string;

  @Column({ name: 'permission_id', type: 'bigint' })
  permissionId!: string;
}
