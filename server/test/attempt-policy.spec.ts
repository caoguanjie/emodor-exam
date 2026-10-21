import { describe, expect, it } from 'vitest';
import type { RuleSnapshot } from '../src/common/training-contracts';
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
      stem: '<p>题干 101</p>',
      options: [{ key: 'B', text: '乙' }, { key: 'A', text: '甲' }],
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
