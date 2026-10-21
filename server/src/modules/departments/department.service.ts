import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SysDepartment } from '../../entities/sys-department.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { RegulationScope } from '../../entities/regulation-scope.entity';
import { Errors } from '../../common/errors';
import { AuditService } from '../../common/audit.service';

export interface DepartmentNode {
  id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  status: number;
  children: DepartmentNode[];
}

/**
 * 部门管理子服务（05 册 2.4.3）：
 * 邻接表一次全量查询 + 内存递归组装（树规模百级）；整树进程内缓存、写后失效重建；
 * 「部门 → 含全部子部门 id 集合」展开结果供发布范围圈定与统计模块复用。
 */
@Injectable()
export class DepartmentService {
  private cache: { tree: DepartmentNode[]; all: Map<string, SysDepartment>; builtAt: number } | null = null;

  constructor(
    @InjectRepository(SysDepartment) private readonly deptRepo: Repository<SysDepartment>,
    private readonly audit: AuditService,
  ) {}

  private async loadAll(): Promise<Map<string, SysDepartment>> {
    const rows = await this.deptRepo.find({ order: { sort: 'ASC', id: 'ASC' } });
    const map = new Map<string, SysDepartment>();
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  private buildTree(all: Map<string, SysDepartment>): DepartmentNode[] {
    const nodes = new Map<string, DepartmentNode>();
    for (const d of all.values()) {
      nodes.set(d.id, { id: d.id, parent_id: d.parentId, name: d.name, sort: d.sort, status: d.status, children: [] });
    }
    const roots: DepartmentNode[] = [];
    for (const node of nodes.values()) {
      if (node.parent_id && nodes.has(node.parent_id)) {
        nodes.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  private async ensureCache() {
    if (!this.cache || Date.now() - this.cache.builtAt > 60_000) {
      const all = await this.loadAll();
      this.cache = { tree: this.buildTree(all), all, builtAt: Date.now() };
    }
  }

  private invalidate() {
    this.cache = null;
  }

  /** 全量部门树（GET /departments/tree，登录即可读） */
  async tree(): Promise<DepartmentNode[]> {
    await this.ensureCache();
    return this.cache!.tree;
  }

  /** 「部门 → 含全部子部门」id 集合展开（发布范围与统计口径复用） */
  async expandWithChildren(departmentIds: string[]): Promise<Set<string>> {
    await this.ensureCache();
    const all = this.cache!.all;
    const result = new Set<string>();
    const byParent = new Map<string, string[]>();
    for (const d of all.values()) {
      if (d.parentId) {
        if (!byParent.has(d.parentId)) byParent.set(d.parentId, []);
        byParent.get(d.parentId)!.push(d.id);
      }
    }
    const stack = [...departmentIds.filter((id) => all.has(id))];
    while (stack.length) {
      const cur = stack.pop()!;
      if (result.has(cur)) continue;
      result.add(cur);
      for (const child of byParent.get(cur) || []) stack.push(child);
    }
    return result;
  }

  /** 部门的祖先链（含自身）：员工可见性反查用（05 册 3.4.5） */
  async ancestorChain(departmentId: string | null): Promise<Set<string>> {
    const result = new Set<string>();
    if (!departmentId) return result;
    await this.ensureCache();
    const all = this.cache!.all;
    let cur = all.get(departmentId) || null;
    let guard = 0;
    while (cur && guard++ < 32) {
      result.add(cur.id);
      cur = cur.parentId ? all.get(cur.parentId) || null : null;
    }
    return result;
  }

  async create(parentId: string | null, name: string, sort: number, actorId: number, actorName: string, ip: string | null) {
    // 唯一根约束：parent_id IS NULL 仅一行（应用层保证，03 册 3.1.1）
    if (parentId === null) {
      const rootCount = await this.deptRepo.count({ where: { parentId: null as any } });
      if (rootCount > 0) throw Errors.param('根部门已存在，仅允许一个根部门');
    } else {
      const parent = await this.deptRepo.findOne({ where: { id: parentId } });
      if (!parent) throw Errors.param('上级部门不存在');
      if (parent.status === 0) throw Errors.param('上级部门已停用');
    }
    try {
      const dept = await this.deptRepo.save(this.deptRepo.create({ parentId: parentId ?? null, name, sort }));
      this.invalidate();
      this.audit.log({
        actor_id: actorId, actor_name: actorName, action: 'department.create', object_type: 'sys_department',
        object_id: dept.id, detail: { name, parent_id: parentId }, result: 'success', source_ip: ip,
      });
      return dept;
    } catch (e: any) {
      if (String(e?.code) === 'ER_DUP_ENTRY') throw Errors.param('同一父部门下部门名已存在');
      throw e;
    }
  }

  async update(id: string, patch: { name?: string; sort?: number }, actorId: number, actorName: string, ip: string | null) {
    const dept = await this.deptRepo.findOne({ where: { id } });
    if (!dept) throw Errors.notFound('部门不存在');
    if (patch.name !== undefined) dept.name = patch.name;
    if (patch.sort !== undefined) dept.sort = patch.sort;
    try {
      await this.deptRepo.save(dept);
    } catch (e: any) {
      if (String(e?.code) === 'ER_DUP_ENTRY') throw Errors.param('同一父部门下部门名已存在');
      throw e;
    }
    this.invalidate();
    // 部门重命名后发布范围与统计按 department_id 实时关联自动同步（FR-ORG-02 验收③）
    this.audit.log({
      actor_id: actorId, actor_name: actorName, action: 'department.update', object_type: 'sys_department',
      object_id: id, detail: patch, result: 'success', source_ip: ip,
    });
    return dept;
  }

  /** 层级调整（事务 + 循环引用检测，05 册 2.4.3） */
  async moveParent(id: string, newParentId: string | null, actorId: number, actorName: string, ip: string | null) {
    if (id === newParentId) throw Errors.param('不能将部门移动到其自身之下');
    const dept = await this.deptRepo.findOne({ where: { id } });
    if (!dept) throw Errors.notFound('部门不存在');
    let newParent: SysDepartment | null = null;
    if (newParentId !== null) {
      newParent = await this.deptRepo.findOne({ where: { id: newParentId } });
      if (!newParent) throw Errors.notFound('目标上级部门不存在');
    }
    if (dept.parentId === null && newParentId !== null) throw Errors.param('根部门不可移动');
    // 循环引用检测：从新 parent 沿 parent_id 链上行，遇到自身即成环
    if (newParent) {
      let cur: SysDepartment | null = newParent;
      let guard = 0;
      while (cur && guard++ < 64) {
        if (cur.id === dept.id) throw Errors.param('不能将部门移动到其自身或其子孙部门之下');
        cur = cur.parentId ? await this.deptRepo.findOne({ where: { id: cur.parentId } }) : null;
      }
    }
    try {
      await this.deptRepo.update(id, { parentId: newParentId });
    } catch (e: any) {
      if (String(e?.code) === 'ER_DUP_ENTRY') throw Errors.param('同一父部门下部门名已存在');
      throw e;
    }
    this.invalidate();
    this.audit.log({
      actor_id: actorId, actor_name: actorName, action: 'department.move', object_type: 'sys_department',
      object_id: id, detail: { new_parent_id: newParentId }, result: 'success', source_ip: ip,
    });
    const updated = await this.deptRepo.findOne({ where: { id } });
    if (!updated) throw Errors.notFound('部门不存在');
    return updated;
  }

  /** 删除：仅允许零引用部门（子部门 / 在职员工 / 发布范围引用任一命中即拒绝，05 册 2.4.3） */
  async remove(id: string, actorId: number, actorName: string, ip: string | null) {
    const dept = await this.deptRepo.findOne({ where: { id } });
    if (!dept) throw Errors.notFound('部门不存在');
    if (id === '1') throw Errors.param('根部门不可删除');
    const childCount = await this.deptRepo.count({ where: { parentId: id } });
    if (childCount > 0) throw Errors.param('存在子部门，不可删除');
    const userCount = await this.deptRepo.manager
      .getRepository(SysUser)
      .count({ where: { departmentId: id, status: 1 } });
    if (userCount > 0) throw Errors.param('仍有在职员工归属该部门，请先转移员工');
    const scopeCount = await this.deptRepo.manager
      .getRepository(RegulationScope)
      .count({ where: { departmentId: id } });
    if (scopeCount > 0) throw Errors.param('该部门被制度发布范围引用，不可删除');
    await this.deptRepo.remove(dept);
    this.invalidate();
    this.audit.log({
      actor_id: actorId, actor_name: actorName, action: 'department.delete', object_type: 'sys_department',
      object_id: id, detail: { name: dept.name }, result: 'success', source_ip: ip,
    });
  }

  /** 停用/启用（05 册 2.4.3）：仍被引用的部门以停用替代删除，保留为历史学习/考试的统计维度 */
  async setStatus(id: string, status: 0 | 1, actorId: number, actorName: string, ip: string | null) {
    const dept = await this.deptRepo.findOne({ where: { id } });
    if (!dept) throw Errors.notFound('部门不存在');
    if (dept.status !== status) {
      dept.status = status;
      await this.deptRepo.save(dept);
      this.invalidate();
      this.audit.log({
        actor_id: actorId, actor_name: actorName, action: 'department.status', object_type: 'sys_department',
        object_id: id, detail: { name: dept.name, status }, result: 'success', source_ip: ip,
      });
    }
    return dept;
  }

  async findByIds(ids: string[]): Promise<SysDepartment[]> {
    if (!ids.length) return [];
    return this.deptRepo.find({ where: { id: In(ids) } });
  }
}
