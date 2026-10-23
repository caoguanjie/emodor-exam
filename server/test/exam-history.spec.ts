import { describe, expect, it, vi } from 'vitest';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { ExamHistoryService, projectFinalResult } from '../src/modules/exams/exam-history.service';

function serviceFor(input: {
  manager: any;
  media?: any;
  reader?: any;
  permissions?: string[];
}) {
  const dataSource: any = {
    transaction: vi.fn(async (_isolation: string, work: (manager: any) => unknown) => work(input.manager)),
  };
  const media = input.media || { bind: vi.fn(async () => undefined) };
  const reader = input.reader || { forGrading: vi.fn() };
  const service = new ExamHistoryService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    reader,
    { permissions: vi.fn(async () => input.permissions || []) } as any,
    media,
    dataSource,
  );
  return { service, media, reader };
}

function terminalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '41', userId: '7', assignmentId: '31', ruleSnapshot: { totalCents: 10000 },
    startedAt: new Date('2026-10-22T01:30:00.000Z'),
    status: 'passed', score: '88.00', gradingState: 'finalized',
    submissionMethod: 'manual', submittedAt: new Date('2026-10-22T02:00:00.000Z'), gradedAt: new Date(),
    ...overrides,
  } as any;
}

function queryBuilder(idRows: Array<{ item_id: string; record_id: string }>) {
  const builder: any = {};
  for (const method of ['innerJoin', 'leftJoin', 'where', 'andWhere', 'select', 'addSelect', 'orderBy', 'addOrderBy', 'offset', 'limit']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.clone = vi.fn(() => builder);
  builder.getCount = vi.fn(async () => idRows.length);
  builder.getRawMany = vi.fn(async () => idRows);
  return builder;
}

describe('ExamHistoryService snapshot integrity', () => {
  it.each(['timeout', null])('preserves a scored historical timeout with submission method %s', async (method) => {
    const record = terminalRecord({ status: 'timeout', submissionMethod: method, score: '100.00' });
    const snapshot: any = { recordId: '41', rule: { passCents: 6000 }, items: [{ itemId: '501', questionId: '101', position: 0, type: 'single', scoreCents: 10000, stem: '历史题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0], analysis: '历史解析', displayToOriginal: [1, 0] }] };
    const answers: any = [{ recordQuestionId: '501', selected: [0], gainedScore: '100.00' }];
    const { service } = serviceFor({ manager: {} });
    const result = await service.resultInTransaction({} as any, record, snapshot, answers);
    expect(result).toMatchObject({ status: 'passed', legacy: true, grading_state: 'finalized', submission_method: method, score: 100, passed: true, submitted_at: '2026-10-22T02:00:00.000Z', items: [{ item_id: '501', selected_option_ids: ['A'], correct_option_ids: ['A'], gained_score: 100 }] });
    expect(result.items[0].analysis).toMatchObject({ type: 'doc' });
    expect(projectFinalResult({ ...record, score: '40.00' }, snapshot, answers)).toMatchObject({ status: 'failed', score: 40, passed: false, submission_method: method });
    expect(record).toMatchObject({ status: 'timeout', score: '100.00', submissionMethod: method });
  });

  it('keeps historical timeout score and time in history while pure timeout remains zero', async () => {
    const historical = terminalRecord({ status: 'timeout', submissionMethod: null, score: '88.00' });
    const pure = terminalRecord({ id: '42', status: 'timeout', submissionMethod: null, gradingState: 'not_submitted', score: '0.00', submittedAt: null, gradedAt: null });
    const service = new ExamHistoryService({ findAndCount: async () => [[historical, pure], 2] } as any, {} as any, { find: async () => [] } as any, { find: async () => [] } as any, {} as any, {} as any, {} as any, {} as any);
    expect((await service.history('7', 1, 20)).items).toMatchObject([{ record_id: '41', status: 'timeout', score: 88, submitted_at: '2026-10-22T02:00:00.000Z' }, { record_id: '42', status: 'timeout', score: 0, submitted_at: null }]);
  });

  it('uses the retained record-read permission instead of the removed review permission', async () => {
    const record = terminalRecord({ assignmentId: null, ruleSnapshot: null });
    const manager = { getRepository: (entity: unknown) => {
      if (entity === ExamRecord) return { findOne: vi.fn(async () => record) };
      throw new Error('unexpected repository');
    } };

    const reviewOnly = serviceFor({ manager, permissions: ['exam_records:review'] });
    await expect(reviewOnly.service.adminResult('8', '41')).rejects.toMatchObject({ code: 40301 });

    const reader = serviceFor({ manager, permissions: ['exam_records:read'] });
    await expect(reader.service.adminResult('8', '41')).resolves.toMatchObject({ record_id: '41', score: 88 });
  });

  it.each([
    ['missing rule snapshot', terminalRecord({ ruleSnapshot: null }), 1],
    ['missing frozen items', terminalRecord(), 0],
  ])('fails closed for assigned records with %s', async (_label, record, itemCount) => {
    const itemRepo = { count: vi.fn(async () => itemCount) };
    const manager = { getRepository: (entity: unknown) => {
      if (entity === ExamRecordQuestion) return itemRepo;
      throw new Error('unexpected repository');
    } };
    const { service, media, reader } = serviceFor({ manager });

    await expect(service.resultInTransaction(manager as any, record)).rejects.toMatchObject({ code: 50001 });
    expect(reader.forGrading).not.toHaveBeenCalled();
    expect(media.bind).not.toHaveBeenCalled();
  });

  it('keeps snapshotless fallback only for records without an assignment', async () => {
    const itemRepo = { count: vi.fn(async () => 0) };
    const manager = { getRepository: (entity: unknown) => {
      if (entity === ExamRecordQuestion) return itemRepo;
      throw new Error('unexpected repository');
    } };
    const { service } = serviceFor({ manager });

    const result = await service.resultInTransaction(manager as any, terminalRecord({ assignmentId: null, ruleSnapshot: null }));

    expect(result).toMatchObject({ legacy: true, items: [], score: 88, correct_rate: null });
  });
});

describe('ExamHistoryService result media repair', () => {
  it('repairs wrong-item result references on first read using one global asset-id lock order', async () => {
    const items: any[] = [
      {
        id: '501', recordId: '41', questionId: '101', type: 'single', scoreCents: 100,
        position: 0, displayToOriginal: [0, 1], snapshotJson: {
          questionId: '101', type: 'single', stem: '题一', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0],
          analysis: '<img data-media-id="802"><img data-media-id="801">', scoreCents: 100,
        },
      },
      {
        id: '502', recordId: '42', questionId: '102', type: 'single', scoreCents: 100,
        position: 0, displayToOriginal: [0, 1], snapshotJson: {
          questionId: '102', type: 'single', stem: '题二', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0],
          analysis: '<img data-media-id="801"><img data-media-id="803">', scoreCents: 100,
        },
      },
    ];
    const records: any[] = [terminalRecord({ id: '41' }), terminalRecord({ id: '42' })];
    const answers: any[] = [
      { examRecordId: '41', recordQuestionId: '501', selected: [], gainedScore: '0.00' },
      { examRecordId: '42', recordQuestionId: '502', selected: [], gainedScore: '0.00' },
    ];
    const builder = queryBuilder([{ item_id: '501', record_id: '41' }, { item_id: '502', record_id: '42' }]);
    const itemRepo = { createQueryBuilder: vi.fn(() => builder), find: vi.fn(async () => items) };
    const recordRepo = { find: vi.fn(async () => records) };
    const answerRepo = { find: vi.fn(async () => answers) };
    const manager = { getRepository: (entity: unknown) => {
      if (entity === ExamRecordQuestion) return itemRepo;
      if (entity === ExamRecord) return recordRepo;
      if (entity === ExamAnswer) return answerRepo;
      if (entity === ExamPaper) return {};
      throw new Error('unexpected repository');
    } };
    const media = { bind: vi.fn(async () => undefined) };
    const { service } = serviceFor({ manager, media });

    const page = await service.wrongItems('7', 1, 20);

    expect(page.total).toBe(2);
    expect(media.bind.mock.calls.map((call: any[]) => call.slice(1))).toEqual([
      ['801', 'exam_record_question', '501'],
      ['801', 'exam_record_question', '502'],
      ['802', 'exam_record_question', '501'],
      ['803', 'exam_record_question', '502'],
    ]);
  });
});
