import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Question, QuestionOption } from '../../entities/question.entity';
import { Errors } from '../../common/errors';
import type { Difficulty, QuestionType } from '../../common/training-contracts';
import { AuditService } from '../../common/audit.service';
import { QuestionVersionService, type QuestionDraft } from './question-version.service';
import { sanitizeQuestionRichTextForDisplay } from './question-validator';
import type { QuestionListQueryDto } from './question.dto';

type QuestionPatch = {
  category_id?: string;
  difficulty?: Difficulty;
  type?: QuestionType;
  stem?: string;
  options?: QuestionOption[];
  answer?: number[];
  analysis?: string | null;
  content_schema_version?: number;
  content_json?: any;
};

@Injectable()
export class QuestionBankService {
  constructor(
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    private readonly versions: QuestionVersionService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  private async questionView(q: Question) {
    const current = await this.versions.current(String(q.id));
    return {
      id: Number(q.id),
      material_id: q.regulationId === null ? null : String(q.regulationId),
      material_version_id: q.versionId === null ? null : String(q.versionId),
      type: q.type,
      stem: sanitizeQuestionRichTextForDisplay(q.stem) || '',
      options: q.options.map((option) => ({ ...option, text: sanitizeQuestionRichTextForDisplay(option.text) || '' })),
      answer: q.answer,
      analysis: sanitizeQuestionRichTextForDisplay(q.analysis),
      content_schema_version: q.contentSchemaVersion || 1,
      content_json: q.contentJson || null,
      enabled: Boolean(q.isEnabled),
      source: q.source,
      created_at: q.createdAt,
      updated_at: q.updatedAt,
      question_id: String(q.id),
      current_version_id: q.currentVersionId ? String(q.currentVersionId) : null,
      category_id: q.categoryId ? String(q.categoryId) : null,
      difficulty: q.difficulty,
      revision: current ? Number(current.revision) : null,
    };
  }

  async list(query: QuestionListQueryDto) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.questionRepo.createQueryBuilder('q');
    if (query.material_id) qb.andWhere('q.regulation_id = :materialId', { materialId: String(query.material_id) });
    if (query.category_id) qb.andWhere('q.category_id = :categoryId', { categoryId: String(query.category_id) });
    if (query.enabled !== undefined) qb.andWhere('q.is_enabled = :enabled', { enabled: query.enabled });
    if (query.type) qb.andWhere('q.type = :type', { type: query.type });
    if (query.difficulty) qb.andWhere('q.difficulty = :difficulty', { difficulty: query.difficulty });
    if (query.keyword?.trim()) qb.andWhere('q.stem LIKE :kw', { kw: `%${query.keyword.trim()}%` });
    qb.orderBy('q.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { list: await Promise.all(rows.map((q) => this.questionView(q))), total, page, page_size: pageSize };
  }

  async getOne(id: string) {
    const q = await this.questionRepo.findOne({ where: { id: String(id) } });
    if (!q) throw Errors.notFound('题目不存在');
    return this.questionView(q);
  }

  async history(id: string, query: { page?: number; page_size?: number }) {
    const q = await this.questionRepo.findOne({ where: { id: String(id) } });
    if (!q) throw Errors.notFound('题目不存在');
    return this.versions.history(String(id), { page: query.page, pageSize: query.page_size });
  }

  private async assertNotInLiveExam(questionId: string) {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('1')
      .from('exam_record', 'er')
      .innerJoin('paper_question', 'pq', 'pq.paper_id = er.paper_id')
      .where('er.status = :status', { status: 'in_progress' })
      .andWhere('pq.question_id = :qid', { qid: questionId })
      .limit(1)
      .getRawOne();
    if (row) throw Errors.questionInUse();
  }

  private async assertTypeChangeAllowed(questionId: string, currentType: string, nextType: string | undefined) {
    if (!nextType || nextType === currentType) return;
    const row = await this.dataSource
      .createQueryBuilder()
      .select('1')
      .from('paper_question', 'pq')
      .where('pq.question_id = :qid', { qid: questionId })
      .limit(1)
      .getRawOne();
    if (row) throw Errors.questionInUse('题目已被 legacy 固定试卷引用，不能变更题型');
  }

  private draftFromQuestion(q: Question, patch: QuestionPatch): QuestionDraft {
    const categoryId = patch.category_id ?? q.categoryId;
    const difficulty = patch.difficulty ?? q.difficulty;
    const type = patch.type ?? q.type;
    if (!categoryId) throw Errors.param('category_id 必填；旧题不会自动归入培训池');
    if (!difficulty) throw Errors.param('difficulty 必填；旧题不会自动伪造难度');
    return {
      categoryId: String(categoryId),
      difficulty: difficulty as Difficulty,
      type: type as QuestionType,
      stem: patch.stem ?? q.stem,
      options: patch.options ?? q.options,
      answer: patch.answer ?? q.answer,
      analysis: patch.analysis === undefined ? q.analysis : patch.analysis,
      contentSchemaVersion: patch.content_schema_version,
      contentJson: patch.content_json,
      regulationId: q.regulationId ? String(q.regulationId) : undefined,
      regulationVersionId: q.versionId ? String(q.versionId) : undefined,
      source: q.source as QuestionDraft['source'],
    };
  }

  async edit(
    id: string,
    patch: QuestionPatch,
    actor: { id: number; name: string },
    ip: string | null,
    expectedVersionId: string | null,
    expectedEnabled: boolean,
  ) {
    const q = await this.questionRepo.findOne({ where: { id: String(id) } });
    if (!q) throw Errors.notFound('题目不存在');
    await this.assertTypeChangeAllowed(String(q.id), q.type, patch.type);
    const touchingCore = ['category_id', 'difficulty', 'type', 'stem', 'options', 'answer', 'content_json']
      .some((field) => (patch as Record<string, unknown>)[field] !== undefined);
    if (touchingCore) await this.assertNotInLiveExam(id);
    const editedFields = Object.keys(patch);
    const versionId = await this.versions.revise(
      String(q.id), this.draftFromQuestion(q, patch), String(actor.id), expectedVersionId, expectedEnabled,
    );
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'question.edit', object_type: 'question', object_id: id,
      detail: { version_id: versionId, fields: editedFields }, result: 'success', source_ip: ip,
    });
    return { ...await this.getOne(id), saved_version_id: String(versionId) };
  }

  async createManual(input: {
    category_id: string; difficulty: Difficulty;
    type: QuestionType; stem: string; options: QuestionOption[]; answer: number[]; analysis?: string | null;
    content_schema_version?: number; content_json?: any;
  }, actor: { id: number; name: string }, ip: string | null) {
    const created = await this.versions.create({
      categoryId: String(input.category_id), difficulty: input.difficulty, type: input.type, stem: input.stem,
      options: input.options, answer: input.answer, analysis: input.analysis || null,
      contentSchemaVersion: input.content_schema_version, contentJson: input.content_json,
      source: 'manual',
    }, String(actor.id));
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'question.create_manual', object_type: 'question',
      object_id: created.questionId, detail: { version_id: created.versionId, category_id: input.category_id, type: input.type },
      result: 'success', source_ip: ip,
    });
    return { ...await this.getOne(created.questionId), saved_version_id: String(created.versionId) };
  }

  async setEnabled(id: string, enabled: boolean, expectedVersionId: string | null, actor: { id: number; name: string }, ip: string | null) {
    if (typeof enabled !== 'boolean') throw Errors.param('enabled 必须是布尔值');
    const change = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Question);
      const q = enabled ? await this.versions.lockIdentityForLifecycle(String(id), manager)
        : await repo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      if (!q) throw Errors.notFound('题目不存在');
      if ((q.currentVersionId ? String(q.currentVersionId) : null) !== expectedVersionId) throw Errors.questionVersionConflict();
      const previous = Boolean(q.isEnabled);
      if (previous === enabled) return null;
      if (enabled) await this.versions.assertCurrentUsable(String(id), manager);
      q.isEnabled = enabled;
      await repo.save(q);
      return { from_enabled: previous, to_enabled: enabled, version_id: q.currentVersionId ? String(q.currentVersionId) : null };
    });
    if (change) this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'question.set_enabled', object_type: 'question', object_id: id,
      detail: change, result: 'success', source_ip: ip,
    });
    return this.getOne(id);
  }
}
