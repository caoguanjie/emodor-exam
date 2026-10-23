import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors, ExamStatus } from '../../common/errors';
import type { FinalResult, Id, SubmissionMethod } from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { StatisticsService } from '../statistics/statistics.service';
import { AttemptReaderService, type GradingSnapshot } from './attempt-reader.service';
import { AnswerDraftService } from './answer-draft.service';
import { ExamHistoryService } from './exam-history.service';
import { questionContent } from '../questions/question-content';
import { assertExamIdentity, expireExamRecord } from './exam-state';

export interface SubmissionGradeDetail {
  itemId: string;
  selected: number[] | null;
  isCorrect: number | null;
  gainedCents: number;
}

export interface SubmissionGrade {
  totalCents: number;
  fullScoreCount: number;
  details: SubmissionGradeDetail[];
}

export function gradeSubmissionSnapshot(snapshot: GradingSnapshot, rows: ExamAnswer[]): SubmissionGrade {
  const byItem = new Map(rows.filter((row) => row.recordQuestionId).map((row) => [String(row.recordQuestionId), row]));
  const details = snapshot.items.map((item): SubmissionGradeDetail => {
    const row = byItem.get(String(item.itemId));
    if (!['single', 'multiple', 'judgment'].includes(item.type)) {
      throw Errors.submitConflict('题型不支持自动评分');
    }
    const content = questionContent(item);
    const selected = Array.isArray(row?.selectedOptionIds)
      ? row!.selectedOptionIds!.map((id) => content.options.findIndex((option) => option.id === id)).sort((a, b) => a - b)
      : Array.isArray(row?.selected)
      ? [...new Set(row!.selected!.map(Number))].sort((left, right) => left - right)
      : [];
    const selectedIds = [...new Set(Array.isArray(row?.selectedOptionIds)
      ? row.selectedOptionIds
      : selected.map((index) => content.options[index]?.id).filter((id): id is string => Boolean(id)))].sort();
    const expected = [...content.answer_option_ids].sort();
    if (!selected.length) {
      return { itemId: String(item.itemId), selected: null, isCorrect: null, gainedCents: 0 };
    }
    const fullyCorrect = selectedIds.length === expected.length && selectedIds.every((value, index) => value === expected[index]);
    let gainedCents = 0;
    let isCorrect = 0;
    if (fullyCorrect) {
      gainedCents = Number(item.scoreCents);
      isCorrect = 1;
    } else if (item.type === 'multiple') {
      const expectedSet = new Set(expected);
      const hasWrong = selectedIds.some((value) => !expectedSet.has(value));
      if (!hasWrong && selectedIds.length < expected.length) {
        gainedCents = Math.round(Number(item.scoreCents) * Number(snapshot.rule.partialCreditRatio));
      }
    }
    return {
      itemId: String(item.itemId), selected, isCorrect, gainedCents,
    };
  });
  return {
    totalCents: details.reduce((sum, detail) => sum + detail.gainedCents, 0),
    fullScoreCount: details.filter((detail, index) => detail.gainedCents === Number(snapshot.items[index].scoreCents)).length,
    details,
  };
}

export function validateWholeSubmission(recordId: string, input: unknown, snapshot: GradingSnapshot): Array<{ item_id: string; option_ids: string[] }> {
  const obj = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (!obj(input) || Object.keys(input).some((key) => !['record_id', 'answers'].includes(key)) || typeof input.record_id !== 'string' || !/^[1-9]\d*$/.test(input.record_id) || input.record_id !== recordId || !Array.isArray(input.answers)) throw Errors.param('整卷交卷请求非法');
  if (input.answers.length !== snapshot.items.length) throw Errors.param('必须提交全部题目，未答题使用空数组');
  const byItem = new Map(snapshot.items.map((item) => [String(item.itemId), item]));
  const seen = new Set<string>();
  return input.answers.map((answer: unknown) => {
    if (!obj(answer) || Object.keys(answer).some((key) => !['item_id', 'option_ids'].includes(key)) || typeof answer.item_id !== 'string' || !Array.isArray(answer.option_ids) || !byItem.has(answer.item_id) || seen.has(answer.item_id)) throw Errors.param('交卷题目缺失、重复或非法');
    seen.add(answer.item_id);
    const item = byItem.get(answer.item_id)!;
    const allowed = new Set(questionContent(item).options.map((option) => option.id));
    const ids = answer.option_ids;
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !allowed.has(id)) || (item.type !== 'multiple' && ids.length > 1)) throw Errors.param('交卷选项非法');
    return { item_id: answer.item_id, option_ids: [...ids] as string[] };
  });
}

type ResultRecord = ExamRecord & {
  gradingState: 'not_submitted' | 'finalized';
  submissionMethod: SubmissionMethod | null;
  gradedAt: Date | null;
};

type FinalizationEffect = {
  recordId: string;
  regulationId: string | null;
  userId: string;
  method: SubmissionMethod;
  status: string;
  score: number | null;
};

type FinalizationOutcome = {
  result: FinalResult;
  effect: FinalizationEffect | null;
};

@Injectable()
export class SubmissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly drafts: AnswerDraftService,
    private readonly reader: AttemptReaderService,
    private readonly history: ExamHistoryService,
    private readonly statistics: StatisticsService,
    private readonly audit: AuditService,
  ) {}

  private async publishFinalization(outcome: FinalizationOutcome, actorName: string): Promise<FinalResult> {
    const effect = outcome.effect;
    if (!effect) return outcome.result;
    if (effect.regulationId) await this.statistics.invalidateRegulationCache(effect.regulationId);
    this.audit.log({
      actor_id: Number(effect.userId),
      actor_name: actorName,
      action: effect.method === 'timeout' ? 'exam.timeout' : 'exam.submit',
      object_type: 'exam_record',
      object_id: effect.recordId,
      detail: { status: effect.status, score: effect.score, timeout: effect.method === 'timeout' },
      result: 'success',
      source_ip: null,
    });
    return outcome.result;
  }

  async submit(userId: Id, recordId: Id, input?: unknown): Promise<FinalResult> {
    const completed = await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(SysUser).findOne({
        where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw Errors.notFound('用户不存在');
      if (Number(user.status) !== 1) throw Errors.accountDisabled();
      let record = await manager.getRepository(ExamRecord).findOne({ where: { id: String(recordId) } }) as ResultRecord | null;
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
      record = await manager.getRepository(ExamRecord).findOne({ where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' } }) as ResultRecord;
      if (record.status !== ExamStatus.IN_PROGRESS || record.gradingState !== 'not_submitted') {
          return { outcome: { result: await this.history.resultInTransaction(manager, record), effect: null }, actorName: user.username };
      }
      if (record.regulationId || !record.assignmentId) throw Errors.dataForbidden('请使用培训考试入口');
      const acceptedAt = new Date();
      if (acceptedAt.getTime() >= new Date(record.deadlineAt).getTime()) return { outcome: await this.finalize(manager, recordId, 'timeout', record), actorName: user.username };
      await assertExamIdentity(manager, String(userId));
      const snapshot = await this.reader.forGrading(manager, String(recordId));
      const answers = validateWholeSubmission(String(recordId), input, snapshot);
      const repo = manager.getRepository(ExamAnswer);
      await repo.delete({ examRecordId: String(recordId) });
      const items = new Map(snapshot.items.map((item) => [String(item.itemId), item]));
      await repo.save(answers.map((answer) => {
        const item = items.get(answer.item_id)!;
        const content = questionContent(item);
        return repo.create({ examRecordId: String(recordId), recordQuestionId: answer.item_id, questionId: String(item.questionId), selectedOptionIds: answer.option_ids, selected: answer.option_ids.map((id) => content.options.findIndex((option) => option.id === id)), isCorrect: null, gainedScore: null });
      }));
      return { outcome: await this.finalize(manager, recordId, 'manual', record, acceptedAt), actorName: user.username };
    });
    return this.publishFinalization(completed.outcome, completed.actorName);
  }

  async submitLegacy(userId: Id, recordId: Id, patch: Array<{ item_id: Id; selected?: number[] }>): Promise<FinalResult> {
    const completed = await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(SysUser).findOne({
        where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw Errors.notFound('用户不存在');
      if (Number(user.status) !== 1) throw Errors.accountDisabled();
      const record = await manager.getRepository(ExamRecord).findOne({
        where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
      }) as ResultRecord | null;
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
      if (record.status !== ExamStatus.IN_PROGRESS || record.gradingState !== 'not_submitted') {
        return { outcome: { result: await this.history.resultInTransaction(manager, record), effect: null }, actorName: user.username };
      }
      const acceptedAt = new Date();
      if (new Date(record.deadlineAt).getTime() <= acceptedAt.getTime()) {
        return { outcome: await this.finalize(manager, recordId, 'timeout', record), actorName: user.username };
      }
      await this.drafts.patchLegacyInTransaction(manager, userId, record as any, patch);
      return { outcome: await this.finalize(manager, recordId, 'manual', record, acceptedAt), actorName: user.username };
    });
    return this.publishFinalization(completed.outcome, completed.actorName);
  }

  async heartbeat(userId: Id, recordId: Id) {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(SysUser).findOne({
        where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw Errors.notFound('用户不存在');
      if (Number(user.status) !== 1) throw Errors.accountDisabled();
      const recordRepo = manager.getRepository(ExamRecord);
      const record = await recordRepo.findOne({
        where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
      }) as ResultRecord | null;
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
      if (record.status !== ExamStatus.IN_PROGRESS || record.gradingState !== 'not_submitted') {
        throw Errors.submitConflict('考试已结束');
      }
      const now = new Date();
      if (new Date(record.deadlineAt).getTime() <= now.getTime()) {
        return {
          expired: true as const,
          outcome: await this.finalize(manager, recordId, 'timeout', record),
          actorName: user.username,
        };
      }
      return {
        expired: false as const,
        value: {
          server_time: now.toISOString(),
          remaining_seconds: Math.max(0, Math.floor((new Date(record.deadlineAt).getTime() - now.getTime()) / 1000)),
          deadline_at: new Date(record.deadlineAt).toISOString(),
          draft_revision: Number(record.draftRevision || 0),
        },
      };
    });
    if (outcome.expired) {
      await this.publishFinalization(outcome.outcome, outcome.actorName);
      throw Errors.submitConflict('考试已超时未交卷');
    }
    return outcome.value;
  }

  async timeout(recordId: Id): Promise<FinalResult> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const record = await manager.getRepository(ExamRecord).findOne({
        where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
      }) as ResultRecord | null;
      if (!record) throw Errors.notFound('考试记录不存在');
      if (record.status === ExamStatus.IN_PROGRESS && new Date(record.deadlineAt).getTime() > Date.now()) {
        throw Errors.submitConflict('考试尚未到期');
      }
      return this.finalize(manager, recordId, 'timeout', record);
    });
    return this.publishFinalization(outcome, 'system');
  }

  async result(userId: Id, recordId: Id): Promise<FinalResult> {
    return this.history.result(userId, recordId);
  }

  async finalize(
    manager: EntityManager,
    recordId: Id,
    method: SubmissionMethod,
    alreadyLocked?: ResultRecord,
    acceptedAt = new Date(),
  ): Promise<FinalizationOutcome> {
    const recordRepo = manager.getRepository(ExamRecord);
    const record = alreadyLocked || await recordRepo.findOne({
      where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
    }) as ResultRecord | null;
    if (!record) throw Errors.notFound('考试记录不存在');
    if (record.status !== ExamStatus.IN_PROGRESS || record.gradingState !== 'not_submitted') {
      return { result: await this.history.resultInTransaction(manager, record), effect: null };
    }
    if (method === 'timeout') {
      const expired = await expireExamRecord(manager, record);
      return { result: await this.history.resultInTransaction(manager, expired), effect: { recordId: String(record.id), regulationId: record.regulationId, userId: String(record.userId), method, status: expired.status, score: 0 } };
    }
    const snapshot = await this.reader.forGrading(manager, String(recordId));
    const answerRepo = manager.getRepository(ExamAnswer);
    const rows = await answerRepo.find({ where: { examRecordId: String(recordId) } });
    const byItem = new Map(rows.filter((row) => row.recordQuestionId).map((row) => [String(row.recordQuestionId), row]));
    const grade = gradeSubmissionSnapshot(snapshot, rows);
    const detailsByItem = new Map(grade.details.map((detail) => [String(detail.itemId), detail]));
    const persisted = snapshot.items.map((item) => {
      const existing = byItem.get(String(item.itemId));
      const detail = detailsByItem.get(String(item.itemId))!;
      return answerRepo.create({
        ...(existing || {}),
        examRecordId: String(record.id),
        recordQuestionId: String(item.itemId),
        questionId: String(item.questionId),
        selected: existing?.selected || null,
        isCorrect: detail.isCorrect,
        gainedScore: (detail.gainedCents / 100).toFixed(2),
      });
    });
    if (persisted.length) await answerRepo.save(persisted);

    const submittedAt = acceptedAt;
    record.submissionMethod = method;
    record.submittedAt = submittedAt;
    record.activeAssignmentId = null;
    record.gradingState = 'finalized';
    record.gradedAt = submittedAt;
    record.score = (grade.totalCents / 100).toFixed(2);
    record.status = grade.totalCents >= Number(snapshot.rule.passCents) ? ExamStatus.PASSED : ExamStatus.FAILED;
    const saved = await recordRepo.save(record) as ResultRecord;
    return {
      result: await this.history.resultInTransaction(manager, saved, snapshot, persisted),
      effect: {
        recordId: String(saved.id),
        regulationId: saved.regulationId ? String(saved.regulationId) : null,
        userId: String(saved.userId),
        method,
        status: saved.status,
        score: saved.score === null ? null : Number(saved.score),
      },
    };
  }

}
