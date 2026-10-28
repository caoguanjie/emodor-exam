import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { In, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import type {
  ExamDifficulty, LearnerSource, Page, PoolScope, RankRow, RuleSnapshot, StatsFilter,
  TrainingExamOverviewRow, TrainingExamSummary, TrainingStatisticsOptions, TrainingStatisticsOverviewFilter,
  TrainingUncompletedReason,
} from '../../common/training-contracts';
import { CourseLesson } from '../../entities/course-lesson.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { PaperReleaseQuestion } from '../../entities/paper-release-question.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { TrainingCourse } from '../../entities/training-course.entity';
import { VideoLearningRecord } from '../../entities/video-learning-record.entity';
import {
  buildExamSummary, buildRankingRows, computeCourseCompletion,
  ruleKey, statisticsRecordView, summarizeReleaseRecords, type StatisticsRecord,
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

function examInfo(paper: ExamPaper, release: PaperRelease | null): TrainingExamSummary['exam'] & { pool_scope: PoolScope } {
  const rule = release?.ruleSnapshot;
  const categoryId = release ? release.categoryId : paper.categoryId;
  return {
    paper_id: String(paper.id), title: paper.title,
    // A missing field on a historical release always means category scope.
    pool_scope: (release ? release.poolScope : paper.poolScope) === 'public' ? 'public' : 'category',
    category_id: categoryId ? String(categoryId) : null,
    mode: (release?.mode || paper.mode) === 'random' ? 'random' : 'fixed',
    total_score: rule ? Number(rule.totalCents) / 100 : null,
    duration_minutes: rule ? Number(rule.durationMinutes) : null,
    pass_score: rule ? Number(rule.passCents) / 100 : null,
    excellent_score: null,
  };
}

@Injectable()
export class TrainingStatisticsService {
  constructor(
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(PaperRelease) private readonly releaseRepo: Repository<PaperRelease>,
    @InjectRepository(PaperReleaseQuestion) private readonly releaseQuestionRepo: Repository<PaperReleaseQuestion>,
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(TrainingCourse) private readonly courseRepo: Repository<TrainingCourse>,
    @InjectRepository(CourseLesson) private readonly lessonRepo: Repository<CourseLesson>,
    @InjectRepository(VideoLearningRecord) private readonly videoRepo: Repository<VideoLearningRecord>,
    @InjectRepository(TrainingCategory) private readonly categoryRepo: Repository<TrainingCategory>,
  ) {}

  async overview(filter: TrainingStatisticsOverviewFilter): Promise<Page<TrainingExamOverviewRow>> {
    const page = Math.max(1, Number(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filter.pageSize || 20)));
    // Join only the latest release so filtering and pagination both use its
    // frozen category. Draft configuration must not overwrite a released exam.
    const query = this.paperRepo.createQueryBuilder('paper')
      .leftJoinAndMapOne('paper.statisticsRelease', PaperRelease, 'release',
        'release.paperId = paper.id AND release.versionNo = '
        + '(SELECT MAX(latest.version_no) FROM paper_release latest WHERE latest.paper_id = paper.id)')
      .where('paper.businessScope = :scope', { scope: 'training' })
      .andWhere('paper.status = :status', { status: 'published' })
      .andWhere('release.id IS NOT NULL');
    const keyword = filter.keyword?.trim();
    if (keyword) query.andWhere('paper.title LIKE :keyword', { keyword: `%${keyword}%` });
    if (filter.categoryId) {
      query.andWhere('(CASE WHEN release.id IS NULL THEN paper.categoryId ELSE release.categoryId END) = :categoryId',
        { categoryId: id(filter.categoryId, '培训类别') });
    }
    const [papers, total] = await query.orderBy('paper.id', 'DESC')
      .skip((page - 1) * pageSize).take(pageSize).getManyAndCount() as [
        Array<ExamPaper & { statisticsRelease?: PaperRelease | null }>, number,
      ];
    const releaseIds = papers.flatMap((paper) => paper.statisticsRelease ? [String(paper.statisticsRelease.id)] : []);
    const categoryIds = [...new Set(papers.map((paper) => examInfo(paper, paper.statisticsRelease || null).category_id)
      .filter((categoryId): categoryId is string => categoryId !== null))];
    const [rawRecords, categories] = await Promise.all([
      releaseIds.length ? this.recordRepo.find({ where: { releaseId: In(releaseIds) } }) : Promise.resolve([]),
      categoryIds.length ? this.categoryRepo.find({ where: { id: In(categoryIds) } }) : Promise.resolve([]),
    ]);
    const recordsByRelease = new Map<string, StatisticsRecord[]>();
    for (const row of rawRecords) {
      const record = statisticsRecordView(row);
      if (!record.releaseId || !releaseIds.includes(record.releaseId)) continue;
      if (filter.categoryId && record.categoryId !== String(filter.categoryId)) continue;
      const group = recordsByRelease.get(record.releaseId) || [];
      group.push(record);
      recordsByRelease.set(record.releaseId, group);
    }
    const categoryNames = new Map(categories.map((category) => [String(category.id), category.name]));
    const items = papers.map((paper): TrainingExamOverviewRow & { pool_scope: PoolScope } => {
      const release = paper.statisticsRelease || null;
      const info = examInfo(paper, release);
      const releaseId = release ? String(release.id) : null;
      const records = release ? recordsByRelease.get(releaseId!) || [] : [];
      // This is descriptive across difficulties, never a combined ranking.
      const summary = release ? summarizeReleaseRecords(records, releaseId!, release.ruleSnapshot)
        : { participant_count: 0, finalized_users: 0, average_score: null };
      return {
        paper_id: info.paper_id, title: info.title, pool_scope: info.pool_scope, category_id: info.category_id,
        category_name: info.pool_scope === 'public' ? '公共题库' : info.category_id ? categoryNames.get(info.category_id) || null : null,
        status: paper.status, release_id: releaseId,
        total_score: info.total_score, duration_minutes: info.duration_minutes, pass_score: info.pass_score,
        ...summary,
      };
    });
    return { items, total, page, page_size: pageSize };
  }

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
    const currentCategory = release ? release.categoryId : paper.categoryId || null;
    const publicPool = examInfo(paper, release).pool_scope === 'public';
    const eligibleUsers = userRows.filter((user) => {
      // Public exams have no registered audience. Actual starts and submissions
      // come from frozen records, never an estimate from current profiles.
      if (publicPool) return false;
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
    const records = rawRecords.map(statisticsRecordView).filter((record) => {
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
      if (exactRule.length) counts.not_passed += 1;
    }
    return (['learning_incomplete', 'not_started', 'not_passed'] as TrainingUncompletedReason[])
      .map((reason) => ({ reason, users: counts[reason] }));
  }

  async examSummary(filter: StatsFilter): Promise<TrainingExamSummary> {
    const context = await this.context(filter);
    const releaseId = context.release ? String(context.release.id) : null;
    const scoringRule = context.release?.ruleSnapshot || null;
    const categoryId = context.release ? context.release.categoryId : context.paper.categoryId || null;
    const course = await this.courseCompletion(categoryId ? String(categoryId) : null, context.eligibleUsers);
    const reasons = this.uncompletedReasons(
      context.eligibleUsers, context.records, releaseId, scoringRule, course.incomplete_user_ids,
    );
    return { ...buildExamSummary({
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
    }), exam: examInfo(context.paper, context.release) };
  }

  async ranking(filter: StatsFilter): Promise<Page<RankRow>> {
    const context = await this.context(filter);
    const mode = (context.release?.mode || context.paper.mode) === 'random' ? 'random' : 'fixed';
    if (mode === 'random' && !filter.difficulty) throw Errors.param('随机卷排名必须明确 difficulty');
    const rows = buildRankingRows(
      context.records,
      new Map(context.users.map((user) => [String(user.id), user.realName])),
      filter.difficulty,
      context.release ? String(context.release.id) : null,
      context.release?.ruleSnapshot || null,
      {
        sort_by: filter.sort_by, sort_order: filter.sort_order,
        userGenders: new Map(context.users.map((user) => [String(user.id), user.gender || null])),
      },
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
    const sheet = workbook.addWorksheet('成绩排名');
    sheet.columns = [
      { header: '名次', key: 'rank', width: 10 },
      { header: '学员ID', key: 'user_id', width: 16 },
      { header: '姓名', key: 'name', width: 16 },
      { header: '性别', key: 'gender', width: 12 },
      { header: '来源', key: 'source', width: 14 },
      { header: '分数', key: 'score', width: 10 },
      { header: '用时(秒)', key: 'duration_seconds', width: 12 },
      { header: '答卷ID', key: 'record_id', width: 16 },
    ];
    for (const row of result.items) sheet.addRow({ ...row,
      gender: row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '未填写',
      source: row.source === 'institution' ? '本机构' : row.source === 'external' ? '外来' : '未知',
    });
    const note = workbook.addWorksheet('口径说明');
    note.getCell('A1').value = filter.difficulty
      ? `排名与成绩仅比较当前发布版本、相同冻结评分规则和卷面难度 ${filter.difficulty}；参与及提交人数属于该试卷历史范围。`
      : '排名与成绩仅比较当前发布版本和相同冻结评分规则；参与及提交人数属于该试卷历史范围。';
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
        pool_scope: paper.poolScope === 'public' ? 'public' : 'category',
        status: paper.status,
      })),
      categories: categories.map((category) => ({ id: String(category.id), name: category.name })),
    };
  }

}
