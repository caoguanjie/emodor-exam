import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SysDepartment } from './entities/sys-department.entity';
import { SysUser } from './entities/sys-user.entity';

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
        lastLoginAt: null,
      });
      console.log('[seed] 超级管理员 admin 已创建（首登强制改密）；初始口令仅经环境变量注入，不落日志');
    }
  }
}
