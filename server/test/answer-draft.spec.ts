import { describe, expect, it, vi } from 'vitest';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { MediaReference } from '../src/entities/media-reference.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { AnswerDraftService } from '../src/modules/exams/answer-draft.service';
import { AttemptReaderService } from '../src/modules/exams/attempt-reader.service';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { DraftInputDto } from '../src/modules/exams/attempt.dto';

function draftFixture(overrides: Record<string, unknown> = {}) {
  const record: any = {
    id: '41', paperId: '11', userId: '9', assignmentId: '31', status: 'in_progress',
    ruleSnapshot: { totalCents: 10000 }, difficulty: 'easy', releaseId: '21', source: 'institution', categoryId: '7',
    deadlineAt: new Date('2099-10-22T09:00:00.000Z'), draftRevision: 0,
    draftPayloadHash: null, draftSavedAt: null, ...overrides,
  };
  const items: any[] = [
    {
      id: '501', recordId: '41', questionId: '101', type: 'single', position: 0,
      displayToOriginal: [1, 0], snapshotJson: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] },
    },
    {
      id: '502', recordId: '41', questionId: '102', type: 'multiple', position: 1,
      displayToOriginal: [0, 1, 2], snapshotJson: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }] },
    },
    {
      id: '503', recordId: '41', questionId: '103', type: 'judgment', position: 2,
      displayToOriginal: [0, 1], snapshotJson: { options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }] },
    },
    {
      id: '504', recordId: '41', questionId: '104', type: 'image', position: 3,
      displayToOriginal: [], snapshotJson: { options: [] },
    },
  ];
  const answers: any[] = [];
  const references: any[] = Array.from({ length: 10 }, (_, index) => ({
    assetId: String(701 + index), ownerType: 'exam_answer_item', ownerId: '504',
  }));
  let nextAnswerId = 1;
  const recordRepo: any = {
    findOne: vi.fn(async () => record),
    save: vi.fn(async (value: any) => Object.assign(record, value)),
  };
  const itemRepo: any = {
    find: vi.fn(async ({ where }: any) => items.filter((item) => String(item.recordId) === String(where.recordId))),
    findOne: vi.fn(async ({ where }: any) => items.find((item) => String(item.id) === String(where.id)) || null),
  };
  const answerRepo: any = {
    find: vi.fn(async ({ where }: any) => answers.filter((answer) => String(answer.examRecordId) === String(where.examRecordId))),
    create: vi.fn((value: any) => ({ ...value })),
    save: vi.fn(async (values: any | any[]) => {
      const list = Array.isArray(values) ? values : [values];
      for (const value of list) {
        const existing = answers.find((answer) => String(answer.recordQuestionId) === String(value.recordQuestionId));
        if (existing) Object.assign(existing, value);
        else answers.push({ id: String(nextAnswerId++), ...value });
      }
      return values;
    }),
    delete: vi.fn(async ({ id }: any) => {
      const index = answers.findIndex((answer) => String(answer.id) === String(id));
      if (index >= 0) answers.splice(index, 1);
    }),
  };
  const referenceRepo: any = {
    findOne: vi.fn(async ({ where }: any) => references.find((reference) => (
      String(reference.assetId) === String(where.assetId)
      && String(reference.ownerType) === String(where.ownerType)
      && String(reference.ownerId) === String(where.ownerId)
    )) || null),
    find: vi.fn(async ({ where }: any) => references.filter((reference) => String(reference.assetId) === String(where.assetId))),
  };
  const repositories = new Map<any, any>([
    [ExamRecord, recordRepo], [ExamRecordQuestion, itemRepo], [ExamAnswer, answerRepo], [MediaReference, referenceRepo],
    [SysUser, { findOne: vi.fn(async () => ({ id: '9', status: 1 })) }],
  ]);
  const manager: any = { getRepository: (entity: any) => repositories.get(entity) };
  const dataSource: any = { transaction: vi.fn(async (work: any) => work(manager)) };
  const media: any = {
    registerOwnerPolicy: vi.fn(),
    assertUsable: vi.fn(async () => undefined),
    bind: vi.fn(async () => undefined),
    uploadAnswer: vi.fn(async () => ({ assetId: '799', status: 'ready', durationMs: null })),
    remove: vi.fn(async () => undefined),
  };
  const service = new AnswerDraftService(recordRepo, answerRepo, itemRepo, referenceRepo, {} as any, dataSource, media);
  return { service, record, items, answers, references, manager, media };
}

describe('AnswerDraftService persistent full drafts', () => {
  it('commits a full replacement, replays the same acknowledgement, and rejects a conflicting revision', async () => {
    const { service, record, answers } = draftFixture();
    const first = {
      revision: 1,
      answers: [
        { item_id: '501', selected: [0] },
        { item_id: '504', asset_ids: ['701'] },
      ],
    };

    const acknowledged = await service.save('9', '41', first);
    expect(acknowledged).toMatchObject({ revision: 1, answered_count: 2 });
    expect(record.draftRevision).toBe(1);
    expect(answers.map((answer) => ({ item: answer.recordQuestionId, selected: answer.selected, assets: answer.assetIds })))
      .toEqual([
        { item: '501', selected: [1], assets: null },
        { item: '504', selected: null, assets: ['701'] },
      ]);

    await expect(service.save('9', '41', first)).resolves.toEqual(acknowledged);
    await expect(service.save('9', '41', { ...first, answers: [{ item_id: '501', selected: [1] }] }))
      .rejects.toMatchObject({ code: 40905, httpStatus: 409 });

    const replaced = await service.save('9', '41', { revision: 2, answers: [{ item_id: '502', selected: [0, 2] }] });
    expect(replaced).toMatchObject({ revision: 2, answered_count: 1 });
    expect(answers.map((answer) => answer.recordQuestionId)).toEqual(['502']);
  });

  it('allows an acknowledged retry after deadline but never writes a new late draft', async () => {
    const { service, record } = draftFixture();
    const input = { revision: 1, answers: [{ item_id: '501', selected: [0] }] };
    const acknowledged = await service.save('9', '41', input);
    record.deadlineAt = new Date('2000-01-01T00:00:00.000Z');

    await expect(service.save('9', '41', input)).resolves.toEqual(acknowledged);
    await expect(service.save('9', '41', { revision: 2, answers: [{ item_id: '501', selected: [1] }] }))
      .rejects.toMatchObject({ code: 40905, httpStatus: 409 });
  });

  it('validates item type, option indexes, exact answer references, and the nine-image limit', async () => {
    const { service, references } = draftFixture();
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '501', asset_ids: ['701'] }] }))
      .rejects.toMatchObject({ code: 40001 });
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '504', selected: [0] }] }))
      .rejects.toMatchObject({ code: 40001 });
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '502', selected: [0, 0] }] }))
      .rejects.toMatchObject({ code: 40001 });
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '503', selected: [2] }] }))
      .rejects.toMatchObject({ code: 40001 });
    await expect(service.save('9', '41', {
      revision: 1, answers: [{ item_id: '504', asset_ids: Array.from({ length: 10 }, (_, index) => String(701 + index)) }],
    })).rejects.toMatchObject({ code: 40001 });

    references.splice(0, references.length, { assetId: '701', ownerType: 'exam_answer_item', ownerId: '999' });
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '504', asset_ids: ['701'] }] }))
      .rejects.toMatchObject({ code: 40302 });
  });

  it('merges a legacy partial heartbeat into the committed full draft instead of clearing omitted answers', async () => {
    const { service, answers, record } = draftFixture();
    await service.save('9', '41', {
      revision: 1,
      answers: [{ item_id: '501', selected: [0] }, { item_id: '504', asset_ids: ['701'] }],
    });

    const ack = await service.patchLegacy('9', '41', [{ item_id: '502', selected: [1] }]);

    expect(ack).toMatchObject({ revision: 2, answered_count: 3 });
    expect(record.draftRevision).toBe(2);
    expect(answers.map((answer) => answer.recordQuestionId).sort()).toEqual(['501', '502', '504']);
  });

  it('registers a distinct answer policy and rejects owner or attempt mismatches while binding', async () => {
    const { service, media, manager, references } = draftFixture();
    service.onModuleInit();
    expect(media.registerOwnerPolicy).toHaveBeenCalledTimes(1);
    expect(media.registerOwnerPolicy.mock.calls[0][0]).toBe('exam_answer_item');
    const policy = media.registerOwnerPolicy.mock.calls[0][1];
    expect(policy.allowedPurposes).toEqual(['answer']);
    await expect(policy.authorizeRead('9', '504', '701')).resolves.toBe(true);
    await expect(policy.authorizeRead('8', '504', '701')).resolves.toBe(false);
    await expect(policy.validateBinding(manager, {
      id: '701', purpose: 'answer', ownerId: '9', uploadedBy: '8', mediaKind: 'image', status: 'ready',
    }, '504')).rejects.toMatchObject({ code: 40302 });

    references.push({ assetId: '799', ownerType: 'exam_answer_item', ownerId: 'other-attempt-item' });
    await expect(policy.validateBinding(manager, {
      id: '799', purpose: 'answer', ownerId: '9', uploadedBy: '9', mediaKind: 'image', status: 'ready',
    }, '504')).rejects.toMatchObject({ code: 40302 });
  });
});

describe('AttemptReaderService persistent recovery', () => {
  it('returns revision, items and answers from one consistent transaction snapshot', async () => {
    const fixture = draftFixture({ draftRevision: 4 });
    fixture.answers.push({
      id: '1', examRecordId: '41', recordQuestionId: '501', questionId: '101',
      selected: [1], assetIds: null, isCorrect: null, gainedScore: null, comment: null, gradingVersion: 0,
    });
    const recordRepo: any = { findOne: vi.fn(async () => { throw new Error('outside transaction record read'); }) };
    const itemRepo: any = { find: vi.fn(async () => { throw new Error('outside transaction item read'); }) };
    const answerRepo: any = { find: vi.fn(async () => { throw new Error('outside transaction answer read'); }) };
    const txRecordRepo: any = { findOne: vi.fn(async () => fixture.record) };
    const txItemRepo: any = { find: vi.fn(async () => fixture.items) };
    const txAnswerRepo: any = { find: vi.fn(async () => fixture.answers) };
    const txManager: any = { getRepository: (entity: any) => new Map<any, any>([
      [ExamRecord, txRecordRepo], [ExamRecordQuestion, txItemRepo], [ExamAnswer, txAnswerRepo],
    ]).get(entity) };
    const dataSource: any = { transaction: vi.fn(async (_isolation: string, work: any) => work(txManager)) };
    const reader = new (AttemptReaderService as any)(recordRepo, itemRepo, answerRepo, fixture.media, dataSource) as AttemptReaderService;

    const recovered = await reader.forStudent('9', '41');

    expect(recovered.draft_revision).toBe(4);
    expect(recovered.answers).toEqual([{ item_id: '501', selected: [0] }]);
    expect(dataSource.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(recordRepo.findOne).not.toHaveBeenCalled();
    expect(itemRepo.find).not.toHaveBeenCalled();
    expect(answerRepo.find).not.toHaveBeenCalled();
  });
});

describe('training attempt DTO', () => {
  it('rejects a tenth image id and accepts a bounded full draft', async () => {
    const pipe = new DtoValidationPipe();
    const metadata: any = { type: 'body', metatype: DraftInputDto };
    await expect(pipe.transform({
      revision: 1,
      answers: [{ item_id: '504', asset_ids: Array.from({ length: 10 }, (_, index) => String(index + 1)) }],
    }, metadata)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({
      revision: 1,
      answers: [{ item_id: '504', asset_ids: ['1', '2'] }],
    }, metadata)).resolves.toMatchObject({ revision: 1, answers: [{ item_id: '504', asset_ids: ['1', '2'] }] });
  });
});
