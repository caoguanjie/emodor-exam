import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors, ExamStatus } from '../../common/errors';
import type { DraftInput, FinalResult, Id, SubmissionMethod } from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { StatisticsService } from '../statistics/statistics.service';
import { AttemptReaderService, type GradingSnapshot } from './attempt-reader.service';
import { AnswerDraftService } from './answer-draft.service';
import { ExamHistoryService } from './exam-history.service';

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
    const selected = Array.isArray(row?.selected)
      ? [...new Set(row!.selected!.map(Number))].sort((left, right) => left - right)
      : [];
    const expected = [...new Set(item.answer.map(Number))].sort((left, right) => left - right);
    if (!selected.length) {
      return { itemId: String(item.itemId), selected: null, isCorrect: null, gainedCents: 0 };
    }
    const fullyCorrect = selected.length === expected.length && selected.every((value, index) => value === expected[index]);
    let gainedCents = 0;
    let isCorrect = 0;
    if (fullyCorrect) {
      gainedCents = Number(item.scoreCents);
      isCorrect = 1;
    } else if (item.type === 'multiple') {
      const expectedSet = new Set(expected);
      const hasWrong = selected.some((value) => !expectedSet.has(value));
      if (!hasWrong && selected.length < expected.length) {
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
      action: 'exam.submit',
      object_type: 'exam_record',
      object_id: effect.recordId,
      detail: { status: effect.status, score: effect.score, timeout: effect.method === 'timeout' },
      result: 'success',
      source_ip: null,
    });
    return outcome.result;
  }

  async submit(userId: Id, recordId: Id, input?: DraftInput): Promise<FinalResult> {
    const completed = await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(SysUser).findOne({
        where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw Errors.notFound('用户不存在');
      if (Number(user.status) !== 1) throw Errors.accountDisabled();
      let record = await manager.getRepository(ExamRecord).findOne({
        where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
      }) as ResultRecord | null;
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
      if (record.status !== ExamStatus.IN_PROGRESS || record.gradingState !== 'not_submitted') {
          return { outcome: { result: await this.history.resultInTransaction(manager, record), effect: null }, actorName: user.username };
      }
      const expired = new Date(record.deadlineAt).getTime() <= Date.now();
      if (input && !expired) {
        await this.drafts.saveInTransaction(manager, userId, recordId, input, record as any);
        record = await manager.getRepository(ExamRecord).findOne({
          where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
        }) as ResultRecord;
      }
      return { outcome: await this.finalize(manager, recordId, expired ? 'timeout' : 'manual', record), actorName: user.username };
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
      if (new Date(record.deadlineAt).getTime() <= Date.now()) {
        return { outcome: await this.finalize(manager, recordId, 'timeout', record), actorName: user.username };
      }
      await this.drafts.patchLegacyInTransaction(manager, userId, record as any, patch);
      return { outcome: await this.finalize(manager, recordId, 'manual', record), actorName: user.username };
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
      throw Errors.submitConflict('考试已超时，系统已自动交卷');
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
  ): Promise<FinalizationOutcome> {
    const recordRepo = manager.getRepository(ExamRecord);
    const record = alreadyLocked || await recordRepo.findOne({
      where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
    }) as ResultRecord | null;
    if (!record) throw Errors.notFound('考试记录不存在');
    if (record.status !== ExamStatus.IN_PROGRESS || record.gradingState !== 'not_submitted') {
      return { result: await this.history.resultInTransaction(manager, record), effect: null };
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

    const submittedAt = new Date();
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
