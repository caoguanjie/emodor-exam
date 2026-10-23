import { describe, expect, it } from 'vitest';
import { attemptQuestionView } from '../src/modules/exams/attempt-reader.service';
import { projectFinalResult } from '../src/modules/exams/exam-history.service';
import { gradeSubmissionSnapshot, validateWholeSubmission } from '../src/modules/exams/submission.service';
import { questionContent, readonlyDoc } from '../src/modules/questions/question-content';
import richFixture from '../../tests/fixtures/question-authoring-v3/rich-content.json';

const item: any = { itemId: '501', questionId: '101', type: 'single', stem: '<p>题干<br>下一行<img data-media-id="99"></p>', options: [{ key: 'red', text: '甲' }, { key: 'blue', text: '乙' }], answer: [1], analysis: '<p>答案解析</p>', scoreCents: 10000, displayToOriginal: [1, 0], position: 0 };

describe('mobile exam stable ID boundary', () => {
  it('projects only readonly content and stable IDs from the frozen original options', () => {
    const view = attemptQuestionView({ id: '501', snapshotJson: item, displayToOriginal: [1, 0], scoreCents: 10000 } as any);
    expect(view).toEqual({ item_id: '501', type: 'single', score: 100, stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '题干' }, { type: 'hardBreak' }, { type: 'text', text: '下一行' }, { type: 'image', attrs: { asset_id: '99' } }] }] }, options: [{ id: 'blue', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] } }, { id: 'red', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] } }] });
  });

  it('grades selected stable IDs independently from display order', () => {
    const grade = gradeSubmissionSnapshot({ recordId: '41', rule: { partialCreditRatio: 0.5 }, items: [item] } as any, [{ recordQuestionId: '501', selected: null, selectedOptionIds: ['blue'] }] as any);
    expect(grade.totalCents).toBe(10000);
  });

  it('returns a pure timeout with no submitted time or question review', () => {
    expect(projectFinalResult({ id: '41', status: 'timeout', score: '0.00', gradingState: 'not_submitted', submissionMethod: null, submittedAt: null, gradedAt: null } as any, { items: [item] } as any, [])).toMatchObject({ status: 'timeout', score: 0, passed: false, submitted_at: null, graded_at: null, grading_state: 'not_submitted', submission_method: null, correct_rate: null, items: [] });
  });

  it('rejects duplicate frozen legacy option IDs instead of generating replacements', () => {
    expect(() => attemptQuestionView({ id: '501', snapshotJson: { ...item, options: [{ key: 'A', text: '甲' }, { key: 'A', text: '乙' }] }, displayToOriginal: [0, 1], scoreCents: 10000 } as any)).toThrow();
  });

  it.each([
    { answers: [] },
    { record_id: 41, answers: [{ item_id: '501', option_ids: [] }] },
    { record_id: '41', answers: [{ item_id: '501', option_ids: [], selected: [0] }] },
    { record_id: '41', answers: [{ item_id: '501', option_ids: ['red', 'red'] }] },
    { record_id: '41', answers: [{ item_id: '501', option_ids: ['unknown'] }] },
    { record_id: '41', answers: [{ item_id: '501', option_ids: ['red', 'blue'] }] },
    { record_id: '41', answers: [{ item_id: '502', option_ids: [] }] },
    { record_id: '41', answers: [{ item_id: '501', option_ids: [] }], revision: 1 },
  ])('rejects incomplete or noncontract whole-exam input %#', (input) => {
    expect(() => validateWholeSubmission('41', input, { items: [item] } as any)).toThrow();
  });

  it('preserves explicit unanswered choices', () => {
    expect(validateWholeSubmission('41', { record_id: '41', answers: [{ item_id: '501', option_ids: [] }] }, { items: [item] } as any)).toEqual([{ item_id: '501', option_ids: [] }]);
  });

  it.each(['checked', 'correct', 'analysis', 'src', 'marks'])('rejects nested management or unsafe field %s', (field) => {
    expect(() => readonlyDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'text', [field]: true }] }] })).toThrow();
  });

  it('keeps stable v2 IDs when options are reordered', () => {
    const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    expect(questionContent({ type: 'single', contentSchemaVersion: 2, contentJson: { stem: doc('题干'), options: [{ id: 'blue', content: doc('乙') }, { id: 'red', content: doc('甲') }], analysis: null, answer_option_ids: ['red'] } }).answer_option_ids).toEqual(['red']);
  });

  it('uses canonical schema 3 option count when a frozen compatibility mirror has drifted', () => {
    const { schema, ...contentJson } = structuredClone(richFixture);
    const rich = { ...item, contentSchemaVersion: schema, contentJson, options: [] };
    const view = attemptQuestionView({ id: '501', snapshotJson: rich, displayToOriginal: [1, 0], scoreCents: 10000 } as any, 3);
    expect(view.options.map((option) => option.id)).toEqual(['B', 'A']);
    const grade = gradeSubmissionSnapshot({ recordId: '41', rule: { partialCreditRatio: 0.5 }, items: [rich] } as any, [{ recordQuestionId: '501', selectedOptionIds: ['A'] }] as any);
    expect(grade.totalCents).toBe(10000);
  });

  it('rejects blank v2 prompts and options instead of creating unusable questions', () => {
    const empty = { type: 'doc', content: [] };
    expect(() => questionContent({ type: 'single', contentSchemaVersion: 2, contentJson: { stem: empty, options: [{ id: 'A', content: empty }, { id: 'B', content: empty }], analysis: null, answer_option_ids: ['A'] } })).toThrow();
  });
});
