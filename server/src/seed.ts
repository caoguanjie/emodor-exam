import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SysDepartment } from './entities/sys-department.entity';
import { SysUser } from './entities/sys-user.entity';
import { SysRole } from './entities/sys-role.entity';
import { SysPermission } from './entities/sys-permission.entity';
import { SysRolePermission } from './entities/sys-role-permission.entity';
import { LEGACY_REGULATION_ADMIN_PERMISSIONS, PERMISSION_CATALOG, PERMISSION_NAMES } from './modules/access/permission-catalog';

/**
 * 首次部署种子（03 册第 7 章初始化口径）：
 * 根部门（id=1，parent_id IS NULL 仅一行）+ 超级管理员（id=1，username=admin）。
 * 仅在对应记录不存在时插入（幂等，不覆盖既有数据 / 口令）；
 * 管理员初始口令必须经环境变量 ADMIN_INITIAL_PASSWORD 运行期注入（安全约束：任何文件不落明文口令），
 * 插入后 last_login_at = NULL → 首次登录由认证链强制改密（07 册 2.2.3）。
 */
export async function ensureSeedData(ds: DataSource): Promise<void> {
  const deptRepo = ds.getRepository(SysDepartment);
  const userRepo = ds.getRepository(SysUser);
  const roleRepo = ds.getRepository(SysRole);
  const permissionRepo = ds.getRepository(SysPermission);
  const rolePermissionRepo = ds.getRepository(SysRolePermission);

  const deptCount = await deptRepo.count();
  if (deptCount === 0) {
    await deptRepo.insert({ id: '1', parentId: null, name: '集团总部', sort: 1, status: 1 });
    console.log('[seed] 根部门「集团总部」已创建（id=1）');
  }

  const admin = await userRepo.findOne({ where: { username: 'admin' } });
  if (!admin) {
    const initial = process.env.ADMIN_INITIAL_PASSWORD;
    // 与业务层「三层统一」口径一致：≥8 位且同时包含字母与数字（common/password-policy.ts）
    if (!initial || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(initial)) {
      console.warn('[seed] 检测到无管理员账号且未配置 ADMIN_INITIAL_PASSWORD（≥8 位且同时包含字母与数字），跳过超级管理员创建——请配置后重启');
    } else {
      const hash = await bcrypt.hash(initial, 12);
      await userRepo.insert({
        id: '1',
        username: 'admin',
        passwordHash: hash,
        realName: '超级管理员',
        employeeNo: null,
        departmentId: null,
        role: 'super_admin',
        status: 1,
        authVersion: 0,
        forcePasswordChange: 1,
        loginCount: 0,
        lastLoginAt: null,
        lastLoginIp: null,
        rolesConfigured: 0,
      });
      console.log('[seed] 超级管理员 admin 已创建（首登强制改密）；初始口令仅经环境变量注入，不落日志');
    }
  }

  // 权限目录和三类系统角色幂等初始化；管理员业务角色关系可在后台另行配置。
  const permissions = new Map<string, SysPermission>();
  for (const code of PERMISSION_CATALOG) {
    let permission = await permissionRepo.findOne({ where: { code } });
    if (!permission) permission = await permissionRepo.save(permissionRepo.create({ code, name: PERMISSION_NAMES[code] }));
    permissions.set(code, permission);
  }
  const roleDefinitions = [
    { code: 'super_admin', name: '超级管理员', isSystem: 1, permissions: [...PERMISSION_CATALOG] },
    { code: 'regulation_admin', name: '业务管理员', isSystem: 1, permissions: LEGACY_REGULATION_ADMIN_PERMISSIONS },
    { code: 'employee', name: '学员', isSystem: 1, permissions: [] as string[] },
  ];
  for (const definition of roleDefinitions) {
    let role = await roleRepo.findOne({ where: { code: definition.code } });
    if (!role) role = await roleRepo.save(roleRepo.create({ code: definition.code, name: definition.name, isSystem: definition.isSystem, status: 1 }));
    for (const code of definition.permissions) {
      const permission = permissions.get(code);
      if (!permission) continue;
      const exists = await rolePermissionRepo.findOne({ where: { roleId: role.id, permissionId: permission.id } });
      if (!exists) await rolePermissionRepo.insert({ roleId: role.id, permissionId: permission.id });
    }
  }
}
