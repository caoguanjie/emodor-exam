import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrainingCategory } from '../../entities/training-category.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { Errors } from '../../common/errors';
import { AuditService } from '../../common/audit.service';

export interface CategoryActor {
  id: string | number;
  name: string;
}

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(TrainingCategory) private readonly categoryRepo: Repository<TrainingCategory>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly audit: AuditService,
  ) {}

  private sanitize(category: TrainingCategory) {
    return {
      id: String(category.id),
      name: category.name,
      description: category.description,
      status: Number(category.status),
      created_by: String(category.createdBy),
      created_at: category.createdAt,
      updated_at: category.updatedAt,
    };
  }

  async assertActive(id: string): Promise<void> {
    const category = await this.categoryRepo.findOne({ where: { id: String(id) } });
    if (!category || Number(category.status) !== 1) throw Errors.categoryInactive();
  }

  async list(query: { page?: number; page_size?: number; keyword?: string; status?: number }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.categoryRepo.createQueryBuilder('c');
    if (query.keyword?.trim()) qb.andWhere('c.name LIKE :keyword', { keyword: `%${query.keyword.trim()}%` });
    if (query.status !== undefined && query.status !== null && (query as any).status !== '') {
      qb.andWhere('c.status = :status', { status: Number(query.status) });
    }
    qb.orderBy('c.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items: rows.map((row) => this.sanitize(row)), total, page, page_size: pageSize };
  }

  async detail(id: string) {
    const category = await this.categoryRepo.findOne({ where: { id: String(id) } });
    if (!category) throw Errors.notFound('培训类别不存在');
    return this.sanitize(category);
  }

  private validateName(name: string) {
    const normalized = String(name || '').trim();
    if (!normalized || normalized.length > 128) throw Errors.param('培训类别名称必填且不超过 128 个字符');
    return normalized;
  }

  async create(input: { name: string; description?: string | null }, actor: CategoryActor, ip: string | null) {
    const name = this.validateName(input.name);
    try {
      const saved = await this.categoryRepo.save(this.categoryRepo.create({
        name,
        description: input.description?.trim() || null,
        status: 1,
        createdBy: String(actor.id),
      }));
      this.audit.log({
        actor_id: Number(actor.id), actor_name: actor.name, action: 'training_category.create',
        object_type: 'training_category', object_id: saved.id, detail: { name }, result: 'success', source_ip: ip,
      });
      return this.sanitize(saved);
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('培训类别名称已存在');
      throw error;
    }
  }

  async update(id: string, input: { name?: string; description?: string | null }, actor: CategoryActor, ip: string | null) {
    const category = await this.categoryRepo.findOne({ where: { id: String(id) } });
    if (!category) throw Errors.notFound('培训类别不存在');
    if (input.name !== undefined) category.name = this.validateName(input.name);
    if (input.description !== undefined) category.description = input.description?.trim() || null;
    try {
      await this.categoryRepo.save(category);
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('培训类别名称已存在');
      throw error;
    }
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: 'training_category.update',
      object_type: 'training_category', object_id: id, detail: { name: category.name }, result: 'success', source_ip: ip,
    });
    return this.sanitize(category);
  }

  async setStatus(id: string, status: 0 | 1, actor: CategoryActor, ip: string | null) {
    const category = await this.categoryRepo.findOne({ where: { id: String(id) } });
    if (!category) throw Errors.notFound('培训类别不存在');
    category.status = status;
    await this.categoryRepo.save(category);
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: 'training_category.status',
      object_type: 'training_category', object_id: id, detail: { status }, result: 'success', source_ip: ip,
    });
    return this.sanitize(category);
  }

  async remove(id: string, actor: CategoryActor, ip: string | null) {
    const category = await this.categoryRepo.findOne({ where: { id: String(id) } });
    if (!category) throw Errors.notFound('培训类别不存在');
    const referenced = await this.userRepo.count({ where: { categoryId: String(id) } });
    if (referenced > 0) throw Errors.categoryInactive('培训类别已被学员引用，不能删除');
    await this.categoryRepo.remove(category);
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: 'training_category.delete',
      object_type: 'training_category', object_id: id, detail: {}, result: 'success', source_ip: ip,
    });
    return null;
  }

  async findById(id: string) {
    return this.categoryRepo.findOne({ where: { id: String(id) } });
  }

  async findByName(name: string) {
    return this.categoryRepo.findOne({ where: { name: String(name).trim() } });
  }
}
