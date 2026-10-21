import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Page, TRAINING_DEFAULTS } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { SysUser } from '../../entities/sys-user.entity';

export type MonitorConnectionState = 'connected' | 'uncertain' | 'ended';

export interface MonitorProjectionRow {
  record_id: string;
  user_id: string;
  name: string;
  source: string | null;
  difficulty: string | null;
  started_at: Date | string;
  deadline_at: Date | string;
  answered_count: number | string;
  total_count: number | string;
  last_heartbeat_at: Date | string | null;
  switch_count: number | string;
  device_summary: string | null;
  status: string;
  grading_state: string;
  submission_method: string | null;
}

export interface RecordProjectionRow extends MonitorProjectionRow {
  paper_id: string;
  paper_title: string;
  username: string;
  category_id: string | null;
  release_id: string | null;
  attempt_no: number | string;
  submitted_at: Date | string | null;
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

export interface MonitorPaperOptionFilters {
  page?: number;
  page_size?: number;
  keyword?: string;
}

export interface MonitorPaperOption {
  id: string;
  title: string;
  status: string;
  business_scope: string;
}

export function monitorRowView(row: MonitorProjectionRow, now: Date) {
  const lastHeartbeatAt = row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : null;
  const connectionState: MonitorConnectionState = row.status !== 'in_progress'
    ? 'ended'
    : !lastHeartbeatAt || now.getTime() - lastHeartbeatAt.getTime() > TRAINING_DEFAULTS.monitoringStaleSeconds * 1000
      ? 'uncertain'
      : 'connected';
  return {
    record_id: String(row.record_id),
    user_id: String(row.user_id),
    name: row.name,
    source: row.source,
    difficulty: row.difficulty,
    started_at: new Date(row.started_at).toISOString(),
    deadline_at: new Date(row.deadline_at).toISOString(),
    server_now: now.toISOString(),
    remaining_seconds: Math.max(0, Math.floor((new Date(row.deadline_at).getTime() - now.getTime()) / 1000)),
    answered_count: Number(row.answered_count || 0),
    total_count: Number(row.total_count || 0),
    last_heartbeat_at: lastHeartbeatAt?.toISOString() || null,
    connection_state: connectionState,
    switch_count: Number(row.switch_count || 0),
    device_summary: row.device_summary || null,
    status: row.status,
    grading_state: row.grading_state,
    submission_method: row.submission_method === 'manual' || row.submission_method === 'timeout'
      ? row.submission_method
      : null,
  };
}

export type MonitorRow = ReturnType<typeof monitorRowView>;

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
    switch_count: Number(row.switch_count || 0),
    status: row.status,
    grading_state: row.grading_state,
    submission_method: row.submission_method === 'manual' || row.submission_method === 'timeout'
      ? row.submission_method
      : null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
  };
}

export type ExamRecordSummary = ReturnType<typeof recordSummaryView>;
export type ExamRecordDetail = ExamRecordSummary & MonitorRow;

@Injectable()
export class ExamMonitorService {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
  ) {}

  private now(): Date {
    return new Date();
  }

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
      .addSelect('record.last_heartbeat_at', 'last_heartbeat_at')
      .addSelect('record.switch_count', 'switch_count')
      .addSelect('record.device_summary', 'device_summary')
      .addSelect('record.status', 'status')
      .addSelect('record.grading_state', 'grading_state')
      .addSelect('record.submission_method', 'submission_method')
      .addSelect('record.score', 'score')
      .addSelect('(SELECT COUNT(*) FROM exam_record_question monitored_item WHERE monitored_item.record_id = record.id)', 'total_count')
      .addSelect(`(SELECT COUNT(*) FROM exam_answer monitored_answer
        WHERE monitored_answer.exam_record_id = record.id
          AND (COALESCE(JSON_LENGTH(monitored_answer.selected), 0) > 0
            OR COALESCE(JSON_LENGTH(monitored_answer.asset_ids), 0) > 0))`, 'answered_count');
  }

  async list(actorId: string, paperId: string, page: number, pageSize: number): Promise<Page<MonitorRow>> {
    void actorId;
    const normalizedPage = Math.max(1, Number(page || 1));
    const normalizedPageSize = Math.min(
      TRAINING_DEFAULTS.maxPageSize,
      Math.max(1, Number(pageSize || TRAINING_DEFAULTS.pageSize)),
    );
    const query = this.projection().where('record.paper_id = :paperId', { paperId: String(paperId) });
    const total = await query.getCount();
    const rows = await query.orderBy('record.started_at', 'DESC').addOrderBy('record.id', 'DESC')
      .skip((normalizedPage - 1) * normalizedPageSize).take(normalizedPageSize).getRawMany<MonitorProjectionRow>();
    const now = this.now();
    return {
      items: rows.map((row) => monitorRowView(row, now)),
      total,
      page: normalizedPage,
      page_size: normalizedPageSize,
    };
  }

  async listRecords(actorId: string, filters: ExamRecordListFilters): Promise<Page<ExamRecordSummary>> {
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
      .skip((page - 1) * pageSize).take(pageSize).getRawMany<RecordProjectionRow>();
    return { items: rows.map(recordSummaryView), total, page, page_size: pageSize };
  }

  async detail(actorId: string, recordId: string): Promise<ExamRecordDetail> {
    void actorId;
    const row = await this.projection().where('record.id = :recordId', { recordId: String(recordId) })
      .getRawOne<RecordProjectionRow>();
    if (!row) throw Errors.notFound('考试记录不存在');
    return { ...recordSummaryView(row), ...monitorRowView(row, this.now()) };
  }

  async paperOptions(
    actorId: string,
    filters: MonitorPaperOptionFilters,
  ): Promise<Page<MonitorPaperOption>> {
    void actorId;
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.min(
      TRAINING_DEFAULTS.maxPageSize,
      Math.max(1, Number(filters.page_size || TRAINING_DEFAULTS.pageSize)),
    );
    const query = this.paperRepo.createQueryBuilder('paper')
      .select('paper.id', 'id')
      .addSelect('paper.title', 'title')
      .addSelect('paper.status', 'status')
      .addSelect('paper.business_scope', 'business_scope');
    const keyword = String(filters.keyword || '').trim();
    if (keyword) query.andWhere('paper.title LIKE :keyword', { keyword: `%${keyword}%` });
    const total = await query.getCount();
    const rows = await query.orderBy('paper.updated_at', 'DESC').addOrderBy('paper.id', 'DESC')
      .skip((page - 1) * pageSize).take(pageSize).getRawMany<MonitorPaperOption>();
    return {
      items: rows.map((row) => ({
        id: String(row.id), title: row.title, status: row.status, business_scope: row.business_scope,
      })),
      total,
      page,
      page_size: pageSize,
    };
  }
}
