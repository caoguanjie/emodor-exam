import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysDepartment } from '../../entities/sys-department.entity';

/** Read-only historical department lookup retained for legacy regulation scope checks. */
@Injectable()
export class DepartmentService {
  private cache: { all: Map<string, SysDepartment>; builtAt: number } | null = null;

  constructor(
    @InjectRepository(SysDepartment) private readonly deptRepo: Repository<SysDepartment>,
  ) {}

  private async all(): Promise<Map<string, SysDepartment>> {
    if (!this.cache || Date.now() - this.cache.builtAt > 60_000) {
      const rows = await this.deptRepo.find({ order: { sort: 'ASC', id: 'ASC' } });
      this.cache = { all: new Map(rows.map((row) => [String(row.id), row])), builtAt: Date.now() };
    }
    return this.cache.all;
  }

  async expandWithChildren(departmentIds: string[]): Promise<Set<string>> {
    const all = await this.all();
    const children = new Map<string, string[]>();
    for (const department of all.values()) {
      if (!department.parentId) continue;
      const parentId = String(department.parentId);
      const ids = children.get(parentId) || [];
      ids.push(String(department.id));
      children.set(parentId, ids);
    }
    const result = new Set<string>();
    const stack = departmentIds.map(String).filter((id) => all.has(id));
    while (stack.length) {
      const current = stack.pop()!;
      if (result.has(current)) continue;
      result.add(current);
      stack.push(...(children.get(current) || []));
    }
    return result;
  }

  async ancestorChain(departmentId: string | null): Promise<Set<string>> {
    const result = new Set<string>();
    if (!departmentId) return result;
    const all = await this.all();
    let current = all.get(String(departmentId)) || null;
    let depth = 0;
    while (current && depth++ < 32) {
      result.add(String(current.id));
      current = current.parentId ? all.get(String(current.parentId)) || null : null;
    }
    return result;
  }
}
