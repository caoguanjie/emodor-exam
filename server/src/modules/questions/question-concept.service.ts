import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import type { QuestionType } from '../../common/training-contracts';
import { QuestionConcept } from '../../entities/question-concept.entity';
import { AuditService } from '../../common/audit.service';
import { CategoryService } from '../training/category.service';

@Injectable()
export class QuestionConceptService {
  constructor(
    @InjectRepository(QuestionConcept) private readonly conceptRepo: Repository<QuestionConcept>,
    private readonly dataSource: DataSource,
    private readonly categories: CategoryService,
    private readonly audit: AuditService,
  ) {}

  async assertCompatible(manager: EntityManager, conceptId: string, categoryId: string, type: QuestionType): Promise<QuestionConcept> {
    const concept = await manager.getRepository(QuestionConcept).findOne({ where: { id: String(conceptId) } });
    if (!concept) throw Errors.notFound('考点不存在');
    if (String(concept.categoryId) !== String(categoryId) || concept.type !== type) {
      throw Errors.param('考点必须与题目属于同一类别和题型');
    }
    return concept;
  }

  async list(input: { categoryId: string; type?: QuestionType; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(input.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 20)));
    const qb = this.conceptRepo.createQueryBuilder('concept')
      .where('concept.category_id = :categoryId', { categoryId: String(input.categoryId) });
    if (input.type) qb.andWhere('concept.type = :type', { type: input.type });
    if (input.keyword?.trim()) qb.andWhere('concept.name LIKE :keyword', { keyword: `%${input.keyword.trim()}%` });
    const total = await qb.getCount();
    const rows = await qb.orderBy('concept.id', 'ASC').skip((page - 1) * pageSize).take(pageSize).getMany();
    return {
      items: rows.map((row) => ({ id: String(row.id), category_id: String(row.categoryId), type: row.type, name: row.name })),
      total,
      page,
      page_size: pageSize,
    };
  }

  async options(input: { categoryId: string; type: QuestionType; page?: number; pageSize?: number; keyword?: string }) {
    await this.categories.assertActive(String(input.categoryId));
    const page = Math.max(1, Number(input.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 20)));
    const qb = this.conceptRepo.createQueryBuilder('concept')
      .where('concept.category_id = :categoryId', { categoryId: String(input.categoryId) })
      .andWhere('concept.type = :type', { type: input.type });
    if (input.keyword?.trim()) qb.andWhere('concept.name LIKE :keyword', { keyword: `%${input.keyword.trim()}%` });
    const total = await qb.getCount();
    const rows = await qb.orderBy('concept.id', 'ASC').skip((page - 1) * pageSize).take(pageSize).getMany();
    return {
      items: rows.map((row) => ({ id: String(row.id), name: row.name })),
      total,
      page,
      page_size: pageSize,
    };
  }

  async create(input: { categoryId: string; type: QuestionType; name: string }, actorId: string, actorName = '', ip: string | null = null) {
    const name = String(input.name || '').trim();
    if (!name || name.length > 128) throw Errors.param('考点名称必填且不超过 128 个字符');
    const concept = await this.dataSource.transaction(async (manager) => {
      await this.categories.lockActive(manager, input.categoryId);
      try {
        return await manager.getRepository(QuestionConcept).save(manager.getRepository(QuestionConcept).create({
          categoryId: String(input.categoryId), type: input.type, name, createdBy: String(actorId),
        }));
      } catch (error: any) {
        if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('该类别和题型下已存在同名考点');
        throw error;
      }
    });
    this.audit.log({
      actor_id: Number(actorId), actor_name: actorName, action: 'question_concept.create', object_type: 'question_concept',
      object_id: concept.id, detail: { category_id: input.categoryId, type: input.type }, result: 'success', source_ip: ip,
    });
    return { id: String(concept.id), category_id: String(concept.categoryId), type: concept.type, name: concept.name };
  }
}
