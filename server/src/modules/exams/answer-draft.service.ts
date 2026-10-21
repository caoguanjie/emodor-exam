import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Errors, ExamStatus } from '../../common/errors';
import type { AnswerInput, DraftAck, DraftInput, Id } from '../../common/training-contracts';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamRecordQuestion } from '../../entities/exam-record-question.entity';
import { MediaReference } from '../../entities/media-reference.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { AccessService } from '../access/access.service';
import { MediaService, type MediaUploadResult } from '../media/media.service';

export const ANSWER_MEDIA_OWNER = 'exam_answer_item';

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
    const selected = answer.selected === undefined ? [] : answer.selected;
    const assetIds = answer.asset_ids === undefined ? [] : answer.asset_ids.map(String);
    if (!Array.isArray(selected) || !selected.every(Number.isInteger)) throw Errors.param('选项下标不合法');
    if (!Array.isArray(assetIds) || assetIds.some((id) => !/^[1-9]\d*$/.test(id))) throw Errors.param('附件编号不合法');
    return {
      item_id: itemId,
      ...(selected.length ? { selected: [...selected].sort((a, b) => a - b) } : {}),
      ...(assetIds.length ? { asset_ids: [...assetIds].sort(compareIds) } : {}),
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
  const assetIds = Array.isArray(row.assetIds) ? row.assetIds.map(String) : [];
  if (!selected.length && !assetIds.length) return null;
  return {
    item_id: String(row.recordQuestionId),
    ...(selected.length ? { selected } : {}),
    ...(assetIds.length ? { asset_ids: assetIds } : {}),
  };
}

@Injectable()
export class AnswerDraftService implements OnModuleInit {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamAnswer) private readonly answerRepo: Repository<ExamAnswer>,
    @InjectRepository(ExamRecordQuestion) private readonly itemRepo: Repository<ExamRecordQuestion>,
    @InjectRepository(MediaReference) private readonly referenceRepo: Repository<MediaReference>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly access: AccessService,
  ) {}

  onModuleInit(): void {
    this.media.registerOwnerPolicy(ANSWER_MEDIA_OWNER, {
      allowedPurposes: ['answer'],
      authorizeRead: (actorId, itemId, assetId) => this.canReadAnswer(actorId, itemId, assetId),
      validateBinding: (manager, asset, itemId) => this.validateAnswerBinding(manager, asset, itemId),
    });
  }

  private repositories(manager?: EntityManager) {
    return {
      records: manager?.getRepository(ExamRecord) || this.recordRepo,
      answers: manager?.getRepository(ExamAnswer) || this.answerRepo,
      items: manager?.getRepository(ExamRecordQuestion) || this.itemRepo,
      references: manager?.getRepository(MediaReference) || this.referenceRepo,
      users: manager?.getRepository(SysUser) || this.userRepo,
    };
  }

  private async itemAndRecord(itemId: Id, manager?: EntityManager) {
    const repos = this.repositories(manager);
    const item = await repos.items.findOne({ where: { id: String(itemId) } });
    if (!item) return null;
    const record = await repos.records.findOne({ where: { id: String(item.recordId) } });
    return record ? { item, record } : null;
  }

  private async canReadAnswer(actorId: Id, itemId: Id, assetId?: Id): Promise<boolean> {
    if (!assetId) return false;
    const resolved = await this.itemAndRecord(String(itemId));
    if (!resolved) return false;
    if (String(resolved.record.userId) === String(actorId)) return true;
    if (resolved.record.status === ExamStatus.IN_PROGRESS) return false;
    const permissions = await this.access.permissions(String(actorId));
    if (!permissions.includes('exam_records:review')) return false;
    const answer = await this.answerRepo.findOne({
      where: { examRecordId: String(resolved.record.id), recordQuestionId: String(resolved.item.id) },
    });
    return Boolean(Array.isArray(answer?.assetIds) && answer.assetIds.map(String).includes(String(assetId)));
  }

  private async validateAnswerBinding(manager: EntityManager, asset: any, itemId: Id): Promise<void> {
    const resolved = await this.itemAndRecord(String(itemId), manager);
    if (!resolved || resolved.item.type !== 'image') throw Errors.dataForbidden('附件不属于图片作答题');
    const ownerId = String(resolved.record.userId);
    if (asset.purpose !== 'answer' || asset.mediaKind !== 'image'
      || String(asset.ownerId) !== ownerId || String(asset.uploadedBy) !== ownerId) {
      throw Errors.dataForbidden('答案附件上传身份不匹配');
    }
    if (resolved.record.status !== ExamStatus.IN_PROGRESS || new Date(resolved.record.deadlineAt).getTime() <= Date.now()) {
      throw Errors.submitConflict('考试已结束，不能绑定答案附件');
    }
    const references = await manager.getRepository(MediaReference).find({
      where: { assetId: String(asset.id), ownerType: ANSWER_MEDIA_OWNER },
    });
    if (references.some((reference) => String(reference.ownerId) !== String(itemId))) {
      throw Errors.dataForbidden('答案附件已属于另一道题');
    }
  }

  private async requireActiveTarget(userId: Id, recordId: Id, itemId: Id, manager?: EntityManager, lock = false) {
    const repos = this.repositories(manager);
    const record = await repos.records.findOne({
      where: { id: String(recordId) },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!record) throw Errors.notFound('考试记录不存在');
    if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
    if (record.status !== ExamStatus.IN_PROGRESS || new Date(record.deadlineAt).getTime() <= Date.now()) {
      throw Errors.submitConflict('考试已结束');
    }
    const item = await repos.items.findOne({ where: { id: String(itemId) } });
    if (!item || String(item.recordId) !== String(record.id)) throw Errors.dataForbidden('题目不属于本次考试');
    if (item.type !== 'image') throw Errors.param('只有图片题可上传答案图片');
    return { record, item };
  }

  async uploadImage(userId: Id, recordId: Id, itemId: Id, file: Express.Multer.File): Promise<MediaUploadResult> {
    await this.requireActiveTarget(userId, recordId, itemId);
    const uploaded = await this.media.uploadAnswer(String(userId), file);
    try {
      await this.dataSource.transaction(async (manager) => {
        const user = await manager.getRepository(SysUser).findOne({
          where: { id: String(userId) }, lock: { mode: 'pessimistic_write' },
        });
        if (!user) throw Errors.notFound('用户不存在');
        if (Number(user.status) !== 1) throw Errors.accountDisabled();
        await this.requireActiveTarget(userId, recordId, itemId, manager, true);
        await this.media.bind(manager, uploaded.assetId, ANSWER_MEDIA_OWNER, String(itemId));
      });
      return uploaded;
    } catch (error) {
      await this.media.remove(String(userId), uploaded.assetId).catch(() => undefined);
      throw error;
    }
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

  /**
   * Upload references establish attempt/item context, not confirmation. Once an
   * attempt ends, release every answer reference not present in the committed
   * draft so A4's existing orphan sweeper can reclaim the physical asset.
   */
  async releaseUnconfirmedReferences(manager: EntityManager, recordId: Id, confirmedAssetIds: Id[]): Promise<void> {
    const itemRows = await manager.getRepository(ExamRecordQuestion).find({ where: { recordId: String(recordId) } });
    const itemIds = itemRows.map((item) => String(item.id));
    if (!itemIds.length) return;
    const references = await manager.getRepository(MediaReference).find({
      where: { ownerType: ANSWER_MEDIA_OWNER, ownerId: In(itemIds) },
    });
    const keep = new Set(confirmedAssetIds.map(String));
    for (const reference of references) {
      if (!keep.has(String(reference.assetId))) {
        await this.media.unbind(manager, String(reference.assetId), ANSWER_MEDIA_OWNER, String(reference.ownerId));
      }
    }
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
      const assetIds = answer.asset_ids || [];
      if (new Set(selected).size !== selected.length || selected.some((value) => value < 0 || value >= item.displayToOriginal.length)) {
        throw Errors.param('选项下标不合法或重复');
      }
      if (new Set(assetIds).size !== assetIds.length) throw Errors.param('答案附件不能重复');
      if (item.type === 'image') {
        if (selected.length) throw Errors.param('图片题不能提交选项答案');
        if (assetIds.length > TRAINING_DEFAULTS.imageAssetsPerItem) {
          throw Errors.param(`图片作答最多 ${TRAINING_DEFAULTS.imageAssetsPerItem} 张`);
        }
        for (const assetId of assetIds) {
          await this.media.assertUsable(userId, assetId, 'answer', userId, manager);
          const reference = await repos.references.findOne({
            where: { assetId: String(assetId), ownerType: ANSWER_MEDIA_OWNER, ownerId: String(item.id) },
          });
          if (!reference) throw Errors.dataForbidden('答案附件不属于本次作答题目');
        }
      } else {
        if (assetIds.length) throw Errors.param('客观题不能提交答案附件');
        if ((item.type === 'single' || item.type === 'judgment') && selected.length > 1) {
          throw Errors.param('单选或判断题只能选择一个选项');
        }
        if (!['single', 'multiple', 'judgment'].includes(item.type)) throw Errors.param('题型不支持');
      }
      if (selected.length || assetIds.length) toPersist.push({ input: answer, item });
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
        assetIds: answer.asset_ids?.length ? answer.asset_ids.map(String) : null,
        isCorrect: null,
        gainedScore: null,
        comment: null,
        gradingVersion: 0,
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
      if (normalized.selected?.length || normalized.asset_ids?.length) current.set(String(normalized.item_id), normalized);
      else current.delete(String(normalized.item_id));
    }
    return this.saveInTransaction(manager, userId, record.id, {
      revision: Number(record.draftRevision || 0) + 1,
      answers: [...current.values()],
    }, record);
  }
}
