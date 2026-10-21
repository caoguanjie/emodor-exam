import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RegulationScope } from '../../entities/regulation-scope.entity';
import { Regulation } from '../../entities/regulation.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { SysDepartment } from '../../entities/sys-department.entity';
import { DepartmentService } from '../departments/department.service';
import { Errors } from '../../common/errors';

export interface ScopeConfig {
  isAll: boolean;
  departmentIds: string[];
}

/** 发布范围服务（05 册 3.4.5）：is_all 与部门圈定互斥表达；应学集合 = 范围内在职员工（status=1） */
@Injectable()
export class RegulationScopeService {
  constructor(
    @InjectRepository(RegulationScope) private readonly scopeRepo: Repository<RegulationScope>,
    @InjectRepository(Regulation) private readonly regRepo: Repository<Regulation>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(SysDepartment) private readonly deptRepo: Repository<SysDepartment>,
    private readonly dataSource: DataSource,
    private readonly departments: DepartmentService,
  ) {}

  async getScope(regulationId: string): Promise<ScopeConfig> {
    const rows = await this.scopeRepo.find({ where: { regulationId } });
    const allRow = rows.find((r) => r.isAll === 1);
    if (allRow) return { isAll: true, departmentIds: [] };
    return { isAll: false, departmentIds: rows.map((r) => r.departmentId!).filter(Boolean) };
  }

  /** 范围配置（PUT /regulations/{id}/scope）：is_all 全员仅一行且 department_id 为 NULL（应用层不变式） */
  async saveScope(regulationId: string, cfg: ScopeConfig) {
    // 制度存在性前置：防对不存在 id 先删（0 行）后插成功，留下孤儿范围行且响应 404 与副作用矛盾
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');
    if (cfg.isAll) {
      // 删除与插入同事务（W-6）：insert 失败整体回滚，避免「先删后插」删除已提交导致已发布制度对全员瞬间不可见
      await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(RegulationScope);
        await repo.delete({ regulationId });
        await repo.insert({ regulationId, departmentId: null, isAll: 1 });
      });
      return;
    }
    const ids = Array.from(new Set(cfg.departmentIds.map(String)));
    if (!ids.length) throw Errors.param('发布范围未配置：请圈定部门或选择面向全员');
    // 数据库无外键，引用完整性由应用层维护：插入前校验部门存在，防非法 id 使 insert 失败
    const found = await this.deptRepo.find({ where: { id: In(ids) } });
    const missing = ids.filter((id) => !found.some((d) => String(d.id) === id));
    if (missing.length) throw Errors.param(`部门不存在：${missing.join('、')}`);
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(RegulationScope);
      await repo.delete({ regulationId });
      const entities = ids.map((departmentId) => repo.create({ regulationId, departmentId, isAll: 0 }));
      await repo.save(entities);
    });
  }

  /** 配置范围是否已存在（发布前置校验②：已配置发布范围，C-04） */
  async isConfigured(regulationId: string): Promise<boolean> {
    const count = await this.scopeRepo.count({ where: { regulationId } });
    return count > 0;
  }

  /** 员工可见性判定（05 册 3.4.6 校验链③）：管理员不受范围限制，employee 按部门祖先链匹配 */
  async isUserInScope(regulationId: string, user: { id: number; role: string; departmentId: string | null }): Promise<boolean> {
    const scope = await this.getScope(regulationId);
    if (scope.isAll) return true;
    if (!scope.departmentIds.length) return false;
    const targetDepts = await this.departments.expandWithChildren(scope.departmentIds);
    if (!user.departmentId) return false;
    const ancestors = await this.departments.ancestorChain(user.departmentId);
    for (const a of ancestors) {
      if (targetDepts.has(a)) return true;
    }
    return false;
  }

  /**
   * 应学集合计算（05 册 7.4.1 AudienceService 统一产出，C-09）：
   * is_all=1 → 全部在职员工；否则圈定部门（含子部门）中 status=1 的员工（去重）。
   */
  async audienceUsers(regulationId: string): Promise<SysUser[]> {
    const scope = await this.getScope(regulationId);
    if (scope.isAll) {
      return this.userRepo.find({ where: { status: 1 } });
    }
    if (!scope.departmentIds.length) return [];
    const depts = await this.departments.expandWithChildren(scope.departmentIds);
    if (!depts.size) return [];
    return this.userRepo
      .createQueryBuilder('u')
      .where('u.status = 1')
      .andWhere('u.department_id IN (:...depts)', { depts: Array.from(depts) })
      .getMany();
  }

  /** 应学人数（分母只计 status=1，C-09） */
  async audienceCount(regulationId: string): Promise<number> {
    const users = await this.audienceUsers(regulationId);
    return users.length;
  }

  /** 部门被哪些制度覆盖（部门 × 制度矩阵反查，scope.idx_department 支撑） */
  async regulationsForDepartments(departmentIds: string[]): Promise<string[]> {
    if (!departmentIds.length) return [];
    const rows = await this.scopeRepo.find({ where: { departmentId: In(departmentIds) } });
    return Array.from(new Set(rows.map((r) => r.regulationId)));
  }
}
