import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ExamPurpose, Page, TRAINING_DEFAULTS } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { examPurposeOf } from './exam-purpose';
import { applyVisibleExamRecordScope } from './exam-record-visibility';

interface RecordProjectionRow {
  exam_purpose?: ExamPurpose;
  record_id: string;
  paper_id: string;
  paper_title: string;
  user_id: string;
  username: string;
  name: string;
  avatar_id?: string | null;
  source: string | null;
  category_id: string | null;
  category_name: string | null;
  pool_scope?: string | null;
  difficulty: string | null;
  release_id: string | null;
  attempt_no: number | string;
  started_at: Date | string;
  deadline_at: Date | string;
  submitted_at: Date | string | null;
  answered_count: number | string;
  total_count: number | string;
  status: string;
  grading_state: string;
  submission_method: string | null;
  score: number | string | null;
  total_score_cents: number | string | null;
}

export type ExamRecordResultStatus = 'in_progress' | 'passed' | 'failed' | 'timeout';

export interface ExamRecordListFilters {
  exam_purpose?: ExamPurpose;
  page?: number;
  page_size?: number;
  keyword?: string;
  paper_id?: string;
  user_id?: string;
  category_id?: string;
  source?: string;
  difficulty?: string;
  status?: string;
  grading_state?: string;
  result_status?: ExamRecordResultStatus;
  date_from?: string;
  date_to?: string;
}

/** MySQL stores UTC instants; date filters refer to Beijing calendar days. */
function beijingDayStart(value: string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Errors.param(`${label}必须是有效的 YYYY-MM-DD 日期`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw Errors.param(`${label}必须是有效的 YYYY-MM-DD 日期`);
  }
  return new Date(date.getTime() - 8 * 60 * 60 * 1000);
}

export function recordSummaryView(row: RecordProjectionRow) {
  if (!['in_progress', 'passed', 'failed', 'timeout'].includes(row.status)
    || (row.status === 'timeout' && row.grading_state === 'finalized'
      && row.score !== null && row.score !== undefined && row.submitted_at !== null && row.submitted_at !== undefined)) {
    throw Errors.notFound('考试记录不存在');
  }
  const totalCents = row.total_score_cents === null || row.total_score_cents === undefined
    ? NaN : Number(row.total_score_cents);
  return {
    exam_purpose: examPurposeOf(row.exam_purpose),
    record_id: String(row.record_id),
    paper_id: String(row.paper_id),
    paper_title: row.paper_title,
    user_id: String(row.user_id),
    username: row.username,
    name: row.name,
    source: row.source,
    pool_scope: row.pool_scope === 'public' ? 'public' as const : 'category' as const,
    category_id: row.category_id ? String(row.category_id) : null,
    category_name: row.pool_scope === 'public' ? '公共题库' : row.category_name ?? null,
    difficulty: row.difficulty,
    release_id: row.release_id ? String(row.release_id) : null,
    attempt_no: Number(row.attempt_no),
    started_at: new Date(row.started_at).toISOString(),
    deadline_at: new Date(row.deadline_at).toISOString(),
    submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    answered_count: Number(row.answered_count || 0),
    total_count: Number(row.total_count || 0),
    status: row.status,
    grading_state: row.grading_state,
    submission_method: row.submission_method === 'manual' || row.submission_method === 'timeout'
      ? row.submission_method
      : null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    total_score: Number.isFinite(totalCents) ? totalCents / 100 : null,
    result_status: row.status as ExamRecordResultStatus,
  };
}

export type ExamRecordSummary = ReturnType<typeof recordSummaryView>;

@Injectable()
export class ExamRecordsService {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
  ) {}

  private projection(): SelectQueryBuilder<ExamRecord> {
    return applyVisibleExamRecordScope(this.recordRepo.createQueryBuilder('record'))
      .leftJoin(TrainingCategory, 'category', 'category.id = record.category_id')
      .leftJoin(PaperRelease, 'release', 'release.id = record.release_id')
      .select('record.id', 'record_id')
      .addSelect('record.paper_id', 'paper_id')
      .addSelect('record.exam_purpose', 'exam_purpose')
      .addSelect('paper.title', 'paper_title')
      .addSelect('record.user_id', 'user_id')
      .addSelect('learner.username', 'username')
      .addSelect('learner.real_name', 'name')
      .addSelect('record.source', 'source')
      .addSelect("COALESCE(release.pool_scope, 'category')", 'pool_scope')
      .addSelect('record.category_id', 'category_id')
      .addSelect('category.name', 'category_name')
      .addSelect('record.difficulty', 'difficulty')
      .addSelect('record.release_id', 'release_id')
      .addSelect('record.attempt_no', 'attempt_no')
      .addSelect('record.started_at', 'started_at')
      .addSelect('record.deadline_at', 'deadline_at')
      .addSelect('record.submitted_at', 'submitted_at')
      .addSelect('record.status', 'status')
      .addSelect('record.grading_state', 'grading_state')
      .addSelect('record.submission_method', 'submission_method')
      .addSelect('record.score', 'score')
      .addSelect("JSON_UNQUOTE(JSON_EXTRACT(record.rule_snapshot, '$.totalCents'))", 'total_score_cents')
      .addSelect('(SELECT COUNT(*) FROM exam_record_question record_item WHERE record_item.record_id = record.id)', 'total_count')
      .addSelect(`(SELECT COUNT(*) FROM exam_answer record_answer
        WHERE record_answer.exam_record_id = record.id
          AND COALESCE(JSON_LENGTH(record_answer.selected), 0) > 0)`, 'answered_count');
  }

  async list(actorId: string, filters: ExamRecordListFilters): Promise<Page<ExamRecordSummary>> {
    void actorId;
    const dateFrom = beijingDayStart(filters.date_from, 'date_from');
    const dateToDay = beijingDayStart(filters.date_to, 'date_to');
    if (dateFrom && dateToDay && dateFrom > dateToDay) throw Errors.param('date_from不能晚于date_to');
    const dateTo = dateToDay ? new Date(dateToDay.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.min(
      TRAINING_DEFAULTS.maxPageSize,
      Math.max(1, Number(filters.page_size || TRAINING_DEFAULTS.pageSize)),
    );
    const query = this.projection();
    const keyword = String(filters.keyword || '').trim();
    if (keyword) {
      query.andWhere('(learner.real_name LIKE :keyword OR learner.username LIKE :keyword OR paper.title LIKE :keyword)', {
        keyword: `%${keyword}%`,
      });
    }
    if (filters.exam_purpose) query.andWhere('record.exam_purpose = :examPurpose', { examPurpose: filters.exam_purpose });
    if (filters.paper_id) query.andWhere('record.paper_id = :paperId', { paperId: String(filters.paper_id) });
    if (filters.user_id) query.andWhere('record.user_id = :userId', { userId: String(filters.user_id) });
    if (filters.category_id) query.andWhere('record.category_id = :categoryId', { categoryId: String(filters.category_id) });
    if (filters.source) query.andWhere('record.source = :source', { source: filters.source });
    if (filters.difficulty) query.andWhere('record.difficulty = :difficulty', { difficulty: filters.difficulty });
    if (filters.status) query.andWhere('record.status = :status', { status: filters.status });
    if (filters.grading_state) query.andWhere('record.grading_state = :gradingState', { gradingState: filters.grading_state });
    if (filters.result_status) query.andWhere('record.status = :resultStatus', { resultStatus: filters.result_status });
    if (dateFrom) query.andWhere('record.started_at >= :dateFrom', { dateFrom });
    if (dateTo) query.andWhere('record.started_at < :dateTo', { dateTo });
    const total = await query.getCount();
    const rows = await query.orderBy('record.started_at', 'DESC').addOrderBy('record.id', 'DESC')
      .offset((page - 1) * pageSize).limit(pageSize).getRawMany<RecordProjectionRow>();
    return { items: rows.map(recordSummaryView), total, page, page_size: pageSize };
  }

  async options(actorId: string, purpose?: ExamPurpose) {
    void actorId;
    const papersQuery = this.recordRepo.manager.getRepository(ExamPaper).createQueryBuilder('paper').withDeleted()
      .select('paper.id', 'id').addSelect('paper.title', 'title')
      .where('(paper.status IN (:...activeStatuses) OR EXISTS (SELECT 1 FROM exam_record historical_record WHERE historical_record.paper_id = paper.id))', {
        activeStatuses: ['draft', 'published'],
      });
    const categoriesQuery = this.recordRepo.manager.getRepository(TrainingCategory).createQueryBuilder('category').withDeleted()
      .select('category.id', 'id').addSelect('category.name', 'name')
      .where('(category.status = :activeStatus OR EXISTS (SELECT 1 FROM exam_record historical_record WHERE historical_record.category_id = category.id))', {
        activeStatus: 1,
      });
    if (purpose) {
      papersQuery.andWhere('paper.exam_purpose = :examPurpose', { examPurpose: purpose });
      categoriesQuery.andWhere('EXISTS (SELECT 1 FROM exam_record historical_record WHERE historical_record.category_id = category.id AND historical_record.exam_purpose = :examPurpose)', { examPurpose: purpose });
    }
    const [papers, categories] = await Promise.all([
      papersQuery.orderBy('paper.title', 'ASC').addOrderBy('paper.id', 'ASC').getRawMany<{ id: string; title: string }>(),
      categoriesQuery.orderBy('category.name', 'ASC').addOrderBy('category.id', 'ASC').getRawMany<{ id: string; name: string }>(),
    ]);
    return {
      papers: papers.map(paper => ({ id: String(paper.id), title: paper.title })),
      categories: categories.map(category => ({ id: String(category.id), name: category.name })),
    };
  }

  async detail(actorId: string, recordId: string): Promise<ExamRecordSummary & { avatar_id: string | null }> {
    void actorId;
    const row = await this.projection().addSelect('learner.avatar_id', 'avatar_id').andWhere('record.id = :recordId', { recordId: String(recordId) })
      .getRawOne<RecordProjectionRow>();
    if (!row) throw Errors.notFound('考试记录不存在');
    return { ...recordSummaryView(row), avatar_id: row.avatar_id ? String(row.avatar_id) : null };
  }
}
