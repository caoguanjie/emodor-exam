import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { Regulation } from '../../entities/regulation.entity';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { ParsePipelineService } from '../regulations/parse-pipeline.service';
import { RegulationVersionService } from '../regulations/regulation-version.service';

export const QUESTION_MATERIAL_CATEGORY = 'question_material';

type Actor = { id: number; name: string };

@Injectable()
export class QuestionMaterialsService {
  constructor(
    @InjectRepository(Regulation) private readonly materialRepo: Repository<Regulation>,
    @InjectRepository(RegulationVersion) private readonly versionRepo: Repository<RegulationVersion>,
    private readonly versions: RegulationVersionService,
    private readonly parsePipeline: ParsePipelineService,
    private readonly audit: AuditService,
  ) {}

  private materialView(material: Regulation) {
    return {
      id: String(material.id),
      title: material.title,
      description: material.description,
    };
  }

  private versionView(version: RegulationVersion) {
    return {
      id: String(version.id),
      version_no: Number(version.versionNo),
      file_type: version.fileType,
      parse_status: version.parseStatus,
      failure_reason: version.parseStatus === 'failed' ? '文件解析失败，请重试或上传新版本' : null,
    };
  }

  private async material(id: string): Promise<Regulation> {
    const material = await this.materialRepo.findOne({
      where: { id: String(id), category: QUESTION_MATERIAL_CATEGORY },
    });
    if (!material) throw Errors.notFound('出题资料不存在');
    return material;
  }

  async list(query: { page?: number; page_size?: number; keyword?: string }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const builder = this.materialRepo.createQueryBuilder('material')
      .where('material.category = :category', { category: QUESTION_MATERIAL_CATEGORY });
    const keyword = String(query.keyword || '').trim();
    if (keyword) builder.andWhere('material.title LIKE :keyword', { keyword: `%${keyword}%` });
    const total = await builder.getCount();
    const rows = await builder.orderBy('material.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();
    return { items: rows.map((row) => this.materialView(row)), total, page, page_size: pageSize };
  }

  async detail(id: string) {
    const material = await this.material(id);
    const versions = await this.versionRepo.find({
      where: { regulationId: String(material.id) },
      order: { versionNo: 'DESC' },
    });
    return { ...this.materialView(material), versions: versions.map((version) => this.versionView(version)) };
  }

  async status(materialId: string, versionId: string) {
    const material = await this.material(materialId);
    const version = await this.versionRepo.findOne({
      where: { id: String(versionId), regulationId: String(material.id) },
    });
    if (!version) throw Errors.notFound('资料版本不存在');
    return { material_id: String(material.id), ...this.versionView(version) };
  }

  async upload(materialId: string, file: Express.Multer.File, actor: Actor, sourceIp: string | null) {
    const material = await this.material(materialId);
    const result = await this.versions.upload(String(material.id), file, actor, sourceIp);
    this.parsePipeline.enqueue(String(result.version_id));
    return {
      id: String(result.version_id),
      version_no: Number(result.version_no),
      file_type: result.file_type,
      parse_status: result.parse_status,
      duplicate_hint: result.duplicate_hint,
    };
  }

  async retry(materialId: string, versionId: string, actor: Actor, sourceIp: string | null) {
    const material = await this.material(materialId);
    const result = await this.versions.retryParse(String(material.id), String(versionId), actor, sourceIp);
    this.parsePipeline.enqueue(String(result.version_id));
    return {
      material_id: String(material.id),
      id: String(result.version_id),
      parse_status: result.parse_status,
      retry_count: Number(result.retry_count),
    };
  }

  async create(input: { title: string; description?: string | null }, actor: Actor, sourceIp: string | null) {
    const title = input.title.trim();
    if (!title) throw Errors.param('资料标题不能为空');
    const material = await this.materialRepo.save(this.materialRepo.create({
      title,
      description: input.description?.trim() || null,
      category: QUESTION_MATERIAL_CATEGORY,
      categoryId: null,
      status: 'draft',
      currentVersionId: null,
      requiredMinutes: 10,
      scrollSegments: 10,
      publishedAt: null,
      createdBy: String(actor.id),
    }));
    this.audit.log({
      actor_id: actor.id,
      actor_name: actor.name,
      action: 'question_material.create',
      object_type: 'question_material',
      object_id: String(material.id),
      detail: { title: material.title },
      result: 'success',
      source_ip: sourceIp,
    });
    return this.materialView(material);
  }
}
