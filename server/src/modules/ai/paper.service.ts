import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { PaperQuestion } from '../../entities/paper-question.entity';
import { Question } from '../../entities/question.entity';
import { QuestionVersion } from '../../entities/question-version.entity';
import { Regulation } from '../../entities/regulation.entity';
import { TrainingCourse } from '../../entities/training-course.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { Errors, PaperStatus, QuestionStatus } from '../../common/errors';
import { AuditService } from '../../common/audit.service';
import type { Difficulty, PoolRule, QuestionType, RuleSnapshot } from '../../common/training-contracts';
import { CategoryService } from '../training/category.service';
import { QuestionVersionService, type QuestionVersionSnapshot } from '../questions/question-version.service';
import type { CreateTrainingPaperDto, UpdateTrainingPaperDto } from '../exams/paper.dto';
import { PaperReleaseService } from '../exams/paper-release.service';

type PaperActor = { id: string | number; name: string };
type FixedQuestionInput = { question_version_id: string; score_cents: number };

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 组卷服务（05 册 4.4.7）：试卷策略配置、选题入卷校验（approved + 同制度 + 不重复）、
 * 发布校验 SUM(paper_question.score) = 100（C-04）、发布后 paper_question 锁定（40907）。
 * 升级后新发布的制度卷冻结题目版本、实际分值和策略；真正升级前无 release 的 published 卷保留兼容语义。
 */
@Injectable()
export class PaperService {
  constructor(
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(PaperQuestion) private readonly pqRepo: Repository<PaperQuestion>,
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    @InjectRepository(QuestionVersion) private readonly versionRepo: Repository<QuestionVersion>,
    @InjectRepository(Regulation) private readonly regulationRepo: Repository<Regulation>,
    @InjectRepository(TrainingCourse) private readonly courseRepo: Repository<TrainingCourse>,
    @InjectRepository(PaperRelease) private readonly releaseRepo: Repository<PaperRelease>,
    private readonly categories: CategoryService,
    private readonly versions: QuestionVersionService,
    private readonly releaseService: PaperReleaseService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  private assertLegacyPaper(paper: ExamPaper): void {
    if (paper.businessScope === 'training') throw Errors.notFound('制度专项试卷不存在');
  }

  private assertTrainingPaper(paper: ExamPaper | null): asserts paper is ExamPaper {
    if (!paper || paper.businessScope !== 'training') throw Errors.notFound('培训试卷不存在');
  }

  paperView(p: ExamPaper, releaseId: string | null = null, frozenRule?: RuleSnapshot) {
    return {
      id: Number(p.id),
      regulation_id: Number(p.regulationId),
      title: p.title,
      total_score: Number(p.totalScore),
      pass_score: frozenRule ? frozenRule.passCents / 100 : Number(p.passScore),
      duration_minutes: frozenRule ? frozenRule.durationMinutes : p.durationMinutes,
      max_attempts: frozenRule ? frozenRule.maxAttempts : p.maxAttempts,
      partial_credit_ratio: frozenRule ? frozenRule.partialCreditRatio : Number(p.partialCreditRatio),
      status: p.status,
      release_id: releaseId,
      rules_locked: Boolean(releaseId),
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
  }

  private assertLegacyFixedQuestion(question: Question): void {
    if (question.type !== 'single' && question.type !== 'multiple') {
      throw Errors.param('legacy 固定试卷仅支持单选题和多选题；判断题/图片题须使用后续培训发布链路');
    }
  }

  private async assertLegacyPaperQuestions(paperId: string): Promise<void> {
    const items = await this.pqRepo.find({ where: { paperId } });
    const questionIds = items.map((item) => String(item.questionId));
    if (!questionIds.length) return;
    const questions = await this.questionRepo.find({ where: { id: In(questionIds) } });
    if (questions.length !== questionIds.length) throw Errors.param('固定试卷包含不存在的题目');
    for (const question of questions) this.assertLegacyFixedQuestion(question);
  }

  async list(query: { page?: number; page_size?: number; regulation_id?: number; status?: string }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.paperRepo.createQueryBuilder('p');
    qb.where('(p.business_scope = :legacyScope OR p.business_scope IS NULL)', { legacyScope: 'regulation' });
    if (query.regulation_id) qb.andWhere('p.regulation_id = :rid', { rid: String(query.regulation_id) });
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    qb.orderBy('p.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    const releases = rows.length ? await this.releaseRepo.find({
      where: { paperId: In(rows.map((item) => String(item.id))) },
      order: { versionNo: 'DESC' },
    }) : [];
    const latest = new Map<string, PaperRelease>();
    for (const release of releases) if (!latest.has(String(release.paperId))) latest.set(String(release.paperId), release);
    return {
      list: rows.map((p) => this.paperView(p, latest.get(String(p.id))?.id || null)),
      total, page, page_size: pageSize,
    };
  }

  async detail(id: string) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    this.assertLegacyPaper(p);
    const questions = await this.pqRepo.find({ where: { paperId: id }, order: { sort: 'ASC', id: 'ASC' } });
    const published = await this.releaseService.latestForPaper(id);
    if (published?.businessScope === 'regulation') {
      const linkByQuestion = new Map(questions.map((item) => [String(item.questionId), item]));
      return {
        ...this.paperView(p, published.id, published.rule),
        sum_score: published.pool.reduce((sum, item) => sum + Number(item.scoreCents), 0) / 100,
        questions: published.pool.map((snapshot, index) => {
          const link = linkByQuestion.get(String(snapshot.questionId));
          return {
            paper_question_id: link ? Number(link.id) : null,
            question_id: Number(snapshot.questionId),
            question_version_id: String(snapshot.versionId),
            sort: link ? Number(link.sort) : index,
            score: Number(snapshot.scoreCents) / 100,
            type: snapshot.type,
            stem: snapshot.stem,
            status: 'approved',
            source: snapshot.source,
          };
        }),
      };
    }
    const qIds = questions.map((pq) => pq.questionId);
    const qRows = qIds.length ? await this.questionRepo.find({ where: { id: In(qIds) } }) : [];
    const qMap = new Map(qRows.map((q) => [q.id, q]));
    return {
      ...this.paperView(p),
      sum_score: questions.reduce((a, pq) => a + Number(pq.score), 0),
      questions: questions.map((pq) => {
        const q = qMap.get(pq.questionId);
        return {
          paper_question_id: Number(pq.id),
          question_id: Number(pq.questionId),
          sort: pq.sort,
          score: Number(pq.score),
          type: q?.type,
          stem: q?.stem,
          status: q?.status,
          source: q?.source,
        };
      }),
    };
  }

  async create(input: { regulation_id: string; title: string; pass_score?: number; duration_minutes?: number; max_attempts?: number; partial_credit_ratio?: number }, actor: { id: number; name: string }, ip: string | null) {
    this.validateStrategy({
      pass_score: input.pass_score,
      duration_minutes: input.duration_minutes,
      max_attempts: input.max_attempts,
      partial_credit_ratio: input.partial_credit_ratio,
    });
    const p = await this.paperRepo.save(
      this.paperRepo.create({
        regulationId: input.regulation_id,
        businessScope: 'regulation',
        mode: 'fixed',
        categoryId: null,
        requiresLearning: 1,
        regulationIds: [String(input.regulation_id)],
        courseIds: [],
        ruleConfig: null,
        title: input.title,
        passScore: String(input.pass_score ?? 60),
        durationMinutes: input.duration_minutes ?? 30,
        maxAttempts: input.max_attempts ?? 3,
        partialCreditRatio: String(input.partial_credit_ratio ?? 0.5),
        status: PaperStatus.DRAFT,
        createdBy: String(actor.id),
      }),
    );
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.create', object_type: 'exam_paper',
      object_id: p.id, detail: { title: input.title, regulation_id: Number(input.regulation_id) }, result: 'success', source_ip: ip,
    });
    return this.paperView(p);
  }

  private validateStrategy(patch: { pass_score?: number; duration_minutes?: number; max_attempts?: number; partial_credit_ratio?: number }) {
    if (patch.pass_score !== undefined && !(patch.pass_score > 0 && patch.pass_score <= 100)) {
      throw Errors.param('pass_score 取值范围 (0, 100]');
    }
    if (patch.duration_minutes !== undefined && (!Number.isInteger(patch.duration_minutes) || patch.duration_minutes < 1)) {
      throw Errors.param('duration_minutes 须为 ≥ 1 的整数');
    }
    if (patch.max_attempts !== undefined && (!Number.isInteger(patch.max_attempts) || patch.max_attempts < 1)) {
      throw Errors.param('max_attempts 须为 ≥ 1 的整数');
    }
    if (patch.partial_credit_ratio !== undefined && !(patch.partial_credit_ratio >= 0 && patch.partial_credit_ratio <= 1)) {
      throw Errors.param('partial_credit_ratio 取值范围 [0.00, 1.00]');
    }
  }

  /** 修改策略字段；有不可变 release 的发布卷须先复制为新草稿。 */
  async updateStrategy(id: string, patch: { title?: string; pass_score?: number; duration_minutes?: number; max_attempts?: number; partial_credit_ratio?: number }, actor: { id: number; name: string }, ip: string | null) {
    this.validateStrategy(patch);
    const p = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ExamPaper);
      const locked = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!locked) throw Errors.notFound('试卷不存在');
      this.assertLegacyPaper(locked);
      if (locked.status === PaperStatus.ARCHIVED) throw Errors.param('已归档试卷不可修改');
      if (await this.releaseService.latestForPaper(id, manager)) {
        throw Errors.paperReleaseConflict('已冻结发布卷不可修改，请复制为新草稿');
      }
      if (patch.title !== undefined) locked.title = patch.title;
      if (patch.pass_score !== undefined) locked.passScore = String(patch.pass_score);
      if (patch.duration_minutes !== undefined) locked.durationMinutes = patch.duration_minutes;
      if (patch.max_attempts !== undefined) locked.maxAttempts = patch.max_attempts;
      if (patch.partial_credit_ratio !== undefined) locked.partialCreditRatio = String(patch.partial_credit_ratio);
      return repo.save(locked);
    });
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.update', object_type: 'exam_paper',
      object_id: id, detail: patch as any, result: 'success', source_ip: ip,
    });
    return this.paperView(p);
  }

  /** 组卷（PUT /ai/papers/{id}/questions）：全量替换题目组成；发布后锁定（40907） */
  async setQuestions(id: string, items: { question_id: number | string; score?: number }[], actor: { id: number; name: string }, ip: string | null) {
    if (!Array.isArray(items) || !items.length) throw Errors.param('试卷至少需要 1 道题');
    const count = await this.dataSource.transaction(async (manager) => {
      const paper = await manager.getRepository(ExamPaper).findOne({
        where: { id }, lock: { mode: 'pessimistic_write' },
      });
      if (!paper) throw Errors.notFound('试卷不存在');
      this.assertLegacyPaper(paper);
      if (paper.status !== PaperStatus.DRAFT) throw Errors.paperQuestionsLocked();
      const qIds = Array.from(new Set(items.map((it) => String(it.question_id))));
      const qRows = await manager.getRepository(Question).find({ where: { id: In(qIds) } });
      const qMap = new Map(qRows.map((q) => [q.id, q]));
      const repo = manager.getRepository(PaperQuestion);
      const entities: PaperQuestion[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const q = qMap.get(String(it.question_id));
        if (!q) throw Errors.param(`题目 ${it.question_id} 不存在`);
        this.assertLegacyFixedQuestion(q);
        if (q.status !== QuestionStatus.APPROVED) throw Errors.param(`题目 ${it.question_id} 未审核通过，不能入卷`);
        if (q.regulationId !== paper.regulationId) throw Errors.param(`题目 ${it.question_id} 与试卷不属于同一制度`);
        if (seen.has(q.id)) throw Errors.param(`题目 ${it.question_id} 重复`);
        seen.add(q.id);
        entities.push(repo.create({
          paperId: id,
          questionId: q.id,
          questionVersionId: q.currentVersionId ? String(q.currentVersionId) : null,
          conceptId: q.conceptId ? String(q.conceptId) : null,
          sort: i,
          score: String(it.score ?? Number(q.score)),
        }));
      }
      await repo.delete({ paperId: id });
      await repo.save(entities);
      return entities.length;
    });
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.questions.set', object_type: 'exam_paper',
      object_id: id, detail: { count }, result: 'success', source_ip: ip,
    });
    return this.detail(id);
  }

  /** 发布（FR-AIQ-07 验收①）：SUM(score) = 100 校验，不足/超出均拦截并提示差额 */
  async publish(id: string, actor: { id: number; name: string }, ip: string | null) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    this.assertLegacyPaper(p);
    if (p.status === PaperStatus.PUBLISHED) {
      const existing = await this.releaseService.latestForPaper(id);
      return this.paperView(p, existing?.id || null, existing?.rule);
    }
    if (p.status === PaperStatus.ARCHIVED) throw Errors.param('已归档试卷不可发布');
    // Compatibility preflight keeps the legacy capability error stable; the
    // release transaction repeats the same type/current-version checks.
    await this.assertLegacyPaperQuestions(id);
    const { releaseId } = await this.releaseService.publish(id, String(actor.id));
    const release = await this.releaseService.get(releaseId);
    const published = await this.paperRepo.findOne({ where: { id } });
    if (!published) throw Errors.notFound('试卷不存在');
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.publish', object_type: 'exam_paper',
      object_id: id, detail: { sum_score: release.rule.totalCents / 100, release_id: releaseId }, result: 'success', source_ip: ip,
    });
    return this.paperView(published, releaseId, release.rule);
  }

  /** Copy immutable release facts into a new editable legacy draft. */
  async copy(id: string, actor: { id: number; name: string }, ip: string | null) {
    const copied = await this.dataSource.transaction(async (manager) => {
      const paperRepo = manager.getRepository(ExamPaper);
      const source = await paperRepo.findOne({ where: { id }, lock: { mode: 'pessimistic_read' } });
      if (!source) throw Errors.notFound('试卷不存在');
      this.assertLegacyPaper(source);
      const release = await this.releaseService.latestForPaper(id, manager);
      const rule = release?.rule;
      const created = await paperRepo.save(paperRepo.create({
        regulationId: source.regulationId,
        businessScope: 'regulation',
        mode: 'fixed',
        categoryId: null,
        requiresLearning: release ? Number(release.requiresLearning) : source.requiresLearning,
        regulationIds: cloneJson(source.regulationIds || (source.regulationId ? [String(source.regulationId)] : [])),
        courseIds: cloneJson(source.courseIds || []),
        ruleConfig: rule ? cloneJson(rule) : source.ruleConfig ? cloneJson(source.ruleConfig) : null,
        title: `${source.title}（副本）`,
        totalScore: source.totalScore,
        passScore: rule ? (rule.passCents / 100).toFixed(2) : source.passScore,
        durationMinutes: rule?.durationMinutes ?? source.durationMinutes,
        maxAttempts: rule?.maxAttempts ?? source.maxAttempts,
        partialCreditRatio: rule ? String(rule.partialCreditRatio) : source.partialCreditRatio,
        status: PaperStatus.DRAFT,
        createdBy: String(actor.id),
      }));
      const itemRepo = manager.getRepository(PaperQuestion);
      const rows = release?.businessScope === 'regulation'
        ? release.pool.map((snapshot, index) => itemRepo.create({
          paperId: String(created.id), questionId: String(snapshot.questionId),
          questionVersionId: String(snapshot.versionId), conceptId: snapshot.conceptId || null,
          sort: index, score: (Number(snapshot.scoreCents) / 100).toFixed(2),
        }))
        : (await itemRepo.find({ where: { paperId: id }, order: { sort: 'ASC', id: 'ASC' } })).map((item) => itemRepo.create({
          paperId: String(created.id), questionId: item.questionId, questionVersionId: item.questionVersionId,
          conceptId: item.conceptId, sort: item.sort, score: item.score,
        }));
      if (rows.length) await itemRepo.save(rows);
      return created;
    });
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.copy', object_type: 'exam_paper',
      object_id: String(copied.id), detail: { source_paper_id: id }, result: 'success', source_ip: ip,
    });
    return this.paperView(copied);
  }

  /** 归档（archived 后不可再发起新作答，C-08） */
  async archive(id: string, actor: { id: number; name: string }, ip: string | null) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    this.assertLegacyPaper(p);
    p.status = PaperStatus.ARCHIVED;
    await this.paperRepo.save(p);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.archive', object_type: 'exam_paper',
      object_id: id, detail: {}, result: 'success', source_ip: ip,
    });
    return this.paperView(p);
  }

  private trainingRule(
    strategy: { passScore: string | number; durationMinutes: number; maxAttempts: number; partialCreditRatio: string | number },
    rules: Array<{ type: QuestionType; count: number; score_cents?: number; scoreCents?: number }>,
    requireComplete: boolean,
    requireUniqueTypes = requireComplete,
  ): RuleSnapshot {
    const normalized: PoolRule[] = rules.map((item) => ({
      type: item.type,
      count: Number(item.count),
      scoreCents: Number(item.score_cents ?? item.scoreCents),
    }));
    if (requireUniqueTypes && (normalized.length > 4
      || new Set(normalized.map((item) => item.type)).size !== normalized.length)) {
      throw Errors.paperRuleInvalid('同一题型只能配置一项随机规则');
    }
    for (const item of normalized) {
      if (!['single', 'multiple', 'judgment', 'image'].includes(item.type)
        || !Number.isInteger(item.count) || item.count < 1
        || !Number.isInteger(item.scoreCents) || item.scoreCents < 1) {
        throw Errors.paperRuleInvalid('题型、题量或分值规则不合法');
      }
    }
    const total = normalized.reduce((sum, item) => sum + item.count * item.scoreCents, 0);
    if (requireComplete && total !== 10000) throw Errors.paperRuleInvalid(`题型规则总分必须为 10000 分，当前为 ${total}`);
    return {
      totalCents: 10000,
      passCents: Math.round(Number(strategy.passScore) * 100),
      durationMinutes: Number(strategy.durationMinutes),
      maxAttempts: Number(strategy.maxAttempts),
      partialCreditRatio: Number(strategy.partialCreditRatio),
      rules: normalized,
    };
  }

  private trainingPaperView(paper: ExamPaper) {
    return {
      id: String(paper.id),
      title: paper.title,
      business_scope: 'training' as const,
      mode: paper.mode as 'fixed' | 'random',
      category_id: paper.categoryId ? String(paper.categoryId) : null,
      requires_learning: Boolean(paper.requiresLearning),
      regulation_ids: (paper.regulationIds || []).map(String),
      course_ids: (paper.courseIds || []).map(String),
      rules: (paper.ruleConfig?.rules || []).map((item) => ({
        type: item.type, count: Number(item.count), score_cents: Number(item.scoreCents),
      })),
      total_score: Number(paper.totalScore),
      pass_score: Number(paper.passScore),
      duration_minutes: Number(paper.durationMinutes),
      max_attempts: Number(paper.maxAttempts),
      partial_credit_ratio: Number(paper.partialCreditRatio),
      status: paper.status,
      created_at: paper.createdAt,
      updated_at: paper.updatedAt,
    };
  }

  private async validateTrainingRelations(
    manager: EntityManager,
    categoryId: string,
    regulationIds: string[],
    courseIds: string[],
    categoryLocked = false,
  ): Promise<void> {
    if (!categoryLocked) await this.categories.lockActive(manager, categoryId);
    if (regulationIds.length) {
      const rows = await manager.getRepository(Regulation).findBy({ id: In(regulationIds) });
      if (rows.length !== regulationIds.length || rows.some((row) => String(row.categoryId) !== categoryId)) {
        throw Errors.paperRuleInvalid('制度筛选项必须全部属于试卷培训类别');
      }
    }
    if (courseIds.length) {
      const rows = await manager.getRepository(TrainingCourse).findBy({ id: In(courseIds) });
      if (rows.length !== courseIds.length || rows.some((row) => String(row.categoryId) !== categoryId)) {
        throw Errors.paperRuleInvalid('关联课程必须全部属于试卷培训类别');
      }
    }
  }

  async listTraining(query: {
    page?: number; page_size?: number; keyword?: string; category_id?: string; mode?: string; status?: string;
  }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.paperRepo.createQueryBuilder('paper').where('paper.business_scope = :scope', { scope: 'training' });
    if (query.keyword?.trim()) qb.andWhere('paper.title LIKE :keyword', { keyword: `%${query.keyword.trim()}%` });
    if (query.category_id) qb.andWhere('paper.category_id = :categoryId', { categoryId: String(query.category_id) });
    if (query.mode) qb.andWhere('paper.mode = :mode', { mode: query.mode });
    if (query.status) qb.andWhere('paper.status = :status', { status: query.status });
    qb.orderBy('paper.id', 'DESC');
    const [rows, total] = await qb.skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { items: rows.map((item) => this.trainingPaperView(item)), total, page, page_size: pageSize };
  }

  async trainingDetail(id: string) {
    const paper = await this.paperRepo.findOne({ where: { id: String(id) } });
    this.assertTrainingPaper(paper);
    const links = await this.pqRepo.find({ where: { paperId: String(id) }, order: { sort: 'ASC', id: 'ASC' } });
    const versionIds = links.map((item) => item.questionVersionId).filter((value): value is string => Boolean(value));
    const versions = versionIds.length ? await this.versionRepo.findBy({ id: In(versionIds) }) : [];
    const versionMap = new Map(versions.map((item) => [String(item.id), item]));
    const latestRelease = await this.releaseRepo.findOne({ where: { paperId: String(id) }, order: { versionNo: 'DESC' } });
    return {
      ...this.trainingPaperView(paper),
      latest_release_id: latestRelease ? String(latestRelease.id) : null,
      sum_score_cents: links.reduce((sum, item) => sum + Math.round(Number(item.score) * 100), 0),
      questions: links.map((item) => {
        const version = item.questionVersionId ? versionMap.get(String(item.questionVersionId)) : undefined;
        return {
          paper_question_id: String(item.id),
          question_id: String(item.questionId),
          question_version_id: item.questionVersionId ? String(item.questionVersionId) : null,
          sort: Number(item.sort),
          score_cents: Math.round(Number(item.score) * 100),
          type: version?.type || null,
          difficulty: version?.difficulty || null,
          concept_id: version?.conceptId ? String(version.conceptId) : null,
          regulation_id: version?.regulationId ? String(version.regulationId) : null,
          stem: version?.stem || '',
          options: cloneJson(version?.options || []),
          status: version?.status || null,
        };
      }),
    };
  }

  async createTraining(input: CreateTrainingPaperDto, actor: PaperActor, ip: string | null) {
    this.validateStrategy(input);
    const categoryId = String(input.category_id);
    const regulationIds = (input.regulation_ids || []).map(String);
    const courseIds = (input.course_ids || []).map(String);
    const paper = await this.dataSource.transaction(async (manager) => {
      await this.validateTrainingRelations(manager, categoryId, regulationIds, courseIds);
      const repo = manager.getRepository(ExamPaper);
      const draft = repo.create({
        regulationId: null,
        businessScope: 'training',
        mode: input.mode,
        categoryId,
        requiresLearning: input.requires_learning ? 1 : 0,
        regulationIds,
        courseIds,
        title: input.title.trim(),
        totalScore: '100.00',
        passScore: String(input.pass_score ?? 60),
        durationMinutes: input.duration_minutes ?? 30,
        maxAttempts: input.max_attempts ?? 3,
        partialCreditRatio: String(input.partial_credit_ratio ?? 0.5),
        status: 'draft',
        createdBy: String(actor.id),
      });
      draft.ruleConfig = this.trainingRule(draft, input.rules || [], input.mode === 'random');
      return repo.save(draft);
    });
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: 'training_paper.create', object_type: 'exam_paper',
      object_id: paper.id, detail: { mode: paper.mode, category_id: categoryId }, result: 'success', source_ip: ip,
    });
    return this.trainingPaperView(paper);
  }

  async updateTraining(id: string, patch: UpdateTrainingPaperDto, actor: PaperActor, ip: string | null) {
    this.validateStrategy(patch);
    const current = await this.paperRepo.findOne({ where: { id: String(id) } });
    this.assertTrainingPaper(current);
    if (current.status !== 'draft') throw Errors.paperReleaseConflict('发布后不可修改规则或题池，请复制为新试卷');
    const targetCategory = String(patch.category_id ?? current.categoryId);
    const updated = await this.dataSource.transaction(async (manager) => {
      await this.categories.lockActive(manager, targetCategory);
      const repo = manager.getRepository(ExamPaper);
      const paper = await repo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      this.assertTrainingPaper(paper);
      if (String(paper.categoryId || '') !== String(current.categoryId || '') || paper.mode !== current.mode) {
        throw Errors.paperReleaseConflict('试卷类别或组卷模式已变化，请刷新后重试');
      }
      if (paper.status !== 'draft') throw Errors.paperReleaseConflict('发布后不可修改规则或题池，请复制为新试卷');
      const regulationIds = (patch.regulation_ids ?? paper.regulationIds ?? []).map(String);
      const courseIds = (patch.course_ids ?? paper.courseIds ?? []).map(String);
      await this.validateTrainingRelations(manager, targetCategory, regulationIds, courseIds, true);
      const oldMode = paper.mode;
      const oldCategory = String(paper.categoryId);
      if (patch.title !== undefined) paper.title = patch.title.trim();
      if (patch.mode !== undefined) paper.mode = patch.mode;
      paper.categoryId = targetCategory;
      if (patch.requires_learning !== undefined) paper.requiresLearning = patch.requires_learning ? 1 : 0;
      paper.regulationIds = regulationIds;
      paper.courseIds = courseIds;
      if (patch.pass_score !== undefined) paper.passScore = String(patch.pass_score);
      if (patch.duration_minutes !== undefined) paper.durationMinutes = patch.duration_minutes;
      if (patch.max_attempts !== undefined) paper.maxAttempts = patch.max_attempts;
      if (patch.partial_credit_ratio !== undefined) paper.partialCreditRatio = String(patch.partial_credit_ratio);
      const ruleInput = patch.rules || (paper.ruleConfig?.rules || []).map((item) => ({ ...item }));
      paper.ruleConfig = this.trainingRule(paper, ruleInput, paper.mode === 'random');
      if (oldMode !== paper.mode || oldCategory !== targetCategory) {
        await manager.getRepository(PaperQuestion).delete({ paperId: String(id) });
      }
      return repo.save(paper);
    });
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: 'training_paper.update', object_type: 'exam_paper',
      object_id: String(id), detail: patch as any, result: 'success', source_ip: ip,
    });
    return this.trainingPaperView(updated);
  }

  async setTrainingQuestions(id: string, items: FixedQuestionInput[], actor: PaperActor, ip: string | null) {
    if (!items.length) throw Errors.paperRuleInvalid('固定试卷至少需要一道题');
    if (new Set(items.map((item) => String(item.question_version_id))).size !== items.length) {
      throw Errors.paperRuleInvalid('固定题单不能重复选择同一题目版本');
    }
    const totalCents = items.reduce((sum, item) => sum + Number(item.score_cents), 0);
    if (totalCents !== 10000 || items.some((item) => !Number.isInteger(item.score_cents) || item.score_cents < 1)) {
      throw Errors.paperRuleInvalid(`固定题单总分必须为 10000 分，当前为 ${totalCents}`);
    }
    const current = await this.paperRepo.findOne({ where: { id: String(id) } });
    this.assertTrainingPaper(current);
    if (current.status !== 'draft' || current.mode !== 'fixed') throw Errors.paperReleaseConflict('只有固定组卷草稿可以修改题单');
    const categoryId = String(current.categoryId);
    const result = await this.dataSource.transaction(async (manager) => {
      await this.categories.lockActive(manager, categoryId);
      const paperRepo = manager.getRepository(ExamPaper);
      const paper = await paperRepo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      this.assertTrainingPaper(paper);
      if (String(paper.categoryId || '') !== String(current.categoryId || '') || paper.mode !== current.mode) {
        throw Errors.paperReleaseConflict('试卷类别或组卷模式已变化，请刷新后重试');
      }
      if (paper.status !== 'draft' || paper.mode !== 'fixed') throw Errors.paperReleaseConflict('只有固定组卷草稿可以修改题单');
      const versionIds = items.map((item) => String(item.question_version_id));
      const versions = await manager.getRepository(QuestionVersion).findBy({ id: In(versionIds) });
      if (versions.length !== versionIds.length) throw Errors.paperRuleInvalid('固定题单包含不存在的题目版本');
      const versionMap = new Map(versions.map((item) => [String(item.id), item]));
      const questionIds = versions.map((item) => String(item.questionId));
      const questions = await manager.getRepository(Question).findBy({ id: In(questionIds) });
      const questionMap = new Map(questions.map((item) => [String(item.id), item]));
      const regulationIds = new Set((paper.regulationIds || []).map(String));
      const concepts = new Set<string>();
      const rows: PaperQuestion[] = [];
      const groupedRules = new Map<string, PoolRule>();
      for (let index = 0; index < items.length; index += 1) {
        const input = items[index];
        const version = versionMap.get(String(input.question_version_id));
        const question = version && questionMap.get(String(version.questionId));
        if (!version || !question || version.status !== 'approved' || String(question.currentVersionId) !== String(version.id)) {
          throw Errors.paperReleaseConflict(`题目版本 ${input.question_version_id} 已不是当前审核通过版本`);
        }
        if (String(version.categoryId) !== categoryId) throw Errors.paperRuleInvalid('固定题目必须与试卷属于同一培训类别');
        if (regulationIds.size && (!version.regulationId || !regulationIds.has(String(version.regulationId)))) {
          throw Errors.paperRuleInvalid('固定题目不在试卷制度筛选范围内');
        }
        const conceptKey = version.conceptId ? `concept:${version.conceptId}` : `question:${version.questionId}`;
        if (concepts.has(conceptKey)) throw Errors.paperRuleInvalid('固定题单存在重复考点');
        concepts.add(conceptKey);
        rows.push(manager.getRepository(PaperQuestion).create({
          paperId: String(id), questionId: String(version.questionId), questionVersionId: String(version.id),
          conceptId: version.conceptId ? String(version.conceptId) : null, sort: index,
          score: (Number(input.score_cents) / 100).toFixed(2),
        }));
        const ruleKey = `${version.type}:${input.score_cents}`;
        const grouped = groupedRules.get(ruleKey);
        if (grouped) grouped.count += 1;
        else groupedRules.set(ruleKey, { type: version.type as QuestionType, count: 1, scoreCents: input.score_cents });
      }
      const repo = manager.getRepository(PaperQuestion);
      await repo.delete({ paperId: String(id) });
      await repo.save(rows);
      paper.ruleConfig = this.trainingRule(paper, [...groupedRules.values()], true, false);
      await paperRepo.save(paper);
      return {
        ...this.trainingPaperView(paper),
        sum_score_cents: totalCents,
        questions: rows.map((row) => ({
          question_id: String(row.questionId), question_version_id: String(row.questionVersionId),
          concept_id: row.conceptId, sort: row.sort, score_cents: Math.round(Number(row.score) * 100),
        })),
      };
    });
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: 'training_paper.questions.set', object_type: 'exam_paper',
      object_id: String(id), detail: { count: items.length }, result: 'success', source_ip: ip,
    });
    return result;
  }

  async trainingCandidates(id: string, query: { type?: QuestionType; difficulty?: Difficulty; page?: number; page_size?: number }) {
    const paper = await this.paperRepo.findOne({ where: { id: String(id) } });
    this.assertTrainingPaper(paper);
    if (!paper.categoryId) throw Errors.paperRuleInvalid('培训试卷缺少培训类别');
    const types = query.type ? [query.type] : ['single', 'multiple', 'judgment', 'image'] as QuestionType[];
    const difficulties = query.difficulty ? [query.difficulty] : ['easy', 'medium', 'hard'] as Difficulty[];
    const regulationIds = (paper.regulationIds || []).map(String);
    const snapshots: QuestionVersionSnapshot[] = [];
    for (const difficulty of difficulties) {
      for (const type of types) {
        snapshots.push(...await this.versions.approvedCandidates({
          categoryId: String(paper.categoryId), type, difficulty,
          ...(regulationIds.length ? { regulationIds } : {}),
        }));
      }
    }
    const unique = [...new Map(snapshots.map((item) => [String(item.versionId), item])).values()];
    unique.sort((left, right) => Number(BigInt(right.versionId) - BigInt(left.versionId)));
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const items = unique.slice((page - 1) * pageSize, page * pageSize).map((item) => ({
      question_id: String(item.questionId), question_version_id: String(item.versionId), revision: item.revision,
      category_id: String(item.categoryId), difficulty: item.difficulty, type: item.type, stem: item.stem,
      options: cloneJson(item.options), score_cents: Number(item.scoreCents), concept_id: item.conceptId || null,
      regulation_id: item.regulationId || null, source: item.source,
    }));
    return { items, total: unique.length, page, page_size: pageSize };
  }

  async regulationOptions(categoryId: string, page = 1, pageSize = 100) {
    const safePage = Math.max(1, Number(page || 1));
    const safeSize = Math.min(100, Math.max(1, Number(pageSize || 100)));
    await this.categories.assertActive(String(categoryId));
    const qb = this.regulationRepo.createQueryBuilder('regulation')
      .where('regulation.category_id = :categoryId', { categoryId: String(categoryId) })
      .orderBy('regulation.id', 'DESC');
    const [rows, total] = await qb.skip((safePage - 1) * safeSize).take(safeSize).getManyAndCount();
    return {
      items: rows.map((item) => ({ id: String(item.id), title: item.title, status: item.status })),
      total, page: safePage, page_size: safeSize,
    };
  }

  async courseOptions(categoryId: string, page = 1, pageSize = 100) {
    const safePage = Math.max(1, Number(page || 1));
    const safeSize = Math.min(100, Math.max(1, Number(pageSize || 100)));
    await this.categories.assertActive(String(categoryId));
    const qb = this.courseRepo.createQueryBuilder('course')
      .where('course.category_id = :categoryId', { categoryId: String(categoryId) })
      .orderBy('course.id', 'DESC');
    const [rows, total] = await qb.skip((safePage - 1) * safeSize).take(safeSize).getManyAndCount();
    return {
      items: rows.map((item) => ({ id: String(item.id), title: item.title, status: item.status })),
      total, page: safePage, page_size: safeSize,
    };
  }

  async copyTraining(id: string, actor: PaperActor, ip: string | null) {
    const source = await this.paperRepo.findOne({ where: { id: String(id) } });
    this.assertTrainingPaper(source);
    if (!source.categoryId) throw Errors.paperRuleInvalid('培训试卷缺少培训类别');
    const copy = await this.dataSource.transaction(async (manager) => {
      await this.categories.lockActive(manager, String(source.categoryId));
      const paperRepo = manager.getRepository(ExamPaper);
      const locked = await paperRepo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_read' } });
      this.assertTrainingPaper(locked);
      if (String(locked.categoryId || '') !== String(source.categoryId || '') || locked.mode !== source.mode) {
        throw Errors.paperReleaseConflict('试卷类别或组卷模式已变化，请刷新后重试');
      }
      const created = await paperRepo.save(paperRepo.create({
        regulationId: null, businessScope: 'training', mode: locked.mode, categoryId: locked.categoryId,
        requiresLearning: locked.requiresLearning, regulationIds: cloneJson(locked.regulationIds || []),
        courseIds: cloneJson(locked.courseIds || []), ruleConfig: locked.ruleConfig ? cloneJson(locked.ruleConfig) : null,
        title: `${locked.title}（副本）`, totalScore: locked.totalScore, passScore: locked.passScore,
        durationMinutes: locked.durationMinutes, maxAttempts: locked.maxAttempts,
        partialCreditRatio: locked.partialCreditRatio, status: 'draft', createdBy: String(actor.id),
      }));
      const links = await manager.getRepository(PaperQuestion).find({ where: { paperId: String(id) }, order: { sort: 'ASC', id: 'ASC' } });
      if (links.length) await manager.getRepository(PaperQuestion).save(links.map((item) => manager.getRepository(PaperQuestion).create({
        paperId: String(created.id), questionId: item.questionId, questionVersionId: item.questionVersionId,
        conceptId: item.conceptId, sort: item.sort, score: item.score,
      })));
      return created;
    });
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: 'training_paper.copy', object_type: 'exam_paper',
      object_id: String(copy.id), detail: { source_paper_id: String(id) }, result: 'success', source_ip: ip,
    });
    return this.trainingPaperView(copy);
  }

  private async transitionTraining(
    id: string,
    actor: PaperActor,
    ip: string | null,
    action: 'withdraw' | 'archive',
  ) {
    const paper = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ExamPaper);
      const locked = await repo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      this.assertTrainingPaper(locked);
      if (action === 'withdraw' && locked.status !== 'published') throw Errors.paperReleaseConflict('只有已发布试卷可以撤回');
      if (locked.status === 'archived') return locked;
      locked.status = action === 'withdraw' ? 'withdrawn' : 'archived';
      return repo.save(locked);
    });
    this.audit.log({
      actor_id: Number(actor.id), actor_name: actor.name, action: `training_paper.${action}`, object_type: 'exam_paper',
      object_id: String(id), detail: {}, result: 'success', source_ip: ip,
    });
    return this.trainingPaperView(paper);
  }

  withdrawTraining(id: string, actor: PaperActor, ip: string | null) {
    return this.transitionTraining(id, actor, ip, 'withdraw');
  }

  archiveTraining(id: string, actor: PaperActor, ip: string | null) {
    return this.transitionTraining(id, actor, ip, 'archive');
  }

  async findById(id: string) {
    return this.paperRepo.findOne({ where: { id } });
  }

  async findPublishedByRegulation(regulationId: string) {
    return this.paperRepo.findOne({ where: { regulationId, status: PaperStatus.PUBLISHED, businessScope: 'regulation' } });
  }
}
