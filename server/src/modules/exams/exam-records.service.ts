import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Page, TRAINING_DEFAULTS } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { SysUser } from '../../entities/sys-user.entity';

interface RecordProjectionRow {
  record_id: string;
  paper_id: string;
  paper_title: string;
  user_id: string;
  username: string;
  name: string;
  source: string | null;
  category_id: string | null;
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
}

export interface ExamRecordListFilters {
  page?: number;
  page_size?: number;
  keyword?: string;
  paper_id?: string;
  source?: string;
  difficulty?: string;
  status?: string;
  grading_state?: string;
}

export function recordSummaryView(row: RecordProjectionRow) {
  return {
    record_id: String(row.record_id),
    paper_id: String(row.paper_id),
    paper_title: row.paper_title,
    user_id: String(row.user_id),
    username: row.username,
    name: row.name,
    source: row.source,
    category_id: row.category_id ? String(row.category_id) : null,
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
  };
}

export type ExamRecordSummary = ReturnType<typeof recordSummaryView>;

@Injectable()
export class ExamRecordsService {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
  ) {}

  private projection(): SelectQueryBuilder<ExamRecord> {
    return this.recordRepo.createQueryBuilder('record')
      .innerJoin(SysUser, 'learner', 'learner.id = record.user_id')
      .innerJoin(ExamPaper, 'paper', 'paper.id = record.paper_id')
      .select('record.id', 'record_id')
      .addSelect('record.paper_id', 'paper_id')
      .addSelect('paper.title', 'paper_title')
      .addSelect('record.user_id', 'user_id')
      .addSelect('learner.username', 'username')
      .addSelect('learner.real_name', 'name')
      .addSelect('record.source', 'source')
      .addSelect('record.category_id', 'category_id')
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
      .addSelect('(SELECT COUNT(*) FROM exam_record_question record_item WHERE record_item.record_id = record.id)', 'total_count')
      .addSelect(`(SELECT COUNT(*) FROM exam_answer record_answer
        WHERE record_answer.exam_record_id = record.id
          AND COALESCE(JSON_LENGTH(record_answer.selected), 0) > 0)`, 'answered_count');
  }

  async list(actorId: string, filters: ExamRecordListFilters): Promise<Page<ExamRecordSummary>> {
    void actorId;
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
    if (filters.paper_id) query.andWhere('record.paper_id = :paperId', { paperId: String(filters.paper_id) });
    if (filters.source) query.andWhere('record.source = :source', { source: filters.source });
    if (filters.difficulty) query.andWhere('record.difficulty = :difficulty', { difficulty: filters.difficulty });
    if (filters.status) query.andWhere('record.status = :status', { status: filters.status });
    if (filters.grading_state) query.andWhere('record.grading_state = :gradingState', { gradingState: filters.grading_state });
    const total = await query.getCount();
    const rows = await query.orderBy('record.started_at', 'DESC').addOrderBy('record.id', 'DESC')
      .offset((page - 1) * pageSize).limit(pageSize).getRawMany<RecordProjectionRow>();
    return { items: rows.map(recordSummaryView), total, page, page_size: pageSize };
  }

  async detail(actorId: string, recordId: string): Promise<ExamRecordSummary> {
    void actorId;
    const row = await this.projection().where('record.id = :recordId', { recordId: String(recordId) })
      .getRawOne<RecordProjectionRow>();
    if (!row) throw Errors.notFound('考试记录不存在');
    return recordSummaryView(row);
  }
}
