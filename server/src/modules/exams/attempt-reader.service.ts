import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Errors, ExamStatus } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import type { AnswerInput, AttemptQuestion, AttemptView, Id, RuleSnapshot } from '../../common/training-contracts';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamRecordQuestion } from '../../entities/exam-record-question.entity';
import { MediaService } from '../media/media.service';
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
    private readonly redis: RedisService,
    private readonly media: MediaService,
  ) {}

  onModuleInit(): void {
    this.media.registerOwnerPolicy('exam_record_question', {
      allowedPurposes: ['question'],
      authorizeRead: (actorId, itemId, assetId) => this.canReadPromptMedia(actorId, itemId, assetId),
      validateBinding: (manager, asset, itemId) => this.validatePromptBinding(manager, itemId, String(asset.id)),
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

  private async canReadPromptMedia(actorId: string, itemId: string, assetId?: string): Promise<boolean> {
    if (!assetId) return false;
    const resolved = await this.itemWithRecord(itemId);
    return Boolean(
      resolved
      && String(resolved.record.userId) === String(actorId)
      && promptMediaIds(resolved.item.snapshotJson).includes(String(assetId)),
    );
  }

  private async validatePromptBinding(manager: EntityManager, itemId: string, assetId: string): Promise<void> {
    const resolved = await this.itemWithRecord(itemId, manager);
    if (!resolved || !promptMediaIds(resolved.item.snapshotJson).includes(String(assetId))) {
      throw Errors.dataForbidden('媒体不属于本次题单的题干或选项');
    }
  }

  private async confirmedAnswers(recordId: string, items: ExamRecordQuestion[]): Promise<AnswerInput[]> {
    let raw: Record<string, string> = {};
    try {
      raw = await this.redis.hgetall(`exam:answer:${recordId}`) || {};
    } catch {
      // deadline and snapshot remain authoritative if Redis is unavailable;
      // C3 replaces this compatibility cache with persistent revisions.
      return [];
    }
    const allowed = new Set(items.map((item) => String(item.id)));
    const answers: AnswerInput[] = [];
    for (const [itemId, value] of Object.entries(raw)) {
      if (!allowed.has(String(itemId))) continue;
      try {
        const selected = JSON.parse(value);
        if (Array.isArray(selected)) answers.push({ item_id: String(itemId), selected: selected.map(Number) });
      } catch { /* corrupt compatibility cache is treated as unanswered */ }
    }
    return answers.sort((left, right) => BigInt(left.item_id) < BigInt(right.item_id) ? -1 : 1);
  }

  async forStudent(userId: Id, recordId: Id): Promise<AttemptView> {
    const record = await this.recordRepo.findOne({ where: { id: String(recordId) } });
    if (!record) throw Errors.notFound('考试记录不存在');
    if (String(record.userId) !== String(userId)) throw Errors.dataForbidden();
    if (record.status !== ExamStatus.IN_PROGRESS) throw Errors.submitConflict('考试已结束');
    if (!record.assignmentId || !record.ruleSnapshot || !record.difficulty) {
      throw Errors.notFound('本次个人题单不存在');
    }
    const items = await this.itemRepo.find({ where: { recordId: String(record.id) }, order: { position: 'ASC', id: 'ASC' } });
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
      draft_revision: 0,
      questions: items.map(attemptQuestionView),
      answers: await this.confirmedAnswers(String(record.id), items),
    };
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
