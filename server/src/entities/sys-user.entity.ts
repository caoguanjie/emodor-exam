import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('sys_user')
export class SysUser {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  username: string;

  /** 只写不读不出参（03 册 3.1.2 设计说明 2） */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ name: 'real_name', type: 'varchar', length: 64 })
  realName: string;

  @Column({ name: 'employee_no', type: 'varchar', length: 32, nullable: true })
  employeeNo: string | null;

  @Column({ name: 'department_id', type: 'bigint', nullable: true })
  departmentId: string | null;

  /** 培训类别；旧用户未补齐资料时保持 NULL，不反推默认类别。 */
  @Column({ name: 'category_id', type: 'bigint', nullable: true })
  categoryId: string | null;

  /** institution=本机构，external=外来；旧用户未确认时保持 NULL。 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  source: 'institution' | 'external' | null;

  /** super_admin / regulation_admin / employee（README 3.4） */
  @Column({ type: 'varchar', length: 32, default: 'employee' })
  role: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  email: string | null;

  /** 1=启用（在职），0=停用 */
  @Column({ type: 'tinyint', default: 1 })
  status: number;

  /** NULL=当前口令从未成功登录（首次登录强制改密标记，07 册 2.2.3） */
  @Column({ name: 'last_login_at', type: 'datetime', precision: 3, nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
