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
import { controlledQuestionMediaIds } from '../questions/question-validator';
import type { PublishedQuestionSnapshot } from './paper-release.service';

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
  return controlledQuestionMediaIds([
    snapshot.stem,
    ...snapshot.options.map((option) => option.text),
  ]);
}

export function resultMediaIds(snapshot: PublishedQuestionSnapshot): string[] {
  return controlledQuestionMediaIds([snapshot.analysis, snapshot.rubric]);
}

/** Public in-progress view. Standard answers, analysis and rubric never cross this boundary. */
export function attemptQuestionView(row: AttemptQuestionRow): AttemptQuestion {
  const snapshot = row.snapshotJson;
  const mapping = row.displayToOriginal;
  return {
    item_id: String(row.id),
    type: snapshot.type,
    stem: snapshot.stem,
    options: mapping.map((originalIndex) => snapshot.options[originalIndex]).filter(Boolean).map((option) => ({ ...option })),
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

  private async canReadQuestionMedia(actorId: string, itemId: string, assetId?: string): Promise<boolean> {
    if (!assetId) return false;
    const resolved = await this.itemWithRecord(itemId);
    if (!resolved) return false;
    const prompt = promptMediaIds(resolved.item.snapshotJson).includes(String(assetId));
    const resultOnly = resultMediaIds(resolved.item.snapshotJson).includes(String(assetId));
    if (!prompt && !resultOnly) return false;
    const terminal = resolved.record.status !== ExamStatus.IN_PROGRESS && Boolean(resolved.record.submittedAt);
    if (String(resolved.record.userId) === String(actorId)) return prompt || (resultOnly && terminal);
    const permissions = await this.access.permissions(String(actorId));
    const canReadRecord = permissions.includes('exam_records:review') || permissions.includes('exam_records:read');
    return canReadRecord && (prompt || (resultOnly && terminal));
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
      const assetIds = Array.isArray(row.assetIds) ? row.assetIds.map(String) : [];
      if (!selected.length && !assetIds.length) continue;
      answers.push({
        item_id: String(itemId),
        ...(selected.length ? { selected } : {}),
        ...(assetIds.length ? { asset_ids: assetIds } : {}),
      });
    }
    return answers.sort((left, right) => BigInt(left.item_id) < BigInt(right.item_id) ? -1 : 1);
  }

  async forStudent(userId: Id, recordId: Id): Promise<AttemptView> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const record = await manager.getRepository(ExamRecord).findOne({ where: { id: String(recordId) } });
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
      if (record.status !== ExamStatus.IN_PROGRESS) throw Errors.submitConflict('考试已结束');
      if (!record.assignmentId || !record.ruleSnapshot || !record.difficulty) {
        throw Errors.notFound('本次个人题单不存在');
      }
      const items = await manager.getRepository(ExamRecordQuestion).find({
        where: { recordId: String(record.id) }, order: { position: 'ASC', id: 'ASC' },
      });
      if (!items.length) throw Errors.notFound('本次个人题单不存在');
      return {
        record_id: String(record.id),
        paper_id: String(record.paperId),
        release_id: record.releaseId ? String(record.releaseId) : null,
        source: record.source,
        category_id: record.categoryId ? String(record.categoryId) : null,
        difficulty: record.difficulty,
        deadline_at: new Date(record.deadlineAt).toISOString(),
        server_now: new Date().toISOString(),
        draft_revision: Number(record.draftRevision || 0),
        questions: items.map(attemptQuestionView),
        answers: await this.confirmedAnswers(manager, String(record.id), items),
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
