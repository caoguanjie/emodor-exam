import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors, ExamStatus } from '../../common/errors';
import type { AnswerInput, DraftAck, DraftInput, Id } from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamRecordQuestion } from '../../entities/exam-record-question.entity';
import { SysUser } from '../../entities/sys-user.entity';

type DraftRecord = ExamRecord & {
  draftRevision: number;
  draftPayloadHash: string | null;
  draftSavedAt: Date | null;
};

function compareIds(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function canonicalAnswers(input: DraftInput): AnswerInput[] {
  if (!input || !Number.isInteger(input.revision) || input.revision < 0 || !Array.isArray(input.answers)) {
    throw Errors.param('草稿格式不合法');
  }
  const seen = new Set<string>();
  const answers = input.answers.map((answer) => {
    const itemId = String(answer?.item_id || '');
    if (!/^[1-9]\d*$/.test(itemId)) throw Errors.param('作答题号不合法');
    if (seen.has(itemId)) throw Errors.param('同一题目不能重复提交');
    seen.add(itemId);
    const unknown = Object.keys(answer || {}).filter((key) => key !== 'item_id' && key !== 'selected');
    if (unknown.length) throw Errors.param(`作答包含不支持的字段：${unknown.join(',')}`);
    const selected = answer.selected === undefined ? [] : answer.selected;
    if (!Array.isArray(selected) || !selected.every(Number.isInteger)) throw Errors.param('选项下标不合法');
    return {
      item_id: itemId,
      ...(selected.length ? { selected: [...selected].sort((a, b) => a - b) } : {}),
    };
  });
  return answers.sort((left, right) => compareIds(left.item_id, right.item_id));
}

function payloadHash(input: DraftInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalAnswers(input))).digest('hex');
}

function rowAnswer(row: ExamAnswer, item: ExamRecordQuestion | undefined): AnswerInput | null {
  if (!row.recordQuestionId) return null;
  const selected = Array.isArray(row.selected) && item
    ? row.selected.map(Number).map((original) => item.displayToOriginal.indexOf(original))
      .filter((display) => display >= 0).sort((left, right) => left - right)
    : [];
  if (!selected.length) return null;
  return {
    item_id: String(row.recordQuestionId),
    ...(selected.length ? { selected } : {}),
  };
}

@Injectable()
export class AnswerDraftService {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamAnswer) private readonly answerRepo: Repository<ExamAnswer>,
    @InjectRepository(ExamRecordQuestion) private readonly itemRepo: Repository<ExamRecordQuestion>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly dataSource: DataSource,
  ) {}

  private repositories(manager?: EntityManager) {
    return {
      records: manager?.getRepository(ExamRecord) || this.recordRepo,
      answers: manager?.getRepository(ExamAnswer) || this.answerRepo,
      items: manager?.getRepository(ExamRecordQuestion) || this.itemRepo,
      users: manager?.getRepository(SysUser) || this.userRepo,
    };
  }

  async confirmedAnswers(recordId: Id, manager?: EntityManager): Promise<AnswerInput[]> {
    const repos = this.repositories(manager);
    const [rows, items] = await Promise.all([
      repos.answers.find({ where: { examRecordId: String(recordId) } }),
      repos.items.find({ where: { recordId: String(recordId) } }),
    ]);
    const itemMap = new Map(items.map((item) => [String(item.id), item]));
    return rows.map((row) => rowAnswer(row, row.recordQuestionId ? itemMap.get(String(row.recordQuestionId)) : undefined))
      .filter((answer): answer is AnswerInput => Boolean(answer))
      .sort((left, right) => compareIds(left.item_id, right.item_id));
  }

  private async assertUser(manager: EntityManager, userId: Id): Promise<void> {
    const user = await manager.getRepository(SysUser).findOne({
      where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw Errors.notFound('用户不存在');
    if (Number(user.status) !== 1) throw Errors.accountDisabled();
  }

  private async lockedRecord(manager: EntityManager, userId: Id, recordId: Id): Promise<DraftRecord> {
    const record = await manager.getRepository(ExamRecord).findOne({
      where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' },
    }) as DraftRecord | null;
    if (!record) throw Errors.notFound('考试记录不存在');
    if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
    return record;
  }

  private ack(record: DraftRecord, answeredCount: number): DraftAck {
    if (!record.draftSavedAt) throw Errors.internal('草稿确认时间缺失');
    return {
      revision: Number(record.draftRevision),
      saved_at: new Date(record.draftSavedAt).toISOString(),
      answered_count: answeredCount,
    };
  }

  async save(userId: Id, recordId: Id, input: DraftInput): Promise<DraftAck> {
    return this.dataSource.transaction((manager) => this.saveInTransaction(manager, userId, recordId, input));
  }

  async saveInTransaction(
    manager: EntityManager,
    userId: Id,
    recordId: Id,
    input: DraftInput,
    locked?: DraftRecord,
  ): Promise<DraftAck> {
    if (!locked) await this.assertUser(manager, userId);
    const record = locked || await this.lockedRecord(manager, userId, recordId);
    if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
    const normalizedAnswers = canonicalAnswers(input);
    const hash = payloadHash({ revision: input.revision, answers: normalizedAnswers });
    const currentRevision = Number(record.draftRevision || 0);
    if (Number(input.revision) === currentRevision) {
      if (record.draftPayloadHash !== hash || !record.draftSavedAt) throw Errors.submitConflict('草稿版本冲突，请恢复最新草稿');
      const existing = await this.confirmedAnswers(recordId, manager);
      return this.ack(record, existing.length);
    }
    if (Number(input.revision) !== currentRevision + 1) throw Errors.submitConflict('草稿版本冲突，请恢复最新草稿');
    if (record.status !== ExamStatus.IN_PROGRESS) throw Errors.submitConflict('考试已结束');
    if (new Date(record.deadlineAt).getTime() <= Date.now()) throw Errors.submitConflict('考试已超时，不能保存新答案');

    const repos = this.repositories(manager);
    const items = await repos.items.find({ where: { recordId: String(record.id) }, order: { position: 'ASC', id: 'ASC' } });
    const itemMap = new Map(items.map((item) => [String(item.id), item]));
    const toPersist: Array<{ input: AnswerInput; item: ExamRecordQuestion }> = [];
    for (const answer of normalizedAnswers) {
      const item = itemMap.get(String(answer.item_id));
      if (!item) throw Errors.param('作答题目不属于本次考试');
      const selected = answer.selected || [];
      if (new Set(selected).size !== selected.length || selected.some((value) => value < 0 || value >= item.displayToOriginal.length)) {
        throw Errors.param('选项下标不合法或重复');
      }
      if ((item.type === 'single' || item.type === 'judgment') && selected.length > 1) {
        throw Errors.param('单选或判断题只能选择一个选项');
      }
      if (!['single', 'multiple', 'judgment'].includes(item.type)) throw Errors.param('题型不支持');
      if (selected.length) toPersist.push({ input: answer, item });
    }

    const existingRows = await repos.answers.find({ where: { examRecordId: String(record.id) } });
    const existingByItem = new Map(existingRows.filter((row) => row.recordQuestionId)
      .map((row) => [String(row.recordQuestionId), row]));
    const keep = new Set(toPersist.map(({ item }) => String(item.id)));
    for (const row of existingRows) {
      if (row.recordQuestionId && !keep.has(String(row.recordQuestionId))) await repos.answers.delete({ id: row.id });
    }
    const rows = toPersist.map(({ input: answer, item }) => {
      const row = existingByItem.get(String(item.id));
      return repos.answers.create({
        ...(row || {}),
        examRecordId: String(record.id),
        recordQuestionId: String(item.id),
        questionId: String(item.questionId),
        selected: answer.selected?.length
          ? answer.selected.map((display) => item.displayToOriginal[display]).sort((left, right) => left - right)
          : null,
        isCorrect: null,
        gainedScore: null,
      });
    });
    if (rows.length) await repos.answers.save(rows);
    record.draftRevision = Number(input.revision);
    record.draftPayloadHash = hash;
    record.draftSavedAt = new Date();
    await repos.records.save(record);
    return this.ack(record, rows.length);
  }

  async patchLegacy(userId: Id, recordId: Id, patch: AnswerInput[]): Promise<DraftAck> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertUser(manager, userId);
      const record = await this.lockedRecord(manager, userId, recordId);
      return this.patchLegacyInTransaction(manager, userId, record, patch);
    });
  }

  async patchLegacyInTransaction(
    manager: EntityManager,
    userId: Id,
    record: DraftRecord,
    patch: AnswerInput[],
  ): Promise<DraftAck> {
    const current = new Map((await this.confirmedAnswers(record.id, manager)).map((answer) => [String(answer.item_id), answer]));
    for (const answer of patch) {
      const normalized = canonicalAnswers({ revision: 0, answers: [answer] })[0];
      if (normalized.selected?.length) current.set(String(normalized.item_id), normalized);
      else current.delete(String(normalized.item_id));
    }
    return this.saveInTransaction(manager, userId, record.id, {
      revision: Number(record.draftRevision || 0) + 1,
      answers: [...current.values()],
    }, record);
  }
}
