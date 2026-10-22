import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Errors, ExamStatus } from '../../common/errors';
import type {
  AnswerInput,
  ExamHistoryItem,
  FinalResult,
  FinalResultItem,
  Id,
  Page,
  WrongItem,
} from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamRecordQuestion } from '../../entities/exam-record-question.entity';
import { AccessService } from '../access/access.service';
import { MediaService } from '../media/media.service';
import { AttemptReaderService, attemptQuestionView, resultMediaIds, type GradingSnapshot, type GradingSnapshotItem } from './attempt-reader.service';

type ResultRecord = ExamRecord;

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function answerView(row: ExamAnswer | undefined, item: GradingSnapshotItem): AnswerInput | null {
  if (!row) return null;
  const selected = Array.isArray(row.selected)
    ? row.selected.map(Number).map((original) => item.displayToOriginal.indexOf(original))
      .filter((display) => display >= 0).sort((left, right) => left - right)
    : [];
  if (!selected.length) return null;
  return {
    item_id: String(item.itemId),
    ...(selected.length ? { selected } : {}),
  };
}

export function projectResultItem(item: GradingSnapshotItem, recordId: Id, row?: ExamAnswer): FinalResultItem {
  const question = attemptQuestionView({
    id: String(item.itemId), recordId: String(recordId), questionId: String(item.questionId),
    type: item.type, scoreCents: Number(item.scoreCents), position: Number(item.position),
    displayToOriginal: [...item.displayToOriginal], snapshotJson: item,
  } as any);
  const correctAnswer = item.answer
    .map((original) => item.displayToOriginal.indexOf(Number(original)))
    .filter((display) => display >= 0);
  return {
    ...question,
    answer: answerView(row, item),
    correct_answer: correctAnswer,
    analysis: item.analysis ?? null,
    gained_score: row?.gainedScore === null || row?.gainedScore === undefined ? null : Number(row.gainedScore),
  };
}

export function projectFinalResult(record: ResultRecord, snapshot: GradingSnapshot, rows: ExamAnswer[]): FinalResult {
  if (!record.submittedAt) throw Errors.internal('历史考试结果缺少交卷时间');
  const byItem = new Map(rows.filter((row) => row.recordQuestionId).map((row) => [String(row.recordQuestionId), row]));
  const finalized = record.gradingState === 'finalized';
  const items = snapshot.items.map((item) => projectResultItem(item, String(record.id), byItem.get(String(item.itemId))));
  const fullScoreCount = snapshot.items.filter((item) => {
    const row = byItem.get(String(item.itemId));
    return Math.round(Number(row?.gainedScore || 0) * 100) === Number(item.scoreCents);
  }).length;
  return {
    record_id: String(record.id),
    grading_state: record.gradingState || (record.score === null ? 'not_submitted' : 'finalized'),
    submission_method: record.submissionMethod || null,
    legacy: !record.submissionMethod,
    submitted_at: new Date(record.submittedAt).toISOString(),
    graded_at: iso(record.gradedAt),
    score: finalized && record.score !== null ? Number(record.score) : null,
    passed: finalized ? record.status === ExamStatus.PASSED : null,
    correct_rate: finalized ? (items.length ? fullScoreCount / items.length : null) : null,
    items,
  };
}

function projectSnapshotlessLegacy(record: ResultRecord): FinalResult {
  if (!record.submittedAt) throw Errors.internal('历史考试结果缺少交卷时间');
  const finalized = record.gradingState === 'finalized' || (
    [ExamStatus.PASSED, ExamStatus.FAILED].includes(record.status as any) && record.score !== null
  );
  return {
    record_id: String(record.id),
    grading_state: finalized ? 'finalized' : record.gradingState,
    submission_method: record.submissionMethod || null,
    legacy: true,
    submitted_at: new Date(record.submittedAt).toISOString(),
    graded_at: iso(record.gradedAt),
    score: finalized && record.score !== null ? Number(record.score) : null,
    passed: finalized && record.status === ExamStatus.PASSED
      ? true
      : finalized && record.status === ExamStatus.FAILED ? false : null,
    correct_rate: null,
    items: [],
  };
}

@Injectable()
export class ExamHistoryService {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamAnswer) private readonly answerRepo: Repository<ExamAnswer>,
    @InjectRepository(ExamRecordQuestion) private readonly itemRepo: Repository<ExamRecordQuestion>,
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    private readonly reader: AttemptReaderService,
    private readonly access: AccessService,
    private readonly media: MediaService,
    private readonly dataSource: DataSource,
  ) {}

  async result(viewerId: Id, recordId: Id): Promise<FinalResult> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const record = await manager.getRepository(ExamRecord).findOne({ where: { id: String(recordId) } });
      if (!record) throw Errors.notFound('考试记录不存在');
      if (String(record.userId) !== String(viewerId)) throw Errors.dataForbidden();
      if (record.status === ExamStatus.IN_PROGRESS && record.gradingState === 'not_submitted') {
        throw Errors.submitConflict('考试进行中，结果不可查');
      }
      return this.resultInTransaction(manager, record);
    });
  }

  async adminResult(viewerId: Id, recordId: Id): Promise<FinalResult> {
    const permissions = await this.access.permissions(String(viewerId));
    if (!permissions.includes('exam_records:read')) {
      throw Errors.forbidden();
    }
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const record = await manager.getRepository(ExamRecord).findOne({ where: { id: String(recordId) } });
      if (!record) throw Errors.notFound('考试记录不存在');
      if (record.status === ExamStatus.IN_PROGRESS && record.gradingState === 'not_submitted') {
        throw Errors.submitConflict('考试进行中，结果不可查');
      }
      return this.resultInTransaction(manager, record);
    });
  }

  async resultInTransaction(
    manager: EntityManager,
    record: ResultRecord,
    suppliedSnapshot?: GradingSnapshot,
    suppliedRows?: ExamAnswer[],
  ): Promise<FinalResult> {
    if (!record.submittedAt) throw Errors.internal('历史考试结果缺少交卷时间');
    let snapshot = suppliedSnapshot;
    if (!snapshot) {
      if (!record.assignmentId) return projectSnapshotlessLegacy(record);
      if (!record.ruleSnapshot) throw Errors.internal('考试记录缺少冻结规则');
      const itemCount = await manager.getRepository(ExamRecordQuestion).count({ where: { recordId: String(record.id) } });
      if (!itemCount) throw Errors.internal('考试记录缺少冻结题单');
      snapshot = await this.reader.forGrading(manager, String(record.id));
    }
    await this.ensureResultMediaReferences(manager, snapshot.items);
    const rows = suppliedRows || await manager.getRepository(ExamAnswer).find({ where: { examRecordId: String(record.id) } });
    return projectFinalResult(record, snapshot, rows);
  }

  private async ensureResultMediaReferences(
    manager: EntityManager,
    items: GradingSnapshotItem[],
  ): Promise<void> {
    const references = new Map<string, { assetId: string; itemId: string }>();
    for (const item of items) {
      for (const assetId of resultMediaIds(item)) {
        const reference = { assetId: String(assetId), itemId: String(item.itemId) };
        references.set(`${reference.assetId}:${reference.itemId}`, reference);
      }
    }
    const compareId = (left: string, right: string) => {
      const leftId = BigInt(left);
      const rightId = BigInt(right);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    };
    const ordered = [...references.values()].sort((left, right) => (
      compareId(left.assetId, right.assetId) || compareId(left.itemId, right.itemId)
    ));
    for (const reference of ordered) {
      await this.media.bind(manager, reference.assetId, 'exam_record_question', reference.itemId);
    }
  }

  async history(userId: Id, page: number, pageSize: number): Promise<Page<ExamHistoryItem>> {
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize || 20)));
    const [rows, total] = await this.recordRepo.findAndCount({
      where: { userId: String(userId) },
      order: { id: 'DESC' },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    });
    const paperIds = [...new Set(rows.map((record) => String(record.paperId)))];
    const papers = paperIds.length ? await this.paperRepo.find({ where: { id: In(paperIds) } }) : [];
    const titleById = new Map(papers.map((paper) => [String(paper.id), paper.title]));
    return {
      items: rows.map((record) => ({
        record_id: String(record.id),
        paper_id: String(record.paperId),
        paper_title: titleById.get(String(record.paperId)) || null,
        attempt_no: Number(record.attemptNo),
        status: record.status,
        grading_state: record.gradingState,
        submission_method: record.submissionMethod,
        legacy: !record.submissionMethod,
        source: record.source,
        difficulty: record.difficulty || 'unknown',
        score: record.gradingState === 'finalized' && record.score !== null ? Number(record.score) : null,
        started_at: new Date(record.startedAt).toISOString(),
        submitted_at: iso(record.submittedAt),
        graded_at: iso(record.gradedAt),
      })),
      total,
      page: safePage,
      page_size: safePageSize,
    };
  }

  async wrongItems(userId: Id, page: number, pageSize: number): Promise<Page<WrongItem>> {
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize || 20)));
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const base = manager.getRepository(ExamRecordQuestion).createQueryBuilder('item')
        .innerJoin(ExamRecord, 'record', 'record.id = item.record_id')
        .leftJoin(ExamAnswer, 'answer', 'answer.exam_record_id = record.id AND answer.record_question_id = item.id')
        .where('record.user_id = :userId', { userId: String(userId) })
        .andWhere('record.grading_state = :state', { state: 'finalized' })
        .andWhere('record.submitted_at IS NOT NULL')
        .andWhere('ROUND(COALESCE(answer.gained_score, 0) * 100) < item.score_cents');
      const total = await base.clone().getCount();
      const idRows = await base.clone()
        .select('item.id', 'item_id')
        .addSelect('record.id', 'record_id')
        .orderBy('record.id', 'DESC')
        .addOrderBy('item.position', 'ASC')
        .offset((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .getRawMany<{ item_id: string; record_id: string }>();
      const itemIds = idRows.map((row) => String(row.item_id));
      const recordIds = [...new Set(idRows.map((row) => String(row.record_id)))];
      const itemPromise: Promise<ExamRecordQuestion[]> = itemIds.length
        ? manager.getRepository(ExamRecordQuestion).find({ where: { id: In(itemIds) } })
        : Promise.resolve([]);
      const recordPromise: Promise<ExamRecord[]> = recordIds.length
        ? manager.getRepository(ExamRecord).find({ where: { id: In(recordIds) } })
        : Promise.resolve([]);
      const answerPromise: Promise<ExamAnswer[]> = recordIds.length
        ? manager.getRepository(ExamAnswer).find({ where: { examRecordId: In(recordIds) } })
        : Promise.resolve([]);
      const [items, records, answers] = await Promise.all([itemPromise, recordPromise, answerPromise]);
      const itemById = new Map(items.map((item) => [String(item.id), item]));
      const recordById = new Map(records.map((record) => [String(record.id), record]));
      const answerByItem = new Map(answers.filter((answer) => answer.recordQuestionId)
        .map((answer) => [`${answer.examRecordId}:${answer.recordQuestionId}`, answer]));
      const pageRows: Array<{
        record: ExamRecord;
        submittedAt: string;
        item: GradingSnapshotItem;
        answer: ExamAnswer | undefined;
      }> = [];
      for (const idRow of idRows) {
        const itemRow = itemById.get(String(idRow.item_id));
        const record = recordById.get(String(idRow.record_id));
        if (!itemRow || !record?.submittedAt) continue;
        const snapshot: GradingSnapshotItem = {
          ...JSON.parse(JSON.stringify(itemRow.snapshotJson)),
          itemId: String(itemRow.id),
          scoreCents: Number(itemRow.scoreCents),
          displayToOriginal: [...itemRow.displayToOriginal],
          position: Number(itemRow.position),
        };
        pageRows.push({
          record,
          submittedAt: new Date(record.submittedAt).toISOString(),
          item: snapshot,
          answer: answerByItem.get(`${record.id}:${itemRow.id}`),
        });
      }
      await this.ensureResultMediaReferences(manager, pageRows.map((row) => row.item));
      const result: WrongItem[] = pageRows.map(({ record, submittedAt, item, answer }) => ({
        record_id: String(record.id),
        submitted_at: submittedAt,
        ...projectResultItem(item, String(record.id), answer),
      }));
      return { items: result, total, page: safePage, page_size: safePageSize };
    });
  }
}
