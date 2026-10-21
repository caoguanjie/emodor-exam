import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { LearningSession } from '../../entities/learning-session.entity';
import { LearningRecord, ScrollCoverage, ScrollCoverageUtil } from '../../entities/learning-record.entity';
import { Regulation } from '../../entities/regulation.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { Errors, RegulationStatus } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { RegulationScopeService } from '../regulations/regulation-scope.service';
import { ContentService } from '../regulations/content.service';
import { StatisticsService } from '../statistics/statistics.service';
import { AccessService } from '../access/access.service';
import { RoleEnum } from '../../common/errors';

export const SESSION_TTL_SECONDS = 6 * 3600; // learn:session:{id} TTL 6 小时兜底过期
export const OFFLINE_THRESHOLD_MS = 90_000; // 90 秒无心跳判定离线（05 册 5.4.6）
const START_LOCK_TTL = 10; // learn:lock:start:{user_id}:{regulation_id} TTL 10 秒
import { HEARTBEAT_CAP_MS } from './tolerance';

export interface SessionState {
  duration_ms: number;
  segments: number[];
  max_scroll_percent: number;
  last_beat_at: number;
  state: 'active' | 'paused';
  paused_at: number;
}

/**
 * 学习会话服务（05 册 5.4.1 / 5.4.6，07 册 3.1.1）：
 * start（单活跃会话约束：后开者胜出）/ end / 心跳结算 / 失焦 pause-resume 锚点模型 /
 * 聚合落库事务（learning_session + learning_record + 有效学习幂等判定）。
 * 心跳高频路径零 MySQL 写入（Redis HINCRBY 累计，03 册 6.3 写入点 1）。
 */
@Injectable()
export class LearningSessionService {
  private readonly logger = new Logger(LearningSessionService.name);

  constructor(
    @InjectRepository(LearningSession) private readonly sessionRepo: Repository<LearningSession>,
    @InjectRepository(LearningRecord) private readonly recordRepo: Repository<LearningRecord>,
    @InjectRepository(Regulation) private readonly regRepo: Repository<Regulation>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    private readonly redis: RedisService,
    private readonly scopeService: RegulationScopeService,
    private readonly content: ContentService,
    private readonly statistics: StatisticsService,
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
  ) {}

  private sessionKey(sessionId: string | number) {
    return `learn:session:${sessionId}`;
  }

  /** 同会话状态读-改-写的进程内串行化（单实例部署语义，07 册 5.2）：并发心跳/pause 各自计入整窗会 N 倍虚增时长 */
  private sessionMutex = new Map<string, Promise<void>>();
  private withSessionMutex<T>(sessionId: string | number, fn: () => Promise<T>): Promise<T> {
    const key = String(sessionId);
    const prev = this.sessionMutex.get(key) ?? Promise.resolve();
    const run = prev.then(fn);
    const settled: Promise<void> = run.then(
      () => undefined,
      () => undefined,
    );
    this.sessionMutex.set(key, settled);
    void settled.finally(() => {
      if (this.sessionMutex.get(key) === settled) this.sessionMutex.delete(key);
    });
    return run;
  }

  private activeKey(userId: number | string, regulationId: string | number) {
    return `learn:active:${userId}:${regulationId}`;
  }

  private async readSessionState(sessionId: string | number): Promise<SessionState | null> {
    const raw = await this.redis.hgetall(this.sessionKey(sessionId));
    if (!raw || !raw.last_beat_at) return null;
    let segments: number[] = new Array(10).fill(0);
    try {
      const parsed = JSON.parse(raw.segments || '[]');
      if (Array.isArray(parsed)) segments = parsed;
    } catch { /* 位图损坏按空处理 */ }
    return {
      duration_ms: Number(raw.duration_ms || 0),
      segments,
      max_scroll_percent: Number(raw.max_scroll_percent || 0),
      last_beat_at: Number(raw.last_beat_at || 0),
      state: raw.state === 'paused' ? 'paused' : 'active',
      paused_at: Number(raw.paused_at || 0),
    };
  }

  private async writeSessionState(sessionId: string | number, state: SessionState) {
    await this.redis.hsetAll(
      this.sessionKey(sessionId),
      {
        duration_ms: String(state.duration_ms),
        segments: JSON.stringify(state.segments),
        max_scroll_percent: String(state.max_scroll_percent),
        last_beat_at: String(state.last_beat_at),
        state: state.state,
        paused_at: String(state.paused_at),
      },
      SESSION_TTL_SECONDS,
    );
  }

  /** 合并滚动段位图（只增不减）与 max_scroll_percent（单调不减），返回新状态 */
  private mergeScroll(state: SessionState, dwellSegments: number[], scrollPercent: number | undefined, totalSegments: number): SessionState {
    if (Array.isArray(dwellSegments)) {
      for (const s of dwellSegments) {
        const idx = Number(s);
        if (Number.isInteger(idx) && idx >= 0 && idx < totalSegments) state.segments[idx] = 1;
      }
    }
    if (typeof scrollPercent === 'number' && Number.isFinite(scrollPercent)) {
      const p = Math.max(0, Math.min(100, Math.round(scrollPercent)));
      if (p > state.max_scroll_percent) state.max_scroll_percent = p;
    }
    return state;
  }

  private async userContext(userId: number) {
    const u = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!u) throw Errors.notFound('用户不存在');
    const permissions = await this.access.permissions(userId);
    const canReadAsAdmin = u.role === RoleEnum.SUPER_ADMIN
      || (u.role === RoleEnum.REGULATION_ADMIN && permissions.includes('regulations:read'));
    return { role: canReadAsAdmin ? u.role : RoleEnum.EMPLOYEE, departmentId: u.departmentId };
  }

  /** 确保学习汇总行存在（首次进入学习时创建，uk_user_regulation 防并发首学） */
  private async ensureRecord(regulation: Regulation, userId: number, versionId: string): Promise<LearningRecord> {
    const existing = await this.recordRepo.findOne({ where: { userId: String(userId), regulationId: regulation.id } });
    if (existing) return existing;
    try {
      return await this.recordRepo.save(
        this.recordRepo.create({
          userId: String(userId),
          regulationId: regulation.id,
          versionId,
          totalSeconds: 0,
          maxScrollPercent: 0,
          scrollCoverage: ScrollCoverageUtil.empty(regulation.scrollSegments),
          isValid: 0,
        }),
      );
    } catch (e: any) {
      if (String(e?.code) === 'ER_DUP_ENTRY') {
        const found = await this.recordRepo.findOne({ where: { userId: String(userId), regulationId: regulation.id } });
        if (found) return found;
      }
      throw e;
    }
  }

  /** 学习进度视图（库内聚合 + 进行中会话的 Redis 实时累计展示） */
  async progressView(regulation: Regulation, userId: number, includeGap = true) {
    const record = await this.recordRepo.findOne({ where: { userId: String(userId), regulationId: regulation.id } });
    const coverage = record ? ScrollCoverageUtil.normalize(record.scrollCoverage, regulation.scrollSegments) : ScrollCoverageUtil.empty(regulation.scrollSegments);
    const dbSeconds = record ? record.totalSeconds : 0;
    // 进行中会话的 Redis 累计（仅展示口径；is_valid 只由落库事务产生）
    const activeSessionId = await this.redis.get(this.activeKey(userId, regulation.id));
    let liveSeconds = 0;
    if (activeSessionId) {
      const st = await this.readSessionState(activeSessionId);
      if (st) {
        liveSeconds = Math.floor(st.duration_ms / 1000);
        // 展示口径合并会话内已确认段位：学习中覆盖进度实时可见（is_valid/落库仍以收口事务为准）
        const liveSegments = st.segments && st.segments.length === regulation.scrollSegments
          ? st.segments
          : new Array(regulation.scrollSegments).fill(0);
        const mergedLive = ScrollCoverageUtil.orMerge(coverage, {
          total_segments: regulation.scrollSegments,
          covered_count: 0,
          segments: liveSegments,
        });
        coverage.segments = mergedLive.segments;
        coverage.covered_count = mergedLive.covered_count;
      }
    }
    const totalSeconds = dbSeconds + liveSeconds;
    const requiredSeconds = regulation.requiredMinutes * 60;
    const remainingSeconds = Math.max(0, requiredSeconds - totalSeconds);
    const bottomCovered = ScrollCoverageUtil.bottomCovered(coverage);
    const view: Record<string, unknown> = {
      regulation_id: Number(regulation.id),
      version_id: record ? Number(record.versionId) : regulation.currentVersionId ? Number(regulation.currentVersionId) : null,
      total_seconds: totalSeconds,
      required_seconds: requiredSeconds,
      remaining_seconds: remainingSeconds,
      max_scroll_percent: record ? record.maxScrollPercent : 0,
      scroll_coverage: coverage,
      is_valid: record?.isValid === 1,
      valid_at: record?.validAt ?? null,
    };
    if (includeGap && record?.isValid !== 1) {
      view.gap = {
        time_gap_seconds: remainingSeconds,
        bottom_segment_covered: bottomCovered,
      };
    }
    return view;
  }

  /** 会话 start（05 册 5.4.1）：published + 范围校验 → 单活跃约束 → INSERT 会话 → Redis 初始化 */
  async start(regulationId: string, userId: number) {
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');
    if (regulation.status !== RegulationStatus.PUBLISHED) {
      throw Errors.contentInvisible('制度未发布或已归档，不可学习');
    }
    if (!regulation.currentVersionId) throw Errors.contentInvisible('制度暂无生效版本');
    // 复用阅读内容可见性校验链（05 册 5.4.1 步骤 1）
    const ctx = await this.userContext(userId);
    await this.content.readingContent(regulationId, { id: userId, role: ctx.role, departmentId: ctx.departmentId }, false);

    // 单活跃会话约束（后开者胜出，阻断双标签页并行刷时长，05 册 5.4.1 步骤 2）。
    // 关键段（读活跃指针 → flush 旧会话 → INSERT → 写回指针）以 SETNX 互斥，防 check-then-act 竞态
    // 产生孤儿活跃会话 N 倍计费（参照考试开考 exam:lock:start，05 册 AD-04）
    const locked = await this.redis.setNx(`learn:lock:start:${userId}:${regulationId}`, '1', START_LOCK_TTL);
    if (!locked) throw Errors.tooManyRequests('正在开始学习，请勿重复操作');

    try {
      const activeSessionId = await this.redis.get(this.activeKey(userId, regulationId));
      if (activeSessionId) {
        await this.flushSession(activeSessionId, new Date());
      }

      const session = await this.sessionRepo.save(
        this.sessionRepo.create({
          userId: String(userId),
          regulationId,
          versionId: regulation.currentVersionId!,
          startedAt: new Date(),
          endedAt: null,
          durationSeconds: 0,
        }),
      );
      const now = Date.now();
      const state: SessionState = {
        duration_ms: 0,
        segments: new Array(regulation.scrollSegments).fill(0),
        max_scroll_percent: 0,
        last_beat_at: now,
        state: 'active',
        paused_at: 0,
      };
      await this.writeSessionState(session.id, state);
      await this.redis.set(this.activeKey(userId, regulationId), String(session.id), SESSION_TTL_SECONDS);
      await this.ensureRecord(regulation, userId, regulation.currentVersionId!);

      const progress = await this.progressView(regulation, userId, false);
      return {
        session_id: Number(session.id),
        server_time: new Date().toISOString(),
        heartbeat_interval_seconds: 30,
        progress,
      };
    } finally {
      await this.redis.del(`learn:lock:start:${userId}:${regulationId}`);
    }
  }

  /** 心跳处理（05 册 5.4.2 / 06 册 3.2 决策图）：容差封顶 → Redis 累计 → 位图合并 → 锚点更新 */
  async heartbeat(sessionId: string, userId: number, dwellSegments: number[], scrollPercent: number | undefined) {
    return this.withSessionMutex(sessionId, () => this.doHeartbeat(sessionId, userId, dwellSegments, scrollPercent));
  }

  private async doHeartbeat(sessionId: string, userId: number, dwellSegments: number[], scrollPercent: number | undefined) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw Errors.sessionConflict('学习会话不存在');
    if (Number(session.userId) !== userId) throw Errors.dataForbidden();
    if (session.endedAt) throw Errors.sessionConflict('会话已结束，请重新开始学习');
    // 单活跃指针校验（active/paused 两分支统一前置）：被新会话取代的旧会话心跳不再计费（06 册口径）
    const activeId = await this.redis.get(this.activeKey(userId, session.regulationId));
    if (activeId !== String(sessionId)) throw Errors.sessionConflict('会话已结束，请重新开始学习');
    // 指针归属本会话：刷新活跃指针 TTL，保证长会话期间指针不先于会话过期
    await this.redis.expire(this.activeKey(userId, session.regulationId), SESSION_TTL_SECONDS);
    const state = await this.readSessionState(sessionId);
    if (!state) throw Errors.sessionConflict('会话已结束，请重新开始学习');

    const regulation = await this.regRepo.findOne({ where: { id: session.regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');

    const now = Date.now();
    let creditedMs = 0;
    if (state.state === 'paused') {
      // paused 态心跳：忽略计费、不更新锚点，仅滚动合并（05 册 5.4.3 规则 1）
      this.mergeScroll(state, dwellSegments, scrollPercent, regulation.scrollSegments);
      await this.writeSessionState(sessionId, state);
    } else {
      const diff = now - state.last_beat_at;
      if (diff > 0) {
        if (diff < 10_000) {
          // 节拍窗口限流：异常高频丢弃（42901）； credited 封顶 45 秒保证丢弃不影响时长正确性（04 册 6.2）
          throw Errors.tooManyRequests();
        }
        creditedMs = Math.min(diff, HEARTBEAT_CAP_MS); // 容差封顶：单次最大计入 45 秒
        state.duration_ms += creditedMs;
      }
      // diff <= 0（乱序/重放）丢弃本心跳，仅合并滚动
      this.mergeScroll(state, dwellSegments, scrollPercent, regulation.scrollSegments);
      state.last_beat_at = now;
      state.state = 'active';
      await this.writeSessionState(sessionId, state);
    }

    const progress = await this.progressView(regulation, userId, false);
    const requiredSeconds = regulation.requiredMinutes * 60;
    const totalSeconds = Number(progress.total_seconds);
    return {
      server_time: new Date().toISOString(),
      credited_seconds: Math.floor(creditedMs / 1000),
      total_seconds: totalSeconds,
      required_seconds: requiredSeconds,
      remaining_seconds: Math.max(0, requiredSeconds - totalSeconds),
      scroll_coverage: progress.scroll_coverage,
      // progress_hint 仅 Redis 侧实时估算，不得据此解锁考试入口（04 册 3.6 / 05 册 5.4.5）
      progress_hint: totalSeconds >= requiredSeconds,
      is_valid: progress.is_valid,
      valid_at: progress.valid_at,
    };
  }

  /** 失焦暂停（pause 事件）：结算一个 ≤45 秒窗口后置 paused；携带段位 flush（07 册 3.1.1） */
  async pause(sessionId: string, userId: number, dwellSegments: number[], scrollPercent: number | undefined) {
    return this.withSessionMutex(sessionId, () => this.doPause(sessionId, userId, dwellSegments, scrollPercent));
  }

  private async doPause(sessionId: string, userId: number, dwellSegments: number[], scrollPercent: number | undefined) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw Errors.sessionConflict('学习会话不存在');
    if (Number(session.userId) !== userId) throw Errors.dataForbidden();
    if (session.endedAt) throw Errors.sessionConflict('会话已结束，请重新开始学习');
    const state = await this.readSessionState(sessionId);
    if (!state) throw Errors.sessionConflict('会话已结束，请重新开始学习');

    const regulation = await this.regRepo.findOne({ where: { id: session.regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');

    const now = Date.now();
    let creditedMs = 0;
    if (state.state === 'active') {
      const diff = now - state.last_beat_at;
      creditedMs = diff > 0 ? Math.min(diff, HEARTBEAT_CAP_MS) : 0; // 锚点结算（重复 pause 幂等：仅首次结算）
      state.duration_ms += creditedMs;
      state.state = 'paused';
      state.paused_at = now;
    }
    this.mergeScroll(state, dwellSegments, scrollPercent, regulation.scrollSegments);
    await this.writeSessionState(sessionId, state);
    return {
      server_time: new Date().toISOString(),
      state: 'paused',
      credited_seconds: Math.floor(creditedMs / 1000),
      total_seconds: await this.totalSecondsView(regulation, userId),
    };
  }

  /** 恢复聚焦（resume 事件）：仅锚点重置（last_beat_at = now），不产生任何时长（05 册 5.4.3） */
  async resume(sessionId: string, userId: number) {
    return this.withSessionMutex(sessionId, () => this.doResume(sessionId, userId));
  }

  private async doResume(sessionId: string, userId: number) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw Errors.sessionConflict('学习会话不存在');
    if (Number(session.userId) !== userId) throw Errors.dataForbidden();
    if (session.endedAt) throw Errors.sessionConflict('会话已结束，请重新开始学习');
    const state = await this.readSessionState(sessionId);
    if (!state) throw Errors.sessionConflict('会话已结束，请重新开始学习');
    if (state.state === 'paused') {
      state.state = 'active';
      state.paused_at = 0;
      state.last_beat_at = Date.now();
      await this.writeSessionState(sessionId, state);
    }
    const regulation = await this.regRepo.findOne({ where: { id: session.regulationId } });
    return {
      server_time: new Date().toISOString(),
      state: 'active',
      total_seconds: regulation ? await this.totalSecondsView(regulation, userId) : 0,
    };
  }

  private async totalSecondsView(regulation: Regulation, userId: number): Promise<number> {
    const view = await this.progressView(regulation, userId, false);
    return Number(view.total_seconds);
  }

  /** 正常结束会话：聚合落库事务（触发器①，05 册 5.4.6） */
  async end(sessionId: string, userId: number, dwellSegments: number[] = [], scrollPercent?: number) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw Errors.notFound('学习会话不存在');
    if (Number(session.userId) !== userId) throw Errors.dataForbidden();
    const closeTime = new Date();
    // 段位/滚动合并透传给 flushSession：在会话互斥锁内执行，防止与并发心跳丢更新（收口竞态）
    const result = await this.flushSession(sessionId, closeTime, null, dwellSegments, scrollPercent);
    const regulation = await this.regRepo.findOne({ where: { id: session.regulationId } });
    const progress = regulation ? await this.progressView(regulation, userId, true) : null;
    return {
      session_id: Number(sessionId),
      duration_seconds: result.durationSeconds,
      progress,
    };
  }

  /**
   * 聚合落库事务（05 册 5.4.6）：单事务完成会话收口 + learning_record 聚合 + 双条件判定。
   * 以 ended_at IS NULL 作为「未收口」判据（条件 UPDATE 影响行数 0 即已被处理，幂等）。
   * dwellSegments/scrollPercent：end 搭载的最后一次待上报段位，锁内在 readSessionState 后合并。
   */
  async flushSession(
    sessionId: string,
    closeTime: Date,
    state?: SessionState | null,
    dwellSegments: number[] = [],
    scrollPercent?: number,
  ): Promise<{ durationSeconds: number }> {
    // 与心跳/暂停互斥：防止收口结算与心跳结算对同一窗口重复计入
    return this.withSessionMutex(sessionId, () => this.doFlushSession(sessionId, closeTime, state, dwellSegments, scrollPercent));
  }

  private async doFlushSession(
    sessionId: string,
    closeTime: Date,
    state?: SessionState | null,
    dwellSegments: number[] = [],
    scrollPercent?: number,
  ): Promise<{ durationSeconds: number }> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) return { durationSeconds: 0 };
    if (!state) state = await this.readSessionState(sessionId);

    const regulation = await this.regRepo.findOne({ where: { id: session.regulationId } });
    const totalSegments = regulation?.scrollSegments ?? 10;

    // 收口前合并最后一次待上报段位（锁内紧跟读态，防并发心跳覆盖丢数据）
    if (state && (dwellSegments.length || typeof scrollPercent === 'number')) {
      this.mergeScroll(state, dwellSegments, scrollPercent, totalSegments);
      await this.writeSessionState(sessionId, state);
    }

    let durationMs = 0;
    let segments: number[] | null = null;
    let maxPercent = 0;
    let endedAt = closeTime;

    if (state) {
      durationMs = state.duration_ms;
      segments = state.segments;
      maxPercent = state.max_scroll_percent;
      if (state.state === 'active') {
        // 离线收口：ended_at 取最后心跳 + 45 秒封顶，并补记封顶时长（UC-04 A2 / 07 册 3.1.2）
        const gap = closeTime.getTime() - state.last_beat_at;
        const finalCredit = Math.max(0, Math.min(gap, HEARTBEAT_CAP_MS));
        durationMs += finalCredit;
        endedAt = new Date(state.last_beat_at + finalCredit);
      } else {
        // paused 收口：失焦期间零累计，ended_at = paused 时刻
        endedAt = new Date(state.paused_at || closeTime.getTime());
      }
    }
    const durationSeconds = Math.floor(durationMs / 1000);
    let becameValid = false;

    await this.dataSource.transaction(async (m) => {
      // 条件更新：已收口会话重复触发直接跳过（幂等）
      const upd = await m
        .createQueryBuilder()
        .update(LearningSession)
        .set({ durationSeconds, endedAt })
        .where('id = :id AND ended_at IS NULL', { id: sessionId })
        .execute();
      if (!upd.affected) return;

      const recordRepo = m.getRepository(LearningRecord);
      await this.ensureRecordTx(m, session, regulation);
      // 行锁串行化聚合更新，防并发丢更新
      const record = await recordRepo
        .createQueryBuilder('lr')
        .setLock('pessimistic_write')
        .where('lr.user_id = :uid AND lr.regulation_id = :rid', { uid: session.userId, rid: session.regulationId })
        .getOne();
      if (!record) return;

      const dbCoverage = ScrollCoverageUtil.normalize(record.scrollCoverage, totalSegments);
      const sessionCoverage: ScrollCoverage = {
        total_segments: totalSegments,
        covered_count: 0,
        segments: segments || new Array(totalSegments).fill(0),
      };
      const merged = ScrollCoverageUtil.orMerge(dbCoverage, sessionCoverage);
      record.scrollCoverage = merged;
      record.totalSeconds += durationSeconds;
      record.maxScrollPercent = Math.max(record.maxScrollPercent, maxPercent);
      record.versionId = session.versionId;
      record.lastLearnAt = endedAt;

      // 有效学习双条件判定（同事务内幂等置位，is_valid 一旦置 1 永不回退，05 册 5.4.5）
      if (record.isValid !== 1 && regulation) {
        const timeOk = record.totalSeconds >= regulation.requiredMinutes * 60;
        const bottomOk = ScrollCoverageUtil.bottomCovered(merged);
        if (timeOk && bottomOk) {
          record.isValid = 1;
          record.validAt = endedAt;
          becameValid = true;
        }
      }
      await recordRepo.save(record);
    });

    // 事务提交后清理 Redis（会话键 + 活跃指针仍指向本会话时删除）
    await this.redis.del(this.sessionKey(sessionId));
    const activeId = await this.redis.get(this.activeKey(session.userId, session.regulationId));
    if (activeId === String(sessionId)) {
      await this.redis.del(this.activeKey(session.userId, session.regulationId));
    }
    // 达标事件按制度失效统计缓存（05 册 7.4.4）：完成率口径及时反映新达标
    if (becameValid) await this.statistics.invalidateRegulationCache(String(session.regulationId));
    return { durationSeconds };
  }

  private async ensureRecordTx(m: any, session: LearningSession, regulation: Regulation | null) {
    const recordRepo = m.getRepository(LearningRecord);
    const found = await recordRepo.findOne({ where: { userId: session.userId, regulationId: session.regulationId } });
    if (found) return found;
    return recordRepo.save(
      recordRepo.create({
        userId: session.userId,
        regulationId: session.regulationId,
        versionId: session.versionId,
        totalSeconds: 0,
        maxScrollPercent: 0,
        scrollCoverage: ScrollCoverageUtil.empty(regulation?.scrollSegments ?? 10),
        isValid: 0,
      }),
    );
  }

  /**
   * 兜底定时任务（触发器②③，每分钟调用）：扫描 ended_at IS NULL 且 started_at 早于阈值的会话：
   * Redis 缺失 → 按现状收口；active 且 90 秒无心跳 → 离线收口（+45 秒封顶）；
   * paused 超过 6 小时 → 收口；会话时长超过 5 小时 → 强制收口（防 Redis TTL 先到）。
   */
  async sweepStalledSessions() {
    const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
    const candidates = await this.sessionRepo.find({
      where: { endedAt: null as any, startedAt: LessThan(threshold) },
      take: 100,
      order: { id: 'ASC' },
    });
    for (const session of candidates) {
      try {
        const state = await this.readSessionState(session.id);
        const now = Date.now();
        if (!state) {
          // Redis 丢失（可再生临时态）：按库内现状收口，已落库数据零丢失（NFR-11）
          await this.flushSession(session.id, new Date(), null);
          continue;
        }
        const ageMs = now - new Date(session.startedAt).getTime();
        if (state.state === 'active' && now - state.last_beat_at > OFFLINE_THRESHOLD_MS) {
          await this.flushSession(session.id, new Date(), state); // 离线收口
        } else if (state.state === 'paused' && (state.paused_at === 0 || now - state.paused_at > 6 * 3600_000)) {
          await this.flushSession(session.id, new Date(), state); // 长时间暂停收口
        } else if (ageMs > 5 * 3600_000) {
          await this.flushSession(session.id, new Date(), state); // 会话超长强制收口（TTL 兜底）
        }
      } catch (e: any) {
        this.logger.warn(`兜底收口失败 session=${session.id}: ${e?.message}`);
      }
    }
  }

  /** 我的制度列表（GET /learning/regulations）：published + 范围内（管理员全部 published），附进度概览 */
  async myRegulations(userId: number) {
    const ctx = await this.userContext(userId);
    const isAdmin = ctx.role === 'super_admin' || ctx.role === 'regulation_admin';
    let regulations: Regulation[];
    if (isAdmin) {
      regulations = await this.regRepo.find({ where: { status: RegulationStatus.PUBLISHED }, order: { id: 'DESC' } });
    } else {
      const all = await this.regRepo.find({ where: { status: RegulationStatus.PUBLISHED }, order: { id: 'DESC' } });
      const inScope: Regulation[] = [];
      for (const r of all) {
        if (await this.scopeService.isUserInScope(r.id, { id: userId, role: ctx.role, departmentId: ctx.departmentId })) {
          inScope.push(r);
        }
      }
      regulations = inScope;
    }
    const records = await this.recordRepo.find({ where: { userId: String(userId) } });
    const recordMap = new Map(records.map((r) => [r.regulationId, r]));
    const activeSessionMap = new Map<string, string>();
    for (const r of regulations) {
      const activeId = await this.redis.get(this.activeKey(userId, r.id));
      if (activeId) activeSessionMap.set(r.id, activeId);
    }
    // 该员工范围内各制度的「是否存在已发布试卷」（真实查询，替代历史硬编码 true）
    const regIds = regulations.map((r) => r.id);
    const publishedPaperRegs = regIds.length
      ? new Set(
          (
            await this.paperRepo
              .createQueryBuilder('p')
              .select('DISTINCT p.regulation_id', 'rid')
              .where('p.regulation_id IN (:...rids)', { rids: regIds })
              .andWhere('p.status = :st', { st: 'published' })
              .getRawMany()
          ).map((row: { rid: string }) => String(row.rid)),
        )
      : new Set<string>();
    return {
      list: regulations.map((r) => {
        const record = recordMap.get(r.id);
        const coverage = record ? ScrollCoverageUtil.normalize(record.scrollCoverage, r.scrollSegments) : null;
        return {
          id: Number(r.id),
          title: r.title,
          category: r.category,
          description: r.description,
          required_minutes: r.requiredMinutes,
          scroll_segments: r.scrollSegments,
          has_published_paper: publishedPaperRegs.has(String(r.id)),
          learning: record
            ? {
                total_seconds: record.totalSeconds,
                required_seconds: r.requiredMinutes * 60,
                is_valid: record.isValid === 1,
                covered_count: coverage?.covered_count ?? 0,
                max_scroll_percent: record.maxScrollPercent,
                last_learn_at: record.lastLearnAt,
              }
            : null,
          active_session_id: activeSessionMap.has(r.id) ? Number(activeSessionMap.get(r.id)) : null,
        };
      }),
    };
  }

  /** 学习进度查询（GET /learning/records/{regulationId}）：仅本人（含差距信息，FR-LRN-06 验收①） */
  async progress(regulationId: string, userId: number) {
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');
    return this.progressView(regulation, userId, true);
  }
}
