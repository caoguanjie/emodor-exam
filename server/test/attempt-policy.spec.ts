import { describe, expect, it, vi } from 'vitest';
import type { RuleSnapshot } from '../src/common/training-contracts';
import { ExamAssignment } from '../src/entities/exam-assignment.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { LearningRecord } from '../src/entities/learning-record.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { Regulation } from '../src/entities/regulation.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import type { PublishedPaper, PublishedQuestionSnapshot } from '../src/modules/exams/paper-release.service';
import {
  AttemptService,
  decideAttemptTransition,
  resolveAttemptDifficulty,
} from '../src/modules/exams/attempt.service';
import {
  attemptQuestionView,
  promptMediaIds,
  type GradingSnapshot,
} from '../src/modules/exams/attempt-reader.service';
import {
  gradeFrozenSnapshot,
  mapLegacyAnswersToItems,
  legacyAttemptView,
} from '../src/modules/exams/legacy-exam-adapter';

const RULE: RuleSnapshot = {
  totalCents: 10000,
  passCents: 6000,
  durationMinutes: 30,
  maxAttempts: 3,
  partialCreditRatio: 0.5,
  rules: [{ type: 'single', count: 1, scoreCents: 10000 }],
};

function question(
  questionId: string,
  difficulty: 'easy' | 'medium' | 'hard' | 'unknown' = 'easy',
  extra: Partial<PublishedQuestionSnapshot> = {},
): PublishedQuestionSnapshot {
  return {
    questionId,
    versionId: `v-${questionId}`,
    revision: 1,
    categoryId: difficulty === 'unknown' ? null : '7',
    difficulty,
    type: 'single',
    stem: `<p>题干 ${questionId}</p>`,
    options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
    answer: [1],
    analysis: '<p>解析</p>',
    rubric: null,
    scoreCents: 10000,
    source: 'manual',
    approvedBy: null,
    approvedAt: null,
    ...extra,
  } as PublishedQuestionSnapshot;
}

function published(input: Partial<PublishedPaper>): PublishedPaper {
  return {
    id: '21',
    paperId: '11',
    categoryId: '7',
    businessScope: 'training',
    mode: 'random',
    rule: structuredClone(RULE),
    requiresLearning: false,
    pool: [question('101')],
    ...input,
  } as PublishedPaper;
}

function legacyAttemptFixture(input: {
  assignment?: Record<string, any> | null;
  records?: Array<Record<string, any>>;
  release?: PublishedPaper | null;
  itemsByRecord?: Record<string, PublishedQuestionSnapshot[]>;
  currentPool?: PublishedQuestionSnapshot[];
}) {
  const assignment = input.assignment === undefined ? null : input.assignment;
  const records = input.records || [];
  const itemsByRecord = input.itemsByRecord || {};
  const currentPool = input.currentPool || [];
  const savedAssignments: Array<Record<string, any>> = [];
  const savedRecords: Array<Record<string, any>> = [];
  const savedItems: Array<Record<string, any>> = [];
  const versionCapture = vi.fn(async (_manager: unknown, questionId: string) => {
    const snapshot = currentPool.find((item) => String(item.questionId) === String(questionId));
    if (!snapshot) throw new Error(`current question ${questionId} missing`);
    return {
      id: snapshot.versionId,
      questionId: snapshot.questionId,
      revision: snapshot.revision,
      categoryId: snapshot.categoryId,
      difficulty: snapshot.difficulty,
      type: snapshot.type,
      stem: snapshot.stem,
      options: snapshot.options,
      answer: snapshot.answer,
      analysis: snapshot.analysis,
      rubric: snapshot.rubric,
      conceptId: snapshot.conceptId || null,
      regulationId: snapshot.regulationId || '2',
      regulationVersionId: snapshot.regulationVersionId || null,
      sourcePageGroup: snapshot.sourcePageGroup || null,
      sourcePageStart: snapshot.sourcePageStart || null,
      sourcePageEnd: snapshot.sourcePageEnd || null,
      source: snapshot.source,
      approvedBy: snapshot.approvedBy,
      approvedAt: snapshot.approvedAt ? new Date(snapshot.approvedAt) : null,
    };
  });

  const assignmentRepo = {
    findOne: vi.fn(async () => assignment),
    create: vi.fn((value: Record<string, any>) => value),
    save: vi.fn(async (value: Record<string, any>) => {
      const saved = { id: '31', ...value };
      savedAssignments.push(saved);
      return saved;
    }),
  };
  const recordRepo = {
    findOne: vi.fn(async ({ where }: any) => records.find((record) => String(record.id) === String(where.id)) || null),
    createQueryBuilder: vi.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        orderBy: () => builder,
        addOrderBy: () => builder,
        getMany: async () => records,
      };
      return builder;
    }),
    create: vi.fn((value: Record<string, any>) => value),
    save: vi.fn(async (value: Record<string, any>) => {
      const saved = { id: String(71 + savedRecords.length), ...value };
      savedRecords.push(saved);
      return saved;
    }),
  };
  const itemRepo = {
    find: vi.fn(async ({ where }: any) => (itemsByRecord[String(where.recordId)] || []).map((snapshot, position) => ({
      id: String(801 + position),
      recordId: String(where.recordId),
      questionId: String(snapshot.questionId),
      questionVersionId: String(snapshot.versionId),
      type: snapshot.type,
      difficulty: snapshot.difficulty,
      scoreCents: snapshot.scoreCents,
      position,
      displayToOriginal: snapshot.options.map((_option, index) => index),
      snapshotJson: structuredClone(snapshot),
    }))),
    create: vi.fn((value: Record<string, any>) => value),
    save: vi.fn(async (values: Array<Record<string, any>>) => values.map((value, index) => {
      const saved = { id: String(901 + index), ...value };
      savedItems.push(saved);
      return saved;
    })),
  };
  const paper = {
    id: '11', regulationId: '2', businessScope: 'regulation', mode: 'fixed', status: 'published',
    passScore: '60.00', durationMinutes: 30, maxAttempts: 3, partialCreditRatio: '0.50', title: '旧固定卷',
  };
  const repositories = new Map<unknown, any>([
    [SysUser, { findOne: vi.fn(async () => ({ id: '9', username: 'learner', role: 'super_admin', status: 1 })) }],
    [ExamAssignment, assignmentRepo],
    [ExamRecord, recordRepo],
    [ExamRecordQuestion, itemRepo],
    [ExamPaper, { findOne: vi.fn(async () => paper) }],
    [Regulation, { findOne: vi.fn(async () => ({ id: '2', status: 'published', requiredMinutes: 1, scrollSegments: 10 })) }],
    [LearningRecord, { findOne: vi.fn(async () => ({ isValid: 1 })) }],
    [PaperQuestion, { find: vi.fn(async () => currentPool.map((snapshot, sort) => ({
      id: String(51 + sort), paperId: '11', questionId: String(snapshot.questionId),
      questionVersionId: String(snapshot.versionId), score: (snapshot.scoreCents / 100).toFixed(2), sort,
    }))) }],
  ]);
  const manager = {
    getRepository(entity: unknown) {
      const repository = repositories.get(entity);
      if (!repository) throw new Error(`unexpected repository ${(entity as any)?.name}`);
      return repository;
    },
  };
  const service = Object.create(AttemptService.prototype) as AttemptService & Record<string, any>;
  service.dataSource = { transaction: vi.fn(async (work: (manager: any) => Promise<unknown>) => work(manager)) };
  service.releases = {
    latestForPaper: vi.fn(async () => input.release || null),
    get: vi.fn(async () => {
      if (!input.release) throw new Error('release missing');
      return input.release;
    }),
  };
  service.sampling = { draw: vi.fn((pool: PublishedQuestionSnapshot[]) => pool) };
  service.shuffle = {
    deriveSeed: vi.fn(() => 'seed'),
    shuffleQuestionOrder: vi.fn((pool: PublishedQuestionSnapshot[]) => pool),
    snapshotOptionMapping: vi.fn((_type: string, length: number) => Array.from({ length }, (_value, index) => index)),
  };
  service.versions = { currentOrCaptureForRelease: versionCapture };
  service.scope = { isUserInScope: vi.fn(async () => true) };
  service.reader = { forStudent: vi.fn(async (_userId: string, recordId: string) => ({ record_id: recordId })) };
  service.media = { bind: vi.fn(async () => undefined) };
  service.redis = { set: vi.fn(async () => undefined) };
  service.audit = { log: vi.fn() };
  return { service, savedAssignments, savedRecords, savedItems, versionCapture };
}

function frozenAssignment(overrides: Record<string, any> = {}) {
  return {
    id: '31', paperId: '11', userId: '9', releaseId: null, source: null, categoryId: null,
    difficulty: 'unknown', ruleSnapshot: structuredClone(RULE), snapshotOrigin: 'legacy_start',
    ...overrides,
  };
}

function frozenRecord(id: string, status: string, attemptNo: number, overrides: Record<string, any> = {}) {
  return {
    id, paperId: '11', regulationId: '2', userId: '9', assignmentId: '31', activeAssignmentId: null,
    releaseId: null, source: null, categoryId: null, difficulty: 'unknown', ruleSnapshot: structuredClone(RULE),
    snapshotOrigin: 'legacy_start', attemptNo, status, score: status === 'failed' ? '0.00' : null,
    startedAt: new Date('2026-10-21T10:00:00.000Z'), deadlineAt: new Date('2099-10-21T10:30:00.000Z'),
    submittedAt: status === 'in_progress' ? null : new Date('2026-10-21T10:10:00.000Z'), switchCount: 0,
    ...overrides,
  };
}

describe('atomic attempt policy', () => {
  it('recovers a still-active third attempt before applying the attempt limit', () => {
    expect(decideAttemptTransition({
      nowMs: Date.parse('2026-10-21T10:00:00.000Z'),
      active: { recordId: '303', deadlineAt: new Date('2026-10-21T10:01:00.000Z') },
      records: [
        { attemptNo: 1, status: 'failed' },
        { attemptNo: 2, status: 'failed' },
        { attemptNo: 3, status: 'in_progress' },
      ],
      maxAttempts: 3,
    })).toEqual({ kind: 'recover', recordId: '303' });
  });

  it('does not turn an expired active row into a fourth attempt', () => {
    expect(() => decideAttemptTransition({
      nowMs: Date.parse('2026-10-21T10:00:00.000Z'),
      active: { recordId: '303', deadlineAt: new Date('2026-10-21T09:59:59.999Z') },
      records: [
        { attemptNo: 1, status: 'failed' },
        { attemptNo: 2, status: 'failed' },
        { attemptNo: 3, status: 'in_progress' },
      ],
      maxAttempts: 3,
    })).toThrow(expect.objectContaining({ code: 40904 }));
  });

  it('counts pre-snapshot records when allocating the third attempt and refuses a fourth', () => {
    const legacy = [
      { attemptNo: 1, status: 'failed' },
      { attemptNo: 2, status: 'failed' },
    ];
    expect(decideAttemptTransition({ nowMs: 0, active: null, records: legacy, maxAttempts: 3 }))
      .toEqual({ kind: 'create', attemptNo: 3 });
    expect(() => decideAttemptTransition({
      nowMs: 0,
      active: null,
      records: [...legacy, { attemptNo: 3, status: 'failed' }],
      maxAttempts: 3,
    })).toThrow(expect.objectContaining({ code: 40902 }));
  });

  it('blocks retakes after a pass or while a submitted row awaits its terminal outcome', () => {
    expect(() => decideAttemptTransition({
      nowMs: 0, active: null, records: [{ attemptNo: 1, status: 'passed' }], maxAttempts: 3,
    })).toThrow(expect.objectContaining({ code: 40903 }));
    expect(() => decideAttemptTransition({
      nowMs: 0, active: null, records: [{ attemptNo: 1, status: 'submitted' }], maxAttempts: 3,
    })).toThrow(expect.objectContaining({ code: 40904 }));
  });
});

describe('frozen assignment facts', () => {
  it('uses source only for random training difficulty', () => {
    expect(resolveAttemptDifficulty('institution', published({ mode: 'random' }))).toBe('easy');
    expect(resolveAttemptDifficulty('external', published({ mode: 'random' }))).toBe('hard');
  });

  it('derives fixed training difficulty from the frozen paper and preserves legacy unknown', () => {
    expect(resolveAttemptDifficulty('external', published({
      mode: 'fixed',
      pool: [question('101', 'medium'), question('102', 'medium')],
    }))).toBe('medium');
    expect(resolveAttemptDifficulty('institution', published({
      mode: 'fixed',
      pool: [question('101', 'easy'), question('102', 'hard')],
    }))).toBe('mixed');
    expect(resolveAttemptDifficulty(null, published({
      categoryId: null,
      businessScope: 'regulation',
      mode: 'fixed',
      pool: [question('legacy', 'easy', { categoryId: null })],
    }))).toBe('unknown');
  });

  it('keeps an assigned exam visible when the learner profile is later cleared', async () => {
    const service = Object.create(AttemptService.prototype) as AttemptService & Record<string, any>;
    service.userRepo = { findOne: async () => ({ id: '9', status: 1, categoryId: null, source: null }) };
    service.assignmentRepo = { find: async () => [{
      id: '31', paperId: '11', userId: '9', source: 'institution', categoryId: '7', difficulty: 'easy',
    }] };
    service.paperRepo = { find: async () => [{
      id: '11', title: '已冻结考试', mode: 'random', status: 'withdrawn', businessScope: 'training',
    }] };

    await expect(service.list('9')).resolves.toMatchObject({
      total: 1,
      items: [{ paper_id: '11', source: 'institution', category_id: '7', difficulty: 'easy' }],
    });
  });

  it('rejects an unsupported first regulation release before consuming an assignment or attempt', async () => {
    const unsupported = question('101', 'unknown', {
      categoryId: null,
      type: 'judgment',
      options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
      answer: [0],
    });
    const release = published({
      businessScope: 'regulation', mode: 'fixed', categoryId: null, pool: [unsupported],
    });
    const fixture = legacyAttemptFixture({ release });

    await expect(fixture.service.start('9', '11')).rejects.toMatchObject({ code: 40001 });
    expect(fixture.savedAssignments).toEqual([]);
    expect(fixture.savedRecords).toEqual([]);
    expect(fixture.savedItems).toEqual([]);
  });

  it('validates an active regulation attempt from its frozen items', async () => {
    const active = frozenRecord('71', 'in_progress', 1, { activeAssignmentId: '31' });
    const unsupported = question('101', 'unknown', {
      categoryId: null,
      type: 'image', options: [], answer: [], rubric: '<p>人工评分</p>',
    });
    const fixture = legacyAttemptFixture({
      assignment: frozenAssignment(),
      records: [active],
      itemsByRecord: { 71: [unsupported] },
    });

    await expect(fixture.service.start('9', '11')).rejects.toMatchObject({ code: 40001 });
    expect(fixture.savedRecords).toEqual([]);
  });

  it('validates old active recovery from its frozen items', async () => {
    const active = frozenRecord('71', 'in_progress', 1, { activeAssignmentId: '31' });
    const unsupported = question('101', 'unknown', {
      categoryId: null,
      type: 'judgment',
      options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0],
    });
    const fixture = legacyAttemptFixture({
      assignment: frozenAssignment(),
      records: [active],
      itemsByRecord: { 71: [unsupported] },
    });

    await expect(fixture.service.recover('9', '71')).rejects.toMatchObject({ code: 40001 });
  });

  it('uses the previous legacy_start item snapshot for a retake without reading current questions', async () => {
    const previous = frozenRecord('70', 'failed', 1);
    const fixture = legacyAttemptFixture({
      assignment: frozenAssignment(),
      records: [previous],
      itemsByRecord: { 70: [question('101', 'unknown', { categoryId: null })] },
      currentPool: [question('101', 'unknown', {
        categoryId: null, type: 'judgment',
        options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0],
      })],
    });

    await expect(fixture.service.start('9', '11')).resolves.toMatchObject({ record_id: '71' });
    expect(fixture.versionCapture).not.toHaveBeenCalled();
    expect(fixture.savedRecords).toHaveLength(1);
    expect(fixture.savedRecords[0].attemptNo).toBe(2);
  });

  it('reports an incomplete legacy_start snapshot instead of recapturing current questions', async () => {
    const previous = frozenRecord('70', 'failed', 1);
    const fixture = legacyAttemptFixture({
      assignment: frozenAssignment(),
      records: [previous],
      currentPool: [question('101', 'unknown', { categoryId: null })],
    });

    await expect(fixture.service.start('9', '11')).rejects.toMatchObject({
      code: 40970,
      message: '个人考试冻结题池不完整',
    });
    expect(fixture.versionCapture).not.toHaveBeenCalled();
    expect(fixture.savedRecords).toEqual([]);
  });

  it('still rejects unsupported current content when genuinely capturing the first legacy_start', async () => {
    const unsupported = question('101', 'unknown', {
      categoryId: null,
      type: 'judgment',
      options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0],
    });
    const fixture = legacyAttemptFixture({ currentPool: [unsupported] });

    await expect(fixture.service.start('9', '11')).rejects.toMatchObject({ code: 40001 });
    expect(fixture.savedAssignments).toEqual([]);
    expect(fixture.savedRecords).toEqual([]);
  });
});

describe('immutable question presentation', () => {
  it('renders from the stored display mapping without exposing grading fields', () => {
    const view = attemptQuestionView({
      id: '901',
      snapshotJson: question('101'),
      displayToOriginal: [1, 0],
      scoreCents: 10000,
    });

    expect(view).toEqual({
      item_id: '901',
      type: 'single',
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '题干 101' }] }] },
      options: [{ id: 'B', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] } }, { id: 'A', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] } }],
      score: 100,
    });
    expect(JSON.stringify(view)).not.toMatch(/answer|analysis|rubric/);
  });

  it('binds only prompt and option images, never answer-side media', () => {
    const snapshot = question('101', 'easy', {
      stem: '<p><img data-media-id="11"></p>',
      options: [
        { key: 'A', text: '<img data-media-id="12">' },
        { key: 'B', text: '无图' },
      ],
      analysis: '<img data-media-id="13">',
      rubric: '<img data-media-id="14">',
    });
    expect(promptMediaIds(snapshot)).toEqual(['11', '12']);
  });
});

describe('legacy frozen snapshot bridge', () => {
  it('grades display positions against persisted mappings and frozen partial-credit rules', () => {
    const snapshot: GradingSnapshot = {
      recordId: '71',
      rule: { ...structuredClone(RULE), rules: [
        { type: 'single', count: 1, scoreCents: 5000 },
        { type: 'multiple', count: 1, scoreCents: 5000 },
      ] },
      items: [
        { ...question('101', 'easy', { scoreCents: 5000 }), itemId: '901', displayToOriginal: [1, 0], position: 0 },
        {
          ...question('102', 'easy', {
            type: 'multiple', scoreCents: 5000,
            options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }],
            answer: [0, 1],
          }),
          itemId: '902', displayToOriginal: [0, 1, 2], position: 1,
        },
      ],
    };
    const answers = new Map<string, number[]>([['901', [0]], ['902', [0]]]);

    expect(gradeFrozenSnapshot(snapshot, answers)).toEqual({
      totalCents: 7500,
      details: [
        { itemId: '901', selected: [1], isCorrect: 1, gainedCents: 5000 },
        { itemId: '902', selected: [0], isCorrect: 0, gainedCents: 2500 },
      ],
    });
  });

  it('keeps judgment labels in semantic order', () => {
    const snapshot: GradingSnapshot = {
      recordId: '71', rule: structuredClone(RULE), items: [{
        ...question('103', 'easy', {
          type: 'judgment', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0],
        }),
        itemId: '903', displayToOriginal: [0, 1], position: 0,
      }],
    };
    expect(gradeFrozenSnapshot(snapshot, new Map([['903', [0]]])).details[0]).toMatchObject({
      selected: [0], isCorrect: 1, gainedCents: 10000,
    });
  });

  it('maps a new AttemptView to the unchanged numeric fixed-client shape', () => {
    const legacy = legacyAttemptView({
      attempt: {
        record_id: '71', paper_id: '11', release_id: '21', source: null, category_id: null,
        difficulty: 'unknown', deadline_at: '2026-10-21T10:30:00.000Z', server_now: '2026-10-21T10:00:00.000Z',
        draft_revision: 0,
        questions: [{ item_id: '901', type: 'single', stem: '冻结题干', options: [], score: 100 }],
        answers: [{ item_id: '901', selected: [0] }],
      },
      attemptNo: 2,
      status: 'in_progress',
      title: '制度固定卷',
      rule: RULE,
      itemToQuestionId: new Map([['901', '101']]),
    });

    expect(legacy).toMatchObject({
      exam_record_id: 71,
      attempt_no: 2,
      status: 'in_progress',
      paper: { id: 11, total_score: 100, pass_score: 60, duration_minutes: 30 },
      questions: [{ question_id: 101, stem: '冻结题干' }],
      saved_answers: { 101: [0] },
    });
    expect(JSON.stringify(legacy.questions)).not.toMatch(/answer|analysis|rubric/);
  });

  it('translates legacy source question ids to snapshot item ids before grading', () => {
    expect(mapLegacyAnswersToItems(
      [{ question_id: 1, selected: [1] }],
      new Map([['1', '2'], ['2', '1']]),
    )).toEqual([{ question_id: '2', selected: [1] }]);

    expect(() => mapLegacyAnswersToItems(
      [{ question_id: 999, selected: [0] }],
      new Map([['1', '2'], ['2', '1']]),
    )).toThrow(expect.objectContaining({ code: 40001 }));
  });
});
