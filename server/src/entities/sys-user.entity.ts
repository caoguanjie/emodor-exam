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

  /** 受控媒体头像资源；本人资料与学员管理只保存 media_asset.id。 */
  @Column({ name: 'avatar_id', type: 'bigint', nullable: true })
  avatarId: string | null;

  /** 1=启用（在职），0=停用 */
  @Column({ type: 'tinyint', default: 1 })
  status: number;

  /** JWT 认证世代；每次密码/身份/管理权限变更递增，令牌中的旧世代立即失效。 */
  @Column({ name: 'auth_version', type: 'int', unsigned: true, default: 0 })
  authVersion: number;

  /** 与真实登录统计分离的首次/重置强制改密状态。 */
  @Column({ name: 'force_password_change', type: 'tinyint', default: 0 })
  forcePasswordChange: number;

  /** 真实密码成功登录次数；refresh 不计入。 */
  @Column({ name: 'login_count', type: 'int', unsigned: true, default: 0 })
  loginCount: number;

  @Column({ name: 'last_login_at', type: 'datetime', precision: 3, nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'last_login_ip', type: 'varchar', length: 64, nullable: true })
  lastLoginIp: string | null;

  /** 是否已显式配置过业务角色；区分 legacy regulation_admin 默认矩阵与清空后的空权限。 */
  @Column({ name: 'roles_configured', type: 'tinyint', default: 0 })
  rolesConfigured: number;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
