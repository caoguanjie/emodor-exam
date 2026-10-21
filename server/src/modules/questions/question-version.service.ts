import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import type { Difficulty, QuestionOption, QuestionType } from '../../common/training-contracts';
import { Question } from '../../entities/question.entity';
import { QuestionVersion } from '../../entities/question-version.entity';
import { Regulation } from '../../entities/regulation.entity';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { AccessService } from '../access/access.service';
import { MediaService } from '../media/media.service';
import { CategoryService } from '../training/category.service';
import { QuestionConceptService } from './question-concept.service';
import {
  controlledQuestionMediaIds,
  sanitizeQuestionRichTextForDisplay,
  validateAndSanitizeQuestionDraft,
  type QuestionDraftInput,
  type ValidatedQuestionDraft,
} from './question-validator';

export type QuestionDraft = QuestionDraftInput;
export interface CandidateFilter {
  categoryId: string;
  regulationIds?: string[];
  type: QuestionType;
  difficulty: Difficulty;
}
export type QuestionVersionSnapshot = Readonly<QuestionDraft & {
  questionId: string;
  versionId: string;
  revision: number;
  approvedBy: string | null;
  approvedAt: string | null;
}>;

const QUESTION_VERSION_MEDIA_OWNER = 'question_version';

@Injectable()
export class QuestionVersionService implements OnModuleInit {
  constructor(
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    @InjectRepository(QuestionVersion) private readonly versionRepo: Repository<QuestionVersion>,
    @InjectRepository(Regulation) private readonly regulationRepo: Repository<Regulation>,
    @InjectRepository(RegulationVersion) private readonly regulationVersionRepo: Repository<RegulationVersion>,
    private readonly dataSource: DataSource,
    private readonly categories: CategoryService,
    private readonly concepts: QuestionConceptService,
    private readonly media: MediaService,
    private readonly access: AccessService,
  ) {}

  onModuleInit(): void {
    this.media.registerOwnerPolicy(QUESTION_VERSION_MEDIA_OWNER, {
      allowedPurposes: ['question'],
      authorizeRead: async (actorId) => (await this.access.permissions(actorId)).includes('questions:read'),
      validateBinding: async (manager, _asset, businessId) => {
        const exists = await manager.getRepository(QuestionVersion).findOne({ where: { id: String(businessId) } });
        if (!exists) throw Errors.notFound('题目版本不存在');
      },
    });
  }

  private async assertSource(draft: ValidatedQuestionDraft, manager?: EntityManager): Promise<void> {
    if (!draft.regulationId && !draft.regulationVersionId) return;
    const regulationRepo = manager?.getRepository(Regulation) || this.regulationRepo;
    const regulationVersionRepo = manager?.getRepository(RegulationVersion) || this.regulationVersionRepo;
    const regulation = await regulationRepo.findOne({ where: { id: draft.regulationId! } });
    if (!regulation) throw Errors.notFound('制度不存在');
    if (draft.regulationVersionId) {
      const version = await regulationVersionRepo.findOne({
        where: { id: draft.regulationVersionId, regulationId: draft.regulationId! },
      });
      if (!version) throw Errors.param('regulation_version_id 与制度不匹配');
    }
  }

  private async assertRelations(manager: EntityManager, draft: ValidatedQuestionDraft): Promise<void> {
    await this.categories.lockActive(manager, draft.categoryId);
    if (draft.conceptId) await this.concepts.assertCompatible(manager, draft.conceptId, draft.categoryId, draft.type);
  }

  private assertExpectedVersion(question: Question, expectedVersionId: string | null | undefined): void {
    if (expectedVersionId === undefined) return;
    const actual = question.currentVersionId ? String(question.currentVersionId) : null;
    if (actual !== expectedVersionId) throw Errors.questionVersionConflict();
  }

  private versionEntity(
    repo: Repository<QuestionVersion>,
    questionId: string,
    revision: number,
    draft: ValidatedQuestionDraft,
    actorId: string,
    approval?: { actorId: string; at: Date },
  ): QuestionVersion {
    return repo.create({
      questionId,
      revision,
      categoryId: draft.categoryId,
      difficulty: draft.difficulty,
      type: draft.type,
      stem: draft.stem,
      options: draft.options,
      answer: draft.answer,
      analysis: draft.analysis,
      rubric: draft.rubric,
      scoreCents: draft.scoreCents,
      conceptId: draft.conceptId || null,
      regulationId: draft.regulationId || null,
      regulationVersionId: draft.regulationVersionId || null,
      sourcePageGroup: draft.sourcePageGroup ?? null,
      sourcePageStart: draft.sourcePageStart ?? null,
      sourcePageEnd: draft.sourcePageEnd ?? null,
      source: draft.source,
      status: approval ? 'approved' : 'pending',
      approvedBy: approval?.actorId || null,
      approvedAt: approval?.at || null,
      reviewedBy: approval?.actorId || null,
      reviewedAt: approval?.at || null,
      reviewReason: null,
      createdBy: String(actorId),
      legacyCapturedAt: null,
    });
  }

  private applyCompatibility(question: Question, version: QuestionVersion): void {
    question.categoryId = version.categoryId;
    question.difficulty = version.difficulty;
    question.conceptId = version.conceptId;
    question.currentVersionId = version.id;
    question.regulationId = version.regulationId;
    question.versionId = version.regulationVersionId;
    question.type = version.type;
    question.stem = version.stem;
    question.options = version.options;
    question.answer = version.answer;
    question.analysis = version.analysis;
    question.rubric = version.rubric;
    question.score = (version.scoreCents / 100).toFixed(2);
    question.status = version.status;
    question.source = version.source;
  }

  private async bindMedia(manager: EntityManager, version: QuestionVersion, mediaAssetIds: string[]): Promise<void> {
    for (const assetId of mediaAssetIds) {
      await this.media.bind(manager, assetId, QUESTION_VERSION_MEDIA_OWNER, String(version.id));
    }
  }

  private async assertMediaUsable(actorId: string, mediaAssetIds: string[]): Promise<void> {
    for (const assetId of mediaAssetIds) await this.media.assertUsable(actorId, assetId, 'question');
  }

  private async captureLegacy(manager: EntityManager, question: Question): Promise<QuestionVersion> {
    const repo = manager.getRepository(QuestionVersion);
    const captured = repo.create({
      questionId: String(question.id),
      revision: 1,
      categoryId: question.categoryId,
      difficulty: question.difficulty,
      type: question.type,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      analysis: question.analysis,
      rubric: question.rubric,
      scoreCents: Math.round(Number(question.score) * 100),
      conceptId: question.conceptId,
      regulationId: question.regulationId,
      regulationVersionId: question.versionId,
      sourcePageGroup: null,
      sourcePageStart: null,
      sourcePageEnd: null,
      source: question.source,
      status: question.status,
      approvedBy: null,
      approvedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
      createdBy: question.createdBy,
      legacyCapturedAt: new Date(),
    });
    return repo.save(captured);
  }

  private async createInManager(
    manager: EntityManager,
    draft: ValidatedQuestionDraft,
    actorId: string,
    approval?: { actorId: string; at: Date },
  ) {
    const questionRepo = manager.getRepository(Question);
    const versionRepo = manager.getRepository(QuestionVersion);
    const question = await questionRepo.save(questionRepo.create({
      regulationId: draft.regulationId || null,
      versionId: draft.regulationVersionId || null,
      categoryId: draft.categoryId,
      difficulty: draft.difficulty,
      conceptId: draft.conceptId || null,
      currentVersionId: null,
      type: draft.type,
      stem: draft.stem,
      options: draft.options,
      answer: draft.answer,
      analysis: draft.analysis,
      rubric: draft.rubric,
      score: (draft.scoreCents / 100).toFixed(2),
      status: approval ? 'approved' : 'pending',
      source: draft.source,
      createdBy: String(actorId),
    }));
    const version = await versionRepo.save(this.versionEntity(versionRepo, String(question.id), 1, draft, actorId, approval));
    this.applyCompatibility(question, version);
    await questionRepo.save(question);
    await this.bindMedia(manager, version, draft.mediaAssetIds);
    return { questionId: String(question.id), versionId: String(version.id) };
  }

  async create(input: QuestionDraft, actorId: string): Promise<{ questionId: string; versionId: string }> {
    return (await this.createMany([input], actorId))[0];
  }

  async createMany(inputs: QuestionDraft[], actorId: string): Promise<Array<{ questionId: string; versionId: string }>> {
    if (!inputs.length) return [];
    const drafts = inputs.map(validateAndSanitizeQuestionDraft);
    await Promise.all(drafts.map((draft) => this.assertSource(draft)));
    await this.assertMediaUsable(String(actorId), [...new Set(drafts.flatMap((draft) => draft.mediaAssetIds))]);
    return this.dataSource.transaction(async (manager) => {
      const categoryIds = [...new Set(drafts.map((draft) => draft.categoryId))]
        .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
      for (const categoryId of categoryIds) await this.categories.lockActive(manager, categoryId);
      for (const draft of drafts) {
        if (draft.conceptId) await this.concepts.assertCompatible(manager, draft.conceptId, draft.categoryId, draft.type);
      }
      const created: Array<{ questionId: string; versionId: string }> = [];
      for (const draft of drafts) created.push(await this.createInManager(manager, draft, actorId));
      return created;
    });
  }

  /**
   * B4 preview uses the same structural, provenance, and controlled-media
   * checks as ordinary question creation. This method never writes data.
   */
  async validateImportDraft(
    input: QuestionDraft,
    actorId: string,
    manager?: EntityManager,
  ): Promise<ValidatedQuestionDraft> {
    const draft = validateAndSanitizeQuestionDraft(input);
    if (draft.source !== 'import') throw Errors.param('导入适配器只能创建 import 来源题目');
    await this.assertSource(draft, manager);
    await this.assertMediaUsable(String(actorId), draft.mediaAssetIds);
    return draft;
  }

  /**
   * Caller-owned transaction adapter for B4. It intentionally does not open a
   * nested transaction so the import batch result and every created version
   * commit or roll back together.
   */
  async createApprovedImportsInManager(
    manager: EntityManager,
    inputs: QuestionDraft[],
    actorId: string,
  ): Promise<Array<{ questionId: string; versionId: string }>> {
    if (!inputs.length) return [];
    const drafts = await Promise.all(inputs.map((input) => this.validateImportDraft(input, actorId, manager)));
    const categoryIds = [...new Set(drafts.map((draft) => draft.categoryId))]
      .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    for (const categoryId of categoryIds) await this.categories.lockActive(manager, categoryId);
    for (const draft of drafts) {
      if (draft.conceptId) await this.concepts.assertCompatible(manager, draft.conceptId, draft.categoryId, draft.type);
    }
    const approval = { actorId: String(actorId), at: new Date() };
    const created: Array<{ questionId: string; versionId: string }> = [];
    for (const draft of drafts) created.push(await this.createInManager(manager, draft, actorId, approval));
    return created;
  }

  async revise(
    questionId: string,
    input: QuestionDraft,
    actorId: string,
    expectedVersionId?: string | null,
  ): Promise<string> {
    const draft = validateAndSanitizeQuestionDraft(input);
    await this.assertSource(draft);
    return this.dataSource.transaction(async (manager) => {
      await this.assertRelations(manager, draft);
      const questionRepo = manager.getRepository(Question);
      const versionRepo = manager.getRepository(QuestionVersion);
      const question = await questionRepo.findOne({ where: { id: String(questionId) }, lock: { mode: 'pessimistic_write' } });
      if (!question) throw Errors.notFound('题目不存在');
      this.assertExpectedVersion(question, expectedVersionId);
      const existingMediaIds = new Set(controlledQuestionMediaIds([
        question.stem,
        question.analysis,
        question.rubric,
        ...question.options.map((option) => option.text),
      ]));
      await this.assertMediaUsable(
        String(actorId),
        draft.mediaAssetIds.filter((assetId) => !existingMediaIds.has(assetId)),
      );

      let current: QuestionVersion;
      if (!question.currentVersionId) {
        current = await this.captureLegacy(manager, question);
        question.currentVersionId = current.id;
      } else {
        const found = await versionRepo.findOne({ where: { id: String(question.currentVersionId) } });
        if (!found) throw Errors.questionVersionConflict('题目当前版本不存在');
        current = found;
      }
      const sourceUnchanged = (current.regulationId ?? null) === (draft.regulationId ?? null)
        && (current.regulationVersionId ?? null) === (draft.regulationVersionId ?? null);
      const draftHasNoProvenance = [draft.sourcePageGroup, draft.sourcePageStart, draft.sourcePageEnd]
        .every((value) => value === undefined);
      const currentProvenance = [current.sourcePageGroup, current.sourcePageStart, current.sourcePageEnd];
      const currentHasCompleteProvenance = currentProvenance.every((value) => Number.isInteger(value));
      const revisionDraft = sourceUnchanged && draftHasNoProvenance && currentHasCompleteProvenance
        ? {
            ...draft,
            sourcePageGroup: current.sourcePageGroup!,
            sourcePageStart: current.sourcePageStart!,
            sourcePageEnd: current.sourcePageEnd!,
          }
        : draft;
      const next = await versionRepo.save(
        this.versionEntity(versionRepo, String(question.id), Number(current.revision) + 1, revisionDraft, actorId),
      );
      this.applyCompatibility(question, next);
      await questionRepo.save(question);
      await this.bindMedia(manager, next, draft.mediaAssetIds);
      return String(next.id);
    });
  }

  /** Upgrade-only capture for a legacy review action; it records current content, not reconstructed history. */
  async captureLegacyVersion(questionId: string): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const questionRepo = manager.getRepository(Question);
      const versionRepo = manager.getRepository(QuestionVersion);
      const question = await questionRepo.findOne({ where: { id: String(questionId) }, lock: { mode: 'pessimistic_write' } });
      if (!question) throw Errors.notFound('题目不存在');
      if (question.currentVersionId) {
        const existing = await versionRepo.findOne({ where: { id: String(question.currentVersionId) } });
        if (!existing) throw Errors.questionVersionConflict('题目当前版本不存在');
        return String(existing.id);
      }
      const captured = await this.captureLegacy(manager, question);
      question.currentVersionId = captured.id;
      await questionRepo.save(question);
      return String(captured.id);
    });
  }

  async approve(versionId: string, actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const versionRepo = manager.getRepository(QuestionVersion);
      const questionRepo = manager.getRepository(Question);
      const version = await versionRepo.findOne({ where: { id: String(versionId) }, lock: { mode: 'pessimistic_write' } });
      if (!version) throw Errors.notFound('题目版本不存在');
      const question = await questionRepo.findOne({ where: { id: String(version.questionId) }, lock: { mode: 'pessimistic_write' } });
      if (!question || String(question.currentVersionId) !== String(version.id)) throw Errors.questionVersionConflict();
      const now = new Date();
      version.status = 'approved';
      version.approvedBy = String(actorId);
      version.approvedAt = now;
      version.reviewedBy = String(actorId);
      version.reviewedAt = now;
      version.reviewReason = null;
      await versionRepo.save(version);
      question.status = 'approved';
      await questionRepo.save(question);
    });
  }

  async reviewCurrent(
    questionId: string,
    expectedVersionId: string | null,
    status: 'approved' | 'rejected',
    actorId: string,
    reason?: string,
  ): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const versionRepo = manager.getRepository(QuestionVersion);
      const questionRepo = manager.getRepository(Question);
      const question = await questionRepo.findOne({ where: { id: String(questionId) }, lock: { mode: 'pessimistic_write' } });
      if (!question) throw Errors.notFound('题目不存在');
      this.assertExpectedVersion(question, expectedVersionId);

      let version: QuestionVersion;
      if (!question.currentVersionId) {
        version = await this.captureLegacy(manager, question);
        question.currentVersionId = version.id;
      } else {
        const found = await versionRepo.findOne({
          where: { id: String(question.currentVersionId) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!found || String(found.questionId) !== String(question.id)) {
          throw Errors.questionVersionConflict('题目当前版本不存在');
        }
        version = found;
      }

      const now = new Date();
      version.status = status;
      version.reviewedBy = String(actorId);
      version.reviewedAt = now;
      version.reviewReason = status === 'rejected' ? reason?.trim().slice(0, 1000) || null : null;
      if (status === 'approved') {
        version.approvedBy = String(actorId);
        version.approvedAt = now;
      } else {
        version.approvedBy = null;
        version.approvedAt = null;
      }
      await versionRepo.save(version);
      question.status = status;
      await questionRepo.save(question);
      return String(version.id);
    });
  }

  async reject(versionId: string, actorId: string, reason?: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const versionRepo = manager.getRepository(QuestionVersion);
      const questionRepo = manager.getRepository(Question);
      const version = await versionRepo.findOne({ where: { id: String(versionId) }, lock: { mode: 'pessimistic_write' } });
      if (!version) throw Errors.notFound('题目版本不存在');
      const question = await questionRepo.findOne({ where: { id: String(version.questionId) }, lock: { mode: 'pessimistic_write' } });
      if (!question || String(question.currentVersionId) !== String(version.id)) throw Errors.questionVersionConflict();
      version.status = 'rejected';
      version.approvedBy = null;
      version.approvedAt = null;
      version.reviewedBy = String(actorId);
      version.reviewedAt = new Date();
      version.reviewReason = reason?.trim().slice(0, 1000) || null;
      await versionRepo.save(version);
      question.status = 'rejected';
      await questionRepo.save(question);
    });
  }

  private snapshot(version: QuestionVersion): QuestionVersionSnapshot {
    if (!version.categoryId || !version.difficulty) throw Errors.questionVersionConflict('题目版本缺少培训类别或难度');
    return Object.freeze({
      questionId: String(version.questionId), versionId: String(version.id), revision: Number(version.revision),
      categoryId: String(version.categoryId), difficulty: version.difficulty as Difficulty, type: version.type as QuestionType,
      stem: version.stem, options: version.options as QuestionOption[], answer: version.answer, analysis: version.analysis,
      rubric: version.rubric, scoreCents: Number(version.scoreCents), conceptId: version.conceptId || undefined,
      regulationId: version.regulationId || undefined, regulationVersionId: version.regulationVersionId || undefined,
      sourcePageGroup: version.sourcePageGroup ?? undefined,
      sourcePageStart: version.sourcePageStart ?? undefined,
      sourcePageEnd: version.sourcePageEnd ?? undefined,
      source: version.source as QuestionDraft['source'], approvedBy: version.approvedBy,
      approvedAt: version.approvedAt?.toISOString() || null,
    });
  }

  async approvedCandidates(filter: CandidateFilter): Promise<QuestionVersionSnapshot[]> {
    await this.categories.assertActive(String(filter.categoryId));
    const qb = this.versionRepo.createQueryBuilder('version')
      .innerJoin(Question, 'question', 'question.current_version_id = version.id')
      .where('version.status = :status', { status: 'approved' })
      .andWhere('version.category_id = :categoryId', { categoryId: String(filter.categoryId) })
      .andWhere('version.type = :type', { type: filter.type })
      .andWhere('version.difficulty = :difficulty', { difficulty: filter.difficulty });
    if (filter.regulationIds?.length) {
      qb.andWhere('version.regulation_id IN (:...regulationIds)', { regulationIds: filter.regulationIds.map(String) });
    }
    const rows = await qb.orderBy('version.id', 'ASC').getMany();
    return rows.map((row) => this.snapshot(row));
  }

  async current(questionId: string): Promise<QuestionVersion | null> {
    const question = await this.questionRepo.findOne({ where: { id: String(questionId) } });
    if (!question?.currentVersionId) return null;
    return this.versionRepo.findOne({ where: { id: String(question.currentVersionId) } });
  }

  async history(questionId: string, input: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Number(input.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 20)));
    const [rows, total] = await this.versionRepo.findAndCount({
      where: { questionId: String(questionId) },
      order: { revision: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((row) => ({
      id: String(row.id), revision: Number(row.revision), status: row.status,
      stem: sanitizeQuestionRichTextForDisplay(row.stem) || '',
      approved_by: row.approvedBy, approved_at: row.approvedAt, reviewed_by: row.reviewedBy,
      reviewed_at: row.reviewedAt, review_reason: row.reviewReason, legacy_captured_at: row.legacyCapturedAt,
      source_page_group: row.sourcePageGroup, source_page_start: row.sourcePageStart, source_page_end: row.sourcePageEnd,
      created_by: String(row.createdBy), created_at: row.createdAt,
    })), total, page, page_size: pageSize };
  }
}
