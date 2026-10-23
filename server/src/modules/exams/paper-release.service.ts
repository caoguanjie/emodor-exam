import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { BizError, Errors } from '../../common/errors';
import type { Difficulty, PoolRule, QuestionContentV2, QuestionOption, QuestionType, RuleSnapshot } from '../../common/training-contracts';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { PaperQuestion } from '../../entities/paper-question.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { PaperReleaseQuestion } from '../../entities/paper-release-question.entity';
import { Question } from '../../entities/question.entity';
import { QuestionVersion } from '../../entities/question-version.entity';
import { CategoryService } from '../training/category.service';
import { QuestionVersionService, type QuestionVersionSnapshot } from '../questions/question-version.service';
import { SamplingService } from './sampling.service';
import type { QuestionContentV3 } from '../../common/question-content-v3';
import { parseQuestionContent } from '../questions/question-content-dispatch';
import { activeDifficulties, assertActiveDifficulty, difficultyCatalog } from '../../common/question-difficulty';

export type PaperBusinessScope = 'regulation' | 'training';
export type PaperMode = 'fixed' | 'random';

export interface ReleaseQuestionSnapshot {
  contentSchemaVersion?: number;
  contentJson?: QuestionContentV2 | QuestionContentV3 | null;
  questionId: string;
  versionId: string;
  revision: number;
  categoryId: string | null;
  difficulty: Difficulty | 'unknown';
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: number[];
  analysis: string | null;
  scoreCents: number;
  conceptId?: string;
  regulationId?: string;
  regulationVersionId?: string;
  sourcePageGroup?: number;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  source: QuestionVersionSnapshot['source'];
  approvedBy: string | null;
  approvedAt: string | null;
}

interface PublishedPaperBase {
  id: string;
  paperId: string;
  rule: RuleSnapshot;
  requiresLearning: boolean;
}

export interface TrainingPublishedPaper extends PublishedPaperBase {
  categoryId: string;
  businessScope: 'training';
  mode: PaperMode;
  pool: QuestionVersionSnapshot[];
}

export interface RegulationPublishedPaper extends PublishedPaperBase {
  categoryId: null;
  businessScope: 'regulation';
  mode: 'fixed';
  pool: ReleaseQuestionSnapshot[];
}

export type PublishedPaper = TrainingPublishedPaper | RegulationPublishedPaper;
export type PublishedQuestionSnapshot = QuestionVersionSnapshot | ReleaseQuestionSnapshot;

const QUESTION_TYPES = new Set<QuestionType>(['single', 'multiple', 'judgment']);
const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard']);

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function decimalToCents(value: string | number): number {
  const numeric = Number(value);
  const cents = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || cents <= 0 || Math.abs(numeric * 100 - cents) > 0.000001) {
    throw Errors.paperRuleInvalid('固定题目分值必须是大于 0 的整数分');
  }
  return cents;
}

function questionGroupKey(version: Pick<QuestionVersion, 'conceptId' | 'questionId'>): string {
  return version.conceptId ? `concept:${version.conceptId}` : `question:${version.questionId}`;
}

/** Publication stores only examination facts, never the author's document or layout. */
function freezePublishedQuestion(input: PublishedQuestionSnapshot): ReleaseQuestionSnapshot {
  const contentSchemaVersion = input.contentSchemaVersion || 1;
  // Legacy publication preserves its captured facts; its existing reader owns adaptation.
  const parsed = contentSchemaVersion === 1 ? null : parseQuestionContent(input);
  let content: QuestionContentV2 | QuestionContentV3 | null = null;
  if (parsed?.schema === 3) {
    const { schema: _schema, ...value } = parsed;
    content = value;
  } else if (parsed) {
    const { schema: _schema, ...value } = parsed;
    content = value;
  }
  const {
    questionId, versionId, revision, categoryId, difficulty, type, stem, options, answer, analysis,
    scoreCents, conceptId, regulationId, regulationVersionId, sourcePageGroup, sourcePageStart,
    sourcePageEnd, source, approvedBy, approvedAt,
  } = input;
  return deepClone({
    questionId, versionId, revision, categoryId, difficulty, type, stem, options, answer, analysis,
    scoreCents, conceptId, regulationId, regulationVersionId, sourcePageGroup, sourcePageStart,
    sourcePageEnd, source, approvedBy, approvedAt,
    contentSchemaVersion,
    contentJson: content,
  });
}

function snapshotFromEntity(version: QuestionVersion): QuestionVersionSnapshot {
  if (!version.categoryId || !version.difficulty || !DIFFICULTIES.has(version.difficulty as Difficulty)) {
    throw Errors.paperReleaseConflict('题目版本缺少有效的培训类别或难度');
  }
  return {
    contentSchemaVersion: version.contentSchemaVersion || 1,
    contentJson: version.contentJson || null,
    questionId: String(version.questionId),
    versionId: String(version.id),
    revision: Number(version.revision),
    categoryId: String(version.categoryId),
    difficulty: version.difficulty as Difficulty,
    type: version.type as QuestionType,
    stem: version.stem,
    options: deepClone(version.options as QuestionOption[]),
    answer: [...version.answer],
    analysis: version.analysis,
    scoreCents: Number(version.scoreCents),
    conceptId: version.conceptId || undefined,
    regulationId: version.regulationId || undefined,
    regulationVersionId: version.regulationVersionId || undefined,
    sourcePageGroup: version.sourcePageGroup ?? undefined,
    sourcePageStart: version.sourcePageStart ?? undefined,
    sourcePageEnd: version.sourcePageEnd ?? undefined,
    source: version.source as QuestionVersionSnapshot['source'],
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt?.toISOString() || null,
  };
}

function releaseSnapshotFromEntity(version: QuestionVersion): ReleaseQuestionSnapshot {
  return {
    contentSchemaVersion: version.contentSchemaVersion || 1,
    contentJson: version.contentJson || null,
    questionId: String(version.questionId),
    versionId: String(version.id),
    revision: Number(version.revision),
    categoryId: version.categoryId ? String(version.categoryId) : null,
    difficulty: DIFFICULTIES.has(version.difficulty as Difficulty) ? version.difficulty as Difficulty : 'unknown',
    type: version.type as QuestionType,
    stem: version.stem,
    options: deepClone(version.options as QuestionOption[]),
    answer: [...version.answer],
    analysis: version.analysis,
    scoreCents: Number(version.scoreCents),
    conceptId: version.conceptId || undefined,
    regulationId: version.regulationId || undefined,
    regulationVersionId: version.regulationVersionId || undefined,
    sourcePageGroup: version.sourcePageGroup ?? undefined,
    sourcePageStart: version.sourcePageStart ?? undefined,
    sourcePageEnd: version.sourcePageEnd ?? undefined,
    source: version.source as QuestionVersionSnapshot['source'],
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt?.toISOString() || null,
  };
}

@Injectable()
export class PaperReleaseService implements OnModuleInit {
  constructor(
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(PaperRelease) private readonly releaseRepo: Repository<PaperRelease>,
    @InjectRepository(PaperReleaseQuestion) private readonly releaseQuestionRepo: Repository<PaperReleaseQuestion>,
    private readonly dataSource: DataSource,
    private readonly categories: CategoryService,
    private readonly questions: QuestionVersionService,
    private readonly sampling: SamplingService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.questions.registerRandomDraftMediaResolver((versionId, categoryId) => (
      this.randomDraftMediaCandidate(versionId, categoryId)
    ));
  }

  private async randomDraftMediaCandidate(
    versionId: string,
    categoryId: string | null,
  ): Promise<QuestionVersionSnapshot | null> {
    if (!categoryId) return null;
    const papers = await this.paperRepo.find({
      where: { businessScope: 'training', mode: 'random', status: 'draft', categoryId },
      order: { id: 'ASC' },
    });
    for (const paper of papers) {
      try {
        const { pool } = await this.randomPool(undefined, paper);
        const candidate = pool.find((item) => String(item.versionId) === String(versionId));
        if (candidate) return candidate;
      } catch (error) {
        if (error instanceof BizError && [40910, 40971, 40972].includes(error.code)) continue;
        throw error;
      }
    }
    return null;
  }

  private ruleForPaper(paper: ExamPaper, rules: PoolRule[]): RuleSnapshot {
    const rule: RuleSnapshot = {
      totalCents: 10000,
      passCents: Math.round(Number(paper.passScore) * 100),
      durationMinutes: Number(paper.durationMinutes),
      maxAttempts: Number(paper.maxAttempts),
      partialCreditRatio: Number(paper.partialCreditRatio),
      rules: rules.map((item) => ({ ...item })),
    };
    this.assertRule(rule);
    return rule;
  }

  private assertRule(rule: RuleSnapshot): void {
    if (rule.totalCents !== 10000) throw Errors.paperRuleInvalid('试卷总分必须为 10000 分');
    if (!Number.isInteger(rule.passCents) || rule.passCents <= 0 || rule.passCents > 10000) {
      throw Errors.paperRuleInvalid('及格线必须在 1—10000 分之间');
    }
    if (!Number.isInteger(rule.durationMinutes) || rule.durationMinutes < 1) throw Errors.paperRuleInvalid('考试时长必须是正整数');
    if (!Number.isInteger(rule.maxAttempts) || rule.maxAttempts < 1) throw Errors.paperRuleInvalid('作答次数必须是正整数');
    if (!Number.isFinite(rule.partialCreditRatio) || rule.partialCreditRatio < 0 || rule.partialCreditRatio > 1) {
      throw Errors.paperRuleInvalid('多选漏选比例必须在 0—1 之间');
    }
    if (!rule.rules.length) throw Errors.paperRuleInvalid('试卷至少需要一项题型规则');
    for (const item of rule.rules) {
      if (!QUESTION_TYPES.has(item.type) || !Number.isInteger(item.count) || item.count < 1
        || !Number.isInteger(item.scoreCents) || item.scoreCents < 1) {
        throw Errors.paperRuleInvalid('题型、题量或分值规则不合法');
      }
    }
    const total = rule.rules.reduce((sum, item) => sum + item.count * item.scoreCents, 0);
    if (total !== 10000) throw Errors.paperRuleInvalid(`题型规则总分必须为 10000 分，当前为 ${total}`);
  }

  private async randomPool(
    manager: EntityManager | undefined,
    paper: ExamPaper,
  ): Promise<{ rule: RuleSnapshot; pool: QuestionVersionSnapshot[] }> {
    const configuredRules = paper.ruleConfig?.rules || [];
    if (configuredRules.length > 4 || new Set(configuredRules.map((item) => item.type)).size !== configuredRules.length) {
      throw Errors.paperRuleInvalid('随机组卷同一题型只能配置一项规则');
    }
    const rule = this.ruleForPaper(paper, configuredRules);
    const pool: QuestionVersionSnapshot[] = [];
    const regulationIds = (paper.regulationIds || []).map(String);
    for (const difficulty of activeDifficulties()) {
      for (const item of rule.rules) {
        pool.push(...await this.questions.approvedCandidates({
          categoryId: String(paper.categoryId),
          type: item.type,
          difficulty,
          ...(regulationIds.length ? { regulationIds } : {}),
        }, manager));
      }
    }
    for (const difficulty of activeDifficulties()) {
      const validation = this.sampling.validatePool(pool, rule.rules, difficulty);
      if (!validation.ok) {
        const label = difficultyCatalog().find((option) => option.code === difficulty)?.label || difficulty;
        throw Errors.paperPoolInsufficient(validation.deficits, `${label}候选题池容量不足`);
      }
    }
    const scoreByType = new Map(rule.rules.map((item) => [item.type, item.scoreCents]));
    const unique = new Map<string, QuestionVersionSnapshot>();
    for (const item of pool) {
      unique.set(String(item.versionId), {
        ...deepClone(item),
        scoreCents: scoreByType.get(item.type)!,
      });
    }
    return { rule, pool: [...unique.values()] };
  }

  private async fixedPool(
    manager: EntityManager,
    paper: ExamPaper,
    forPublication = true,
  ): Promise<{ rule: RuleSnapshot; pool: QuestionVersionSnapshot[] }> {
    const items = await manager.getRepository(PaperQuestion).find({
      where: { paperId: String(paper.id) },
      order: { sort: 'ASC', id: 'ASC' },
    });
    if (!items.length || items.some((item) => !item.questionVersionId)) {
      throw Errors.paperRuleInvalid('固定组卷至少需要一道已选择的题目版本');
    }
    const versionIds = items.map((item) => String(item.questionVersionId));
    const versions = await manager.getRepository(QuestionVersion).findBy({ id: In(versionIds) });
    const versionMap = new Map(versions.map((item) => [String(item.id), item]));
    const questionIds = versions.map((item) => String(item.questionId));
    const questions = await manager.getRepository(Question).findBy({ id: In(questionIds) });
    const questionMap = new Map(questions.map((item) => [String(item.id), item]));
    const regulationIds = new Set((paper.regulationIds || []).map(String));
    const seen = new Set<string>();
    const pool: QuestionVersionSnapshot[] = [];
    const rules = new Map<string, PoolRule>();
    for (const item of items) {
      const version = versionMap.get(String(item.questionVersionId));
      const question = version && questionMap.get(String(version.questionId));
      if (!version || !question || version.status !== 'approved' || String(question.currentVersionId) !== String(version.id)) {
        throw Errors.paperReleaseConflict(`题目 ${item.questionId} 已不是当前审核通过版本`);
      }
      if (String(version.categoryId) !== String(paper.categoryId)) throw Errors.paperRuleInvalid('固定题目与试卷培训类别不一致');
      if (forPublication) this.assertPublishDifficulty(version);
      if (regulationIds.size && (!version.regulationId || !regulationIds.has(String(version.regulationId)))) {
        throw Errors.paperRuleInvalid('固定题目不在试卷制度筛选范围内');
      }
      const key = questionGroupKey(version);
      if (seen.has(key)) throw Errors.paperRuleInvalid('固定题单存在重复考点');
      seen.add(key);
      const scoreCents = decimalToCents(item.score);
      const snapshot = snapshotFromEntity(version);
      pool.push({ ...snapshot, scoreCents });
      const ruleKey = `${snapshot.type}:${scoreCents}`;
      const existing = rules.get(ruleKey);
      if (existing) existing.count += 1;
      else rules.set(ruleKey, { type: snapshot.type, count: 1, scoreCents });
    }
    return { rule: this.ruleForPaper(paper, [...rules.values()]), pool };
  }

  private async regulationFixedPool(
    manager: EntityManager,
    paper: ExamPaper,
  ): Promise<{ rule: RuleSnapshot; pool: ReleaseQuestionSnapshot[] }> {
    const itemRepo = manager.getRepository(PaperQuestion);
    const items = await itemRepo.find({
      where: { paperId: String(paper.id) },
      order: { sort: 'ASC', id: 'ASC' },
    });
    const sumCents = items.reduce((sum, item) => sum + decimalToCents(item.score), 0);
    const expectedCents = Math.round(Number(paper.totalScore) * 100);
    if (sumCents !== expectedCents) {
      throw Errors.publishCheckFailed(
        `试卷总分校验未通过：题目分值合计 ${(sumCents / 100).toFixed(2)}，应为 ${(expectedCents / 100).toFixed(2)}（差额 ${((expectedCents - sumCents) / 100).toFixed(2)}）`,
      );
    }

    const resolved = new Map<string, QuestionVersion>();
    for (const item of [...items].sort((left, right) => String(left.questionId).localeCompare(String(right.questionId), 'en', { numeric: true }))) {
      resolved.set(String(item.questionId), await this.questions.currentOrCaptureForRelease(
        manager,
        String(item.questionId),
        item.questionVersionId ? String(item.questionVersionId) : undefined,
      ));
    }

    const pool: ReleaseQuestionSnapshot[] = [];
    const rules = new Map<string, PoolRule>();
    const seen = new Set<string>();
    for (const item of items) {
      const version = resolved.get(String(item.questionId));
      if (!version) throw Errors.paperReleaseConflict(`题目 ${item.questionId} 当前版本不存在，请重新选题`);
      this.assertPublishDifficulty(version);
      if (version.type !== 'single' && version.type !== 'multiple') {
        throw Errors.param('legacy 固定试卷仅支持单选题和多选题；判断题/图片题须使用后续培训发布链路');
      }
      if (!paper.regulationId || String(version.regulationId || '') !== String(paper.regulationId)) {
        throw Errors.paperReleaseConflict(`题目 ${item.questionId} 与试卷制度已不一致，请重新选题`);
      }
      const groupKey = questionGroupKey(version);
      if (seen.has(groupKey)) throw Errors.paperRuleInvalid('固定题单存在重复考点');
      seen.add(groupKey);
      const scoreCents = decimalToCents(item.score);
      const snapshot = { ...releaseSnapshotFromEntity(version), scoreCents };
      pool.push(snapshot);
      item.questionVersionId = String(version.id);
      item.conceptId = version.conceptId ? String(version.conceptId) : null;
      const key = `${snapshot.type}:${scoreCents}`;
      const existing = rules.get(key);
      if (existing) existing.count += 1;
      else rules.set(key, { type: snapshot.type, count: 1, scoreCents });
    }
    await itemRepo.save(items);
    return { rule: this.ruleForPaper(paper, [...rules.values()]), pool };
  }

  private assertPublishDifficulty(version: QuestionVersion): void {
    try { assertActiveDifficulty(version.difficulty); }
    catch {
      throw Errors.paperRuleInvalid(`题目 ${version.questionId}（版本 ${version.id}）难度 ${version.difficulty || 'unknown'} 未启用，请修订并重新选题`);
    }
  }

  async publish(paperId: string, actorId: string): Promise<{ releaseId: string }> {
    const current = await this.paperRepo.findOne({ where: { id: String(paperId) } });
    if (!current || !['training', 'regulation'].includes(current.businessScope)) throw Errors.notFound('试卷不存在');
    if (current.status === 'published') {
      const existing = await this.releaseRepo.findOne({ where: { paperId: String(paperId) }, order: { versionNo: 'DESC' } });
      if (existing) return { releaseId: String(existing.id) };
    }
    if (current.status !== 'draft') throw Errors.paperReleaseConflict('只有草稿试卷可以发布');
    if (current.businessScope === 'training' && !current.categoryId) throw Errors.paperRuleInvalid('培训试卷必须选择培训类别');
    if (current.businessScope === 'regulation' && (!current.regulationId || current.mode !== 'fixed')) {
      throw Errors.paperRuleInvalid('制度试卷必须是关联制度的固定组卷');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      // Category references use the established category -> paper lock order.
      // C2 can then serialize start against publish/withdraw on the paper row.
      if (current.businessScope === 'training') await this.categories.lockActive(manager, String(current.categoryId));
      const paperRepo = manager.getRepository(ExamPaper);
      const releaseRepo = manager.getRepository(PaperRelease);
      const releaseQuestionRepo = manager.getRepository(PaperReleaseQuestion);
      const paper = await paperRepo.findOne({ where: { id: String(paperId) }, lock: { mode: 'pessimistic_write' } });
      if (!paper || !['training', 'regulation'].includes(paper.businessScope)) throw Errors.notFound('试卷不存在');
      if (paper.status === 'published') {
        const existing = await releaseRepo.findOne({ where: { paperId: String(paperId) }, order: { versionNo: 'DESC' } });
        if (existing) return { releaseId: String(existing.id) };
      }
      if (paper.status !== 'draft') throw Errors.paperReleaseConflict('只有草稿试卷可以发布');
      if (paper.businessScope !== current.businessScope || paper.mode !== current.mode
        || String(paper.categoryId || '') !== String(current.categoryId || '')) {
        throw Errors.paperReleaseConflict('试卷类别或组卷模式已变化，请刷新后重试');
      }
      if (paper.businessScope === 'training' && !paper.categoryId) {
        throw Errors.paperReleaseConflict('试卷培训类别已变化，请刷新后重试');
      }

      const frozen = paper.businessScope === 'regulation'
        ? await this.regulationFixedPool(manager, paper)
        : paper.mode === 'random'
          ? await this.randomPool(manager, paper)
          : paper.mode === 'fixed'
            ? await this.fixedPool(manager, paper)
            : (() => { throw Errors.paperRuleInvalid('未知组卷模式'); })();
      const snapshots = frozen.pool.map(freezePublishedQuestion);
      const previous = await releaseRepo.findOne({ where: { paperId: String(paperId) }, order: { versionNo: 'DESC' } });
      const release = await releaseRepo.save(releaseRepo.create({
        paperId: String(paper.id),
        versionNo: Number(previous?.versionNo || 0) + 1,
        businessScope: paper.businessScope,
        mode: paper.mode,
        categoryId: paper.categoryId ? String(paper.categoryId) : null,
        requiresLearning: Number(paper.requiresLearning || 0),
        ruleSnapshot: deepClone(frozen.rule),
        regulationIds: deepClone(paper.regulationIds || []),
        courseIds: deepClone(paper.courseIds || []),
        createdBy: String(actorId),
      }));
      const rows = snapshots.map((snapshot, position) => releaseQuestionRepo.create({
        releaseId: String(release.id),
        questionId: String(snapshot.questionId),
        questionVersionId: String(snapshot.versionId),
        conceptId: snapshot.conceptId ? String(snapshot.conceptId) : null,
        type: snapshot.type,
        difficulty: snapshot.difficulty,
        scoreCents: Number(snapshot.scoreCents),
        position,
        snapshotJson: deepClone(snapshot),
      }));
      await releaseQuestionRepo.save(rows);
      paper.status = 'published';
      await paperRepo.save(paper);
      return { releaseId: String(release.id) };
    });
    this.audit.log({
      actor_id: Number(actorId), actor_name: String(actorId), action: 'paper.release.publish',
      object_type: 'paper_release', object_id: result.releaseId, detail: { paper_id: String(paperId) }, result: 'success', source_ip: null,
    });
    return result;
  }

  async get(releaseId: string, manager?: EntityManager): Promise<PublishedPaper> {
    const releaseRepo = manager ? manager.getRepository(PaperRelease) : this.releaseRepo;
    const releaseQuestionRepo = manager ? manager.getRepository(PaperReleaseQuestion) : this.releaseQuestionRepo;
    const release = await releaseRepo.findOne({ where: { id: String(releaseId) } });
    if (!release) throw Errors.notFound('试卷发布版本不存在');
    const rows = await releaseQuestionRepo.find({
      where: { releaseId: String(releaseId) },
      order: { position: 'ASC', id: 'ASC' },
    });
    const base = {
      id: String(release.id),
      paperId: String(release.paperId),
      rule: deepClone(release.ruleSnapshot),
      requiresLearning: Boolean(release.requiresLearning),
    };
    if (release.businessScope === 'regulation') {
      return {
        ...base,
        categoryId: null,
        businessScope: 'regulation',
        mode: 'fixed',
        pool: rows.map((row) => ({
          ...deepClone(row.snapshotJson as ReleaseQuestionSnapshot),
          categoryId: row.snapshotJson.categoryId ? String(row.snapshotJson.categoryId) : null,
          difficulty: DIFFICULTIES.has(row.difficulty as Difficulty) ? row.difficulty as Difficulty : 'unknown',
          scoreCents: Number(row.scoreCents),
        })),
      };
    }
    if (!release.categoryId) throw Errors.paperReleaseConflict('培训试卷发布版本缺少培训类别');
    return {
      ...base,
      categoryId: String(release.categoryId),
      businessScope: 'training',
      mode: release.mode as PaperMode,
      pool: rows.map((row) => ({ ...deepClone(row.snapshotJson as QuestionVersionSnapshot), scoreCents: Number(row.scoreCents) })),
    };
  }

  async latestForPaper(paperId: string, manager?: EntityManager): Promise<PublishedPaper | null> {
    const repo = manager ? manager.getRepository(PaperRelease) : this.releaseRepo;
    const release = await repo.findOne({ where: { paperId: String(paperId) }, order: { versionNo: 'DESC' } });
    return release ? this.get(String(release.id), manager) : null;
  }

  async preview(paperId: string, difficulty: Difficulty = 'easy') {
    const paper = await this.paperRepo.findOne({ where: { id: String(paperId) } });
    if (!paper || paper.businessScope !== 'training') throw Errors.notFound('培训试卷不存在');
    let releaseId: string | null = null;
    let rule: RuleSnapshot;
    let pool: QuestionVersionSnapshot[];
    const published = await this.latestForPaper(paperId);
    if (published) {
      if (published.businessScope !== 'training') throw Errors.paperReleaseConflict('试卷发布版本业务范围不一致');
      releaseId = published.id;
      rule = published.rule;
      pool = published.pool;
    } else if (paper.mode === 'random') {
      ({ rule, pool } = await this.randomPool(undefined, paper));
    } else {
      ({ rule, pool } = await this.dataSource.transaction((manager) => this.fixedPool(manager, paper, false)));
    }
    const capacities = paper.mode === 'random'
      ? activeDifficulties().flatMap((poolDifficulty) => rule.rules.map((item) => ({
        difficulty: poolDifficulty,
        type: item.type,
        required: item.count,
        available: new Set(pool.filter((candidate) => candidate.difficulty === poolDifficulty && candidate.type === item.type)
          .map((candidate) => candidate.conceptId ? `concept:${candidate.conceptId}` : `question:${candidate.questionId}`)).size,
      })))
      : [];
    if (paper.mode === 'random' && !published) assertActiveDifficulty(difficulty);
    const questions = paper.mode === 'random'
      ? this.sampling.draw(pool, rule.rules, difficulty)
      : pool;
    return {
      paper_id: String(paper.id),
      release_id: releaseId,
      mode: paper.mode as PaperMode,
      sample_kind: paper.mode === 'random' ? 'random_example' as const : 'fixed_paper' as const,
      note: paper.mode === 'random'
        ? '随机预览仅为规则与样例，不代表所有考生取得同一张试卷。'
        : '固定卷预览使用发布题单。',
      difficulty: paper.mode === 'random' ? difficulty : null,
      rule: deepClone(rule),
      capacities,
      questions: deepClone(questions),
    };
  }
}
