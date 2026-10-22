import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Regulation } from '../../entities/regulation.entity';
import { RegulationScope } from '../../entities/regulation-scope.entity';
import { LearningRecord, ScrollCoverageUtil } from '../../entities/learning-record.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { SysDepartment } from '../../entities/sys-department.entity';
import { Errors, ExamStatus as ExamStatusEnum } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { GradingService } from '../exams/grading.service';

const TERMINAL_STATUSES = [ExamStatusEnum.SUBMITTED, ExamStatusEnum.PASSED, ExamStatusEnum.FAILED, ExamStatusEnum.TIMEOUT];

export interface UserExamStat {
  userId: string;
  bestScore: number;
  bestPaperId: string;
  passScoreOfBest: number;
  attempted: boolean;
}

/**
 * 统计口径服务（05 册 7.4.1，逐字实现）：
 * 应学集合（C-09：发布范围内 status=1 在职员工）；学习完成率分子分母同源；
 * 参考人数 = 非 in_progress 去重考生；通过率/平均分/分数分布按「每人最高分」口径（C-06），
 * 及格线取最高分所在试卷的 pass_score（「以最好成绩认定」语义）；个人维度一律不缓存（越权边界）。
 */
@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(Regulation) private readonly regRepo: Repository<Regulation>,
    @InjectRepository(RegulationScope) private readonly scopeRepo: Repository<RegulationScope>,
    @InjectRepository(LearningRecord) private readonly learningRepo: Repository<LearningRecord>,
    @InjectRepository(ExamRecord) private readonly examRepo: Repository<ExamRecord>,
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(SysDepartment) private readonly deptRepo: Repository<SysDepartment>,
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
  ) {}

  /** 制度维度统计（GET /statistics/regulations/{id}/overview 七项指标，Redis 缓存 TTL 5 分钟） */
  async regulationOverview(regulationId: string) {
    const cacheKey = `stat:reg:${regulationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch { /* 缓存损坏走直查 */ }
    }
    const result = await this.computeOverview(regulationId);
    await this.redis.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }

  async computeOverview(regulationId: string) {
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');
    // 应学集合（分母只计 status=1，C-09）
    const scope = await this.scopeRepo.find({ where: { regulationId } });
    const isAll = scope.some((s) => s.isAll === 1);
    let audience: SysUser[] = [];
    if (isAll) {
      audience = await this.userRepo.find({ where: { status: 1 } });
    } else {
      const deptIds = scope.map((s) => s.departmentId!).filter(Boolean);
      if (deptIds.length) {
        // 部门级范围：应用层树展开为含全部子部门的 id 集合（03 册 6.4 应学口径）
        const expanded = await this.expandDepartments(deptIds);
        audience = await this.userRepo
          .createQueryBuilder('u')
          .where('u.status = 1')
          .andWhere('u.department_id IN (:...depts)', { depts: Array.from(expanded) })
          .getMany();
      }
    }
    const audienceIds = new Set(audience.map((u) => u.id));

    // 学习完成率 = 应学集合中 is_valid=1 人数 ÷ 应学人数（分子分母同源，防 > 100%）
    const records = await this.learningRepo.find({ where: { regulationId } });
    const validCount = records.filter((r) => audienceIds.has(r.userId) && r.isValid === 1).length;
    const assignedCount = audience.length;
    const completionRate = assignedCount ? validCount / assignedCount : 0;

    // 考试指标（事实数据口径：status ≠ in_progress，排除进行中记录）
    const examRecords = await this.examRepo
      .createQueryBuilder('er')
      .where('er.regulation_id = :rid', { rid: regulationId })
      .andWhere('er.status <> :ip', { ip: ExamStatusEnum.IN_PROGRESS })
      .getMany();
    const participantIds = new Set(examRecords.map((r) => r.userId));

    // 每人最高分（跨试卷口径）+ 及格线取最高分所在试卷 pass_score（05 册 7.4.1）
    const papers = await this.paperRepo.find({ where: { regulationId } });
    const passScoreMap = new Map(papers.map((p) => [p.id, Number(p.passScore)]));
    const bestByUser = new Map<string, ExamRecord>();
    for (const r of examRecords) {
      if (r.score === null) continue;
      const cur = bestByUser.get(r.userId);
      if (!cur || Number(r.score) > Number(cur.score)) bestByUser.set(r.userId, r);
    }
    const passedIds: string[] = [];
    const bestScores: number[] = [];
    for (const [uid, rec] of bestByUser) {
      const score = Number(rec.score);
      bestScores.push(score);
      const passScore = passScoreMap.get(rec.paperId) ?? 60;
      if (score >= passScore) passedIds.push(uid);
    }
    const participantCount = participantIds.size;
    const passedCount = passedIds.length;
    const passRate = participantCount ? passedCount / participantCount : 0;
    const averageScore = bestScores.length ? Math.round((bestScores.reduce((a, b) => a + b, 0) / bestScores.length) * 100) / 100 : 0;
    const distribution: Record<string, number> = {
      '[0,60)': 0, '[60,70)': 0, '[70,80)': 0, '[80,90)': 0, '[90,100]': 0,
    };
    for (const s of bestScores) {
      // 复用判分侧同一分桶实现，保证统计口径与 core-algorithms 单测一致
      distribution[GradingService.distributionBucket(s)]++;
    }

    return {
      regulation_id: Number(regulationId),
      title: regulation.title,
      required_minutes: regulation.requiredMinutes,
      assigned_count: assignedCount,
      learning: {
        valid_count: validCount,
        completion_rate: Math.round(completionRate * 1000) / 1000,
      },
      exam: {
        participant_count: participantCount,
        participation_rate: assignedCount ? Math.round((participantCount / assignedCount) * 1000) / 1000 : 0,
        passed_count: passedCount,
        pass_rate: Math.round(passRate * 1000) / 1000,
        average_score: averageScore,
        score_distribution: distribution,
      },
      uncompleted_count: assignedCount - validCount,
    };
  }

  /** 部门维度对比（GET /statistics/regulations/{id}/departments）：应学集合按 department_id 切片 */
  async departmentBreakdown(regulationId: string) {
    const overview = await this.computeOverview(regulationId);
    const scope = await this.scopeRepo.find({ where: { regulationId } });
    const isAll = scope.some((s) => s.isAll === 1);
    const deptIds = scope.map((s) => s.departmentId!).filter(Boolean);
    const expanded = isAll ? null : deptIds.length ? await this.expandDepartments(deptIds) : new Set<string>();

    const audience = await this.userRepo.find({ where: { status: 1 } });
    const inScope = audience.filter((u) => (expanded ? expanded.has(u.departmentId || '') : true));
    const records = await this.learningRepo.find({ where: { regulationId } });
    const validUserIds = new Set(records.filter((r) => r.isValid === 1).map((r) => r.userId));
    const examRecords = await this.examRepo
      .createQueryBuilder('er')
      .where('er.regulation_id = :rid', { rid: regulationId })
      .andWhere('er.status <> :ip', { ip: ExamStatusEnum.IN_PROGRESS })
      .getMany();
    const papers = await this.paperRepo.find({ where: { regulationId } });
    const passScoreMap = new Map(papers.map((p) => [p.id, Number(p.passScore)]));
    const bestByUser = new Map<string, ExamRecord>();
    for (const r of examRecords) {
      if (r.score === null) continue;
      const cur = bestByUser.get(r.userId);
      if (!cur || Number(r.score) > Number(cur.score)) bestByUser.set(r.userId, r);
    }

    // 按部门切片聚合（部门树父级汇总 = 子树员工聚合，05 册 7.4.2）
    const byDept = new Map<string, { assigned: number; valid: number; participants: Set<string>; passed: number; scores: number[] }>();
    for (const u of inScope) {
      const key = u.departmentId || '0';
      if (!byDept.has(key)) byDept.set(key, { assigned: 0, valid: 0, participants: new Set(), passed: 0, scores: [] });
      const agg = byDept.get(key)!;
      agg.assigned++;
      if (validUserIds.has(u.id)) agg.valid++;
      const best = bestByUser.get(u.id);
      if (best) {
        agg.participants.add(u.id);
        agg.scores.push(Number(best.score));
        if (Number(best.score) >= (passScoreMap.get(best.paperId) ?? 60)) agg.passed++;
      }
    }
    const deptRows = await this.deptRepo.find();
    const deptMap = new Map(deptRows.map((d) => [d.id, d]));
    const list = Array.from(byDept.entries()).map(([deptId, agg]) => {
      const dept = deptMap.get(deptId);
      return {
        department_id: Number(deptId) || null,
        department_name: dept?.name || '未分配部门',
        assigned_count: agg.assigned,
        valid_count: agg.valid,
        completion_rate: agg.assigned ? Math.round((agg.valid / agg.assigned) * 1000) / 1000 : 0,
        participant_count: agg.participants.size,
        passed_count: agg.passed,
        pass_rate: agg.participants.size ? Math.round((agg.passed / agg.participants.size) * 1000) / 1000 : 0,
        average_score: agg.scores.length ? Math.round((agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length) * 100) / 100 : 0,
      };
    });
    list.sort((a, b) => b.assigned_count - a.assigned_count);
    void overview;
    return { list };
  }

  /** 未完成人员清单（GET /statistics/regulations/{id}/uncompleted）：未达标 + 考试未通过/未参考（FR-STT-04） */
  async uncompletedList(regulationId: string) {
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');
    const scope = await this.scopeRepo.find({ where: { regulationId } });
    const isAll = scope.some((s) => s.isAll === 1);
    const deptIds = scope.map((s) => s.departmentId!).filter(Boolean);
    const expanded = isAll ? null : deptIds.length ? await this.expandDepartments(deptIds) : new Set<string>();
    const audience = await this.userRepo.find({ where: { status: 1 } });
    const inScope = audience.filter((u) => (expanded ? expanded.has(u.departmentId || '') : true));

    const records = await this.learningRepo.find({ where: { regulationId } });
    const recordMap = new Map(records.map((r) => [r.userId, r]));
    const papers = await this.paperRepo.find({ where: { regulationId } });
    const paperIds = papers.map((p) => p.id);
    const examRecords = paperIds.length
      ? await this.examRepo
          .createQueryBuilder('er')
          .where('er.paper_id IN (:...pids)', { pids: paperIds })
          .andWhere('er.status <> :ip', { ip: ExamStatusEnum.IN_PROGRESS })
          .getMany()
      : [];
    const passScoreMap = new Map(papers.map((p) => [p.id, Number(p.passScore)]));
    const bestByUser = new Map<string, ExamRecord>();
    for (const r of examRecords) {
      if (r.score === null) continue;
      const cur = bestByUser.get(r.userId);
      if (!cur || Number(r.score) > Number(cur.score)) bestByUser.set(r.userId, r);
    }

    const deptRows = await this.deptRepo.find();
    const deptMap = new Map(deptRows.map((d) => [d.id, d.name]));
    const requiredSeconds = regulation.requiredMinutes * 60;
    const list = inScope.map((u) => {
      const record = recordMap.get(u.id) || null;
      const coverage = record ? ScrollCoverageUtil.normalize(record.scrollCoverage, regulation.scrollSegments) : ScrollCoverageUtil.empty(regulation.scrollSegments);
      const totalSeconds = record?.totalSeconds ?? 0;
      const isValid = record?.isValid === 1;
      const best = bestByUser.get(u.id) || null;
      const bestScore = best ? Number(best.score) : null;
      const examPassed = best ? bestScore! >= (passScoreMap.get(best.paperId) ?? 60) : false;

      let type: string;
      let reason: string;
      if (!isValid) {
        type = '学习未达标';
        const gaps: string[] = [];
        if (totalSeconds < requiredSeconds) gaps.push(`剩余有效时长缺口 ${Math.max(0, requiredSeconds - totalSeconds)} 秒`);
        if (!ScrollCoverageUtil.bottomCovered(coverage)) gaps.push('底部段未覆盖');
        reason = gaps.join('；');
      } else if (!best) {
        type = '未参考';
        reason = '有效学习已达标，尚未参加考试';
      } else if (!examPassed) {
        type = '考试未通过';
        reason = `历次最高分 ${bestScore}，未达及格线 ${passScoreMap.get(best.paperId) ?? 60}`;
      } else {
        return null; // 已完成（学习达标 + 考试通过），不属于未完成人员
      }
      return {
        user_id: Number(u.id),
        real_name: u.realName,
        username: u.username,
        employee_no: u.employeeNo,
        department_name: u.departmentId ? deptMap.get(u.departmentId) || '' : '未分配部门',
        type,
        total_seconds: totalSeconds,
        required_seconds: requiredSeconds,
        remaining_seconds: Math.max(0, requiredSeconds - totalSeconds),
        covered_count: coverage.covered_count,
        total_segments: coverage.total_segments,
        bottom_segment_covered: ScrollCoverageUtil.bottomCovered(coverage),
        is_valid: isValid,
        best_score: bestScore,
        exam_status: best ? best.status : null,
        reason,
      };
    });
    return { list: list.filter(Boolean) };
  }

  /** 个人维度（GET /statistics/users/{id}）：学习记录 + 考试成绩（employee 仅本人，数据范围收口） */
  async personal(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw Errors.notFound('员工不存在');
    const learningRows = await this.learningRepo.find({ where: { userId } });
    const regIds = learningRows.map((r) => r.regulationId);
    const regs = regIds.length ? await this.regRepo.find({ where: { id: In(regIds) } }) : [];
    const regMap = new Map(regs.map((r) => [r.id, r]));
    const learning = learningRows.map((r) => {
      const reg = regMap.get(r.regulationId);
      const coverage = ScrollCoverageUtil.normalize(r.scrollCoverage, reg?.scrollSegments ?? 10);
      return {
        regulation_id: Number(r.regulationId),
        regulation_title: reg?.title || '',
        total_seconds: r.totalSeconds,
        required_seconds: (reg?.requiredMinutes ?? 0) * 60,
        covered_count: coverage.covered_count,
        total_segments: coverage.total_segments,
        max_scroll_percent: r.maxScrollPercent,
        is_valid: r.isValid === 1,
        valid_at: r.validAt,
        last_learn_at: r.lastLearnAt,
      };
    });

    const examRows = await this.examRepo.find({ where: { userId }, order: { id: 'ASC' } });
    const paperIds = Array.from(new Set(examRows.map((r) => r.paperId)));
    const papers = paperIds.length ? await this.paperRepo.find({ where: { id: In(paperIds) } }) : [];
    const paperMap = new Map(papers.map((p) => [p.id, p]));
    const byPaper = new Map<string, typeof examRows>();
    for (const r of examRows) {
      if (!byPaper.has(r.paperId)) byPaper.set(r.paperId, []);
      byPaper.get(r.paperId)!.push(r);
    }
    const exams = Array.from(byPaper.entries()).map(([paperId, rows]) => {
      const finished = rows.filter((r) => r.status !== ExamStatusEnum.IN_PROGRESS && r.score !== null);
      const best = finished.length ? Math.max(...finished.map((r) => Number(r.score))) : null;
      return {
        paper_id: Number(paperId),
        paper_title: paperMap.get(paperId)?.title || '',
        attempts: rows.length,
        best_score: best,
        has_passed: rows.some((r) => r.status === ExamStatusEnum.PASSED),
        records: rows.map((r) => ({
          id: Number(r.id),
          attempt_no: r.attemptNo,
          status: r.status,
          score: r.score === null ? null : Number(r.score),
          started_at: r.startedAt,
          submitted_at: r.submittedAt,
        })),
      };
    });
    return {
      user: {
        id: Number(user.id),
        username: user.username,
        real_name: user.realName,
        employee_no: user.employeeNo,
        department_id: user.departmentId ? Number(user.departmentId) : null,
        role: user.role,
      },
      learning,
      exams,
    };
  }

  /** 全部制度概览列表（GET /statistics/regulations） */
  async allRegulationsOverview() {
    const regs = await this.regRepo.find({ order: { id: 'DESC' } });
    const list: Record<string, unknown>[] = [];
    for (const r of regs) {
      const o = await this.computeOverview(r.id);
      list.push({ ...o, status: r.status, category: r.category });
    }
    return { list };
  }

  /** 个人维度明细行（Excel 导出 user_detail，05 册 7.4.3 列定义） */
  async regulationUserDetails(regulationId: string) {
    const regulation = await this.regRepo.findOne({ where: { id: regulationId } });
    if (!regulation) throw Errors.notFound('制度不存在');
    const scope = await this.scopeRepo.find({ where: { regulationId } });
    const isAll = scope.some((s) => s.isAll === 1);
    const deptIds = scope.map((s) => s.departmentId!).filter(Boolean);
    const expanded = isAll ? null : deptIds.length ? await this.expandDepartments(deptIds) : new Set<string>();
    const audience = await this.userRepo.find({ where: { status: 1 } });
    const inScope = audience.filter((u) => (expanded ? expanded.has(u.departmentId || '') : true));
    const deptNames = await this.departmentNames();
    const records = await this.learningRepo.find({ where: { regulationId } });
    const recordMap = new Map(records.map((r) => [r.userId, r]));
    const papers = await this.paperRepo.find({ where: { regulationId } });
    const paperIds = papers.map((p) => p.id);
    const examRows = paperIds.length
      ? await this.examRepo.createQueryBuilder('er')
          .where('er.paper_id IN (:...pids)', { pids: paperIds })
          .getMany()
      : [];
    const paperMap = new Map(papers.map((p) => [p.id, p]));
    const byUserPaper = new Map<string, Map<string, ExamRecord[]>>();
    for (const r of examRows) {
      if (!byUserPaper.has(r.userId)) byUserPaper.set(r.userId, new Map());
      const byPaper = byUserPaper.get(r.userId)!;
      if (!byPaper.has(r.paperId)) byPaper.set(r.paperId, []);
      byPaper.get(r.paperId)!.push(r);
    }
    return inScope.map((u) => {
      const record = recordMap.get(u.id);
      const coverage = record ? ScrollCoverageUtil.normalize(record.scrollCoverage, regulation.scrollSegments) : ScrollCoverageUtil.empty(regulation.scrollSegments);
      const papersOfUser = Array.from(byUserPaper.get(u.id)?.entries() || []);
      const bestScores = papersOfUser.flatMap(([, rows]) => rows.filter((r) => r.score !== null && r.status !== ExamStatusEnum.IN_PROGRESS).map((r) => Number(r.score)));
      const best = bestScores.length ? Math.max(...bestScores) : null;
      const bestRows = papersOfUser.flatMap(([, rows]) => rows).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      const bestRow = bestRows[0] || null;
      return {
        name: u.realName,
        eno: u.employeeNo || '',
        dept: u.departmentId ? deptNames.get(u.departmentId) || '' : '未分配部门',
        reg: regulation.title,
        total: record?.totalSeconds ?? 0,
        covered: `${coverage.covered_count}/${coverage.total_segments}`,
        valid: record?.isValid === 1 ? '达标' : '未达标',
        paper: bestRow ? paperMap.get(bestRow.paperId)?.title || '' : '',
        attempts: papersOfUser.reduce((a, [, rows]) => a + rows.length, 0),
        best: best ?? '—',
        status: bestRow?.status || '未参考',
      };
    });
  }

  private async expandDepartments(deptIds: string[]): Promise<Set<string>> {
    const rows = await this.deptRepo.find();
    const byParent = new Map<string, string[]>();
    for (const d of rows) {
      if (d.parentId) {
        if (!byParent.has(d.parentId)) byParent.set(d.parentId, []);
        byParent.get(d.parentId)!.push(d.id);
      }
    }
    const result = new Set<string>();
    const stack = [...deptIds];
    while (stack.length) {
      const cur = stack.pop()!;
      if (result.has(cur)) continue;
      result.add(cur);
      for (const child of byParent.get(cur) || []) stack.push(child);
    }
    return result;
  }

  /** 统计缓存主动失效（交卷/达标事件按 regulation_id 前缀批量失效，05 册 7.4.4） */
  async invalidateRegulationCache(regulationId: string) {
    await this.redis.delByPrefix(`stat:reg:${regulationId}`);
    await this.redis.delByPrefix(`stat:dept:${regulationId}:`);
  }

  async invalidateAllStatistics() {
    await this.redis.delByPrefix('stat:reg:');
    await this.redis.delByPrefix('stat:dept:');
  }

  /** 部门名称映射（Excel 导出用） */
  async departmentNames(): Promise<Map<string, string>> {
    const rows = await this.deptRepo.find();
    return new Map(rows.map((d) => [d.id, d.name]));
  }

  static TERMINAL_STATUSES = TERMINAL_STATUSES;
}
