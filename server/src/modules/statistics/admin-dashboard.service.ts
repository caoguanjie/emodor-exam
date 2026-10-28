import { Injectable } from '@nestjs/common';
import { DataSource, In, SelectQueryBuilder } from 'typeorm';
import { Errors } from '../../common/errors';
import type { AdminDashboard, DashboardExamTrend, DashboardLearningOptions, DashboardLearningSummary, DashboardRecentExams, RuleSnapshot } from '../../common/training-contracts';
import { ExamRecord } from '../../entities/exam-record.entity';
import { AccessService } from '../access/access.service';
import { applyVisibleExamRecordScope } from '../exams/exam-record-visibility';
import { examPurposeOf } from '../exams/exam-purpose';
import { getEffectiveLearningVersionIds } from '../exams/paper-learning';
import { dashboardDates, dashboardPeriod } from './dashboard-time';
import { statisticsRecordView, summarizeReleaseRecords } from './ranking';

// JSON_TABLE keeps malformed historical requirements out before pagination.
const LEARNING_CANDIDATE_FROM = `FROM exam_paper paper
  INNER JOIN paper_release publication ON publication.paper_id = paper.id
    AND publication.version_no = (SELECT MAX(latest.version_no) FROM paper_release latest WHERE latest.paper_id = paper.id)
  WHERE paper.business_scope = 'training' AND paper.status = 'published'
    AND paper.exam_purpose = 'formal' AND publication.exam_purpose = 'formal'
    AND publication.business_scope = 'training' AND publication.requires_learning = 1
    AND publication.required_learning_minutes BETWEEN 1 AND 2147483647
    AND JSON_TYPE(publication.course_ids) = 'ARRAY' AND JSON_LENGTH(publication.course_ids) > 0
    AND NOT EXISTS (
      SELECT 1 FROM JSON_TABLE(publication.course_ids, '$[*]' COLUMNS (
        ordinal FOR ORDINALITY, course_id VARCHAR(255) PATH '$' NULL ON EMPTY NULL ON ERROR
      )) course_item
      WHERE course_item.course_id IS NULL OR course_item.course_id NOT REGEXP '^[1-9][0-9]*$'
        OR JSON_TYPE(JSON_EXTRACT(publication.course_ids, CONCAT('$[', course_item.ordinal - 1, ']'))) <> 'STRING'
    )
    AND JSON_LENGTH(publication.course_ids) = (
      SELECT COUNT(DISTINCT course_item.course_id) FROM JSON_TABLE(publication.course_ids, '$[*]' COLUMNS (
        course_id VARCHAR(255) PATH '$' NULL ON EMPTY NULL ON ERROR
      )) course_item
    )`;

function courseIds(value: unknown): string[] | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!Array.isArray(parsed) || !parsed.length
    || parsed.some(item => typeof item !== 'string' || !/^[1-9]\d*$/.test(item))
    || new Set(parsed).size !== parsed.length) return null;
  return parsed;
}

function requireId(value: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw Errors.param('ID必须是正整数字符串');
  return value;
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly dataSource: DataSource, private readonly access: AccessService) {}

  private async assertStatistics(actorId: string): Promise<void> {
    if (!(await this.access.permissions(String(actorId))).includes('statistics:read')) throw Errors.forbidden();
  }

  private async queryRecords(query: SelectQueryBuilder<ExamRecord>): Promise<Record<string, any>[]> {
    const [sql, parameters] = query.getQueryAndParameters();
    return this.dataSource.manager.query(sql, parameters);
  }

  async overview(actorId: string, now = new Date()): Promise<AdminDashboard> {
    const permissions = new Set(await this.access.permissions(String(actorId)));
    const today = dashboardPeriod(now, 1);
    const week = dashboardPeriod(now, 7);
    const metrics: AdminDashboard['metrics'] = {};
    const response: AdminDashboard = {
      as_of: now.toISOString(), timezone: 'Asia/Shanghai',
      periods: {
        today: { date_from: today.date_from, date_to: today.date_to },
        last_7_days: { date_from: week.date_from, date_to: week.date_to },
      },
      metrics,
    };
    const manager = this.dataSource.manager;
    const tasks: Promise<void>[] = [];
    const aggregate = async (sql: string, keys: Array<keyof typeof metrics>) => {
      const [row] = await manager.query(sql);
      for (const key of keys) metrics[key] = Number(row?.[key] || 0);
    };
    if (permissions.has('students:read')) tasks.push(aggregate(`
      SELECT COUNT(*) AS learner_count,
        COALESCE(SUM(source = 'institution'), 0) AS learner_institution_count,
        COALESCE(SUM(source = 'external'), 0) AS learner_external_count,
        COALESCE(SUM(source IS NULL OR source NOT IN ('institution', 'external')), 0) AS learner_unknown_source_count
      FROM sys_user learner WHERE learner.role = 'employee' AND learner.status = 1
        AND NOT EXISTS (SELECT 1 FROM sys_user_role role_link WHERE role_link.user_id = learner.id)
    `, ['learner_count', 'learner_institution_count', 'learner_external_count', 'learner_unknown_source_count']));
    if (permissions.has('questions:read')) tasks.push(aggregate(`
      SELECT COUNT(*) AS question_count, COALESCE(SUM(is_enabled = 1), 0) AS enabled_question_count
      FROM question WHERE deleted_at IS NULL
    `, ['question_count', 'enabled_question_count']));
    if (permissions.has('papers:read')) tasks.push(aggregate(`
      SELECT COUNT(*) AS paper_count, COALESCE(SUM(status = 'published'), 0) AS published_paper_count
      FROM exam_paper WHERE business_scope = 'training' AND exam_purpose = 'formal'
    `, ['paper_count', 'published_paper_count']));
    if (permissions.has('statistics:read')) tasks.push((async () => {
      const query = applyVisibleExamRecordScope(manager.getRepository(ExamRecord).createQueryBuilder('record'))
        .select('COUNT(DISTINCT CASE WHEN record.started_at >= :todayStart THEN record.user_id END)', 'today_participant_count')
        .addSelect('COUNT(CASE WHEN record.started_at >= :todayStart THEN 1 END)', 'today_attempt_count')
        .addSelect('COUNT(DISTINCT record.user_id)', 'last_7_days_participant_count')
        .addSelect('COUNT(*)', 'last_7_days_attempt_count')
        .andWhere('record.examPurpose = :examPurpose', { examPurpose: 'formal' })
        .andWhere('record.started_at >= :periodStart', { periodStart: week.startUtc })
        .andWhere('record.started_at < :periodEnd', { periodEnd: week.endUtc })
        .setParameter('todayStart', today.startUtc);
      const [row] = await this.queryRecords(query);
      for (const key of ['today_participant_count', 'today_attempt_count', 'last_7_days_participant_count', 'last_7_days_attempt_count'] as const) {
        metrics[key] = Number(row?.[key] || 0);
      }
      // Compatibility: raw starts, including historical statuses, remain the old seven-day metric.
      const legacyRows = await manager.query(`SELECT
        DATE_FORMAT(DATE_ADD(started_at, INTERVAL 8 HOUR), '%Y-%m-%d') AS date, COUNT(*) AS count
        FROM exam_record WHERE exam_purpose = 'formal' AND started_at >= ? GROUP BY date`, [week.startUtc]);
      const counts = new Map<string, number>(legacyRows.map(row => [String(row.date), Number(row.count)]));
      response.exam_trend = dashboardDates(week.date_from, 7).map(date => ({ date, count: counts.get(date) || 0 }));
    })());
    await Promise.all(tasks);
    return response;
  }

  async examTrend(actorId: string, days: 7 | 30, now = new Date()): Promise<DashboardExamTrend> {
    await this.assertStatistics(actorId);
    if (days !== 7 && days !== 30) throw Errors.param('days必须为7或30');
    const period = dashboardPeriod(now, days);
    const date = "DATE_FORMAT(DATE_ADD(record.started_at, INTERVAL 8 HOUR), '%Y-%m-%d')";
    const first = applyVisibleExamRecordScope(this.dataSource.manager.getRepository(ExamRecord).createQueryBuilder('record'))
      .select(date, 'date')
      .addSelect('record.source', 'source')
      .addSelect(`ROW_NUMBER() OVER (PARTITION BY ${date}, record.user_id ORDER BY record.started_at ASC, record.id ASC)`, 'ordinal')
      .andWhere('record.examPurpose = :examPurpose', { examPurpose: 'formal' })
      .andWhere('record.started_at >= :periodStart', { periodStart: period.startUtc })
      .andWhere('record.started_at < :periodEnd', { periodEnd: period.endUtc });
    const [firstSql, parameters] = first.getQueryAndParameters();
    const rows = await this.dataSource.manager.query(`SELECT first_record.date AS date,
      COUNT(*) AS participant_count,
      SUM(first_record.source = 'institution') AS institution_count,
      SUM(first_record.source = 'external') AS external_count,
      SUM(first_record.source IS NULL OR first_record.source NOT IN ('institution', 'external')) AS unknown_source_count
      FROM (${firstSql}) first_record WHERE first_record.ordinal = 1 GROUP BY first_record.date`, parameters);
    const byDate = new Map<string, Record<string, any>>(rows.map(row => [String(row.date), row]));
    return {
      as_of: now.toISOString(), timezone: 'Asia/Shanghai', days,
      date_from: period.date_from, date_to: period.date_to,
      points: dashboardDates(period.date_from, days).map(date => {
        const row = byDate.get(date);
        return { date, participant_count: Number(row?.participant_count || 0),
          institution_count: Number(row?.institution_count || 0), external_count: Number(row?.external_count || 0),
          unknown_source_count: Number(row?.unknown_source_count || 0) };
      }),
    };
  }

  async learningOptions(actorId: string, filter: { keyword?: string; page?: number; pageSize?: number }): Promise<DashboardLearningOptions> {
    await this.assertStatistics(actorId);
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
      || !Number.isSafeInteger((page - 1) * pageSize)
      || filter.keyword !== undefined && (typeof filter.keyword !== 'string' || filter.keyword.length > 128)) {
      throw Errors.param('培训候选查询参数不合法');
    }
    const now = new Date();
    const keyword = filter.keyword?.trim();
    const from = LEARNING_CANDIDATE_FROM + (keyword ? ' AND paper.title LIKE ?' : '');
    const parameters = keyword ? [`%${keyword}%`] : [];
    const [[count], rows] = await Promise.all([
      this.dataSource.manager.query(`SELECT COUNT(*) AS total ${from}`, parameters),
      this.dataSource.manager.query(`SELECT paper.id AS paper_id, paper.title, publication.id AS release_id,
        publication.released_at, publication.required_learning_minutes ${from}
        ORDER BY publication.released_at DESC, publication.id DESC LIMIT ? OFFSET ?`, [...parameters, pageSize, (page - 1) * pageSize]),
    ]);
    return {
      as_of: now.toISOString(), items: rows.map(row => ({
        paper_id: String(row.paper_id), title: row.title, release_id: String(row.release_id),
        released_at: new Date(row.released_at).toISOString(), required_learning_minutes: Number(row.required_learning_minutes),
      })), total: Number(count?.total || 0), page, page_size: pageSize,
    };
  }

  async learningSummary(actorId: string, paperId: string, releaseId: string): Promise<DashboardLearningSummary> {
    await this.assertStatistics(actorId);
    requireId(paperId);
    requireId(releaseId);
    const now = new Date();
    return this.dataSource.transaction('REPEATABLE READ', async manager => {
      const [release] = await manager.query(`SELECT paper.id AS paper_id, paper.title, paper.status,
        paper.business_scope AS paper_scope, paper.exam_purpose AS paper_purpose, publication.exam_purpose AS release_purpose, publication.id AS release_id, publication.paper_id AS release_paper_id,
        publication.business_scope AS release_scope, publication.version_no, publication.category_id,
        publication.requires_learning, publication.required_learning_minutes, publication.course_ids, publication.released_at,
        (SELECT MAX(latest.version_no) FROM paper_release latest WHERE latest.paper_id = paper.id) AS latest_version_no
        FROM exam_paper paper LEFT JOIN paper_release publication ON publication.id = ? AND publication.paper_id = paper.id
        WHERE paper.id = ? AND paper.exam_purpose = 'formal' AND publication.exam_purpose = 'formal'`, [releaseId, paperId]);
      if (!release || release.paper_scope !== 'training' || examPurposeOf(release.paper_purpose) !== 'formal' || examPurposeOf(release.release_purpose) !== 'formal' || !release.release_id
        || String(release.release_paper_id) !== paperId) throw Errors.notFound('培训或发布版本不存在');
      const selectedCourseIds = courseIds(release.course_ids);
      const minutes = Number(release.required_learning_minutes);
      if (release.status !== 'published' || release.release_scope !== 'training'
        || Number(release.version_no) !== Number(release.latest_version_no)
        || Number(release.requires_learning) !== 1 || !Number.isInteger(minutes) || minutes < 1 || minutes > 2147483647
        || !selectedCourseIds) throw Errors.paperReleaseConflict('培训要求已更新，请重新选择');
      const versions = await getEffectiveLearningVersionIds(manager, selectedCourseIds);
      const credited = versions.length ? 'COALESCE(progress.credited_ms, 0)' : '0';
      const join = versions.length ? `LEFT JOIN (
        SELECT video.user_id, SUM(video.credited_ms) AS credited_ms FROM video_learning_record video
        WHERE video.lesson_version_id IN (${versions.map(() => '?').join(',')}) GROUP BY video.user_id
      ) progress ON progress.user_id = learner.id` : '';
      const [counts] = await manager.query(`SELECT COUNT(*) AS eligible_count,
        COALESCE(SUM(CASE WHEN ${credited} >= CAST(? AS DECIMAL(30,0)) THEN 1 ELSE 0 END), 0) AS achieved_count
        FROM sys_user learner ${join}
        WHERE learner.role = 'employee' AND learner.status = 1 AND learner.category_id = ?
          AND learner.source IN ('institution', 'external')
          AND NOT EXISTS (SELECT 1 FROM sys_user_role role_link WHERE role_link.user_id = learner.id)`,
      [(BigInt(minutes) * 60000n).toString(), ...versions, release.category_id]);
      const eligible = Number(counts?.eligible_count || 0);
      const achieved = Number(counts?.achieved_count || 0);
      return {
        as_of: now.toISOString(), state: eligible ? 'ready' : 'no_audience',
        paper_id: String(release.paper_id), title: release.title, release_id: String(release.release_id),
        released_at: new Date(release.released_at).toISOString(), required_learning_minutes: minutes,
        eligible_count: eligible, achieved_count: achieved, pending_count: eligible - achieved,
        achievement_rate: eligible ? Math.round(achieved / eligible * 10000) / 10000 : null,
      };
    });
  }

  async recentExams(actorId: string): Promise<DashboardRecentExams> {
    await this.assertStatistics(actorId);
    const now = new Date();
    const manager = this.dataSource.manager;
    const exams = await manager.query(`SELECT paper.id AS paper_id, paper.title, paper.status,
      publication.id AS release_id, publication.pool_scope, publication.category_id, publication.rule_snapshot, publication.released_at
      FROM exam_paper paper INNER JOIN paper_release publication ON publication.paper_id = paper.id
        AND publication.version_no = (SELECT MAX(latest.version_no) FROM paper_release latest WHERE latest.paper_id = paper.id)
      WHERE paper.business_scope = 'training' AND paper.exam_purpose = 'formal' AND publication.exam_purpose = 'formal'
      ORDER BY publication.released_at DESC, publication.id DESC LIMIT 4`);
    if (!exams.length) return { as_of: now.toISOString(), limit: 4, items: [] };
    const releaseIds = exams.map(row => String(row.release_id));
    const categoryIds = [...new Set<string>(exams.filter(row => row.category_id != null).map(row => String(row.category_id)))];
    const [rawRecords, categories] = await Promise.all([
      manager.getRepository(ExamRecord).find({
        where: { releaseId: In(releaseIds), examPurpose: 'formal' },
        select: ['id', 'examPurpose', 'paperId', 'releaseId', 'userId', 'categoryId', 'source', 'difficulty', 'ruleSnapshot',
          'status', 'gradingState', 'score', 'startedAt', 'submittedAt', 'deadlineAt', 'submissionMethod', 'gradedAt'],
      }),
      categoryIds.length ? manager.query(`SELECT id, name FROM training_category WHERE id IN (${categoryIds.map(() => '?').join(',')})`, categoryIds)
        : Promise.resolve([]),
    ]);
    const records = rawRecords.filter(row => examPurposeOf(row.examPurpose) === 'formal').map(statisticsRecordView);
    const names = new Map<string, string>(categories.map(row => [String(row.id), row.name]));
    return {
      as_of: now.toISOString(), limit: 4,
      items: exams.map(row => {
        const rule: RuleSnapshot | null = typeof row.rule_snapshot === 'string' ? JSON.parse(row.rule_snapshot) : row.rule_snapshot || null;
        const releaseId = String(row.release_id);
        const categoryId = row.category_id != null ? String(row.category_id) : null;
        const poolScope = row.pool_scope === 'public' ? 'public' : 'category';
        return {
          paper_id: String(row.paper_id), title: row.title, pool_scope: poolScope, category_id: categoryId,
          category_name: poolScope === 'public' ? '公共题库' : categoryId ? names.get(categoryId) || null : null, status: row.status, release_id: releaseId,
          total_score: rule ? Number(rule.totalCents) / 100 : null,
          duration_minutes: rule ? Number(rule.durationMinutes) : null,
          pass_score: rule ? Number(rule.passCents) / 100 : null,
          ...summarizeReleaseRecords(records, releaseId, rule), released_at: new Date(row.released_at).toISOString(),
        };
      }),
    };
  }
}
