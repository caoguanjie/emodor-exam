import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import type {
  AdminDashboard, ExamDifficulty, LearnerSource, Page, RankRow, RuleSnapshot, StatsFilter,
  TrainingExamSummary, TrainingStatisticsOptions, TrainingUncompletedReason,
} from '../../common/training-contracts';
import { CourseLesson } from '../../entities/course-lesson.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { PaperReleaseQuestion } from '../../entities/paper-release-question.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { Question } from '../../entities/question.entity';
import { SysUserRole } from '../../entities/sys-user-role.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { TrainingCourse } from '../../entities/training-course.entity';
import { VideoLearningRecord } from '../../entities/video-learning-record.entity';
import { AccessService } from '../access/access.service';
import {
  buildDashboardTrend, buildExamSummary, buildRankingRows, computeCourseCompletion,
  ruleKey, type StatisticsRecord,
} from './ranking';

const DIFFICULTIES: ExamDifficulty[] = ['easy', 'medium', 'hard', 'mixed', 'unknown'];

function id(value: unknown, label: string): string {
  const text = String(value || '');
  if (!/^[1-9]\d*$/.test(text)) throw Errors.param(`${label}不合法`);
  return text;
}

function difficulty(value: unknown): ExamDifficulty {
  const text = String(value || 'unknown') as ExamDifficulty;
  return DIFFICULTIES.includes(text) ? text : 'unknown';
}

function asDate(value: Date | string | null | undefined, fallback?: Date): Date {
  if (!value) return fallback ? new Date(fallback) : new Date(0);
  return value instanceof Date ? value : new Date(value);
}

function recordView(row: ExamRecord): StatisticsRecord {
  return {
    id: String(row.id), paperId: String(row.paperId), releaseId: row.releaseId ? String(row.releaseId) : null,
    userId: String(row.userId), categoryId: row.categoryId ? String(row.categoryId) : null,
    source: row.source || null, difficulty: difficulty(row.difficulty), ruleSnapshot: row.ruleSnapshot || null,
    status: row.status, gradingState: row.gradingState, score: row.score === null ? null : Number(row.score),
    startedAt: asDate(row.startedAt), submittedAt: row.submittedAt ? asDate(row.submittedAt) : null,
    deadlineAt: asDate(row.deadlineAt, row.startedAt), submissionMethod: row.submissionMethod,
    gradedAt: row.gradedAt ? asDate(row.gradedAt) : null,
  };
}

function shanghaiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

@Injectable()
export class TrainingStatisticsService {
  constructor(
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(PaperRelease) private readonly releaseRepo: Repository<PaperRelease>,
    @InjectRepository(PaperReleaseQuestion) private readonly releaseQuestionRepo: Repository<PaperReleaseQuestion>,
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(SysUserRole) private readonly userRoleRepo: Repository<SysUserRole>,
    @InjectRepository(TrainingCourse) private readonly courseRepo: Repository<TrainingCourse>,
    @InjectRepository(CourseLesson) private readonly lessonRepo: Repository<CourseLesson>,
    @InjectRepository(VideoLearningRecord) private readonly videoRepo: Repository<VideoLearningRecord>,
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    @InjectRepository(TrainingCategory) private readonly categoryRepo: Repository<TrainingCategory>,
    private readonly access: AccessService,
  ) {}

  private expectedDifficulty(
    paper: ExamPaper,
    release: PaperRelease | null,
    fixedDifficulty: ExamDifficulty,
    source: LearnerSource | null,
  ): ExamDifficulty {
    if (paper.businessScope !== 'training') return 'unknown';
    const mode = release?.mode || paper.mode;
    if (mode === 'random') return source === 'institution' ? 'easy' : source === 'external' ? 'hard' : 'unknown';
    return fixedDifficulty;
  }

  private async context(filter: StatsFilter) {
    const paperId = id(filter.paperId, '试卷');
    const paper = await this.paperRepo.findOne({ where: { id: paperId } });
    if (!paper) throw Errors.notFound('试卷不存在');
    const release = await this.releaseRepo.findOne({ where: { paperId }, order: { versionNo: 'DESC' } });
    const releaseQuestions = release
      ? await this.releaseQuestionRepo.find({ where: { releaseId: String(release.id) } })
      : [];
    const fixedDifficulties = new Set(releaseQuestions.map((item) => difficulty(item.difficulty)));
    const fixedDifficulty: ExamDifficulty = fixedDifficulties.size === 0
      ? 'unknown'
      : fixedDifficulties.size === 1 ? [...fixedDifficulties][0] : 'mixed';

    const [userRows, rawRecords] = await Promise.all([
      this.userRepo.find(),
      this.recordRepo.find({ where: { paperId }, order: { id: 'ASC' } }),
    ]);
    const currentCategory = release?.categoryId || paper.categoryId || null;
    const eligibleUsers = userRows.filter((user) => {
      // Source and category are training facts, not permission roles. Giving a
      // learner a business role must not silently remove that person from the
      // current exam population.
      if (Number(user.status) !== 1) return false;
      if (!currentCategory || String(user.categoryId || '') !== String(currentCategory)) return false;
      if (!user.source) return false;
      if (filter.categoryId && String(user.categoryId || '') !== String(filter.categoryId)) return false;
      if (filter.source && user.source !== filter.source) return false;
      return !filter.difficulty
        || this.expectedDifficulty(paper, release, fixedDifficulty, user.source) === filter.difficulty;
    });
    const records = rawRecords.map(recordView).filter((record) => {
      if (filter.categoryId && String(record.categoryId || '') !== String(filter.categoryId)) return false;
      if (filter.source && record.source !== filter.source) return false;
      if (filter.difficulty && difficulty(record.difficulty) !== filter.difficulty) return false;
      return true;
    });
    return { paper, release, records, users: userRows, eligibleUsers };
  }

  private async courseCompletion(categoryId: string | null, eligibleUsers: SysUser[]) {
    if (!categoryId) {
      return { eligible_users: 0, required_lessons: 0, completed_users: 0, completion_rate: null, incomplete_user_ids: [] as string[] };
    }
    const courseRows = (await this.courseRepo.find({ where: { categoryId, status: 'published' } }))
      .filter((course) => String(course.categoryId) === String(categoryId) && course.status === 'published');
    const courseIds = courseRows.map((course) => String(course.id));
    const lessonRows = courseIds.length
      ? await this.lessonRepo.find({ where: { courseId: In(courseIds), required: 1, lessonType: 'video' } })
      : [];
    const requiredVersionIds = lessonRows
      .filter((lesson) => courseIds.includes(String(lesson.courseId)) && Number(lesson.required) === 1 && lesson.lessonType === 'video')
      .map((lesson) => lesson.currentVersionId ? String(lesson.currentVersionId) : `missing:${lesson.id}`);
    const persistedVersionIds = requiredVersionIds.filter((versionId) => !versionId.startsWith('missing:'));
    const progressRows = persistedVersionIds.length
      ? await this.videoRepo.find({ where: { lessonVersionId: In(persistedVersionIds) } })
      : [];
    return computeCourseCompletion({
      eligibleUsers: eligibleUsers.map((user) => ({ id: String(user.id), source: user.source })),
      requiredVersionIds,
      completedPairs: new Set(progressRows
        .filter((row) => Number(row.completed) === 1)
        .map((row) => `${row.userId}:${row.lessonVersionId}`)),
    });
  }

  private uncompletedReasons(
    eligibleUsers: SysUser[],
    records: StatisticsRecord[],
    releaseId: string | null,
    scoringRule: RuleSnapshot | null,
    learningIncompleteIds: string[],
  ): Array<{ reason: TrainingUncompletedReason; users: number }> {
    const learningIncomplete = new Set(learningIncompleteIds);
    const counts: Record<TrainingUncompletedReason, number> = {
      learning_incomplete: learningIncomplete.size,
      not_started: 0,
      pending_manual: 0,
      not_passed: 0,
    };
    for (const user of eligibleUsers) {
      const history = records.filter((record) => record.userId === String(user.id));
      if (!history.length) {
        counts.not_started += 1;
        continue;
      }
      const scoring = releaseId === null
        ? history.filter((record) => record.releaseId === null)
        : history.filter((record) => String(record.releaseId || '') === releaseId);
      const exactRule = scoring.filter((record) => ruleKey(record.ruleSnapshot) === ruleKey(scoringRule));
      if (exactRule.some((record) => record.gradingState === 'finalized' && record.status === 'passed')) continue;
      if (exactRule.some((record) => record.gradingState === 'pending_manual')) counts.pending_manual += 1;
      else if (exactRule.some((record) => record.gradingState === 'finalized' && record.score !== null)) counts.not_passed += 1;
    }
    return (['learning_incomplete', 'not_started', 'pending_manual', 'not_passed'] as TrainingUncompletedReason[])
      .map((reason) => ({ reason, users: counts[reason] }));
  }

  async examSummary(filter: StatsFilter): Promise<TrainingExamSummary> {
    const context = await this.context(filter);
    const releaseId = context.release ? String(context.release.id) : null;
    const scoringRule = context.release?.ruleSnapshot || null;
    const categoryId = context.release?.categoryId || context.paper.categoryId || null;
    const course = await this.courseCompletion(categoryId ? String(categoryId) : null, context.eligibleUsers);
    const reasons = this.uncompletedReasons(
      context.eligibleUsers, context.records, releaseId, scoringRule, course.incomplete_user_ids,
    );
    return buildExamSummary({
      records: context.records,
      eligibleUserIds: new Set(context.eligibleUsers.map((user) => String(user.id))),
      scoringReleaseId: releaseId,
      scoringRule,
      course: {
        eligible_users: course.eligible_users,
        required_lessons: course.required_lessons,
        completed_users: course.completed_users,
        completion_rate: course.completion_rate,
      },
      uncompletedReasons: reasons,
    });
  }

  async ranking(filter: StatsFilter): Promise<Page<RankRow>> {
    if (!filter.difficulty) throw Errors.param('排名必须明确 difficulty');
    const context = await this.context(filter);
    const rows = buildRankingRows(
      context.records,
      new Map(context.users.map((user) => [String(user.id), user.realName])),
      filter.difficulty,
      context.release ? String(context.release.id) : null,
      context.release?.ruleSnapshot || null,
    );
    const page = Math.max(1, Number(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filter.pageSize || 20)));
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      page_size: pageSize,
    };
  }

  async export(filter: StatsFilter): Promise<Buffer> {
    const result = await this.ranking(filter);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('难度排名');
    sheet.columns = [
      { header: '名次', key: 'rank', width: 10 },
      { header: '学员ID', key: 'user_id', width: 16 },
      { header: '姓名', key: 'name', width: 16 },
      { header: '来源', key: 'source', width: 14 },
      { header: '难度', key: 'difficulty', width: 12 },
      { header: '分数', key: 'score', width: 10 },
      { header: '用时(秒)', key: 'duration_seconds', width: 12 },
      { header: '答卷ID', key: 'record_id', width: 16 },
    ];
    for (const row of result.items) sheet.addRow(row);
    const note = workbook.addWorksheet('口径说明');
    note.getCell('A1').value = '排名与成绩仅比较当前发布版本、相同冻结评分规则和所选难度；参与及提交人数属于该试卷历史范围。';
    note.getColumn(1).width = 100;
    return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  }

  /** C6 reports are intentionally real-time; the method is a no-op hook for future caching. */
  async invalidate(_paperId: string): Promise<void> {}

  async options(): Promise<TrainingStatisticsOptions> {
    const [papers, categories] = await Promise.all([this.paperRepo.find(), this.categoryRepo.find()]);
    return {
      papers: papers.filter((paper) => paper.businessScope === 'training').map((paper) => ({
        id: String(paper.id), title: paper.title, category_id: paper.categoryId ? String(paper.categoryId) : null,
        status: paper.status,
      })),
      categories: categories.map((category) => ({ id: String(category.id), name: category.name })),
    };
  }

  async dashboard(userId: string, now = new Date()): Promise<AdminDashboard> {
    const permissions = new Set(await this.access.permissions(String(userId)));
    const metrics: AdminDashboard['metrics'] = {};
    const [users, roleLinks] = permissions.has('students:read')
      ? await Promise.all([this.userRepo.find(), this.userRoleRepo.find()])
      : [[], []];
    if (permissions.has('students:read')) {
      const managerIds = new Set(roleLinks.map((link) => String(link.userId)));
      metrics.learner_count = users.filter((user) => Number(user.status) === 1
        && user.role === 'employee' && !managerIds.has(String(user.id))).length;
    }
    if (permissions.has('questions:read')) metrics.question_count = await this.questionRepo.count();
    if (permissions.has('papers:read')) metrics.paper_count = await this.paperRepo.count();
    if (permissions.has('exam_records:review')) {
      metrics.pending_grading_count = await this.recordRepo.count({ where: { gradingState: 'pending_manual' } });
    }

    const response: AdminDashboard = { as_of: now.toISOString(), timezone: 'Asia/Shanghai', metrics };
    if (permissions.has('statistics:read')) {
      const dates = Array.from({ length: 7 }, (_, index) => shanghaiDate(new Date(now.getTime() - (6 - index) * 86_400_000)));
      const earliest = new Date(`${dates[0]}T00:00:00+08:00`);
      const rows = await this.recordRepo.find({ where: { startedAt: MoreThanOrEqual(earliest) } });
      response.exam_trend = buildDashboardTrend(rows.map((row) => asDate(row.startedAt)), dates);
    }
    return response;
  }
}
