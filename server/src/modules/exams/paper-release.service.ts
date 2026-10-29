import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { BizError, Errors } from '../../common/errors';
import { assertPaperLearningCourses, normalizePaperLearning } from './paper-learning';
import { MAX_PAPER_SCORE_CENTS, paperScoreRule } from './paper-score';
import type { Difficulty, ExamPurpose, PoolRule, PoolScope, QuestionContentV2, QuestionOption, QuestionType, RuleSnapshot } from '../../common/training-contracts';
import { paperPoolConfig } from './paper-pool';
import { examPurposeOf } from './exam-purpose';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { PaperQuestion } from '../../entities/paper-question.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { PaperReleaseQuestion } from '../../entities/paper-release-question.entity';
import { Question } from '../../entities/question.entity';
import { QuestionVersion } from '../../entities/question-version.entity';
import { CategoryService } from '../training/category.service';
import { QuestionVersionService, type CandidateFilter, type QuestionVersionSnapshot } from '../questions/question-version.service';
import { SamplingService, samplingGroupKey, type SamplingGrouping } from './sampling.service';
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
  examPurpose?: ExamPurpose;
  id: string;
  paperId: string;
  poolScope?: PoolScope;
  rule: RuleSnapshot;
  requiresLearning: boolean;
  requiredLearningMinutes: number | null;
  courseIds: string[];
}

export interface TrainingPublishedPaper extends PublishedPaperBase {
  categoryId: string | null;
  businessScope: 'training';
  mode: PaperMode;
  pool: ScoredQuestionVersionSnapshot[];
}

export interface RegulationPublishedPaper extends PublishedPaperBase {
  categoryId: null;
  businessScope: 'regulation';
  mode: 'fixed';
  pool: ReleaseQuestionSnapshot[];
}

export type PublishedPaper = TrainingPublishedPaper | RegulationPublishedPaper;
export type ScoredQuestionVersionSnapshot = QuestionVersionSnapshot & { scoreCents: number };
export type PublishedQuestionSnapshot = ScoredQuestionVersionSnapshot | ReleaseQuestionSnapshot;

const QUESTION_TYPES = new Set<QuestionType>(['single', 'multiple', 'judgment']);
const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard']);

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function decimalToCents(value: string | number, allowZero = false): number {
  const numeric = Number(value);
  const cents = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || cents < (allowZero ? 0 : 1) || cents > MAX_PAPER_SCORE_CENTS || Math.abs(numeric * 100 - cents) > 0.000001) {
    throw Errors.paperRuleInvalid(allowZero ? '草稿题目分值须为 0～999.99 分，最多两位小数' : '固定题目分值必须是大于 0 的整数分');
  }
  return cents;
}

function questionGroupKey(version: Pick<QuestionVersion, 'questionId'>): string {
  return `question:${version.questionId}`;
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

function releaseSnapshotFromEntity(version: QuestionVersion, scoreCents: number): ReleaseQuestionSnapshot {
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
    scoreCents,
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
    const categoryPapers = await this.paperRepo.find({
      where: { businessScope: 'training', mode: 'random', status: 'draft', categoryId },
      order: { id: 'ASC' },
    });
    const publicPapers = await this.paperRepo.find({
      where: { businessScope: 'training', mode: 'random', status: 'draft', poolScope: 'public' },
      order: { id: 'ASC' },
    });
    const papers = [...new Map([...categoryPapers, ...publicPapers].map(paper => [String(paper.id), paper])).values()];
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

  private ruleForPaper(paper: ExamPaper, rules: PoolRule[], requireComplete = true): RuleSnapshot {
    const rule: RuleSnapshot = {
      ...paperScoreRule(paper.businessScope === 'regulation' ? 100 : paper.totalScore, paper.passScore),
      durationMinutes: Number(paper.durationMinutes),
      maxAttempts: paper.maxAttempts,
      partialCreditRatio: Number(paper.partialCreditRatio),
      rules: rules.map((item) => ({ ...item })),
    };
    if (examPurposeOf(paper.examPurpose) === 'practice' && (paper.businessScope !== 'training' || paper.mode !== 'random' || paper.poolScope !== 'public')) throw Errors.paperRuleInvalid('模拟考仅支持公共随机培训卷');
    this.assertRule(rule, requireComplete, examPurposeOf(paper.examPurpose));
    return rule;
  }

  private assertRule(rule: RuleSnapshot, requireComplete = true, purpose: ExamPurpose = 'formal'): void {
    if (!Number.isInteger(rule.totalCents) || rule.totalCents < 1 || rule.totalCents > MAX_PAPER_SCORE_CENTS) throw Errors.paperRuleInvalid('试卷总分必须为 0.01～999.99 分');
    if (!Number.isInteger(rule.passCents) || rule.passCents <= 0 || rule.passCents > rule.totalCents) {
      throw Errors.paperRuleInvalid('及格分数必须大于 0 且不超过试卷总分');
    }
    if (!Number.isInteger(rule.durationMinutes) || rule.durationMinutes < 1 || rule.durationMinutes > 1440) throw Errors.paperRuleInvalid('考试时长必须为1—1440分钟');
    if (purpose === 'practice' ? rule.maxAttempts !== null : (typeof rule.maxAttempts !== 'number' || !Number.isInteger(rule.maxAttempts) || rule.maxAttempts < 1 || rule.maxAttempts > 100)) throw Errors.paperRuleInvalid('作答次数必须为1—100次');
    if (!Number.isFinite(rule.partialCreditRatio) || rule.partialCreditRatio < 0 || rule.partialCreditRatio > 1) {
      throw Errors.paperRuleInvalid('多选漏选比例必须在 0—1 之间');
    }
    if (!rule.rules.length) throw Errors.paperRuleInvalid('试卷至少需要一项题型规则');
    for (const item of rule.rules) {
      if (!QUESTION_TYPES.has(item.type) || !Number.isInteger(item.count) || item.count < 1
        || !Number.isInteger(item.scoreCents) || item.scoreCents < (requireComplete ? 1 : 0) || item.scoreCents > MAX_PAPER_SCORE_CENTS) {
        throw Errors.paperRuleInvalid('题型、题量或分值规则不合法');
      }
    }
    const total = rule.rules.reduce((sum, item) => sum + item.count * item.scoreCents, 0);
    if (requireComplete && total !== rule.totalCents) throw Errors.paperRuleInvalid(`题目分值合计须为 ${rule.totalCents / 100} 分，当前为 ${total / 100} 分`);
  }

  /** Current usable identities, using exactly the publication candidate policy. */
  async randomCapacities(query: { paper_id?: string; pool_scope?: PoolScope; category_id?: string }) {
    if (query.paper_id && (query.pool_scope || query.category_id)) throw Errors.param('paper_id 不可与题池筛选同时使用');
    let paper: Pick<ExamPaper, 'businessScope' | 'mode' | 'poolScope' | 'categoryId' | 'regulationIds'>;
    if (query.paper_id) {
      const stored = await this.paperRepo.findOne({ where: { id: query.paper_id } });
      if (!stored || stored.businessScope !== 'training') throw Errors.notFound('培训试卷不存在');
      if (stored.mode !== 'random') throw Errors.param('仅随机试卷可查询可抽题数');
      paper = stored;
    } else {
      paper = { businessScope: 'training', mode: 'random', poolScope: query.pool_scope || 'category', categoryId: query.category_id || null, regulationIds: [] };
    }
    const config = paperPoolConfig(paper);
    const types: QuestionType[] = ['single', 'multiple', 'judgment'];
    const filters: CandidateFilter[] = activeDifficulties().flatMap(difficulty => types.map(type => ({
      ...(config.poolScope === 'public' ? { poolScope: 'public' as const } : { categoryId: config.categoryId! }),
      difficulty, type, ...(paper.regulationIds?.length ? { regulationIds: paper.regulationIds.map(String) } : {}),
    })));
    const pool = await this.questions.enabledCandidates(filters);
    return { items: types.map(type => {
      const count = (difficulty: string) => new Set(pool.filter(item => item.type === type && item.difficulty === difficulty).map(item => String(item.questionId))).size;
      const easy = count('easy'), hard = count('hard');
      return { type, easy, hard, available: Math.min(easy, hard) };
    }) };
  }

  private async randomPool(
    manager: EntityManager | undefined,
    paper: ExamPaper,
  ): Promise<{ rule: RuleSnapshot; pool: ScoredQuestionVersionSnapshot[] }> {
    const poolConfig = paperPoolConfig(paper);
    const configuredRules = paper.ruleConfig?.rules || [];
    if (configuredRules.length > 3 || configuredRules.some(item => item.count > 500)
      || new Set(configuredRules.map((item) => item.type)).size !== configuredRules.length) {
      throw Errors.paperRuleInvalid('随机组卷同一题型只能配置一项规则');
    }
    const rule = this.ruleForPaper(paper, configuredRules);
    const pool: QuestionVersionSnapshot[] = [];
    const regulationIds = (paper.regulationIds || []).map(String);
    const filters: CandidateFilter[] = activeDifficulties().flatMap(difficulty => rule.rules.map(item => ({
      ...(poolConfig.poolScope === 'public' ? { poolScope: 'public' as const } : { categoryId: poolConfig.categoryId! }),
      type: item.type,
      difficulty,
      ...(regulationIds.length ? { regulationIds } : {}),
    })));
    if (manager) {
      pool.push(...await this.questions.enabledCandidates(filters, manager));
    } else {
      for (const filter of filters) pool.push(...await this.questions.enabledCandidates(filter, manager));
    }
    for (const difficulty of activeDifficulties()) {
      const validation = this.sampling.validatePool(pool, rule.rules, difficulty);
      if (!validation.ok) {
        const label = difficultyCatalog().find((option) => option.code === difficulty)?.label || difficulty;
        throw Errors.paperPoolInsufficient(validation.deficits.map(deficit => ({ difficulty, ...deficit })), `${label}候选题池容量不足`);
      }
    }
    const scoreByType = new Map(rule.rules.map((item) => [item.type, item.scoreCents]));
    const unique = new Map<string, ScoredQuestionVersionSnapshot>();
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
  ): Promise<{ rule: RuleSnapshot; pool: ScoredQuestionVersionSnapshot[] }> {
    const draftPreview = !forPublication && paper.businessScope === 'training' && paper.status === 'draft';
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
    const questionIds = [...new Set(versions.map((item) => String(item.questionId)))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const questions: Question[] = [];
    for (const questionId of questionIds) {
      const question = await manager.getRepository(Question).findOne({
        where: { id: questionId }, ...(forPublication ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
      if (question) questions.push(question);
    }
    const questionMap = new Map(questions.map((item) => [String(item.id), item]));
    const regulationIds = new Set((paper.regulationIds || []).map(String));
    const seen = new Set<string>();
    const pool: ScoredQuestionVersionSnapshot[] = [];
    const rules = new Map<string, PoolRule>();
    for (const item of items) {
      const version = versionMap.get(String(item.questionVersionId));
      const question = version && questionMap.get(String(version.questionId));
      if (!version || !question || (forPublication && (!question.isEnabled || question.deletedAt)) || String(question.currentVersionId) !== String(version.id)) {
        throw Errors.paperReleaseConflict(`题目 ${item.questionId} 已停用或不是当前版本，请重新选题`);
      }
      if (String(version.categoryId) !== String(paper.categoryId)) throw Errors.paperRuleInvalid('固定题目与试卷培训类别不一致');
      if (forPublication) this.assertPublishDifficulty(version);
      if (regulationIds.size && (!version.regulationId || !regulationIds.has(String(version.regulationId)))) {
        throw Errors.paperRuleInvalid('固定题目不在试卷制度筛选范围内');
      }
      const key = questionGroupKey(version);
      if (seen.has(key)) throw Errors.paperRuleInvalid('固定题单不能重复选择同一题目');
      seen.add(key);
      const scoreCents = decimalToCents(item.score, draftPreview);
      const snapshot = snapshotFromEntity(version);
      pool.push({ ...snapshot, scoreCents });
      const ruleKey = `${snapshot.type}:${scoreCents}`;
      const existing = rules.get(ruleKey);
      if (existing) existing.count += 1;
      else rules.set(ruleKey, { type: snapshot.type, count: 1, scoreCents });
    }
    return { rule: this.ruleForPaper(paper, [...rules.values()], !draftPreview), pool };
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
      if (seen.has(groupKey)) throw Errors.paperRuleInvalid('固定题单不能重复选择同一题目');
      seen.add(groupKey);
      const scoreCents = decimalToCents(item.score);
      const snapshot = releaseSnapshotFromEntity(version, scoreCents);
      pool.push(snapshot);
      item.questionVersionId = String(version.id);
      item.conceptId = null;
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

  async publish(paperId: string, actorId: string): Promise<{ releaseId: string; poolScope?: PoolScope }> {
    const current = await this.paperRepo.findOne({ where: { id: String(paperId) } });
    if (!current || !['training', 'regulation'].includes(current.businessScope)) throw Errors.notFound('试卷不存在');
    if (current.status === 'published') {
      const existing = await this.releaseRepo.findOne({ where: { paperId: String(paperId) }, order: { versionNo: 'DESC' } });
      if (existing) return { releaseId: String(existing.id), poolScope: existing.poolScope ?? 'category' };
    }
    if (current.status !== 'draft') throw Errors.paperReleaseConflict('只有草稿试卷可以发布');
    const currentPool = paperPoolConfig(current);
    if (current.businessScope === 'regulation' && (!current.regulationId || current.mode !== 'fixed')) {
      throw Errors.paperRuleInvalid('制度试卷必须是关联制度的固定组卷');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      // Category references use the established category -> paper lock order.
      // C2 can then serialize start against publish/withdraw on the paper row.
      if (current.businessScope === 'training' && currentPool.categoryId !== null) await this.categories.lockActive(manager, currentPool.categoryId);
      const paperRepo = manager.getRepository(ExamPaper);
      const releaseRepo = manager.getRepository(PaperRelease);
      const releaseQuestionRepo = manager.getRepository(PaperReleaseQuestion);
      const paper = await paperRepo.findOne({ where: { id: String(paperId) }, lock: { mode: 'pessimistic_write' } });
      if (!paper || !['training', 'regulation'].includes(paper.businessScope)) throw Errors.notFound('试卷不存在');
      if (paper.status === 'published') {
        const existing = await releaseRepo.findOne({ where: { paperId: String(paperId) }, order: { versionNo: 'DESC' } });
        if (existing) return { releaseId: String(existing.id), poolScope: existing.poolScope ?? 'category' };
      }
      if (paper.status !== 'draft') throw Errors.paperReleaseConflict('只有草稿试卷可以发布');
      if (paper.businessScope !== current.businessScope || paper.mode !== current.mode
        || (paper.poolScope ?? 'category') !== currentPool.poolScope
        || String(paper.categoryId || '') !== String(current.categoryId || '')) {
        throw Errors.paperReleaseConflict('试卷类别或组卷模式已变化，请刷新后重试');
      }
      const poolConfig = paperPoolConfig(paper);
      const learning = paper.businessScope === 'training' ? normalizePaperLearning(paper) : null;
      if (learning) await assertPaperLearningCourses(manager, poolConfig.categoryId, learning.courseIds);

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
        examPurpose: examPurposeOf(paper.examPurpose),
        mode: paper.mode,
        poolScope: poolConfig.poolScope,
        categoryId: paper.categoryId ? String(paper.categoryId) : null,
        requiresLearning: learning ? learning.requiresLearning : Number(paper.requiresLearning || 0),
        requiredLearningMinutes: learning?.requiredLearningMinutes ?? null,
        ruleSnapshot: deepClone(frozen.rule),
        regulationIds: deepClone(paper.regulationIds || []),
        courseIds: deepClone(learning ? learning.courseIds : paper.courseIds || []),
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
      if (paper.businessScope === 'training') {
        paper.updatedBy = String(actorId);
        paper.updatedAt = new Date();
      }
      await paperRepo.save(paper);
      return { releaseId: String(release.id), poolScope: poolConfig.poolScope };
    });
    this.audit.log({
      actor_id: Number(actorId), actor_name: String(actorId), action: 'paper.release.publish',
      object_type: 'paper_release', object_id: result.releaseId, detail: { paper_id: String(paperId) }, result: 'success', source_ip: null,
    });
    return result;
  }

  async withdraw(paperId: string, actorId: string): Promise<{ paper_id: string; status: 'draft' }> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const paperRepo = manager.getRepository(ExamPaper);
      // New attempts take the same paper lock before checking published status.
      const paper = await paperRepo.findOne({ where: { id: String(paperId) }, lock: { mode: 'pessimistic_write' } });
      if (!paper || paper.businessScope !== 'training') throw Errors.notFound('培训试卷不存在');
      if (paper.status === 'draft' && await manager.getRepository(PaperRelease).existsBy({ paperId: String(paperId) })) return false;
      if (paper.status !== 'published' && paper.status !== 'withdrawn') throw Errors.paperReleaseConflict('只有已发布试卷可以撤回');

      paper.status = 'draft';
      paper.updatedBy = String(actorId);
      paper.updatedAt = new Date();
      await paperRepo.save(paper);
      return true;
    });
    if (changed) {
      this.audit.log({
        actor_id: Number(actorId), actor_name: String(actorId), action: 'paper.release.withdraw',
        object_type: 'exam_paper', object_id: String(paperId), detail: { paper_id: String(paperId) }, result: 'success', source_ip: null,
      });
    }
    return { paper_id: String(paperId), status: 'draft' };
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
      examPurpose: examPurposeOf(release.examPurpose),
      poolScope: release.poolScope ?? 'category',
      rule: deepClone(release.ruleSnapshot),
      requiresLearning: Boolean(release.requiresLearning),
      requiredLearningMinutes: release.requiredLearningMinutes ?? null,
      courseIds: (release.courseIds || []).map(String),
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
    if ((release.poolScope ?? 'category') === 'category' && !release.categoryId) throw Errors.paperReleaseConflict('培训试卷发布版本缺少培训类别');
    const poolConfig = paperPoolConfig(release);
    return {
      ...base,
      categoryId: poolConfig.categoryId,
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
    let pool: ScoredQuestionVersionSnapshot[];
    const published = paper.status === 'draft' ? null : await this.latestForPaper(paperId);
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
    const grouping: SamplingGrouping = published ? 'historical-concept' : 'question';
    const capacities = paper.mode === 'random'
      ? activeDifficulties().flatMap((poolDifficulty) => rule.rules.map((item) => ({
        difficulty: poolDifficulty,
        type: item.type,
        required: item.count,
        available: new Set(pool.filter((candidate) => candidate.difficulty === poolDifficulty && candidate.type === item.type)
          .map((candidate) => samplingGroupKey(candidate, grouping))).size,
      })))
      : [];
    if (paper.mode === 'random' && !published) assertActiveDifficulty(difficulty);
    const questions = paper.mode === 'random'
      ? this.sampling.draw(pool, rule.rules, difficulty, undefined, grouping, rule.totalCents)
      : pool;
    return {
      paper_id: String(paper.id),
      exam_purpose: examPurposeOf(paper.examPurpose),
      release_id: releaseId,
      mode: paper.mode as PaperMode,
      sample_kind: paper.mode === 'random' ? 'random_example' as const : 'fixed_paper' as const,
      note: paper.mode === 'random'
        ? '随机预览仅为规则与样例，不代表所有考生取得同一张试卷。'
        : published ? '固定卷预览使用发布题单。' : '固定草稿预览；发布前仍须完成分值配置。',
      difficulty: paper.mode === 'random' ? difficulty : null,
      rule: deepClone(rule),
      capacities,
      questions: deepClone(questions),
    };
  }
}
