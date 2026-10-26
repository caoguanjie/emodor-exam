import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BizError, Errors } from '../../common/errors';
import { assertActiveDifficulty } from '../../common/question-difficulty';
import type { Difficulty, QuestionOption, QuestionType } from '../../common/training-contracts';
import { Question } from '../../entities/question.entity';
import { QuestionVersion } from '../../entities/question-version.entity';
import { Regulation } from '../../entities/regulation.entity';
import { RegulationVersion } from '../../entities/regulation-version.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaReference } from '../../entities/media-reference.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { AccessService } from '../access/access.service';
import { MediaService } from '../media/media.service';
import { CategoryService } from '../training/category.service';
import { parseQuestionContent } from './question-content-dispatch';
import { classifyQuestionAsset } from './question-authoring-media';
import { synchronizeFormAuthoring, withoutAuthoringScores, authoringQuestionHash, assembleVersionAuthoring, type AuthoringQuestionWrite, type AuthoringSavedItem } from './question-authoring-codec';
import type { AuthoringBundle } from '../../common/question-authoring';
import { legacyHtmlDoc } from './question-content';
import { parseRichDocV3 } from './question-content-v3';
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

type RandomDraftMediaResolver = (
  versionId: string,
  categoryId: string | null,
) => Promise<QuestionVersionSnapshot | null>;

const QUESTION_VERSION_MEDIA_OWNER = 'question_version';

type QuestionMediaFields = {
  stem?: unknown;
  options?: unknown;
  analysis?: unknown;
  contentSchemaVersion?: number;
  content_schema_version?: number;
  contentJson?: unknown;
  content_json?: unknown;
};

function questionMediaField(fields: QuestionMediaFields, assetId: string): 'prompt' | 'answer' | null {
  if (fields.contentSchemaVersion === 3 || fields.content_schema_version === 3) return classifyQuestionAsset(fields, assetId);
  const optionTexts = Array.isArray(fields.options)
    ? fields.options.flatMap((option) => (
        option && typeof option === 'object' && typeof (option as { text?: unknown }).text === 'string'
          ? [(option as { text: string }).text]
          : []
      ))
    : [];
  const promptIds = controlledQuestionMediaIds([
    typeof fields.stem === 'string' ? fields.stem : null,
    ...optionTexts,
  ]);
  if (promptIds.includes(assetId)) return 'prompt';
  const answerIds = controlledQuestionMediaIds([
    typeof fields.analysis === 'string' ? fields.analysis : null,
  ]);
  return answerIds.includes(assetId) ? 'answer' : null;
}

function releaseMediaFields(value: unknown): QuestionMediaFields | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as QuestionMediaFields : null;
}

@Injectable()
export class QuestionVersionService implements OnModuleInit {
  private randomDraftMediaResolver?: RandomDraftMediaResolver;

  constructor(
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    @InjectRepository(QuestionVersion) private readonly versionRepo: Repository<QuestionVersion>,
    @InjectRepository(Regulation) private readonly regulationRepo: Repository<Regulation>,
    @InjectRepository(RegulationVersion) private readonly regulationVersionRepo: Repository<RegulationVersion>,
    private readonly dataSource: DataSource,
    private readonly categories: CategoryService,
    private readonly media: MediaService,
    private readonly access: AccessService,
  ) {}

  onModuleInit(): void {
    this.media.registerOwnerPolicy(QUESTION_VERSION_MEDIA_OWNER, {
      allowedPurposes: ['question'],
      authorizeRead: (actorId, versionId, assetId) => this.canReadQuestionVersionMedia(actorId, versionId, assetId),
      validateBinding: async (manager, _asset, businessId) => {
        const exists = await manager.getRepository(QuestionVersion).findOne({ where: { id: String(businessId) } });
        if (!exists) throw Errors.notFound('题目版本不存在');
      },
    });
  }

  registerRandomDraftMediaResolver(resolver: RandomDraftMediaResolver): void {
    if (this.randomDraftMediaResolver) throw Errors.internal('随机草稿媒体解析器重复注册');
    this.randomDraftMediaResolver = resolver;
  }

  private async canReadQuestionVersionMedia(actorId: string, versionId: string, assetId?: string): Promise<boolean> {
    const permissions = await this.access.permissions(actorId);
    if (permissions.includes('questions:read')) return true;
    if (!assetId || !permissions.includes('papers:read')) return false;
    const includeAnswers = permissions.includes('papers:export') || permissions.includes('questions:export');
    const exactVersionId = String(versionId);
    const exactAssetId = String(assetId);

    const version = await this.versionRepo.findOne({ where: { id: exactVersionId } });
    const draftField = version ? questionMediaField(version, exactAssetId) : null;
    if (draftField === 'prompt' || (draftField === 'answer' && includeAnswers)) {
      const draftRows = await this.dataSource.query(
        `SELECT 1 AS readable
         FROM paper_question pq
         INNER JOIN exam_paper paper ON paper.id = pq.paper_id
         WHERE pq.question_version_id = ? AND paper.mode = 'fixed' AND paper.status = 'draft'
         LIMIT 1`,
        [exactVersionId],
      );
      if (draftRows.length) return true;
    }

    const releaseRows = await this.dataSource.query(
      `SELECT release_question.snapshot_json
       FROM paper_release_question release_question
       INNER JOIN paper_release release_row ON release_row.id = release_question.release_id
       INNER JOIN exam_paper paper ON paper.id = release_row.paper_id
       WHERE release_question.question_version_id = ?`,
      [exactVersionId],
    );
    const releaseAuthorized = releaseRows.some((row: { snapshot_json?: unknown }) => {
      const fields = releaseMediaFields(row.snapshot_json);
      if (!fields) return false;
      const releaseField = questionMediaField(fields, exactAssetId);
      return releaseField === 'prompt' || (releaseField === 'answer' && includeAnswers);
    });
    if (releaseAuthorized || !version || !this.randomDraftMediaResolver) return releaseAuthorized;

    const categoryId = version.categoryId == null ? null : String(version.categoryId);
    const candidate = await this.randomDraftMediaResolver(exactVersionId, categoryId);
    if (!candidate || String(candidate.versionId) !== exactVersionId || String(candidate.categoryId) !== categoryId) return false;
    const randomField = questionMediaField(candidate, exactAssetId);
    return randomField === 'prompt' || (randomField === 'answer' && includeAnswers);
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
  }

  private assertExpectedVersion(question: Question, expectedVersionId: string | null): void {
    if (expectedVersionId !== null && (typeof expectedVersionId !== 'string' || !/^[1-9]\d*$/.test(expectedVersionId))) throw Errors.param('expected_version_id 必须显式提供 ID 或 null');
    const actual = question.currentVersionId ? String(question.currentVersionId) : null;
    if (actual !== expectedVersionId) throw Errors.questionVersionConflict();
  }

  private assertExpectedEnabled(question: Question, expectedEnabled: unknown): void {
    if (typeof expectedEnabled !== 'boolean') throw Errors.param('expected_enabled 必须显式提供布尔值');
    if (Boolean(question.isEnabled) !== expectedEnabled) throw Errors.questionVersionConflict('题目启用状态已改变，请刷新后重试');
  }

  private versionEntity(
    repo: Repository<QuestionVersion>,
    questionId: string,
    revision: number,
    draft: ValidatedQuestionDraft,
    actorId: string,
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
      contentSchemaVersion: draft.contentSchemaVersion,
      contentJson: draft.contentJson,
      scoreCents: null,
      conceptId: null,
      regulationId: draft.regulationId || null,
      regulationVersionId: draft.regulationVersionId || null,
      sourcePageGroup: draft.sourcePageGroup ?? null,
      sourcePageStart: draft.sourcePageStart ?? null,
      sourcePageEnd: draft.sourcePageEnd ?? null,
      source: draft.source,
      status: 'approved',
      approvedBy: null,
      approvedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
      createdBy: String(actorId),
      legacyCapturedAt: null,
    });
  }

  private applyCompatibility(question: Question, version: QuestionVersion): void {
    if (question.deletedAt) throw Errors.notFound('题目不存在');
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
    question.contentSchemaVersion = version.contentSchemaVersion;
    question.contentJson = version.contentJson;
    question.score = version.scoreCents == null ? null : (version.scoreCents / 100).toFixed(2);
    question.status = version.status;
    question.source = version.source;
    question.isEnabled = true;
  }

  private async bindMedia(manager: EntityManager, version: QuestionVersion, mediaAssetIds: string[]): Promise<void> {
    for (const assetId of mediaAssetIds) {
      await this.media.bind(manager, assetId, QUESTION_VERSION_MEDIA_OWNER, String(version.id));
    }
  }

  private async assertMediaUsable(actorId: string, mediaAssetIds: string[], manager?: EntityManager): Promise<void> {
    for (const assetId of mediaAssetIds) {
      if (manager) await this.media.assertUsable(actorId, assetId, 'question', undefined, manager);
      else await this.media.assertUsable(actorId, assetId, 'question');
    }
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
      scoreCents: question.score == null ? null : Math.round(Number(question.score) * 100),
      contentSchemaVersion: question.contentSchemaVersion || 1,
      contentJson: question.contentJson || null,
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
    authoring?: AuthoringQuestionWrite,
  ) {
    const questionRepo = manager.getRepository(Question);
    const versionRepo = manager.getRepository(QuestionVersion);
    const question = await questionRepo.save(questionRepo.create({
      regulationId: draft.regulationId || null,
      versionId: draft.regulationVersionId || null,
      categoryId: draft.categoryId,
      difficulty: draft.difficulty,
      conceptId: null,
      currentVersionId: null,
      type: draft.type,
      stem: draft.stem,
      options: draft.options,
      answer: draft.answer,
      analysis: draft.analysis,
      score: null,
      status: 'approved',
      isEnabled: true,
      deletedAt: null,
      source: draft.source,
      createdBy: String(actorId),
    }));
    const version = this.versionEntity(versionRepo, String(question.id), 1, draft, actorId);
    this.attachAuthoring(version, draft, authoring?.bundle || null, authoring?.client_id || `question_${question.id}`);
    await versionRepo.save(version);
    this.finalizeAuthoringIdentity(version);
    await versionRepo.save(version);
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
    const drafts = inputs.map((input) => validateAndSanitizeQuestionDraft(input));
    await Promise.all(drafts.map((draft) => this.assertSource(draft)));
    await this.assertMediaUsable(String(actorId), [...new Set(drafts.flatMap((draft) => draft.mediaAssetIds))]);
    return this.dataSource.transaction(async (manager) => {
      const categoryIds = [...new Set(drafts.map((draft) => draft.categoryId))]
        .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
      for (const categoryId of categoryIds) await this.categories.lockActive(manager, categoryId);
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
    await this.assertMediaUsable(String(actorId), draft.mediaAssetIds, manager);
    return draft;
  }

  /** Only the dedicated ephemeral-reference import may create unbound AI rows. */
  async validateAiImportDraft(input: QuestionDraft, actorId: string, manager?: EntityManager): Promise<ValidatedQuestionDraft> {
    if (input.source !== 'ai' || input.regulationId || input.regulationVersionId
      || input.sourcePageGroup !== undefined || input.sourcePageStart !== undefined || input.sourcePageEnd !== undefined) {
      throw Errors.param('参考题生成只能创建无资料绑定的 AI 题目');
    }
    assertActiveDifficulty(input.difficulty);
    const draft = validateAndSanitizeQuestionDraft(input, { allowReferenceAi: true });
    await this.assertMediaUsable(String(actorId), draft.mediaAssetIds, manager);
    return draft;
  }

  async createPendingAiImportsInManager(
    manager: EntityManager,
    inputs: QuestionDraft[],
    actorId: string,
    afterRelationsLocked?: (manager: EntityManager, drafts: readonly ValidatedQuestionDraft[]) => Promise<void>,
  ): Promise<Array<{ questionId: string; versionId: string }>> {
    const drafts = await Promise.all(inputs.map((input) => this.validateAiImportDraft(input, actorId, manager)));
    const categoryIds = [...new Set(drafts.map((draft) => draft.categoryId))]
      .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    for (const categoryId of categoryIds) await this.categories.lockActive(manager, categoryId);
    await afterRelationsLocked?.(manager, drafts);
    const created: Array<{ questionId: string; versionId: string }> = [];
    for (const draft of drafts) created.push(await this.createInManager(manager, draft, actorId));
    return created;
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
    afterRelationsLocked?: (
      manager: EntityManager,
      drafts: readonly ValidatedQuestionDraft[],
    ) => Promise<void>,
  ): Promise<Array<{ questionId: string; versionId: string }>> {
    if (!inputs.length) return [];
    const drafts = await Promise.all(inputs.map((input) => this.validateImportDraft(input, actorId, manager)));
    const categoryIds = [...new Set(drafts.map((draft) => draft.categoryId))]
      .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    for (const categoryId of categoryIds) await this.categories.lockActive(manager, categoryId);
    await afterRelationsLocked?.(manager, drafts);
    const created: Array<{ questionId: string; versionId: string }> = [];
    for (const draft of drafts) created.push(await this.createInManager(manager, draft, actorId));
    return created;
  }

  async revise(
    questionId: string,
    input: QuestionDraft,
    actorId: string,
    expectedVersionId: string | null,
    expectedEnabled: boolean,
  ): Promise<string> {
    // Input provenance is copied from the existing identity by the question
    // workflow. Reference-generated AI questions intentionally have no material.
    let actual = input;
    if (input.contentSchemaVersion === undefined && input.contentJson == null) {
      const current = await this.current(questionId);
      if (current?.contentSchemaVersion === 3) {
        const content = parseQuestionContent(current);
        if (content.schema !== 3) throw Errors.internal('题目内容版本不一致');
        const stem = input.stem === current.stem ? content.stem : parseRichDocV3(legacyHtmlDoc(input.stem));
        const analysis = input.analysis === current.analysis ? content.analysis : input.analysis == null ? null : parseRichDocV3(legacyHtmlDoc(input.analysis));
        const options = input.options.map((option) => {
          const old = current.options.find((item) => item.key === option.key);
          const rich = content.options.find((item) => item.id === option.key);
          return { id: option.key, content: rich && old?.text === option.text ? rich.content : parseRichDocV3(legacyHtmlDoc(option.text)) };
        });
        actual = { ...input, contentSchemaVersion: 3, contentJson: { stem, options, analysis, answer_option_ids: input.answer.map((index) => options[index]?.id) } };
      }
    }
    const draft = validateAndSanitizeQuestionDraft(actual, { allowReferenceAi: true });
    await this.assertSource(draft);
    return this.dataSource.transaction(async (manager) => {
      return this.reviseInManager(manager, questionId, draft, actorId, expectedVersionId, expectedEnabled);
    });
  }

  private async reviseInManager(
    manager: EntityManager, questionId: string, draft: ValidatedQuestionDraft, actorId: string,
    expectedVersionId: string | null, expectedEnabled: boolean, authoring?: AuthoringQuestionWrite,
  ): Promise<string> {
      await this.assertRelations(manager, draft);
      const questionRepo = manager.getRepository(Question);
      const versionRepo = manager.getRepository(QuestionVersion);
      const question = await questionRepo.findOne({ where: { id: String(questionId) }, lock: { mode: 'pessimistic_write' } });
      if (!question || question.deletedAt) throw Errors.notFound('题目不存在');
      this.assertExpectedVersion(question, expectedVersionId);
      this.assertExpectedEnabled(question, expectedEnabled);
      const existingMediaIds = new Set(controlledQuestionMediaIds([
        question.stem,
        question.analysis,
        ...question.options.map((option) => option.text),
      ]));
      await this.assertMediaUsable(
        String(actorId),
        draft.mediaAssetIds.filter((assetId) => !existingMediaIds.has(assetId)),
        authoring ? manager : undefined,
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
      if (current.contentSchemaVersion === 3 && draft.contentSchemaVersion !== 3) throw Errors.param('$.content_schema_version: schema 3 修订不能降级', { path: '$.content_schema_version' });
      this.attachAuthoring(next, revisionDraft, authoring?.bundle || current.authoringJson || null,
        authoring?.client_id || Object.keys(current.authoringJson?.document.questions || {})[0] || `question_${question.id}`);
      this.finalizeAuthoringIdentity(next);
      await versionRepo.save(next);
      this.applyCompatibility(question, next);
      await questionRepo.save(question);
      await this.bindMedia(manager, next, draft.mediaAssetIds);
      return String(next.id);
  }

  private attachAuthoring(version: QuestionVersion, draft: ValidatedQuestionDraft, base: AuthoringBundle | null, client: string): void {
    const content = parseQuestionContent(draft);
    const placeholder: AuthoringBundle = base || { document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: {} }, option_ids: {}, identities: {}, layouts: {} };
    const supplied = placeholder.document.questions[client];
    const bundle = supplied ? placeholder : { ...placeholder, document: { ...placeholder.document, questions: { [client]: {
      type: draft.type, category_id: draft.categoryId, difficulty: draft.difficulty,
      regulation_id: draft.regulationId || null, regulation_version_id: draft.regulationVersionId || null,
      analysis: { type: 'doc', content: [] },
    } } } };
    version.authoringSchemaVersion = 1;
    version.authoringJson = withoutAuthoringScores(synchronizeFormAuthoring(base, {
      client_id: client, bundle, content, identity: { question_id: String(version.questionId), expected_version_id: version.id ? String(version.id) : null, expected_enabled: true },
      category_id: draft.categoryId, type: draft.type, difficulty: draft.difficulty,
    }));
  }

  private finalizeAuthoringIdentity(version: QuestionVersion): void {
    if (!version.authoringJson) return;
    const client = Object.keys(version.authoringJson.document.questions)[0];
    version.authoringJson.identities[client] = { question_id: String(version.questionId), expected_version_id: String(version.id), expected_enabled: true };
    version.authoringJson.document.questions[client].question_id = String(version.questionId);
    version.authoringJson.document.questions[client].base_revision = Number(version.revision);
  }

  /** Caller owns the transaction: content, authoring, media and receipt share it. */
  async lockAuthoringBatch(manager: EntityManager, inputs: readonly AuthoringQuestionWrite[]): Promise<void> {
    const order = (left: string, right: string) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
    for (const category of [...new Set(inputs.map((input) => input.category_id))].sort(order)) await this.categories.lockActive(manager, category);
    for (const question of [...new Set(inputs.flatMap((input) => input.identity ? [input.identity.question_id] : []))].sort(order)) {
      const row = await manager.getRepository(Question).findOne({ where: { id: question }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.deletedAt) throw Errors.notFound('题目不存在');
    }
  }

  /** Caller owns the transaction: content, authoring, media and receipt share it. */
  async writeAuthoringInTransaction(manager: EntityManager, input: AuthoringQuestionWrite, actorId: string): Promise<AuthoringSavedItem> {
    const meta = input.bundle.document.questions[input.client_id];
    let source: QuestionDraftInput['source'] = 'manual';
    let current: QuestionVersion | null = null;
    let question: Question | null = null;
    if (input.identity) {
      question = await manager.getRepository(Question).findOne({ where: { id: input.identity.question_id }, lock: { mode: 'pessimistic_write' } });
      if (!question || question.deletedAt) throw Errors.notFound('题目不存在');
      this.assertExpectedVersion(question, input.identity.expected_version_id);
      this.assertExpectedEnabled(question, input.identity.expected_enabled);
      current = question.currentVersionId ? await manager.getRepository(QuestionVersion).findOne({ where: { id: String(question.currentVersionId) } }) : null;
      if (question.currentVersionId && !current) throw Errors.questionVersionConflict('题目当前版本不存在');
      const trusted = current || question;
      if (trusted.source !== 'manual' && trusted.source !== 'ai' && trusted.source !== 'import') throw Errors.param('题目真实来源非法');
      source = trusted.source;
      const trustedVersionId = current ? current.regulationVersionId : question.versionId;
      if ((meta.regulation_id || null) !== (trusted.regulationId || null) || (meta.regulation_version_id || null) !== (trustedVersionId || null)) throw Errors.param('$.regulation_id: 不允许伪造题目来源', { path: '$.regulation_id' });
      if (current && question.isEnabled && authoringQuestionHash(assembleVersionAuthoring(current, input.client_id)) === authoringQuestionHash(input.bundle)) {
        return this.authoringSavedItem(current, input);
      }
      const live = await manager.query(`SELECT 1 AS blocked FROM exam_record er
        INNER JOIN paper_question pq ON pq.paper_id = er.paper_id
        WHERE er.status = 'in_progress' AND pq.question_id = ? LIMIT 1`, [String(question.id)]);
      if (live.length) throw Errors.questionInUse();
      if (question.type !== input.type) {
        const linked = await manager.query('SELECT 1 AS blocked FROM paper_question WHERE question_id = ? LIMIT 1', [String(question.id)]);
        if (linked.length) throw Errors.questionInUse('题目已被 legacy 固定试卷引用，不能变更题型');
      }
    } else if (meta.regulation_id !== null || meta.regulation_version_id !== null) throw Errors.param('$.regulation_id: 人工新题不能指定资料来源', { path: '$.regulation_id' });
    const parsed = parseQuestionContent({ ...input.content, type: input.type });
    const { schema, ...contentJson } = parsed;
    const draft = validateAndSanitizeQuestionDraft({
      categoryId: input.category_id, difficulty: input.difficulty, type: input.type,
      source, stem: '', options: [], answer: [], analysis: null,
      contentSchemaVersion: schema, contentJson, regulationId: meta.regulation_id || undefined, regulationVersionId: meta.regulation_version_id || undefined,
      sourcePageGroup: current?.sourcePageGroup ?? undefined, sourcePageStart: current?.sourcePageStart ?? undefined, sourcePageEnd: current?.sourcePageEnd ?? undefined,
    }, { allowReferenceAi: true });
    await this.assertSource(draft, manager);
    await this.assertRelations(manager, draft);
    let versionId: string;
    if (input.identity) versionId = await this.reviseInManager(manager, input.identity.question_id, draft, actorId, input.identity.expected_version_id, input.identity.expected_enabled, input);
    else {
      await this.assertMediaUsable(actorId, draft.mediaAssetIds, manager);
      versionId = (await this.createInManager(manager, draft, actorId, input)).versionId;
    }
    const saved = await manager.getRepository(QuestionVersion).findOne({ where: { id: versionId } });
    if (!saved?.authoringJson) throw Errors.internal('作者原稿未保存');
    return this.authoringSavedItem(saved, input);
  }

  private authoringSavedItem(saved: QuestionVersion, input: AuthoringQuestionWrite): AuthoringSavedItem {
    // Receipt retains this request's paper context, while persisted authoring remains score-free.
    const bundle = structuredClone(input.bundle);
    const meta = bundle.document.questions[input.client_id];
    meta.question_id = String(saved.questionId); meta.base_revision = Number(saved.revision);
    bundle.identities[input.client_id] = { question_id: String(saved.questionId), expected_version_id: String(saved.id), expected_enabled: true };
    return { client_id: input.client_id, question_id: String(saved.questionId), saved_version_id: String(saved.id), revision: Number(saved.revision), bundle };
  }

  /** Upgrade-only capture records current content, not reconstructed history. */
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

  /**
   * Only the old already-published fixed-paper attempt adapter uses this path.
   * Capture the original facts without applying today's new-publication pool policy.
   */
  async currentOrCaptureForLegacyAttempt(
    manager: EntityManager,
    questionId: string,
    expectedVersionId?: string | null,
  ): Promise<QuestionVersion> {
    const questionRepo = manager.getRepository(Question);
    const versionRepo = manager.getRepository(QuestionVersion);
    const question = await questionRepo.findOne({ where: { id: String(questionId) }, lock: { mode: 'pessimistic_write' } });
    if (!question) throw Errors.notFound('题目不存在');
    if (expectedVersionId !== undefined) this.assertExpectedVersion(question, expectedVersionId);
    if (question.currentVersionId) {
      const version = await versionRepo.findOne({ where: { id: String(question.currentVersionId) }, lock: { mode: 'pessimistic_read' } });
      if (!version || String(version.questionId) !== String(question.id)) throw Errors.questionVersionConflict('题目当前版本不存在');
      return version;
    }
    const captured = await this.captureLegacy(manager, question);
    question.currentVersionId = captured.id;
    await questionRepo.save(question);
    return captured;
  }

  /**
   * Resolve the exact current enabled revision while the caller owns the
   * publication transaction. Legacy questions are captured as current facts;
   * no category, difficulty, or historic approval metadata is synthesized.
   */
  async currentOrCaptureForRelease(
    manager: EntityManager,
    questionId: string,
    expectedVersionId?: string | null,
  ): Promise<QuestionVersion> {
    const questionRepo = manager.getRepository(Question);
    const versionRepo = manager.getRepository(QuestionVersion);
    const question = await this.lockIdentityForLifecycle(String(questionId), manager);
    if (!question.isEnabled) {
      throw Errors.paperReleaseConflict(`题目 ${questionId} 已停用，请重新选题`);
    }
    if (expectedVersionId && String(question.currentVersionId || '') !== String(expectedVersionId)) {
      throw Errors.paperReleaseConflict(`题目 ${questionId} 的已选版本已过期，请重新选题`);
    }

    let version: QuestionVersion;
    if (question.currentVersionId) {
      const found = await versionRepo.findOne({ where: { id: String(question.currentVersionId) } });
      if (!found || String(found.questionId) !== String(question.id)) {
        throw Errors.paperReleaseConflict(`题目 ${questionId} 当前版本不存在或不匹配，请重新选题`);
      }
      version = found;
    } else {
      if (expectedVersionId) {
        throw Errors.paperReleaseConflict(`题目 ${questionId} 的已选版本已过期，请重新选题`);
      }
      version = await this.captureLegacy(manager, question);
      question.currentVersionId = version.id;
      await questionRepo.save(question);
    }
    await this.assertCurrentUsable(String(questionId), manager);
    return version;
  }

  private snapshot(version: QuestionVersion): QuestionVersionSnapshot {
    if (!version.categoryId || !version.difficulty) throw Errors.questionVersionConflict('题目版本缺少培训类别或难度');
    return Object.freeze({
      questionId: String(version.questionId), versionId: String(version.id), revision: Number(version.revision),
      categoryId: String(version.categoryId), difficulty: version.difficulty as Difficulty, type: version.type as QuestionType,
      stem: version.stem, options: version.options as QuestionOption[], answer: version.answer, analysis: version.analysis,
      contentSchemaVersion: version.contentSchemaVersion || 1, contentJson: version.contentJson || null,
      regulationId: version.regulationId || undefined, regulationVersionId: version.regulationVersionId || undefined,
      sourcePageGroup: version.sourcePageGroup ?? undefined,
      sourcePageStart: version.sourcePageStart ?? undefined,
      sourcePageEnd: version.sourcePageEnd ?? undefined,
      source: version.source as QuestionDraft['source'], approvedBy: version.approvedBy,
      approvedAt: version.approvedAt?.toISOString() || null,
    });
  }

  async enabledCandidates(filter: CandidateFilter, manager?: EntityManager): Promise<QuestionVersionSnapshot[]> {
    assertActiveDifficulty(filter.difficulty);
    if (manager) await this.categories.lockActive(manager, String(filter.categoryId));
    else await this.categories.assertActive(String(filter.categoryId));
    const repo = manager ? manager.getRepository(QuestionVersion) : this.versionRepo;
    const qb = repo.createQueryBuilder('version')
      .innerJoin(Question, 'question', 'question.current_version_id = version.id AND question.id = version.question_id')
      .where('question.is_enabled = :enabled', { enabled: true })
      .andWhere('question.deleted_at IS NULL')
      .andWhere('question.category_id = version.category_id AND question.type = version.type AND question.difficulty = version.difficulty')
      .andWhere('version.category_id = :categoryId', { categoryId: String(filter.categoryId) })
      .andWhere('version.type = :type', { type: filter.type })
      .andWhere('version.difficulty = :difficulty', { difficulty: filter.difficulty });
    if (filter.regulationIds?.length) {
      qb.andWhere('version.regulation_id IN (:...regulationIds)', { regulationIds: filter.regulationIds.map(String) });
    }
    const rows = await qb.orderBy('version.id', 'ASC').getMany();
    if (!manager) {
      const usable: QuestionVersionSnapshot[] = [];
      for (const row of rows) {
        try {
          await this.assertStoredFactsUsable(row, String(row.id));
          usable.push(this.snapshot(row));
        } catch (error) {
          if (!(error instanceof BizError) || error.code >= 50000) throw error;
        }
      }
      return usable;
    }
    const usable: QuestionVersion[] = [];
    const ordered = [...rows].sort((a, b) => BigInt(a.questionId) < BigInt(b.questionId) ? -1 : BigInt(a.questionId) > BigInt(b.questionId) ? 1 : 0);
    for (const row of ordered) {
      const identity = await manager.getRepository(Question).findOne({ where: { id: String(row.questionId) }, lock: { mode: 'pessimistic_write' } });
      if (!identity?.isEnabled || identity.deletedAt || String(identity.currentVersionId || '') !== String(row.id)
        || String(identity.categoryId) !== String(filter.categoryId) || identity.type !== filter.type || identity.difficulty !== filter.difficulty) continue;
      await this.assertCurrentUsable(String(row.questionId), manager);
      usable.push(row);
    }
    return usable.map((row) => this.snapshot(row));
  }

  /** Keep category -> question lock ordering shared with revision and publication. */
  async lockIdentityForLifecycle(questionId: string, manager: EntityManager): Promise<Question> {
    const repo = manager.getRepository(Question);
    const observed = await repo.findOne({ where: { id: String(questionId) } });
    if (!observed || observed.deletedAt) throw Errors.notFound('题目不存在');
    const categoryId = observed.categoryId == null ? null : String(observed.categoryId);
    if (categoryId) await manager.getRepository(TrainingCategory).findOne({ where: { id: categoryId }, lock: { mode: 'pessimistic_write' } });
    const locked = await repo.findOne({ where: { id: String(questionId) }, lock: { mode: 'pessimistic_write' } });
    if (!locked || locked.deletedAt) throw Errors.notFound('题目不存在');
    if ((locked.categoryId == null ? null : String(locked.categoryId)) !== categoryId) throw Errors.questionVersionConflict('题目类别已改变，请刷新后重试');
    return locked;
  }

  /** Validate the exact current facts, without modifying historical versions. */
  async assertCurrentUsable(questionId: string, manager: EntityManager): Promise<void> {
    const question = await this.lockIdentityForLifecycle(String(questionId), manager);
    const version = question.currentVersionId ? await manager.getRepository(QuestionVersion).findOne({
      where: { id: String(question.currentVersionId) }, lock: { mode: 'pessimistic_read' },
    }) : null;
    if (question.currentVersionId && (!version || String(version.questionId) !== String(question.id))) throw Errors.questionVersionConflict('题目当前版本不存在');
    const draft = await this.assertStoredFactsUsable(version || question, version ? String(version.id) : null, manager);
    await this.categories.lockActive(manager, draft.categoryId);
  }

  private async assertStoredFactsUsable(fact: Question | QuestionVersion, versionId: string | null, manager?: EntityManager): Promise<ValidatedQuestionDraft> {
    const version = 'questionId' in fact ? fact : null;
    const draft = validateAndSanitizeQuestionDraft({
      categoryId: fact.categoryId!, difficulty: fact.difficulty as Difficulty, type: fact.type as QuestionType,
      stem: fact.stem, options: fact.options, answer: fact.answer, analysis: fact.analysis,
      contentSchemaVersion: fact.contentSchemaVersion, contentJson: fact.contentJson,
      source: fact.source as QuestionDraft['source'], regulationId: fact.regulationId || undefined,
      regulationVersionId: (version ? version.regulationVersionId : (fact as Question).versionId) || undefined,
      sourcePageGroup: version?.sourcePageGroup ?? undefined, sourcePageStart: version?.sourcePageStart ?? undefined,
      sourcePageEnd: version?.sourcePageEnd ?? undefined,
    }, { allowReferenceAi: true });
    await this.assertSource(draft, manager);
    for (const assetId of draft.mediaAssetIds) {
      const assets = manager ? manager.getRepository(MediaAsset) : this.dataSource.getRepository(MediaAsset);
      const references = manager ? manager.getRepository(MediaReference) : this.dataSource.getRepository(MediaReference);
      const lock = manager ? { lock: { mode: 'pessimistic_read' as const } } : {};
      const asset = await assets.findOne({ where: { id: assetId }, ...lock });
      const reference = versionId ? await references.findOne({
        where: { assetId, ownerType: QUESTION_VERSION_MEDIA_OWNER, ownerId: versionId }, ...lock,
      }) : null;
      if (!asset || asset.status !== 'ready' || asset.purpose !== 'question' || asset.mediaKind !== 'image' || !reference) throw Errors.param('题目媒体不可用或缺少当前版本引用');
    }
    return draft;
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
