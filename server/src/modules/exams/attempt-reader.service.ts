import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors, ExamStatus } from '../../common/errors';
import type { AnswerInput, AttemptQuestion, AttemptView, Id, RuleSnapshot } from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamRecordQuestion } from '../../entities/exam-record-question.entity';
import { MediaService } from '../media/media.service';
import { AccessService } from '../access/access.service';
import type { PublishedQuestionSnapshot } from './paper-release.service';
import { collectContentAssetIds, parseQuestionContent, projectStudentContent } from '../questions/question-content-dispatch';
import { assertExamIdentity, expireExamRecord, isScoredLegacyTimeout } from './exam-state';
import { SysUser } from '../../entities/sys-user.entity';
import { examPurposeOf } from './exam-purpose';
import { assertContentCapability, requiredContentCapability } from './question-content-capability';

export type GradingSnapshotItem = PublishedQuestionSnapshot & {
  itemId: Id;
  displayToOriginal: number[];
  position: number;
};

export interface GradingSnapshot {
  recordId: Id;
  rule: RuleSnapshot;
  items: GradingSnapshotItem[];
}

type AttemptQuestionRow = Pick<ExamRecordQuestion, 'id' | 'snapshotJson' | 'displayToOriginal' | 'scoreCents'>;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function promptMediaIds(snapshot: PublishedQuestionSnapshot): string[] {
  const content = parseQuestionContent(snapshot);
  return collectContentAssetIds({ ...content, analysis: null });
}

export function resultMediaIds(snapshot: PublishedQuestionSnapshot): string[] {
  const content = parseQuestionContent(snapshot);
  if (!content.analysis) return [];
  const analysisIds = new Set<string>();
  const visit = (node: { type: string; attrs?: unknown; content?: readonly any[] }) => {
    if (node.type === 'image') analysisIds.add((node.attrs as { asset_id: string }).asset_id);
    node.content?.forEach(visit);
  };
  visit(content.analysis);
  const assets = new Set(collectContentAssetIds(content));
  return [...analysisIds].filter((id) => assets.has(id));
}

/** Public in-progress view. Standard answers and analysis never cross this boundary. */
export function attemptQuestionView(row: AttemptQuestionRow, contentVersion: 2 | 3 = 2): AttemptQuestion<2 | 3> {
  const snapshot = row.snapshotJson;
  const mapping = row.displayToOriginal;
  const content = parseQuestionContent(snapshot);
  assertContentCapability(content.schema, contentVersion);
  const visible = projectStudentContent(content);
  if (mapping.length !== content.options.length || new Set(mapping).size !== mapping.length || mapping.some((index) => !Number.isInteger(index) || index < 0 || index >= content.options.length)) throw Errors.param('冻结选项显示映射非法');
  return {
    ...(contentVersion === 3 ? { content_schema_version: content.schema } : {}),
    item_id: String(row.id),
    type: snapshot.type,
    stem: visible.stem,
    options: mapping.map((originalIndex) => visible.options[originalIndex]),
    score: Number(row.scoreCents) / 100,
  };
}

@Injectable()
export class AttemptReaderService implements OnModuleInit {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamRecordQuestion) private readonly itemRepo: Repository<ExamRecordQuestion>,
    @InjectRepository(ExamAnswer) private readonly answerRepo: Repository<ExamAnswer>,
    private readonly media: MediaService,
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
  ) {}

  onModuleInit(): void {
    this.media.registerOwnerPolicy('exam_record_question', {
      allowedPurposes: ['question'],
      authorizeRead: (actorId, itemId, assetId) => this.canReadQuestionMedia(actorId, itemId, assetId),
      authorizeTicket: (actorId, itemId, assetId) => this.canReadQuestionMedia(actorId, itemId, assetId, true),
      validateBinding: (manager, asset, itemId) => this.validateQuestionBinding(manager, itemId, String(asset.id)),
    });
  }

  private async itemWithRecord(
    itemId: string,
    manager?: EntityManager,
  ): Promise<{ item: ExamRecordQuestion; record: ExamRecord } | null> {
    const itemRepo = manager?.getRepository(ExamRecordQuestion) || this.itemRepo;
    const recordRepo = manager?.getRepository(ExamRecord) || this.recordRepo;
    const item = await itemRepo.findOne({ where: { id: String(itemId) } });
    if (!item) return null;
    const record = await recordRepo.findOne({ where: { id: String(item.recordId) } });
    return record ? { item, record } : null;
  }

  private async canReadQuestionMedia(actorId: string, itemId: string, assetId?: string, ticket = false): Promise<boolean> {
    if (!assetId) return false;
    const resolved = await this.itemWithRecord(itemId);
    if (!resolved) return false;
    const prompt = promptMediaIds(resolved.item.snapshotJson).includes(String(assetId));
    const resultOnly = resultMediaIds(resolved.item.snapshotJson).includes(String(assetId));
    if (!prompt && !resultOnly) return false;
    const terminal = ([ExamStatus.PASSED, ExamStatus.FAILED].includes(resolved.record.status as any) || isScoredLegacyTimeout(resolved.record)) && Boolean(resolved.record.submittedAt);
    const permissions = await this.access.permissions(String(actorId));
    const canReadRecord = permissions.includes('exam_records:read');
    if (!ticket && canReadRecord) return prompt || (resultOnly && terminal);
    if (ticket && canReadRecord) return false;
    if (String(resolved.record.userId) !== String(actorId)) return false;
    const actor = await this.dataSource.getRepository(SysUser).findOne({ where: { id: actorId } });
    if (!actor || actor.role !== 'employee' || Number(actor.status) !== 1) return false;
    if ((resolved.record.status === ExamStatus.TIMEOUT && !isScoredLegacyTimeout(resolved.record)) || resolved.record.status === ExamStatus.SUBMITTED) return false;
    if (terminal) return prompt || resultOnly;
    if (new Date(resolved.record.deadlineAt).getTime() <= Date.now()) {
      await this.dataSource.transaction(async (manager) => {
        const record = await manager.getRepository(ExamRecord).findOne({ where: { id: resolved.record.id }, lock: { mode: 'pessimistic_write' } });
        if (record?.status === ExamStatus.IN_PROGRESS && new Date(record.deadlineAt).getTime() <= Date.now()) await expireExamRecord(manager, record);
      });
      return false;
    }
    try { await assertExamIdentity(this.dataSource.manager, actorId); } catch { return false; }
    return prompt;
  }

  private async validateQuestionBinding(manager: EntityManager, itemId: string, assetId: string): Promise<void> {
    const resolved = await this.itemWithRecord(itemId, manager);
    if (!resolved) throw Errors.dataForbidden('媒体不属于本次冻结题目');
    if (promptMediaIds(resolved.item.snapshotJson).includes(String(assetId))) return;
    const terminal = resolved.record.status !== ExamStatus.IN_PROGRESS && Boolean(resolved.record.submittedAt);
    if (terminal && resultMediaIds(resolved.item.snapshotJson).includes(String(assetId))) return;
    throw Errors.dataForbidden('媒体不属于当前可读的冻结题目内容');
  }

  private async confirmedAnswers(manager: EntityManager, recordId: string, items: ExamRecordQuestion[]): Promise<AnswerInput[]> {
    const rows = await manager.getRepository(ExamAnswer).find({ where: { examRecordId: String(recordId) } });
    const allowed = new Set(items.map((item) => String(item.id)));
    const itemMap = new Map(items.map((item) => [String(item.id), item]));
    const answers: AnswerInput[] = [];
    for (const row of rows) {
      const itemId = row.recordQuestionId ? String(row.recordQuestionId) : '';
      if (!allowed.has(String(itemId))) continue;
      const item = itemMap.get(itemId);
      const selected = Array.isArray(row.selected) && item
        ? row.selected.map(Number).map((original) => item.displayToOriginal.indexOf(original))
          .filter((display) => display >= 0).sort((left, right) => left - right)
        : [];
      if (!selected.length) continue;
      answers.push({
        item_id: String(itemId),
        ...(selected.length ? { selected } : {}),
      });
    }
    return answers.sort((left, right) => BigInt(left.item_id) < BigInt(right.item_id) ? -1 : 1);
  }

  forStudent(userId: Id, recordId: Id, contentVersion?: 2): Promise<AttemptView>;
  forStudent(userId: Id, recordId: Id, contentVersion: 2 | 3): Promise<AttemptView<2 | 3>>;
  async forStudent(userId: Id, recordId: Id, contentVersion: 2 | 3 = 2): Promise<AttemptView<2 | 3>> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      let record = await manager.getRepository(ExamRecord).findOne({ where: { id: String(recordId) }, lock: { mode: 'pessimistic_write' } });
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
      if (record.status === ExamStatus.IN_PROGRESS && new Date(record.deadlineAt).getTime() <= Date.now()) record = await expireExamRecord(manager, record);
      const base = { exam_purpose: examPurposeOf(record.examPurpose), status: record.status as AttemptView['status'], record_id: String(record.id), paper_id: String(record.paperId), release_id: record.releaseId ? String(record.releaseId) : null, deadline_at: new Date(record.deadlineAt).toISOString(), server_now: new Date().toISOString() };
      if (record.status !== ExamStatus.IN_PROGRESS) return { ...base, questions: [] };
      if (!record.regulationId) await assertExamIdentity(manager, String(userId));
      if (!record.assignmentId || !record.ruleSnapshot || !record.difficulty) {
        throw Errors.notFound('本次个人题单不存在');
      }
      const items = await manager.getRepository(ExamRecordQuestion).find({
        where: { recordId: String(record.id) }, order: { position: 'ASC', id: 'ASC' },
      });
      if (!items.length) throw Errors.notFound('本次个人题单不存在');
      assertContentCapability(requiredContentCapability(items.map((item) => item.snapshotJson)), contentVersion);
      return {
        ...base,
        questions: items.map((item) => attemptQuestionView(item, contentVersion)),
      };
    });
  }

  async forGrading(manager: EntityManager, recordId: Id): Promise<GradingSnapshot> {
    const record = await manager.getRepository(ExamRecord).findOne({ where: { id: String(recordId) } });
    if (!record?.ruleSnapshot || !record.assignmentId) throw Errors.notFound('本次个人题单不存在');
    const rows = await manager.getRepository(ExamRecordQuestion).find({
      where: { recordId: String(recordId) },
      order: { position: 'ASC', id: 'ASC' },
    });
    if (!rows.length) throw Errors.notFound('本次个人题单不存在');
    return {
      recordId: String(record.id),
      rule: deepClone(record.ruleSnapshot),
      items: rows.map((row) => ({
        ...deepClone(row.snapshotJson),
        scoreCents: Number(row.scoreCents),
        itemId: String(row.id),
        displayToOriginal: [...row.displayToOriginal],
        position: Number(row.position),
      })),
    };
  }
}
