import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegulationScope } from '../../entities/regulation-scope.entity';
import { DepartmentService } from '../departments/department.service';

export interface ScopeConfig {
  isAll: boolean;
  departmentIds: string[];
}

/** Read-only historical scope lookup retained by legacy learning and fixed exams. */
@Injectable()
export class RegulationScopeService {
  constructor(
    @InjectRepository(RegulationScope) private readonly scopeRepo: Repository<RegulationScope>,
    private readonly departments: DepartmentService,
  ) {}

  async getScope(regulationId: string): Promise<ScopeConfig> {
    const rows = await this.scopeRepo.find({ where: { regulationId } });
    if (rows.some((row) => row.isAll === 1)) return { isAll: true, departmentIds: [] };
    return {
      isAll: false,
      departmentIds: rows.map((row) => row.departmentId).filter((id): id is string => Boolean(id)),
    };
  }

  async isUserInScope(
    regulationId: string,
    user: { id: number; role: string; departmentId: string | null },
  ): Promise<boolean> {
    void user.id;
    const scope = await this.getScope(regulationId);
    if (scope.isAll) return true;
    if (!scope.departmentIds.length || !user.departmentId) return false;
    const targetDepartments = await this.departments.expandWithChildren(scope.departmentIds);
    const ancestors = await this.departments.ancestorChain(user.departmentId);
    for (const departmentId of ancestors) {
      if (targetDepartments.has(departmentId)) return true;
    }
    return false;
  }
}
