import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors, ExamStatus } from '../../common/errors';
import type { FinalResult, GradingQueueItem, Id, Page } from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamReviewEvent } from '../../entities/exam-review-event.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { AccessService } from '../access/access.service';
import { StatisticsService } from '../statistics/statistics.service';
import { AttemptReaderService } from './attempt-reader.service';
import { ExamHistoryService } from './exam-history.service';

export interface ManualScoreInput {
  scoreCents: number;
  comment: string;
  expectedVersion: number;
}

export interface GradingQueueQuery {
  page?: number;
  pageSize?: number;
  paperId?: Id;
  source?: 'institution' | 'external';
  state?: 'pending_manual' | 'finalized';
}

type FinalizationEffect = {
  recordId: string;
  regulationId: string | null;
  actorId: string;
  score: number;
  status: string;
} | null;

function assertId(value: Id, label: string): string {
  const id = String(value);
  if (!/^[1-9]\d*$/.test(id)) throw Errors.param(`${label}不合法`);
  return id;
}

function decimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

@Injectable()
export class ManualGradingService {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    private readonly dataSource: DataSource,
    private readonly reader: AttemptReaderService,
    private readonly history: ExamHistoryService,
    private readonly access: AccessService,
    private readonly statistics: StatisticsService,
    private readonly audit: AuditService,
  ) {}

  private async requireReviewer(actorId: Id): Promise<void> {
    const permissions = await this.access.permissions(String(actorId));
    if (!permissions.includes('exam_records:review')) throw Errors.forbidden();
  }

  async score(actorId: Id, recordId: Id, itemId: Id, input: ManualScoreInput): Promise<FinalResult> {
    const reviewerId = assertId(actorId, '阅卷人');
    const safeRecordId = assertId(recordId, '考试记录');
    const safeItemId = assertId(itemId, '题目');
    if (!input || !Number.isInteger(input.scoreCents) || input.scoreCents < 0) throw Errors.param('得分必须为非负整数分');
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw Errors.param('评分版本不合法');
    if (typeof input.comment !== 'string' || input.comment.length > 2000) throw Errors.param('评语格式不合法');
    await this.requireReviewer(reviewerId);

    const completed = await this.dataSource.transaction(async (manager) => {
      const recordRepo = manager.getRepository(ExamRecord);
      const record = await recordRepo.findOne({
        where: { id: safeRecordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) throw Errors.notFound('考试记录不存在');
      if (record.gradingState === 'finalized') throw Errors.submitConflict('最终成绩已结算，不能修改评分');
      if (record.gradingState !== 'pending_manual' || record.status !== ExamStatus.SUBMITTED || !record.submittedAt) {
        throw Errors.submitConflict('考试记录不在待人工批改状态');
      }

      const snapshot = await this.reader.forGrading(manager, safeRecordId);
      const item = snapshot.items.find((candidate) => String(candidate.itemId) === safeItemId);
      if (!item) throw Errors.notFound('本次冻结题目不存在');
      if (item.type !== 'image') throw Errors.param('只有图片作答题可人工评分');
      if (input.scoreCents > Number(item.scoreCents)) throw Errors.param('得分不能超过本题满分');

      const answerRepo = manager.getRepository(ExamAnswer);
      const answer = await answerRepo.findOne({
        where: { examRecordId: safeRecordId, recordQuestionId: safeItemId },
      });
      if (!answer || !Array.isArray(answer.assetIds) || answer.assetIds.length === 0) {
        throw Errors.param('未作答图片题没有人工批改任务');
      }
      if (Number(answer.gradingVersion || 0) !== input.expectedVersion) {
        throw Errors.submitConflict('评分版本已变化，请刷新后重试');
      }

      const beforeScore = answer.gainedScore;
      const beforeComment = answer.comment;
      const nextVersion = Number(answer.gradingVersion || 0) + 1;
      const comment = input.comment.trim() || null;
      answer.gainedScore = decimal(input.scoreCents);
      answer.comment = comment;
      answer.isCorrect = input.scoreCents === Number(item.scoreCents) ? 1 : 0;
      answer.gradingVersion = nextVersion;
      await answerRepo.save(answer);

      const reviewRepo = manager.getRepository(ExamReviewEvent);
      await reviewRepo.save(reviewRepo.create({
        examRecordId: safeRecordId,
        recordQuestionId: safeItemId,
        reviewerId,
        beforeScore,
        afterScore: answer.gainedScore,
        beforeComment,
        afterComment: comment,
        gradingVersion: nextVersion,
      }));

      record.gradingRevision = Number(record.gradingRevision || 0) + 1;
      const rows = await answerRepo.find({ where: { examRecordId: safeRecordId } });
      const itemById = new Map(snapshot.items.map((candidate) => [String(candidate.itemId), candidate]));
      const pending = rows.some((row) => {
        const candidate = row.recordQuestionId ? itemById.get(String(row.recordQuestionId)) : undefined;
        return candidate?.type === 'image'
          && Array.isArray(row.assetIds) && row.assetIds.length > 0
          && row.gainedScore === null;
      });

      let effect: FinalizationEffect = null;
      if (!pending) {
        const totalCents = snapshot.items.reduce((total, candidate) => {
          const row = rows.find((answerRow) => String(answerRow.recordQuestionId) === String(candidate.itemId));
          if (!row || row.gainedScore === null) throw Errors.internal('批改完成时存在未评分题目');
          return total + Math.round(Number(row.gainedScore) * 100);
        }, 0);
        record.gradingState = 'finalized';
        record.gradedAt = new Date();
        record.score = decimal(totalCents);
        record.status = totalCents >= Number(snapshot.rule.passCents) ? ExamStatus.PASSED : ExamStatus.FAILED;
        effect = {
          recordId: safeRecordId,
          regulationId: record.regulationId ? String(record.regulationId) : null,
          actorId: reviewerId,
          score: totalCents / 100,
          status: record.status,
        };
      }
      await recordRepo.save(record);
      return {
        result: await this.history.resultInTransaction(manager, record, snapshot, rows),
        effect,
      };
    });

    if (completed.effect) {
      if (completed.effect.regulationId) await this.statistics.invalidateRegulationCache(completed.effect.regulationId);
      this.audit.log({
        actor_id: completed.effect.actorId,
        actor_name: completed.effect.actorId,
        action: 'exam.grade',
        object_type: 'exam_record',
        object_id: completed.effect.recordId,
        detail: { status: completed.effect.status, score: completed.effect.score },
        result: 'success',
        source_ip: null,
      });
    }
    return completed.result;
  }

  async queue(actorId: Id, query: GradingQueueQuery): Promise<Page<GradingQueueItem>> {
    await this.requireReviewer(actorId);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const base = this.recordRepo.createQueryBuilder('record')
      .innerJoin(ExamPaper, 'paper', 'paper.id = record.paper_id')
      .innerJoin(SysUser, 'student', 'student.id = record.user_id')
      .where('record.submitted_at IS NOT NULL')
      .andWhere("record.grading_state IN ('pending_manual', 'finalized')")
      .andWhere(`EXISTS (
        SELECT 1 FROM exam_record_question queue_item
        INNER JOIN exam_answer queue_answer
          ON queue_answer.exam_record_id = record.id
         AND queue_answer.record_question_id = queue_item.id
        WHERE queue_item.record_id = record.id
          AND queue_item.type = 'image'
          AND JSON_LENGTH(queue_answer.asset_ids) > 0
      )`);
    if (query.paperId) base.andWhere('record.paper_id = :paperId', { paperId: assertId(query.paperId, '试卷') });
    if (query.source) base.andWhere('record.source = :source', { source: query.source });
    if (query.state) base.andWhere('record.grading_state = :gradingState', { gradingState: query.state });
    const total = await base.clone().getCount();
    const raw = await base.clone()
      .select('record.id', 'record_id')
      .addSelect('record.paper_id', 'paper_id')
      .addSelect('paper.title', 'paper_title')
      .addSelect('record.user_id', 'user_id')
      .addSelect('student.real_name', 'user_name')
      .addSelect('record.source', 'source')
      .addSelect('record.grading_state', 'grading_state')
      .addSelect('record.submitted_at', 'submitted_at')
      .addSelect('record.graded_at', 'graded_at')
      .addSelect('record.score', 'score')
      .addSelect(`(
        SELECT COUNT(*) FROM exam_record_question qi
        INNER JOIN exam_answer qa ON qa.exam_record_id = record.id AND qa.record_question_id = qi.id
        WHERE qi.record_id = record.id AND qi.type = 'image' AND JSON_LENGTH(qa.asset_ids) > 0
      )`, 'image_items')
      .addSelect(`(
        SELECT COUNT(*) FROM exam_record_question qi
        INNER JOIN exam_answer qa ON qa.exam_record_id = record.id AND qa.record_question_id = qi.id
        WHERE qi.record_id = record.id AND qi.type = 'image' AND JSON_LENGTH(qa.asset_ids) > 0 AND qa.gained_score IS NULL
      )`, 'pending_items')
      .addSelect(`(
        SELECT COUNT(*) FROM exam_record_question qi
        INNER JOIN exam_answer qa ON qa.exam_record_id = record.id AND qa.record_question_id = qi.id
        WHERE qi.record_id = record.id AND qi.type = 'image' AND JSON_LENGTH(qa.asset_ids) > 0 AND qa.gained_score IS NOT NULL
      )`, 'graded_items')
      .orderBy("CASE WHEN record.grading_state = 'pending_manual' THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('record.submitted_at', 'ASC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<any>();
    return {
      items: raw.map((row) => ({
        record_id: String(row.record_id),
        paper_id: String(row.paper_id),
        paper_title: String(row.paper_title),
        user_id: String(row.user_id),
        user_name: String(row.user_name),
        source: row.source || null,
        grading_state: row.grading_state,
        submitted_at: new Date(row.submitted_at).toISOString(),
        graded_at: row.graded_at ? new Date(row.graded_at).toISOString() : null,
        score: row.score === null ? null : Number(row.score),
        pending_items: Number(row.pending_items),
        graded_items: Number(row.graded_items),
        image_items: Number(row.image_items),
      })),
      total,
      page,
      page_size: pageSize,
    };
  }
}
