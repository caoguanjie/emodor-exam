import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { PaperQuestion } from '../../entities/paper-question.entity';
import { Question } from '../../entities/question.entity';
import { Regulation } from '../../entities/regulation.entity';
import { LearningRecord } from '../../entities/learning-record.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { AppConfig } from '../../config/configuration';
import { Errors, ExamStatus, PaperStatus, RegulationStatus } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import { ShuffleService } from './shuffle.service';
import { GradingService } from './grading.service';
import { RegulationScopeService } from '../regulations/regulation-scope.service';
import { StatisticsService } from '../statistics/statistics.service';
import { ScrollCoverageUtil } from '../../entities/learning-record.entity';
import { LegacyExamAdapter } from './legacy-exam-adapter';
import { AnswerDraftService } from './answer-draft.service';
import { SubmissionService } from './submission.service';

const SUBMIT_LOCK_TTL = 30; // exam:lock:submit:{record_id} TTL = 判分 P99 × 3（07 册 3.2.4）
const SWITCH_DEBOUNCE_SECONDS = 1; // 服务端 1 秒窗口二次去抖（05 册 6.4.4）
const SWITCH_WARN_THRESHOLD = 3; // >3 前端全屏警告
const SWITCH_RISK_THRESHOLD = 5; // ≥5 风控标记 + 审计

/**
 * 考试评分服务（05 册 6.4，06 册 §4）：
 * 五步资格校验链 → 开考事务（deadline_at 快照 + Redis 计时）→ 确定性 seed 乱序下发
 * → 作答暂存 / 切屏去抖计数 → 三层幂等交卷 → 自动评分落库 → 超时自动交卷（定时扫描）。
 */
@Injectable()
export class ExamService {
  private readonly logger = new Logger(ExamService.name);

  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamAnswer) private readonly answerRepo: Repository<ExamAnswer>,
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(PaperQuestion) private readonly pqRepo: Repository<PaperQuestion>,
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    @InjectRepository(Regulation) private readonly regRepo: Repository<Regulation>,
    @InjectRepository(LearningRecord) private readonly learningRepo: Repository<LearningRecord>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly shuffle: ShuffleService,
    private readonly grading: GradingService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly scopeService: RegulationScopeService,
    private readonly statistics: StatisticsService,
    private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly legacyAdapter: LegacyExamAdapter,
    private readonly answerDrafts: AnswerDraftService,
    private readonly submissions: SubmissionService,
  ) {}

  private deadlineKey(recordId: string | number) {
    return `exam:deadline:${recordId}`;
  }

  private assertLegacyRecordRoute(record: ExamRecord) {
    if (record.assignmentId && !record.regulationId) {
      throw Errors.contentInvisible('培训考试请使用本人考试接口');
    }
  }

  private answerKey(recordId: string | number) {
    return `exam:answer:${recordId}`;
  }

  private switchKey(recordId: string | number) {
    return `exam:switch:${recordId}`;
  }

  private async userContext(userId: number) {
    const u = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!u) throw Errors.notFound('用户不存在');
    return u;
  }

  // ================= 查询 =================

  /** 可考列表（GET /exams/papers）：范围可见 published 制度的 published 试卷 + 资格状态 */
  async listAvailablePapers(userId: number) {
    const user = await this.userContext(userId);
    const isAdmin = user.role === 'super_admin' || user.role === 'regulation_admin';
    const regulations = await this.regRepo.find({ where: { status: RegulationStatus.PUBLISHED } });
    const visible: Regulation[] = [];
    for (const r of regulations) {
      if (isAdmin || (await this.scopeService.isUserInScope(r.id, { id: userId, role: user.role, departmentId: user.departmentId }))) {
        visible.push(r);
      }
    }
    if (!visible.length) return { list: [] };
    const papers = await this.paperRepo.find({ where: { status: PaperStatus.PUBLISHED } });
    const regMap = new Map(visible.map((r) => [r.id, r]));
    // 批量预取（替代逐卷查询的 N+1）：考试记录按 paperId 分组，学习记录按 regulationId 建索引
    const paperIds = papers.map((p) => p.id).filter((id) => regMap.has(id));
    const examRecords = paperIds.length
      ? await this.recordRepo.find({ where: { paperId: In(paperIds), userId: String(userId) } })
      : [];
    const recordsByPaper = new Map<string, ExamRecord[]>();
    for (const rec of examRecords) {
      const arr = recordsByPaper.get(rec.paperId) || [];
      arr.push(rec);
      recordsByPaper.set(rec.paperId, arr);
    }
    const learningRecords = paperIds.length
      ? await this.learningRepo.find({ where: { userId: String(userId), regulationId: In(Array.from(regMap.keys())) } })
      : [];
    const validRegs = new Set(learningRecords.filter((lr) => lr.isValid === 1).map((lr) => lr.regulationId));
    const result: Record<string, unknown>[] = [];
    for (const p of papers) {
      if (!p.regulationId || p.businessScope === 'training') continue;
      const reg = regMap.get(p.regulationId);
      if (!reg) continue;
      const records = recordsByPaper.get(p.id) || [];
      const finished = records.filter((r) => r.status !== ExamStatus.IN_PROGRESS);
      const bestScore = finished.length ? Math.max(...finished.map((r) => Number(r.score || 0))) : null;
      result.push({
        paper_id: Number(p.id),
        paper_title: p.title,
        regulation_id: Number(reg.id),
        regulation_title: reg.title,
        duration_minutes: p.durationMinutes,
        max_attempts: p.maxAttempts,
        pass_score: Number(p.passScore),
        is_eligible: validRegs.has(reg.id),
        attempt_used: records.length,
        best_score: bestScore,
        has_passed: records.some((r) => r.status === ExamStatus.PASSED),
      });
    }
    return { list: result };
  }

  /** 我的考试记录列表（GET /exams/records） */
  async myRecords(userId: number, query: { page?: number; page_size?: number }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.recordRepo.createQueryBuilder('er')
      .innerJoin(ExamPaper, 'legacy_paper', 'legacy_paper.id = er.paper_id AND legacy_paper.business_scope = :scope', { scope: 'regulation' })
      .where('er.user_id = :uid', { uid: String(userId) });
    qb.orderBy('er.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    const paperIds = Array.from(new Set(rows.map((r) => r.paperId)));
    const papers = paperIds.length ? await this.paperRepo.find({ where: { id: In(paperIds) } }) : [];
    const paperMap = new Map(papers.map((p) => [p.id, p]));
    const regIds = Array.from(new Set(rows.map((r) => r.regulationId).filter((id): id is string => Boolean(id))));
    const regs = regIds.length ? await this.regRepo.find({ where: { id: In(regIds) } }) : [];
    const regMap = new Map(regs.map((r) => [r.id, r]));
    return {
      list: rows.map((r) => ({
        id: Number(r.id),
        paper_id: Number(r.paperId),
        paper_title: paperMap.get(r.paperId)?.title,
        regulation_id: r.regulationId === null ? null : Number(r.regulationId),
        regulation_title: r.regulationId === null ? undefined : regMap.get(r.regulationId)?.title,
        attempt_no: r.attemptNo,
        status: r.status,
        score: r.score === null ? null : Number(r.score),
        started_at: r.startedAt,
        submitted_at: r.submittedAt,
        switch_count: r.switchCount,
      })),
      total,
      page,
      page_size: pageSize,
    };
  }

  // ================= 开考 =================

  private async loadLegacyPaperQuestions(paperId: string) {
    const pqs = await this.pqRepo.find({ where: { paperId }, order: { sort: 'ASC', id: 'ASC' } });
    const qIds = pqs.map((pq) => pq.questionId);
    const questions = qIds.length ? await this.questionRepo.find({ where: { id: In(qIds) } }) : [];
    const qMap = new Map(questions.map((q) => [q.id, q]));
    if (qIds.some((questionId) => !qMap.has(questionId))) throw Errors.param('固定试卷包含不存在的题目');
    for (const questionId of qIds) {
      const question = qMap.get(questionId)!;
      if (question.type !== 'single' && question.type !== 'multiple') {
        throw Errors.param('legacy 固定试卷仅支持单选题和多选题，暂不能开考判断题或图片题');
      }
    }
    return { pqs, qMap };
  }

  /** 乱序试卷视图（下发不含 answer / analysis，06 册 4.1） */
  private async buildPaperView(record: ExamRecord, paper: ExamPaper) {
    const { pqs, qMap } = await this.loadLegacyPaperQuestions(String(paper.id));
    const seed = this.shuffle.deriveSeed(record.id);
    const ordered = this.shuffle.shuffleQuestionOrder(pqs, seed);
    return ordered.map((pq) => {
      const q = qMap.get(pq.questionId)!;
      const options = this.shuffle.shuffleOptions(q.options || [], seed, pq.questionId);
      return {
        question_id: Number(pq.questionId),
        type: q.type,
        stem: q.stem,
        options,
        score: Number(pq.score),
      };
    });
  }

  private async remainingSeconds(record: ExamRecord): Promise<number> {
    const deadline = new Date(record.deadlineAt).getTime();
    return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  }

  /** Legacy fixed-client start delegates to C2's atomic snapshot flow. */
  async start(paperId: string, userId: number) {
    const paper = await this.paperRepo.findOne({ where: { id: String(paperId) } });
    if (!paper) throw Errors.notFound('试卷不存在');
    if (paper.businessScope === 'training' || !paper.regulationId) {
      throw Errors.contentInvisible('培训考试请使用本人考试接口');
    }
    return this.legacyAdapter.start(String(paperId), String(userId));
  }

  private async startResponse(record: ExamRecord, paper: ExamPaper) {
    const questions = await this.buildPaperView(record, paper);
    return {
      exam_record_id: Number(record.id),
      attempt_no: record.attemptNo,
      status: record.status,
      paper: {
        id: Number(paper.id),
        title: paper.title,
        total_score: Number(paper.totalScore),
        pass_score: Number(paper.passScore),
        duration_minutes: paper.durationMinutes,
      },
      remaining_seconds: await this.remainingSeconds(record),
      deadline_at: record.deadlineAt,
      questions,
      saved_answers: await this.loadSavedAnswers(record.id),
    };
  }

  /** 恢复考试（GET /exams/records/{id}）：同 seed 复现乱序映射 + Redis 暂存恢复（UC-06 A2） */
  async recover(recordId: string, userId: number) {
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) throw Errors.notFound('考试记录不存在');
    if (Number(record.userId) !== userId) throw Errors.dataForbidden();
    this.assertLegacyRecordRoute(record);
    if (record.status !== ExamStatus.IN_PROGRESS) {
      // 已终态：返回成绩摘要，前端路由至结果页
      return {
        exam_record_id: Number(record.id),
        status: record.status,
        score: record.score === null ? null : Number(record.score),
        finished: true,
      };
    }
    if (record.assignmentId) return this.legacyAdapter.recover(String(recordId), String(userId));
    const paper = await this.paperRepo.findOne({ where: { id: record.paperId } });
    if (!paper) throw Errors.notFound('试卷不存在');
    return this.startResponse(record, paper);
  }

  private async loadSavedAnswers(recordId: string): Promise<Record<string, number[]>> {
    const raw = await this.redis.hgetall(this.answerKey(recordId));
    const out: Record<string, number[]> = {};
    for (const [qid, val] of Object.entries(raw || {})) {
      try {
        const arr = JSON.parse(val);
        if (Array.isArray(arr)) out[qid] = arr.map(Number);
      } catch { /* 暂存损坏按未答处理 */ }
    }
    return out;
  }

  // ================= 作答 / 切屏 =================

  /** 考试心跳（POST /exams/records/{id}/heartbeat）：作答暂存 + 服务端时间校准（05 册 6.4.3） */
  async heartbeat(recordId: string, userId: number, answers: { question_id: number | string; selected?: number[] }[]) {
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) throw Errors.notFound('考试记录不存在');
    if (Number(record.userId) !== userId) throw Errors.dataForbidden();
    this.assertLegacyRecordRoute(record);
    const now = Date.now();
    if (record.status !== ExamStatus.IN_PROGRESS) {
      throw Errors.submitConflict('考试已结束');
    }
    if (new Date(record.deadlineAt).getTime() <= now) {
      // 已超时：立即触发自动交卷
      await this.autoSubmit(record);
      throw Errors.submitConflict('考试已超时，系统已自动交卷');
    }
    const persistedAnswers = record.assignmentId && record.regulationId
      ? await this.legacyAdapter.answersToItems(String(record.id), answers)
      : answers;
    if (record.assignmentId) {
      if (persistedAnswers.length) {
        await this.answerDrafts.patchLegacy(String(userId), String(record.id), persistedAnswers.map((answer) => ({
          item_id: String(answer.question_id), selected: answer.selected,
        })));
      }
      const heartbeat = await this.submissions.heartbeat(String(userId), String(record.id));
      return {
        server_time: heartbeat.server_time,
        remaining_seconds: heartbeat.remaining_seconds,
        deadline_at: record.deadlineAt,
      };
    }
    // 5 秒去抖窗口：仅拦截异常高频风暴（作答暂存为幂等覆盖写，重复到达无副作用）；
    // 30 秒正常节拍由前端定时器保证，学习心跳同理以远小于节拍的窗口判定「异常高频」（04 册 6.2）
    const lastBeat = await this.redis.get(`exam:beat:${recordId}`);
    if (lastBeat && now - Number(lastBeat) < 5_000) {
      throw Errors.tooManyRequests();
    }
    await this.redis.set(`exam:beat:${recordId}`, String(now), 300);
    // 作答暂存（呈现位置，交卷时服务端还原；每题覆盖写幂等）
    for (const a of persistedAnswers || []) {
      await this.redis.hset(this.answerKey(recordId), String(a.question_id), JSON.stringify((a.selected || []).map(Number)));
    }
    const deadline = new Date(record.deadlineAt).getTime();
    return {
      server_time: new Date().toISOString(),
      remaining_seconds: Math.max(0, Math.floor((deadline - now) / 1000)),
      deadline_at: record.deadlineAt,
    };
  }

  /** 切屏上报（POST /exams/records/{id}/switch）：Redis INCR + 1 秒窗口去抖（05 册 6.4.4） */
  async reportSwitch(recordId: string, userId: number) {
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) throw Errors.notFound('考试记录不存在');
    if (Number(record.userId) !== userId) throw Errors.dataForbidden();
    this.assertLegacyRecordRoute(record);
    if (record.status !== ExamStatus.IN_PROGRESS) {
      const switchCount = record.switchCount;
      return { switch_count: switchCount, warning: switchCount > SWITCH_WARN_THRESHOLD, risk_flag: switchCount >= SWITCH_RISK_THRESHOLD };
    }
    if (record.assignmentId) {
      const result = await this.submissions.reportSwitch(String(userId), String(record.id));
      const count = Number(result.switch_count);
      const warning = count > SWITCH_WARN_THRESHOLD;
      const riskFlag = count >= SWITCH_RISK_THRESHOLD;
      if (riskFlag) {
        this.audit.log({
          actor_id: userId, actor_name: '', action: 'exam.switch.risk', object_type: 'exam_record',
          object_id: recordId, detail: { switch_count: count }, result: 'success', source_ip: null,
        });
      }
      return { switch_count: count, warning, risk_flag: riskFlag };
    }
    // 1 秒窗口去抖：窗口内的重复上报合并计 1 次（防事件风暴与伪造 flooding）
    const debounced = await this.redis.setNx(`exam:switch:deb:${recordId}`, '1', SWITCH_DEBOUNCE_SECONDS);
    if (!debounced) {
      const current = Number((await this.redis.get(this.switchKey(recordId))) || record.switchCount || 0);
      return { switch_count: current, warning: current > SWITCH_WARN_THRESHOLD, risk_flag: current >= SWITCH_RISK_THRESHOLD };
    }
    const count = await this.redis.incr(this.switchKey(recordId), 24 * 3600);
    const warning = count > SWITCH_WARN_THRESHOLD;
    const riskFlag = count >= SWITCH_RISK_THRESHOLD;
    if (riskFlag) {
      // ≥5 风控标记 + 审计日志（人工复核，不强制交卷，07 册 3.2.2）
      this.audit.log({
        actor_id: userId, actor_name: '', action: 'exam.switch.risk', object_type: 'exam_record',
        object_id: recordId, detail: { switch_count: count }, result: 'success', source_ip: null,
      });
    }
    return { switch_count: count, warning, risk_flag: riskFlag };
  }

  // ================= 交卷与评分 =================

  /** 交卷（POST /exams/records/{id}/submit）：三层幂等（防重锁 → 状态机单向 → 乐观锁） */
  async submit(recordId: string, userId: number, answers: { question_id: number | string; selected?: number[] }[]) {
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) throw Errors.notFound('考试记录不存在');
    if (Number(record.userId) !== userId) throw Errors.dataForbidden();
    this.assertLegacyRecordRoute(record);

    if (record.assignmentId) {
      // A completed C2 attempt is an idempotent replay regardless of the retry
      // body. Do not remap stale client answers before returning its first result.
      if (record.status !== ExamStatus.IN_PROGRESS) {
        return this.legacyAdapter.submitResult(record);
      }
      const mapped = await this.legacyAdapter.answersToItems(String(record.id), answers);
      await this.submissions.submitLegacy(String(userId), String(record.id), mapped.map((answer) => ({
        item_id: String(answer.question_id), selected: answer.selected,
      })));
      const completed = await this.recordRepo.findOne({ where: { id: String(record.id) } });
      if (!completed) throw Errors.notFound('考试记录不存在');
      return this.legacyAdapter.submitResult(completed);
    }

    // 幂等：终态记录重复交卷直接返回首次评分结果（04 册 1.5）
    if (record.status !== ExamStatus.IN_PROGRESS) {
      return this.submitResultView(record);
    }
    const now = Date.now();
    const isTimeout = new Date(record.deadlineAt).getTime() <= now;
    const submittedAnswers = record.assignmentId && record.regulationId
      ? await this.legacyAdapter.answersToItems(String(record.id), answers)
      : answers;

    // Redis 防重锁：并发重复交卷仅首个请求进入判分
    const locked = await this.redis.setNx(`exam:lock:submit:${recordId}`, '1', SUBMIT_LOCK_TTL);
    if (!locked) {
      const fresh = await this.recordRepo.findOne({ where: { id: recordId } });
      if (fresh && fresh.status !== ExamStatus.IN_PROGRESS) return this.submitResultView(fresh);
      throw Errors.tooManyRequests('正在交卷，请勿重复提交');
    }

    try {
      const user = await this.userRepo.findOne({ where: { id: String(userId) } });
      if (!user || user.status !== 1) throw Errors.accountDisabled(); // 敏感操作回查在职状态

      // 取最终作答集：Redis 暂存 + 交卷请求增量合并（请求增量覆盖写）
      const saved = await this.redis.hgetall(this.answerKey(recordId));
      const merged = new Map<string, number[]>();
      for (const [qid, val] of Object.entries(saved || {})) {
        try {
          const arr = JSON.parse(val);
          if (Array.isArray(arr)) merged.set(qid, arr.map(Number));
        } catch { /* ignore */ }
      }
      // 超时口径（07 册 3.2.4）：deadline 已过则忽略请求体增量，仅以截止时刻的 Redis 暂存判分（与 autoSubmit 一致）
      if (!isTimeout) {
        for (const a of submittedAnswers || []) {
          merged.set(String(a.question_id), (a.selected || []).map(Number));
        }
      }

      const result = await this.gradeAndPersist(record, merged, isTimeout ? 'timeout' : 'submitted', user.username);
      // 成功清理顺序：提交事务 → DEL 答案暂存 → DEL 防重锁 → DEL deadline / 切屏（07 册 3.2.4）
      await this.redis.del(this.answerKey(recordId), `exam:lock:submit:${recordId}`, this.deadlineKey(recordId), this.switchKey(recordId));
      return result;
    } catch (e: any) {
      // 判分事务回滚：DEL 防重锁（考生可立即重试）、保留作答暂存（07 册 3.2.4 失败释放约定）
      await this.redis.del(`exam:lock:submit:${recordId}`);
      throw e;
    }
  }

  /** 评分落库（05 册 6.4.5 评分落库事务）：乱序还原 → 逐题判分 → 条件 UPDATE + 批量 INSERT 单事务 */
  private async gradeAndPersist(
    record: ExamRecord,
    answers: Map<string, number[]>,
    submitStatus: 'submitted' | 'timeout',
    actorName: string,
  ): Promise<Record<string, unknown>> {
    const paper = await this.paperRepo.findOne({ where: { id: record.paperId } });
    if (!paper) throw Errors.notFound('试卷不存在');
    const pqs = await this.pqRepo.find({ where: { paperId: paper.id }, order: { sort: 'ASC', id: 'ASC' } });
    const qIds = pqs.map((pq) => pq.questionId);
    const questions = qIds.length ? await this.questionRepo.find({ where: { id: In(qIds) } }) : [];
    const qMap = new Map(questions.map((q) => [q.id, q]));

    // 乱序还原：同 seed 重算映射，呈现位置 → 原始选项下标（判分以原始 answer 语义为准）
    const seed = this.shuffle.deriveSeed(record.id);
    const restored = new Map<string, number[]>();
    for (const pq of pqs) {
      const q = qMap.get(pq.questionId);
      if (!q) continue;
      const display = answers.get(String(pq.questionId)) || answers.get(pq.questionId) || null;
      if (!display || !display.length) {
        restored.set(pq.questionId, null as any);
        continue;
      }
      const mapping = this.shuffle.optionMapping((q.options || []).length, seed, pq.questionId);
      restored.set(pq.questionId, this.shuffle.restoreSelection(display, mapping));
    }

    const graded = this.grading.grade(restored, paper, pqs, qMap);
    const passed = this.grading.isPassed(graded.total, Number(paper.passScore));
    const finalStatus = passed ? ExamStatus.PASSED : ExamStatus.FAILED;
    const switchCount = Number((await this.redis.get(this.switchKey(record.id))) || 0);
    const submittedAt = new Date();

    let savedRecord: ExamRecord | null = null;
    await this.dataSource.transaction(async (m) => {
      const recordRepo = m.getRepository(ExamRecord);
      // 状态机单向 + 乐观锁（条件 UPDATE：影响行数 0 = 已被处理）
      const upd = await recordRepo
        .createQueryBuilder()
        .update(ExamRecord)
        .set({ status: submitStatus, score: String(graded.total), submittedAt, switchCount })
        .where('id = :id AND status = :status', { id: record.id, status: ExamStatus.IN_PROGRESS })
        .execute();
      if (!upd.affected) throw Errors.submitConflict();

      // 批量 INSERT exam_answer（append-only，无 UPDATE 路径）
      const answerRepo = m.getRepository(ExamAnswer);
      const entities = graded.details.map((d) =>
        answerRepo.create({
          examRecordId: record.id,
          questionId: String(d.question_id),
          selected: d.selected,
          isCorrect: d.is_correct,
          gainedScore: String(d.gained_score),
        }),
      );
      if (entities.length) await answerRepo.save(entities);

      // 判分后落终态：submitted/timeout → passed/failed（五态状态机，03 册 3.4.4）
      await recordRepo.update(record.id, { status: finalStatus });
      savedRecord = await recordRepo.findOne({ where: { id: record.id } });
    });

    // 交卷事件按制度失效统计缓存（05 册 7.4.4）：完成率/通过率不滞后于最新交卷
    await this.statistics.invalidateRegulationCache(String(record.regulationId));

    this.audit.log({
      actor_id: Number(record.userId), actor_name: actorName, action: 'exam.submit', object_type: 'exam_record',
      object_id: record.id, detail: { status: finalStatus, score: graded.total, timeout: submitStatus === 'timeout' },
      result: 'success', source_ip: null,
    });
    return this.submitResultView(savedRecord || ({ ...record, status: finalStatus, score: String(graded.total), submittedAt, switchCount } as ExamRecord));
  }

  private async submitResultView(record: ExamRecord) {
    if (record.assignmentId) return this.legacyAdapter.submitResult(record);
    const paper = await this.paperRepo.findOne({ where: { id: record.paperId } });
    // 取最高分口径（C-06）：同一试卷多次作答取最高分
    const finished = await this.recordRepo.find({ where: { paperId: record.paperId, userId: record.userId } });
    const scores = finished.filter((r) => r.status !== ExamStatus.IN_PROGRESS && r.score !== null).map((r) => Number(r.score));
    const bestScore = scores.length ? Math.max(...scores) : null;
    const answers = await this.answerRepo.find({ where: { examRecordId: record.id } });
    return {
      exam_record_id: Number(record.id),
      status: record.status,
      score: record.score === null ? null : Number(record.score),
      pass_score: paper ? Number(paper.passScore) : null,
      switch_count: record.switchCount,
      submitted_at: record.submittedAt,
      best_score: bestScore,
      answer_summary: answers.map((a) => ({
        question_id: Number(a.questionId),
        is_correct: a.isCorrect === null ? null : a.isCorrect === 1,
        gained_score: Number(a.gainedScore),
      })),
    };
  }

  /** 成绩与答题明细（GET /exams/records/{id}/result）：解析仅在交卷后下发（04 册 3.7） */
  async result(recordId: string, userId: number, userRole: string) {
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) throw Errors.notFound('考试记录不存在');
    this.assertLegacyRecordRoute(record);
    if (record.assignmentId) return this.legacyAdapter.result(String(recordId), String(userId), userRole);
    const isOwner = Number(record.userId) === userId;
    const isAdmin = userRole === 'super_admin' || userRole === 'regulation_admin';
    if (!isOwner && !isAdmin) throw Errors.dataForbidden();
    // 在考拒绝：成绩明细（含 answer/analysis）仅在交卷后下发，恢复在考走 start 幂等路径（04 册 3.7）
    if (record.status === ExamStatus.IN_PROGRESS) {
      throw Errors.submitConflict('考试进行中，成绩明细交卷后可查');
    }
    const paper = await this.paperRepo.findOne({ where: { id: record.paperId } });
    const pqs = await this.pqRepo.find({ where: { paperId: record.paperId } });
    const qRows = await this.questionRepo.find({ where: { id: In(pqs.length ? pqs.map((p) => p.questionId) : ['0']) } });
    const qMap = new Map(qRows.map((q) => [q.id, q]));
    const answers = await this.answerRepo.find({ where: { examRecordId: record.id } });
    const finished = await this.recordRepo.find({ where: { paperId: record.paperId, userId: record.userId } });
    const scores = finished.filter((r) => r.status !== ExamStatus.IN_PROGRESS && r.score !== null).map((r) => Number(r.score));
    return {
      exam_record_id: Number(record.id),
      paper_id: Number(record.paperId),
      attempt_no: record.attemptNo,
      status: record.status,
      score: record.score === null ? null : Number(record.score),
      pass_score: paper ? Number(paper.passScore) : null,
      switch_count: record.switchCount,
      started_at: record.startedAt,
      submitted_at: record.submittedAt,
      best_score: scores.length ? Math.max(...scores) : null,
      questions: pqs.map((pq) => {
        const q = qMap.get(pq.questionId);
        const a = answers.find((x) => x.questionId === pq.questionId);
        return {
          question_id: Number(pq.questionId),
          type: q?.type,
          stem: q?.stem,
          options: q?.options,
          score: Number(pq.score),
          selected: a ? a.selected : null,
          is_correct: a ? (a.isCorrect === null ? null : a.isCorrect === 1) : null,
          gained_score: a ? Number(a.gainedScore) : null,
          answer: q?.answer,
          analysis: q?.analysis,
        };
      }),
    };
  }

  // ================= 超时自动交卷 =================

  /** 超时自动交卷（定时任务主触发，每 30 秒扫描 idx_status_deadline 条件，06 册 4.3） */
  async sweepTimeouts() {
    const rows = await this.recordRepo.find({
      where: { status: ExamStatus.IN_PROGRESS, deadlineAt: LessThanOrEqual(new Date()) },
      take: 50,
      order: { deadlineAt: 'ASC' },
    });
    for (const record of rows) {
      try {
        await this.autoSubmit(record);
      } catch (e: any) {
        this.logger.warn(`超时自动交卷失败 record=${record.id}: ${e?.message}`);
      }
    }
    return rows.length;
  }

  /** Redis 到期键辅助触发（04 册 3.7 辅通道）：检查指定记录是否到期并交卷 */
  async checkAndSubmitIfExpired(recordId: string) {
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (record && record.status === ExamStatus.IN_PROGRESS && new Date(record.deadlineAt).getTime() <= Date.now()) {
      await this.autoSubmit(record);
    }
  }

  /** 单条超时交卷：与主动交卷同一评分路径，status=timeout、按当前已答内容评分（FR-EXM-03） */
  private async autoSubmit(record: ExamRecord) {
    if (record.assignmentId) {
      await this.submissions.timeout(String(record.id));
      return;
    }
    const locked = await this.redis.setNx(`exam:lock:submit:${record.id}`, '1', SUBMIT_LOCK_TTL);
    if (!locked) return; // 主动交卷进行中，先到者生效（幂等，06 册 4.3）
    try {
      const saved = await this.redis.hgetall(this.answerKey(record.id));
      const merged = new Map<string, number[]>();
      for (const [qid, val] of Object.entries(saved || {})) {
        try {
          const arr = JSON.parse(val);
          if (Array.isArray(arr)) merged.set(qid, arr.map(Number));
        } catch { /* ignore */ }
      }
      await this.gradeAndPersist(record, merged, 'timeout', 'system');
      await this.redis.del(this.answerKey(record.id), this.deadlineKey(record.id), this.switchKey(record.id));
    } finally {
      await this.redis.del(`exam:lock:submit:${record.id}`);
    }
  }
}
