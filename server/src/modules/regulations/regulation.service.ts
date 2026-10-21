import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Regulation } from '../../entities/regulation.entity';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { Errors, RegulationStatus } from '../../common/errors';
import { RegulationScopeService } from './regulation-scope.service';
import { ParsePipelineService } from './parse-pipeline.service';
import { CategoryService } from '../training/category.service';
import { AuditService } from '../../common/audit.service';

/**
 * 制度主档服务（05 册 3.3）：创建/编辑、学习要求配置、状态机
 * draft → published（前置：生效版本 parsed + 已配范围，C-04）→ archived。
 */
@Injectable()
export class RegulationService {
  constructor(
    @InjectRepository(Regulation) private readonly regRepo: Repository<Regulation>,
    @InjectRepository(RegulationVersion) private readonly versionRepo: Repository<RegulationVersion>,
    private readonly scopeService: RegulationScopeService,
    private readonly parsePipeline: ParsePipelineService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    private readonly categories: CategoryService,
  ) {}

  sanitize(r: Regulation) {
    return {
      id: Number(r.id),
      title: r.title,
      category: r.category,
      category_id: r.categoryId ? String(r.categoryId) : null,
      description: r.description,
      status: r.status,
      current_version_id: r.currentVersionId ? Number(r.currentVersionId) : null,
      required_minutes: r.requiredMinutes,
      scroll_segments: r.scrollSegments,
      published_at: r.publishedAt,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  async list(query: { page?: number; page_size?: number; keyword?: string; category?: string; status?: string }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.regRepo.createQueryBuilder('r');
    if (query.keyword) qb.andWhere('r.title LIKE :kw', { kw: `%${query.keyword}%` });
    if (query.category) qb.andWhere('r.category = :category', { category: query.category });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    qb.orderBy('r.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { list: rows.map((r) => this.sanitize(r)), total, page, page_size: pageSize };
  }

  async detail(id: string) {
    const r = await this.regRepo.findOne({ where: { id } });
    if (!r) throw Errors.notFound('制度不存在');
    const scope = await this.scopeService.getScope(id);
    // API 出参统一 snake_case（04 册信封口径）：ScopeConfig 内部为驼峰，序列化时显式映射
    return {
      ...this.sanitize(r),
      scope: { is_all: scope.isAll, department_ids: scope.departmentIds.map(String) },
    };
  }

  async create(input: { title: string; category: string; category_id?: string | null; description?: string | null }, actor: { id: number; name: string }, ip: string | null) {
    const categoryId = this.trainingCategoryId(input.category_id);
    const r = await this.dataSource.transaction(async (manager) => {
      if (categoryId) await this.categories.lockActive(manager, categoryId);
      const repo = manager.getRepository(Regulation);
      return repo.save(repo.create({
        title: input.title,
        category: input.category,
        categoryId,
        description: input.description || null,
        status: RegulationStatus.DRAFT,
        createdBy: String(actor.id),
      }));
    });
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'regulation.create', object_type: 'regulation',
      object_id: r.id, detail: { title: input.title }, result: 'success', source_ip: ip,
    });
    return this.sanitize(r);
  }

  async update(id: string, patch: { title?: string; category?: string; category_id?: string | null; description?: string | null }, actor: { id: number; name: string }, ip: string | null) {
    const requestedCategoryId = this.trainingCategoryId(patch.category_id);
    const r = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Regulation);
      const row = await repo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw Errors.notFound('制度不存在');
      if (patch.category_id !== undefined && String(requestedCategoryId || '') !== String(row.categoryId || '')) {
        if (requestedCategoryId) await this.categories.lockActive(manager, requestedCategoryId);
        row.categoryId = requestedCategoryId;
      }
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.category !== undefined) row.category = patch.category;
      if (patch.description !== undefined) row.description = patch.description;
      return repo.save(row);
    });
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'regulation.update', object_type: 'regulation',
      object_id: id, detail: patch as any, result: 'success', source_ip: ip,
    });
    return this.sanitize(r);
  }

  private trainingCategoryId(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const id = String(value);
    if (!/^[1-9]\d*$/.test(id)) throw Errors.param('category_id 必须是字符串 ID 或 null');
    return id;
  }

  /** 学习要求配置（FR-REG-05）：required_minutes ≥ 1；scroll_segments 本期仅接受 10 */
  async updateLearningConfig(id: string, cfg: { required_minutes: number; scroll_segments: number }, actor: { id: number; name: string }, ip: string | null) {
    if (!Number.isInteger(cfg.required_minutes) || cfg.required_minutes < 1) {
      throw Errors.param('required_minutes 须为正整数（分钟）');
    }
    if (cfg.scroll_segments !== 10) {
      throw Errors.param('scroll_segments 本期固定为 10（配置项前向保留）');
    }
    const r = await this.regRepo.findOne({ where: { id } });
    if (!r) throw Errors.notFound('制度不存在');
    r.requiredMinutes = cfg.required_minutes;
    r.scrollSegments = cfg.scroll_segments;
    await this.regRepo.save(r);
    // 已达标 learning_record.is_valid 不因调低阈值回退（判定单调，FR-REG-05 验收③）
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'regulation.learning_config', object_type: 'regulation',
      object_id: id, detail: cfg, result: 'success', source_ip: ip,
    });
    return this.sanitize(r);
  }

  /** 发布（FR-REG-07 前置校验，C-04）：生效版本 parsed + 已配置发布范围 */
  async publish(id: string, actor: { id: number; name: string }, ip: string | null) {
    const r = await this.regRepo.findOne({ where: { id } });
    if (!r) throw Errors.notFound('制度不存在');
    if (r.status === RegulationStatus.PUBLISHED) return this.sanitize(r);
    if (r.status === RegulationStatus.ARCHIVED) throw Errors.param('已归档制度不可发布');
    if (!r.currentVersionId) throw Errors.publishCheckFailed('发布校验未通过：请先上传制度文件并设置生效版本');
    const version = await this.versionRepo.findOne({ where: { id: r.currentVersionId } });
    if (!version || version.parseStatus !== 'parsed') {
      throw Errors.publishCheckFailed('发布校验未通过：生效版本尚未解析成功（parse_status ≠ parsed）');
    }
    const scopeOk = await this.scopeService.isConfigured(id);
    if (!scopeOk) throw Errors.publishCheckFailed('发布校验未通过：请先配置发布范围（按部门圈定或面向全员）');
    r.status = RegulationStatus.PUBLISHED;
    if (!r.publishedAt) r.publishedAt = new Date();
    await this.regRepo.save(r);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'regulation.publish', object_type: 'regulation',
      object_id: id, detail: { current_version_id: Number(r.currentVersionId) }, result: 'success', source_ip: ip,
    });
    return this.sanitize(r);
  }

  /** 归档（C-08：止学止考，历史数据保留并计入统计） */
  async archive(id: string, actor: { id: number; name: string }, ip: string | null) {
    const r = await this.regRepo.findOne({ where: { id } });
    if (!r) throw Errors.notFound('制度不存在');
    if (r.status === RegulationStatus.ARCHIVED) return this.sanitize(r);
    r.status = RegulationStatus.ARCHIVED;
    await this.regRepo.save(r);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'regulation.archive', object_type: 'regulation',
      object_id: id, detail: {}, result: 'success', source_ip: ip,
    });
    return this.sanitize(r);
  }

  async findById(id: string) {
    return this.regRepo.findOne({ where: { id } });
  }

  async findByIds(ids: string[]) {
    if (!ids.length) return [];
    return this.regRepo.find({ where: { id: In(ids) } });
  }
}
