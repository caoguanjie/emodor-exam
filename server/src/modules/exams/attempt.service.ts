import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors, ExamStatus, PaperStatus, RegulationStatus } from '../../common/errors';
import { difficultyForSource } from '../../common/question-difficulty';
import { RedisService } from '../../common/redis.service';
import type {
  AttemptView, Difficulty, ExamDifficulty, Id, LearnerSource, Page, PoolRule, QuestionOption, QuestionType, RuleSnapshot,
} from '../../common/training-contracts';
import { ExamAssignment } from '../../entities/exam-assignment.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecordQuestion } from '../../entities/exam-record-question.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { LearningRecord, ScrollCoverageUtil } from '../../entities/learning-record.entity';
import { PaperQuestion } from '../../entities/paper-question.entity';
import { QuestionVersion } from '../../entities/question-version.entity';
import { Regulation } from '../../entities/regulation.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { MediaService } from '../media/media.service';
import { QuestionVersionService } from '../questions/question-version.service';
import { RegulationScopeService } from '../regulations/regulation-scope.service';
import { AttemptReaderService, promptMediaIds } from './attempt-reader.service';
import {
  PaperReleaseService,
  type PublishedPaper,
  type PublishedQuestionSnapshot,
  type ReleaseQuestionSnapshot,
} from './paper-release.service';
import { SamplingService } from './sampling.service';
import { ShuffleService } from './shuffle.service';
import { assertExamIdentity, expireExamRecord } from './exam-state';
import { parseQuestionContent } from '../questions/question-content-dispatch';
import { assertContentCapability, requiredContentCapability } from './question-content-capability';
import { assertPaperLearningEligible } from './paper-learning';

type AttemptRecordFact = { attemptNo: number; status: string };

export function decideAttemptTransition(input: {
  nowMs: number;
  active: { recordId: string; deadlineAt: Date } | null;
  records: AttemptRecordFact[];
  maxAttempts: number;
}): { kind: 'recover'; recordId: string } | { kind: 'create'; attemptNo: number } {
  if (input.active) {
    if (new Date(input.active.deadlineAt).getTime() > input.nowMs) {
      return { kind: 'recover', recordId: String(input.active.recordId) };
    }
    throw Errors.examInProgress('考试已到期，请刷新查看状态');
  }
  if (input.records.some((record) => record.status === ExamStatus.PASSED)) throw Errors.alreadyPassed();
  if (input.records.some((record) => record.status === ExamStatus.SUBMITTED)) {
    throw Errors.examInProgress('考试正在等待批改，暂不能补考');
  }
  const attemptNo = input.records.reduce((max, record) => Math.max(max, Number(record.attemptNo) || 0), 0) + 1;
  if (attemptNo > Number(input.maxAttempts)) throw Errors.attemptsExhausted();
  return { kind: 'create', attemptNo };
}

export function resolveAttemptDifficulty(source: LearnerSource | null, paper: PublishedPaper): ExamDifficulty {
  if (paper.businessScope === 'regulation') return 'unknown';
  if (paper.mode === 'random') {
    return difficultyForSource(source);
  }
  const difficulties = new Set(paper.pool.map((item) => item.difficulty));
  if (!difficulties.size) throw Errors.paperReleaseConflict('固定试卷发布题单为空');
  if (difficulties.size === 1) return [...difficulties][0];
  return 'mixed';
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validDifficulty(value: string | null): Difficulty | 'unknown' {
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : 'unknown';
}

function legacySnapshot(version: QuestionVersion, scoreCents: number): ReleaseQuestionSnapshot {
  return {
    questionId: String(version.questionId),
    versionId: String(version.id),
    revision: Number(version.revision),
    categoryId: version.categoryId ? String(version.categoryId) : null,
    difficulty: validDifficulty(version.difficulty),
    type: version.type as QuestionType,
    stem: version.stem,
    options: deepClone(version.options as QuestionOption[]),
    answer: [...version.answer],
    analysis: version.analysis,
    scoreCents,
    conceptId: version.conceptId || undefined,
    regulationId: version.regulationId || undefined,
    regulationVersionId: version.regulationVersionId || undefined,
    sourcePageGroup: version.sourcePageGroup ?? undefined,
    sourcePageStart: version.sourcePageStart ?? undefined,
    sourcePageEnd: version.sourcePageEnd ?? undefined,
    source: version.source as ReleaseQuestionSnapshot['source'],
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt?.toISOString() || null,
  };
}

function cents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

function assertLegacyClientPool(pool: PublishedQuestionSnapshot[]): void {
  if (pool.some((item) => item.type !== 'single' && item.type !== 'multiple')) {
    throw Errors.param('legacy 固定试卷仅支持单选题和多选题');
  }
}

@Injectable()
export class AttemptService {
  private readonly logger = new Logger(AttemptService.name);

  constructor(
    @InjectRepository(ExamAssignment) private readonly assignmentRepo: Repository<ExamAssignment>,
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamRecordQuestion) private readonly itemRepo: Repository<ExamRecordQuestion>,
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly dataSource: DataSource,
    private readonly releases: PaperReleaseService,
    private readonly sampling: SamplingService,
    private readonly shuffle: ShuffleService,
    private readonly versions: QuestionVersionService,
    private readonly scope: RegulationScopeService,
    private readonly reader: AttemptReaderService,
    private readonly media: MediaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  private async lockedRecords(manager: EntityManager, userId: string, paperId: string): Promise<ExamRecord[]> {
    return manager.getRepository(ExamRecord).createQueryBuilder('record')
      .setLock('pessimistic_write')
      .where('record.user_id = :userId AND record.paper_id = :paperId', { userId, paperId })
      .orderBy('record.attempt_no', 'ASC')
      .addOrderBy('record.id', 'ASC')
      .getMany();
  }

  private async assertTrainingCategoryActive(manager: EntityManager, categoryId: string): Promise<void> {
    const category = await manager.getRepository(TrainingCategory).findOne({ where: { id: String(categoryId) } });
    if (!category || Number(category.status) !== 1) throw Errors.categoryInactive();
  }

  private async assertLegacyEligibility(manager: EntityManager, user: SysUser, paper: ExamPaper): Promise<void> {
    if (!paper.regulationId || paper.businessScope !== 'regulation' || paper.mode !== 'fixed') {
      throw Errors.contentInvisible('制度固定卷不存在');
    }
    const regulation = await manager.getRepository(Regulation).findOne({ where: { id: String(paper.regulationId) } });
    if (!regulation || regulation.status !== RegulationStatus.PUBLISHED) throw Errors.contentInvisible('制度未发布或已归档');
    const isAdmin = user.role === 'super_admin' || user.role === 'regulation_admin';
    if (!isAdmin && !(await this.scope.isUserInScope(String(regulation.id), {
      id: Number(user.id), role: user.role, departmentId: user.departmentId,
    }))) {
      throw Errors.contentInvisible('不在该制度的发布范围内');
    }
    const learning = await manager.getRepository(LearningRecord).findOne({
      where: { userId: String(user.id), regulationId: String(regulation.id) },
    });
    if (!learning || Number(learning.isValid) !== 1) {
      const coverage = learning
        ? ScrollCoverageUtil.normalize(learning.scrollCoverage, regulation.scrollSegments)
        : ScrollCoverageUtil.empty(regulation.scrollSegments);
      const totalSeconds = Number(learning?.totalSeconds || 0);
      throw Errors.notEligible('未完成有效学习，暂无考试资格', {
        gap: {
          time_gap_seconds: Math.max(0, Number(regulation.requiredMinutes) * 60 - totalSeconds),
          bottom_segment_covered: ScrollCoverageUtil.bottomCovered(coverage),
        },
      });
    }
  }

  private async legacyPool(
    manager: EntityManager,
    paper: ExamPaper,
  ): Promise<{ rule: RuleSnapshot; pool: PublishedQuestionSnapshot[] }> {
    const rows = await manager.getRepository(PaperQuestion).find({
      where: { paperId: String(paper.id) }, order: { sort: 'ASC', id: 'ASC' },
    });
    if (!rows.length) throw Errors.paperRuleInvalid('固定组卷至少需要一道题');
    const resolved = new Map<string, QuestionVersion>();
    for (const row of [...rows].sort((left, right) => String(left.questionId).localeCompare(String(right.questionId), 'en', { numeric: true }))) {
      resolved.set(String(row.questionId), await this.versions.currentOrCaptureForLegacyAttempt(
        manager,
        String(row.questionId),
        row.questionVersionId ? String(row.questionVersionId) : undefined,
      ));
    }
    const rules = new Map<string, PoolRule>();
    const pool = rows.map((row) => {
      const version = resolved.get(String(row.questionId));
      if (!version) throw Errors.notFound('固定试卷题目不存在');
      if (!paper.regulationId || String(version.regulationId || '') !== String(paper.regulationId)) {
        throw Errors.paperReleaseConflict('固定试卷题目与制度不一致');
      }
      const scoreCents = cents(row.score);
      const key = `${version.type}:${scoreCents}`;
      const existing = rules.get(key);
      if (existing) existing.count += 1;
      else rules.set(key, { type: version.type as QuestionType, count: 1, scoreCents });
      return legacySnapshot(version, scoreCents);
    });
    assertLegacyClientPool(pool);
    const totalCents = pool.reduce((sum, item) => sum + Number(item.scoreCents), 0);
    if (totalCents !== 10000) throw Errors.paperRuleInvalid(`题型规则总分必须为 10000 分，当前为 ${totalCents}`);
    return {
      rule: {
        totalCents: 10000,
        passCents: cents(paper.passScore),
        durationMinutes: Number(paper.durationMinutes),
        maxAttempts: Number(paper.maxAttempts),
        partialCreditRatio: Number(paper.partialCreditRatio),
        rules: [...rules.values()],
      },
      pool,
    };
  }

  private async previousLegacyPool(
    manager: EntityManager,
    assignmentId: string,
    records: ExamRecord[],
  ): Promise<PublishedQuestionSnapshot[] | null> {
    const itemRepo = manager.getRepository(ExamRecordQuestion);
    for (const record of records.filter((item) => String(item.assignmentId || '') === String(assignmentId))) {
      const rows = await itemRepo.find({ where: { recordId: String(record.id) }, order: { position: 'ASC', id: 'ASC' } });
      if (rows.length) return rows.map((row) => ({ ...deepClone(row.snapshotJson), scoreCents: Number(row.scoreCents) }));
    }
    return null;
  }

  private async frozenRecordPool(
    manager: EntityManager,
    recordId: string,
  ): Promise<PublishedQuestionSnapshot[]> {
    const rows = await manager.getRepository(ExamRecordQuestion).find({
      where: { recordId: String(recordId) }, order: { position: 'ASC', id: 'ASC' },
    });
    if (!rows.length) throw Errors.paperReleaseConflict('个人考试冻结题池不完整');
    return rows.map((row) => ({ ...deepClone(row.snapshotJson), scoreCents: Number(row.scoreCents) }));
  }

  private async initializeRuntime(record: ExamRecord): Promise<void> {
    const now = Date.now();
    const deadline = new Date(record.deadlineAt).getTime();
    const ttlSeconds = Math.max(1, Math.floor((deadline - now) / 1000));
    try {
      await this.redis.set(`exam:deadline:${record.id}`, String(deadline), ttlSeconds + 60);
    } catch {
      this.logger.warn(`考试 ${record.id} Redis 初始化失败，期限仍以数据库为准`);
    }
  }

  start(userId: Id, paperId: Id, mobile?: boolean, contentVersion?: 2): Promise<AttemptView>;
  start(userId: Id, paperId: Id, mobile: boolean, contentVersion: 2 | 3): Promise<AttemptView<2 | 3>>;
  async start(userId: Id, paperId: Id, mobile = false, contentVersion: 2 | 3 = 2): Promise<AttemptView<2 | 3>> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(SysUser).findOne({
        where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw Errors.notFound('用户不存在');
      if (Number(user.status) !== 1) throw Errors.accountDisabled();
      if (mobile && user.role !== 'employee') throw Errors.forbidden();

      const assignmentRepo = manager.getRepository(ExamAssignment);
      let assignment = await assignmentRepo.findOne({
        where: { paperId: String(paperId), userId: String(userId) },
        lock: { mode: 'pessimistic_write' },
      });
      const records = await this.lockedRecords(manager, String(userId), String(paperId));
      const active = records.find((record) => record.status === ExamStatus.IN_PROGRESS) || null;

      // Recovery deliberately precedes paper status and the user's latest
      // category/source checks. A withdrawn paper may still finish its active attempt.
      if (active) {
        if (mobile && active.regulationId) throw Errors.dataForbidden('请使用培训考试入口');
        if (new Date(active.deadlineAt).getTime() <= Date.now()) {
          await expireExamRecord(manager, active);
          return { record: active, recovered: true, actorName: user.username };
        }
        if (mobile) await assertExamIdentity(manager, String(userId));
        if (!assignment || String(active.assignmentId || '') !== String(assignment.id)) {
          throw Errors.examInProgress('已有升级前进行中的考试，请先完成当前作答');
        }
        const frozen = await this.frozenRecordPool(manager, String(active.id));
        if (active.regulationId) assertLegacyClientPool(frozen);
        assertContentCapability(requiredContentCapability(frozen), contentVersion);
        return { record: active, recovered: true, actorName: user.username };
      }

      if (mobile) await assertExamIdentity(manager, String(userId));

      const paper = await manager.getRepository(ExamPaper).findOne({
        where: { id: String(paperId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!paper) throw Errors.notFound('试卷不存在');
      if (mobile && paper.businessScope !== 'training') throw Errors.contentInvisible('请使用培训考试入口');
      if (paper.status !== PaperStatus.PUBLISHED) throw Errors.contentInvisible('考试未发布或已撤回');

      let release: PublishedPaper | null = null;
      let pool: PublishedQuestionSnapshot[] | null = null;
      let rule: RuleSnapshot;
      let source: LearnerSource | null;
      let categoryId: string | null;
      let difficulty: ExamDifficulty;
      let snapshotOrigin: 'release' | 'legacy_start';

      if (assignment) {
        rule = deepClone(assignment.ruleSnapshot);
        source = assignment.source;
        categoryId = assignment.categoryId;
        difficulty = assignment.difficulty;
        snapshotOrigin = assignment.snapshotOrigin;
        if (paper.businessScope === 'training') {
          if (!categoryId) throw Errors.paperReleaseConflict('个人考试归属缺少培训类别');
          await this.assertTrainingCategoryActive(manager, categoryId);
        } else {
          await this.assertLegacyEligibility(manager, user, paper);
        }
        if (assignment.releaseId) {
          release = await this.releases.get(String(assignment.releaseId), manager);
          if (String(release.paperId) !== String(paper.id)) throw Errors.paperReleaseConflict('个人考试发布版本不匹配');
          if (paper.businessScope === 'regulation') assertLegacyClientPool(release.pool);
        } else {
          pool = await this.previousLegacyPool(manager, String(assignment.id), records);
          if (!pool) throw Errors.paperReleaseConflict('个人考试冻结题池不完整');
          if (paper.businessScope === 'regulation') assertLegacyClientPool(pool);
        }
      } else {
        release = await this.releases.latestForPaper(String(paper.id), manager);
        if (paper.businessScope === 'training') {
          if (!release || release.businessScope !== 'training') throw Errors.paperReleaseConflict('培训试卷缺少发布版本');
          if (!user.categoryId || !user.source) throw Errors.param('学员培训类别和来源必须先配置');
          if (String(user.categoryId) !== String(release.categoryId)) throw Errors.dataForbidden('该考试不属于学员培训类别');
          await this.assertTrainingCategoryActive(manager, String(release.categoryId));
          source = user.source;
          categoryId = String(release.categoryId);
          difficulty = resolveAttemptDifficulty(source, release);
          rule = deepClone(release.rule);
          snapshotOrigin = 'release';
        } else {
          await this.assertLegacyEligibility(manager, user, paper);
          if (release && release.businessScope !== 'regulation') throw Errors.paperReleaseConflict('制度试卷发布版本业务范围不一致');
          source = null;
          categoryId = null;
          difficulty = 'unknown';
          snapshotOrigin = release ? 'release' : 'legacy_start';
          if (release) {
            assertLegacyClientPool(release.pool);
            rule = deepClone(release.rule);
          }
          else {
            const legacy = await this.legacyPool(manager, paper);
            rule = legacy.rule;
            pool = legacy.pool;
          }
        }
      }

      if (!pool && !release) throw Errors.paperReleaseConflict('个人考试缺少冻结题池');
      const candidates = pool || release!.pool;
      const actualPool = release?.businessScope === 'training' && release.mode === 'random'
        ? candidates.filter((item) => item.difficulty === difficulty && rule.rules.some((rule) => rule.type === item.type))
        : candidates;
      assertContentCapability(requiredContentCapability(actualPool), contentVersion);

      const transition = decideAttemptTransition({
        nowMs: Date.now(), active: null, records, maxAttempts: Number(rule.maxAttempts),
      });
      if (transition.kind !== 'create') throw Errors.examInProgress();

      if (release) await assertPaperLearningEligible(manager, String(user.id), release);

      if (!pool) {
        if (!release) throw Errors.paperReleaseConflict('个人考试缺少冻结题池');
        if (release.businessScope === 'training' && release.mode === 'random') {
          if (difficulty !== 'easy' && difficulty !== 'hard') throw Errors.paperRuleInvalid('随机组卷难度必须是初级或高级');
          // Old releases retain their frozen concept grouping. New releases
          // have no concepts, so this falls back to stable question identity.
          pool = this.sampling.draw(release.pool, rule.rules, difficulty, undefined, 'historical-concept', rule.totalCents);
        } else {
          pool = release.pool.map((item) => deepClone(item));
        }
      }
      if (!pool.length) throw Errors.paperPoolInsufficient([], '个人题单为空');

      if (!assignment) {
        assignment = await assignmentRepo.save(assignmentRepo.create({
          paperId: String(paper.id), userId: String(user.id), releaseId: release ? String(release.id) : null,
          source, categoryId, difficulty, ruleSnapshot: deepClone(rule), snapshotOrigin,
        }));
      }

      const startedAt = new Date();
      const deadlineAt = new Date(startedAt.getTime() + Number(rule.durationMinutes) * 60_000);
      const recordRepo = manager.getRepository(ExamRecord);
      const record = await recordRepo.save(recordRepo.create({
        paperId: String(paper.id),
        regulationId: paper.regulationId ? String(paper.regulationId) : null,
        userId: String(user.id),
        assignmentId: String(assignment.id),
        activeAssignmentId: String(assignment.id),
        releaseId: assignment.releaseId ? String(assignment.releaseId) : null,
        source: assignment.source,
        categoryId: assignment.categoryId,
        difficulty: assignment.difficulty,
        ruleSnapshot: deepClone(assignment.ruleSnapshot),
        snapshotOrigin: assignment.snapshotOrigin,
        attemptNo: transition.attemptNo,
        status: ExamStatus.IN_PROGRESS,
        score: null,
        startedAt,
        deadlineAt,
        submittedAt: null,
      }));

      const seed = this.shuffle.deriveSeed(String(record.id));
      const ordered = this.shuffle.shuffleQuestionOrder(pool, seed);
      const itemRepo = manager.getRepository(ExamRecordQuestion);
      const items = await itemRepo.save(ordered.map((snapshot, position) => {
        const mapping = this.shuffle.snapshotOptionMapping(
          snapshot.type, parseQuestionContent(snapshot).options.length, seed, String(snapshot.versionId),
        );
        return itemRepo.create({
          recordId: String(record.id),
          questionId: String(snapshot.questionId),
          questionVersionId: snapshot.versionId ? String(snapshot.versionId) : null,
          type: snapshot.type,
          difficulty: snapshot.difficulty,
          scoreCents: Number(snapshot.scoreCents),
          position,
          displayToOriginal: mapping,
          snapshotJson: deepClone(snapshot),
        });
      }));
      for (const item of items) {
        for (const assetId of promptMediaIds(item.snapshotJson)) {
          await this.media.bind(manager, assetId, 'exam_record_question', String(item.id));
        }
      }
      return { record, recovered: false, actorName: user.username };
    });

    if (!outcome.recovered) {
      await this.initializeRuntime(outcome.record);
      this.audit.log({
        actor_id: Number(userId), actor_name: outcome.actorName, action: 'exam.start', object_type: 'exam_record',
        object_id: String(outcome.record.id), detail: { paper_id: String(paperId), attempt_no: outcome.record.attemptNo },
        result: 'success', source_ip: null,
      });
    }
    return this.reader.forStudent(String(userId), String(outcome.record.id), contentVersion);
  }

  recover(userId: Id, recordId: Id, mobile?: boolean, contentVersion?: 2): Promise<AttemptView>;
  recover(userId: Id, recordId: Id, mobile: boolean, contentVersion: 2 | 3): Promise<AttemptView<2 | 3>>;
  async recover(userId: Id, recordId: Id, mobile = false, contentVersion: 2 | 3 = 2): Promise<AttemptView<2 | 3>> {
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(SysUser).findOne({
        where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw Errors.notFound('用户不存在');
      if (Number(user.status) !== 1) throw Errors.accountDisabled();
      const record = await manager.getRepository(ExamRecord).findOne({
        where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
      if (mobile && record.status === ExamStatus.IN_PROGRESS && record.regulationId) throw Errors.dataForbidden('请使用培训考试入口');
      if (record.status !== ExamStatus.IN_PROGRESS) return;
      if (new Date(record.deadlineAt).getTime() <= Date.now()) {
        await expireExamRecord(manager, record);
        return;
      }
      if (record.regulationId) {
        assertLegacyClientPool(await this.frozenRecordPool(manager, String(record.id)));
      }
    });
    return this.reader.forStudent(String(userId), String(recordId), contentVersion);
  }

  async list(userId: Id, page = 1, pageSize = 20): Promise<Page<Record<string, unknown>>> {
    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user) throw Errors.notFound('用户不存在');
    if (Number(user.status) !== 1) throw Errors.accountDisabled();
    const assignments = await this.assignmentRepo.find({ where: { userId: String(userId) } });
    const published = user.categoryId && user.source
      ? await this.paperRepo.find({
        where: { businessScope: 'training', categoryId: String(user.categoryId), status: PaperStatus.PUBLISHED },
        order: { id: 'DESC' },
      })
      : [];
    const assignedIds = assignments.map((assignment) => String(assignment.paperId));
    const assigned = assignedIds.length ? await this.paperRepo.find({ where: { id: In(assignedIds), businessScope: 'training' } }) : [];
    const byId = new Map([...published, ...assigned].map((paper) => [String(paper.id), paper]));
    const all = [...byId.values()].sort((left, right) => BigInt(left.id) < BigInt(right.id) ? 1 : -1);
    const items = all.slice((page - 1) * pageSize, page * pageSize).map((paper) => {
      const assignment = assignments.find((item) => String(item.paperId) === String(paper.id));
      return {
        paper_id: String(paper.id),
        title: paper.title,
        mode: paper.mode,
        status: paper.status,
        source: assignment?.source ?? user.source,
        category_id: assignment?.categoryId ?? (user.categoryId ? String(user.categoryId) : null),
        difficulty: assignment?.difficulty ?? (paper.mode === 'random' && user.source
          ? difficultyForSource(user.source)
          : null),
      };
    });
    return { items, total: all.length, page, page_size: pageSize };
  }
}
