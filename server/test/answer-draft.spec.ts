import { describe, expect, it, vi } from 'vitest';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { LearnerIdentity } from '../src/entities/learner-identity.entity';
import { AnswerDraftService } from '../src/modules/exams/answer-draft.service';
import { AttemptReaderService } from '../src/modules/exams/attempt-reader.service';
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
      displayToOriginal: [1, 0], snapshotJson: {
        type: 'single', stem: '<p>单选题</p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
        answer: [1], analysis: '<p>解析</p>', scoreCents: 3000,
      },
    },
    {
      id: '502', recordId: '41', questionId: '102', type: 'multiple', position: 1,
      displayToOriginal: [0, 1, 2], snapshotJson: {
        type: 'multiple', stem: '<p>多选题</p>', options: [
          { key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' },
        ], answer: [0, 1], analysis: null, scoreCents: 4000,
      },
    },
    {
      id: '503', recordId: '41', questionId: '103', type: 'judgment', position: 2,
      displayToOriginal: [0, 1], snapshotJson: {
        type: 'judgment', stem: '<p>判断题</p>', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
        answer: [0], analysis: null, scoreCents: 3000,
      },
    },
  ];
  const answers: any[] = [];
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
      for (const value of Array.isArray(values) ? values : [values]) {
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
  const userRepo: any = { findOne: vi.fn(async () => ({ id: '9', status: 1, role: 'employee' })) };
  const repositories = new Map<any, any>([
    [ExamRecord, recordRepo], [ExamRecordQuestion, itemRepo], [ExamAnswer, answerRepo], [SysUser, userRepo],
    [LearnerIdentity, { findOne: vi.fn(async () => ({ userId: '9' })) }],
  ]);
  const manager: any = { getRepository: (entity: any) => repositories.get(entity) };
  const dataSource: any = { transaction: vi.fn(async (work: any) => work(manager)) };
  const media: any = { registerOwnerPolicy: vi.fn(), bind: vi.fn(async () => undefined) };
  const access: any = { permissions: vi.fn(async (actorId: string) => actorId === '8' ? ['exam_records:read'] : []) };
  const service = new AnswerDraftService(recordRepo, answerRepo, itemRepo, userRepo, dataSource);
  return { service, record, items, answers, manager, media, access, recordRepo, itemRepo, answerRepo };
}

describe('AnswerDraftService persistent objective drafts', () => {
  it('rejects the removed image-answer attachment shape before persisting a draft', async () => {
    const { service, answers } = draftFixture();

    await expect(service.save('9', '41', {
      revision: 1,
      answers: [{ item_id: '501', asset_ids: ['701'] } as any],
    })).rejects.toMatchObject({ code: 40001 });
    expect(answers).toEqual([]);
  });

  it('commits a full replacement, replays the same acknowledgement, and rejects a conflicting revision', async () => {
    const { service, record, answers } = draftFixture();
    const first = {
      revision: 1,
      answers: [{ item_id: '501', selected: [0] }, { item_id: '502', selected: [0, 2] }],
    };

    const acknowledged = await service.save('9', '41', first);
    expect(acknowledged).toMatchObject({ revision: 1, answered_count: 2 });
    expect(record.draftRevision).toBe(1);
    expect(answers.map((answer) => ({ item: answer.recordQuestionId, selected: answer.selected }))).toEqual([
      { item: '501', selected: [1] }, { item: '502', selected: [0, 2] },
    ]);

    await expect(service.save('9', '41', first)).resolves.toEqual(acknowledged);
    await expect(service.save('9', '41', { ...first, answers: [{ item_id: '501', selected: [1] }] }))
      .rejects.toMatchObject({ code: 40905, httpStatus: 409 });

    const replaced = await service.save('9', '41', { revision: 2, answers: [{ item_id: '503', selected: [1] }] });
    expect(replaced).toMatchObject({ revision: 2, answered_count: 1 });
    expect(answers.map((answer) => answer.recordQuestionId)).toEqual(['503']);
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

  it('validates objective option indexes and refuses a historical unsupported item type', async () => {
    const { service, items } = draftFixture();
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '502', selected: [0, 0] }] }))
      .rejects.toMatchObject({ code: 40001 });
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '503', selected: [2] }] }))
      .rejects.toMatchObject({ code: 40001 });
    items.push({ id: '504', recordId: '41', questionId: '104', type: 'image', position: 3, displayToOriginal: [] });
    await expect(service.save('9', '41', { revision: 1, answers: [{ item_id: '504', selected: [] }] }))
      .rejects.toMatchObject({ code: 40001 });
  });

  it('merges a legacy partial heartbeat into the committed full draft instead of clearing omitted answers', async () => {
    const { service, answers, record } = draftFixture();
    await service.save('9', '41', {
      revision: 1,
      answers: [{ item_id: '501', selected: [0] }, { item_id: '502', selected: [1] }],
    });

    const ack = await service.patchLegacy('9', '41', [{ item_id: '503', selected: [1] }]);

    expect(ack).toMatchObject({ revision: 2, answered_count: 3 });
    expect(record.draftRevision).toBe(2);
    expect(answers.map((answer) => answer.recordQuestionId).sort()).toEqual(['501', '502', '503']);
  });
});

describe('AttemptReaderService persistent recovery', () => {
  it('returns only the active readonly snapshot without old server draft state', async () => {
    const fixture = draftFixture({ draftRevision: 4 });
    fixture.answers.push({
      id: '1', examRecordId: '41', recordQuestionId: '501', questionId: '101',
      selected: [1], isCorrect: null, gainedScore: null,
    });
    const outsideRepo: any = { findOne: vi.fn(async () => { throw new Error('outside transaction read'); }), find: vi.fn() };
    const dataSource: any = { transaction: vi.fn(async (_isolation: string, work: any) => work(fixture.manager)) };
    const reader = new AttemptReaderService(
      outsideRepo, outsideRepo, outsideRepo, fixture.media, dataSource, fixture.access,
    );

    const recovered = await reader.forStudent('9', '41');

    expect(recovered).toMatchObject({ status: 'in_progress', record_id: '41' });
    expect(recovered).not.toHaveProperty('draft_revision');
    expect(recovered).not.toHaveProperty('answers');
    expect(dataSource.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(outsideRepo.findOne).not.toHaveBeenCalled();
  });

  it('keeps prompt and result-only question media separated by terminal state and record permissions', async () => {
    const fixture = draftFixture();
    fixture.items[0].snapshotJson = {
      type: 'single', stem: '<p>题干<img data-media-id="801"></p>',
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0],
      analysis: '<p>解析<img data-media-id="802"></p>', scoreCents: 3000,
    };
    const reader = new AttemptReaderService(
      fixture.recordRepo, fixture.itemRepo, fixture.answerRepo, fixture.media, { transaction: vi.fn(), getRepository: fixture.manager.getRepository, manager: fixture.manager } as any, fixture.access,
    );
    reader.onModuleInit();
    const policy = fixture.media.registerOwnerPolicy.mock.calls[0][1];

    await expect(policy.authorizeRead('9', '501', '801')).resolves.toBe(true);
    await expect(policy.authorizeRead('9', '501', '802')).resolves.toBe(false);
    await expect(policy.authorizeRead('8', '501', '801')).resolves.toBe(true);
    await expect(policy.authorizeRead('8', '501', '802')).resolves.toBe(false);

    fixture.record.status = 'passed';
    fixture.record.submittedAt = new Date();
    await expect(policy.authorizeRead('9', '501', '802')).resolves.toBe(true);
    await expect(policy.authorizeRead('8', '501', '802')).resolves.toBe(true);
    await expect(policy.authorizeRead('10', '501', '802')).resolves.toBe(false);

    fixture.record.status = 'timeout';
    fixture.record.gradingState = 'finalized';
    fixture.record.score = '25.00';
    fixture.record.submissionMethod = null;
    await expect(policy.authorizeRead('9', '501', '802')).resolves.toBe(true);
    await expect(policy.authorizeTicket('9', '501', '802')).resolves.toBe(true);
    fixture.record.gradingState = 'not_submitted';
    fixture.record.submittedAt = null;
    fixture.record.score = '0.00';
    await expect(policy.authorizeTicket('9', '501', '801')).resolves.toBe(false);
    await expect(policy.authorizeTicket('9', '501', '802')).resolves.toBe(false);
  });
});

describe('training attempt DTO', () => {
  it('rejects removed image attachments and accepts selected objective answers', async () => {
    const pipe = new DtoValidationPipe();
    const metadata: any = { type: 'body', metatype: DraftInputDto };

    await expect(pipe.transform({
      revision: 1,
      answers: [{ item_id: '501', asset_ids: ['1'] }],
    }, metadata)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({
      revision: 1,
      answers: [{ item_id: '501', selected: [0] }],
    }, metadata)).resolves.toMatchObject({ revision: 1, answers: [{ item_id: '501', selected: [0] }] });
  });
});
