import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { createExtensions } from '../../Tiptap/utils/createExtensions';
import type { CommitResult, QuestionAuthoringDocument, QuestionMeta } from '../../../api/question-document-types';
import type { PaperDesignerValue, PaperQuestionBinding } from '../contracts';
import {
  abandonPaperSave, applyPaperSaveOutcome, applyQuestionCommitResult, beginPaperSave, changePaperValue,
  copyQuestionsForPaper, createPaperSaveState, failPaperSave, insertPaper, paperLoadAction, planPaperSave, preflightPaper,
  questionFingerprint, validatePaperStructure,
} from '../paper-designer-state';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function single(id = 'source-client', category = '10', concept: string | null = '20'): QuestionAuthoringDocument {
  return {
    schema_version: 1,
    content: { type: 'doc', content: [{
      type: 'questionBlock', attrs: { client_id: id }, content: [
        { type: 'questionStem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '进入前应做什么？', marks: [{ type: 'bold' }] }, { type: 'mediaImage', attrs: { asset_id: '88', alt: null } }] }] },
        { type: 'questionOption', attrs: { option_id: `${id}-a`, checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '先检测' }] }] },
        { type: 'questionOption', attrs: { option_id: `${id}-b`, checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '直接进入' }] }] },
      ],
    }] },
    questions: { [id]: {
      type: 'single', category_id: category, difficulty: 'easy', concept_id: concept,
      regulation_id: '30', regulation_version_id: '31', score_cents: 10000,
      analysis: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '先检测再进入' }] }] },
    } },
  };
}

function bound(baseline = 'source-baseline', version = '50'): PaperQuestionBinding {
  return { kind: 'bound', question_id: '40', question_version_id: version, revision: 2, baseline_fingerprint: baseline };
}

function paper(document = single(), binding: PaperQuestionBinding = { kind: 'new' }): PaperDesignerValue {
  return {
    paper: { id: '100', title: '当前试卷', category_id: '10', mode: 'fixed', pass_score: 60, duration_minutes: 30 },
    document,
    bindings: Object.fromEntries(Object.keys(document.questions).map((id) => [id, clone(binding)])),
  };
}

describe('paper-local question copies', () => {
  // Catches retaining source write identity, reusing local IDs, or mutating library data.
  it('regenerates client/option IDs and keeps exact source identities only in bindings', () => {
    const source = paper(single(), bound());
    const original = clone(source);
    const ids = ['local-client', 'local-option-a', 'local-option-b'];
    const result = copyQuestionsForPaper(source, () => ids.shift()!);

    expect(result.document.content.content?.[0].attrs?.client_id).toBe('local-client');
    expect(result.document.content.content?.[0].content?.slice(1).map((node) => node.attrs?.option_id)).toEqual(['local-option-a', 'local-option-b']);
    expect(result.document.questions['local-client']).not.toHaveProperty('question_id');
    expect(result.document.questions['local-client']).not.toHaveProperty('base_revision');
    expect(result.document.questions['local-client']).not.toHaveProperty('generation_ref');
    expect(result.bindings).toEqual({ 'local-client': {
      kind: 'bound', question_id: '40', question_version_id: '50', revision: 2, baseline_fingerprint: 'source-baseline',
    } });
    expect(source).toEqual(original);
    result.document.questions['local-client'].analysis.content = [];
    expect(source.document.questions['source-client'].analysis.content).toHaveLength(1);
  });

  it('rejects orphan source metadata instead of dropping it while copying', () => {
    const source = paper();
    source.document.questions.orphan = clone(source.document.questions['source-client']);
    expect(() => copyQuestionsForPaper(source)).toThrow();
  });
});

describe('single-question fingerprints and save routing', () => {
  it('ignores historical concepts in content equality', () => {
    const document = single();
    const changed = clone(document);
    changed.questions['source-client'].concept_id = 'different-legacy-concept';
    expect(questionFingerprint(changed, 'source-client')).toBe(questionFingerprint(document, 'source-client'));
  });
  it('normalizes default attributes added by the real question schema without detaching a bound item', () => {
    const document = single();
    document.content.content![0].content![0].content = [
      { type: 'paragraph', content: [{ type: 'text', text: '格式文字', marks: [{ type: 'textStyle', attrs: { fontSize: '16pt' } }, { type: 'link', attrs: { href: 'https://example.test' } }] }, { type: 'mediaImage', attrs: { asset_id: '88' } }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '步骤' }] }] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '表头' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '内容' }] }] }] }] },
    ];
    const normalized = clone(document);
    normalized.content = getSchema(createExtensions('question')).nodeFromJSON(document.content).toJSON();
    expect(questionFingerprint(normalized, 'source-client')).toBe(questionFingerprint(document, 'source-client'));
  });

  it.each([
    ['alignment', { textAlign: 'center' }], ['indent', { indent: 1 }], ['line height', { lineHeight: '1.5' }],
  ])('retains nondefault paragraph %s in the fingerprint', (_name, attrs) => {
    const document = single(); const changed = clone(document);
    changed.content.content![0].content![0].content![0].attrs = attrs;
    expect(questionFingerprint(changed, 'source-client')).not.toBe(questionFingerprint(document, 'source-client'));
  });

  // Catches including whole-paper order, local IDs, write receipts, or key ordering in the baseline.
  it('ignores local/persistence identity and outer question order', () => {
    const document = single();
    const other = single('second', '10', '21');
    const value = paper(document, bound());
    const copied = copyQuestionsForPaper(value, (() => { let n = 0; return () => `fresh-${++n}`; })());
    const expanded = clone(document);
    expanded.content.content!.unshift(other.content.content![0]);
    expanded.questions.second = other.questions.second;
    expanded.questions['source-client'] = Object.fromEntries(Object.entries(expanded.questions['source-client']).reverse()) as unknown as QuestionMeta;
    Object.assign(expanded.questions['source-client'], { question_id: '99', base_revision: 9 });
    expanded.questions['source-client'].category_id = 'different-paper-category';

    expect(questionFingerprint(copied.document, 'fresh-1')).toBe(questionFingerprint(document, 'source-client'));
    expect(questionFingerprint(expanded, 'source-client')).toBe(questionFingerprint(document, 'source-client'));
  });

  // Each mutation changes the saved content while leaving all ignored identities unchanged.
  it.each([
    ['answer', (doc: QuestionAuthoringDocument) => { doc.content.content![0].content![1].attrs!.checked = false; }],
    ['option order', (doc: QuestionAuthoringDocument) => { const children = doc.content.content![0].content!; [children[1], children[2]] = [children[2], children[1]]; }],
    ['format', (doc: QuestionAuthoringDocument) => { doc.content.content![0].content![0].content![0].content![0].marks = [{ type: 'italic' }]; }],
    ['media', (doc: QuestionAuthoringDocument) => { doc.content.content![0].content![0].content![0].content![1].attrs!.asset_id = '89'; }],
    ['difficulty', (doc: QuestionAuthoringDocument) => { doc.questions['source-client'].difficulty = 'hard'; }],
    ['regulation', (doc: QuestionAuthoringDocument) => { doc.questions['source-client'].regulation_id = '32'; }],
    ['regulation version', (doc: QuestionAuthoringDocument) => { doc.questions['source-client'].regulation_version_id = '33'; }],
    ['analysis', (doc: QuestionAuthoringDocument) => { doc.questions['source-client'].analysis.content = []; }],
    ['type', (doc: QuestionAuthoringDocument) => { doc.questions['source-client'].type = 'multiple'; }],
  ])('detects a changed %s', (_name, change) => {
    const document = single();
    const changed = clone(document);
    change(changed);
    expect(questionFingerprint(changed, 'source-client')).not.toBe(questionFingerprint(document, 'source-client'));
  });

  // Catches submitting unchanged bound items or retaining original write credentials for copies.
  it('reuses unchanged bindings and submits new/changed items without source write identity', () => {
    const first = single('first', '10', '20');
    const second = single('second', '10', '21');
    const third = single('third', '10', '22');
    const combined: QuestionAuthoringDocument = {
      schema_version: 1,
      content: { type: 'doc', content: [...first.content.content!, ...second.content.content!, ...third.content.content!] },
      questions: { ...first.questions, ...second.questions, ...third.questions },
    };
    const value = paper(combined);
    value.bindings.first = bound(questionFingerprint(combined, 'first'), '51');
    value.bindings.second = bound(questionFingerprint(combined, 'second'), '52');
    value.document.questions.second.analysis.content = [];
    const plan = planPaperSave(value);

    expect(plan.order).toEqual(['first', 'second', 'third']);
    expect(plan.reuse).toEqual([{ client_id: 'first', question_id: '40', question_version_id: '51', revision: 2, score_cents: 10000 }]);
    expect(Object.keys(plan.submit.questions)).toEqual(['second', 'third']);
    expect(plan.submit.content.content?.map((node) => node.attrs?.client_id)).toEqual(['second', 'third']);
    for (const meta of Object.values(plan.submit.questions)) {
      expect(meta).not.toHaveProperty('question_id');
      expect(meta).not.toHaveProperty('base_revision');
      expect(meta).not.toHaveProperty('generation_ref');
    }
    value.document.questions.second.analysis = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '先检测再进入' }] }] };
    expect(planPaperSave(value).reuse.map((item) => item.client_id)).toEqual(['first', 'second']);
  });
});

describe('paper preflight and atomic insertion', () => {
  // Catches accepting a body-only structural edit, duplicate block, or unknown top-level node.
  it.each(['missing-meta', 'missing-binding', 'orphan-meta', 'duplicate-block', 'unknown-root'])(
    'rejects inconsistent client_id sets: %s', (change) => {
      const value = paper();
      if (change === 'missing-meta') delete value.document.questions['source-client'];
      if (change === 'missing-binding') delete value.bindings['source-client'];
      if (change === 'orphan-meta') value.document.questions.orphan = clone(value.document.questions['source-client']);
      if (change === 'duplicate-block') value.document.content.content!.push(clone(value.document.content.content![0]));
      if (change === 'unknown-root') value.document.content.content!.push({ type: 'paragraph' });
      expect(validatePaperStructure(value).map((issue) => issue.code)).toContain('client-id-mismatch');
    },
  );

  it('rejects an unknown binding sidecar entry', () => {
    const value = paper();
    value.bindings.orphan = { kind: 'new' };
    expect(validatePaperStructure(value).map((issue) => issue.code)).toContain('client-id-mismatch');
  });

  // Catches dropping only one conflicting source item or changing the current paper category on append.
  it.each([
    ['category', 'category-mismatch'],
    ['question', 'duplicate-question'],
    ['limit', 'question-limit'],
  ])('rejects %s conflicts without changing either draft', (conflict, code) => {
    const target = paper(single('current', '10', '20'), bound('current-baseline', '50'));
    const source = paper(single('incoming', '10', '21'), bound('incoming-baseline', '51'));
    if (conflict === 'category') { source.paper.category_id = '11'; source.document.questions.incoming.category_id = '11'; }
    if (conflict !== 'question') (source.bindings.incoming as Extract<PaperQuestionBinding, { kind: 'bound' }>).question_id = '41';
    if (conflict === 'limit') {
      const blocks = Array.from({ length: 100 }, (_, index) => single(`current-${index}`, '10', null));
      target.document = { schema_version: 1, content: { type: 'doc', content: blocks.flatMap((doc) => doc.content.content!) }, questions: Object.assign({}, ...blocks.map((doc) => doc.questions)) };
      target.bindings = Object.fromEntries(Object.keys(target.document.questions).map((id) => [id, { kind: 'new' }]));
    }
    const beforeTarget = clone(target);
    const beforeSource = clone(source);
    const result = insertPaper(target, source, 'append');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain(code);
    expect(target).toEqual(beforeTarget);
    expect(source).toEqual(beforeSource);
  });

  // Catches replacing the persisted target identity or retaining the target configuration.
  it('replaces content/configuration across categories while preserving the current draft ID', () => {
    const target = paper();
    const source = paper(single('incoming', '11', '21'), bound());
    source.paper = { id: '999', title: '来源试卷', category_id: '11', mode: 'fixed', pass_score: 80, duration_minutes: 90 };
    const ids = ['copy-client', 'copy-a', 'copy-b'];
    const result = insertPaper(target, source, 'replace', () => ids.shift()!);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paper).toEqual({ id: '100', title: '来源试卷', category_id: '11', mode: 'fixed', pass_score: 80, duration_minutes: 90 });
      expect(Object.keys(result.value.document.questions)).toEqual(['copy-client']);
      expect(validatePaperStructure(result.value)).toEqual([]);
    }
  });

  it('appends in source order and keeps current paper settings', () => {
    const target = paper(single('current', '10', '20'), bound('first', '50'));
    const source = paper(single('incoming', '10', '21'), bound('second', '51'));
    (source.bindings.incoming as Extract<PaperQuestionBinding, { kind: 'bound' }>).question_id = '41';
    const ids = ['current', 'copy-client', 'copy-a', 'copy-b'];
    const result = insertPaper(target, source, 'append', () => ids.shift()!);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paper).toEqual(target.paper);
      expect(result.value.document.content.content?.map((node) => node.attrs?.client_id)).toEqual(['current', 'copy-client']);
      expect(validatePaperStructure(result.value)).toEqual([]);
    }
  });

  // Empty papers load directly even after settings change; only existing questions require a choice.
  it.each([
    ['title', { title: '修改过的标题' }], ['regulations', { regulation_ids: ['30'] }], ['courses', { course_ids: ['40'] }],
    ['exam settings', { duration_minutes: 90, pass_score: 80, max_attempts: 5, partial_credit_ratio: 0.25, requires_learning: true }],
  ])('loads an empty paper directly after changing %s', (_label, patch) => {
    const empty = paper({ schema_version: 1, content: { type: 'doc', content: [] }, questions: {} });
    expect(paperLoadAction(empty)).toBe('load');
    Object.assign(empty.paper, patch);
    expect(paperLoadAction(empty)).toBe('load');
  });

  it('only offers append or replacement when the current document contains a question', () => {
    const emptyWithParagraph = paper({ schema_version: 1, content: { type: 'doc', content: [{ type: 'paragraph' }] }, questions: {} });
    expect(paperLoadAction(emptyWithParagraph)).toBe('load');
    expect(paperLoadAction(paper())).toBe('choose-append-or-replace');
  });

  // Catches allowing deterministic failure only after creating new question records.
  it.each([
    ['title', 'title-required'], ['category', 'category-required'], ['empty', 'questions-required'],
    ['score', 'total-score'], ['answer', 'invalid-question'],
  ])('preflights required %s data before save', (change, code) => {
    const value = paper();
    if (change === 'title') value.paper.title = '  ';
    if (change === 'category') delete value.paper.category_id;
    if (change === 'empty') { value.document.content.content = []; value.document.questions = {}; value.bindings = {}; }
    if (change === 'score') value.document.questions['source-client'].score_cents = 500;
    if (change === 'answer') value.document.content.content![0].content![1].attrs!.checked = false;
    expect(preflightPaper(value).map((issue) => issue.code)).toContain(code);
  });

  it('rejects formatted judgment labels before any save write', () => {
    const value = paper(); const block = value.document.content.content![0]!;
    value.document.questions['source-client'].type = 'judgment';
    block.content![1]!.content = [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '正确' }] }];
    block.content![2]!.content = [{ type: 'paragraph', content: [{ type: 'text', text: '错误', marks: [{ type: 'bold' }] }] }];
    expect(preflightPaper(value).map((entry) => entry.code)).toContain('invalid-question');
  });
});

describe('partial-save recovery', () => {
  function receipt(): CommitResult {
    return { request_id: 'save-one', items: [{ client_id: 'source-client', question_id: '90', version_id: '91', revision: 1 }] };
  }

  it('forbids abandoning an unknown question submission before a receipt is confirmed', () => {
    const value = paper();
    const saving = beginPaperSave(createPaperSaveState(value, true), 'save-one');
    const unknown = applyPaperSaveOutcome(saving, {
      status: 'incomplete', value, message: '提交结果尚未确认，请继续查询', can_abandon: false,
    });
    expect(unknown.can_abandon).toBe(false);
    expect(abandonPaperSave(unknown)).toBe(unknown);
    const changed = clone(value); changed.paper.title = '禁止新建请求';
    expect(changePaperValue(unknown, changed)).toBe(unknown);
    expect(beginPaperSave(unknown, 'different').context).toEqual({ request_id: 'save-one' });
  });

  it('does not accept permission to abandon while submitted questions remain unbound', () => {
    const value = paper();
    const saving = beginPaperSave(createPaperSaveState(value, true), 'save-one');
    expect(() => applyPaperSaveOutcome(saving, {
      status: 'incomplete', value, message: '无完整回执', can_abandon: true,
    })).toThrow();
  });

  // Catches updating existing reused items, retaining write credentials, or storing a stale baseline.
  it('refreshes only submitted bindings from an exact commit receipt', () => {
    const value = paper();
    const existing = single('existing', '10', '21');
    value.document.content.content!.push(existing.content.content![0]);
    value.document.questions.existing = existing.questions.existing;
    value.bindings.existing = bound('unchanged-existing', '70');
    const original = clone(value);
    const updated = applyQuestionCommitResult(value, receipt(), { request_id: 'save-one', client_ids: ['source-client'] });
    expect(updated.bindings['source-client']).toEqual({
      kind: 'bound', question_id: '90', question_version_id: '91', revision: 1,
      baseline_fingerprint: questionFingerprint(value.document, 'source-client'),
    });
    expect(updated.bindings.existing).toEqual({ kind: 'bound', question_id: '40', question_version_id: '70', revision: 2, baseline_fingerprint: 'unchanged-existing' });
    expect(updated.document.questions['source-client']).not.toHaveProperty('question_id');
    expect(updated.document.questions['source-client']).not.toHaveProperty('base_revision');
    expect(updated.document.questions['source-client']).not.toHaveProperty('generation_ref');
    expect(value).toEqual(original);
  });

  it.each(['request', 'missing', 'duplicate', 'extra', 'unknown', 'question-id', 'version-id', 'revision'])(
    'rejects a malformed %s commit receipt without mutating the draft', (change) => {
      const value = paper();
      const original = clone(value);
      const result = receipt();
      if (change === 'request') result.request_id = 'another-request';
      if (change === 'missing') result.items = [];
      if (change === 'duplicate') result.items.push(clone(result.items[0]));
      if (change === 'extra') result.items.push({ ...result.items[0], client_id: 'extra' });
      if (change === 'unknown') result.items[0].client_id = 'unknown';
      if (change === 'question-id') result.items[0].question_id = '9007199254740993.1';
      if (change === 'version-id') result.items[0].version_id = '';
      if (change === 'revision') result.items[0].revision = 0;
      expect(() => applyQuestionCommitResult(value, result, { request_id: 'save-one', client_ids: ['source-client'] })).toThrow();
      expect(value).toEqual(original);
    },
  );

  // Catches keeping a created question as new or clearing dirty/request identity after partial success.
  it('adopts incomplete bindings and retries without another question submission', () => {
    const source = paper();
    const saving = beginPaperSave(createPaperSaveState(source, true), 'save-one');
    const receipt = clone(source);
    receipt.bindings['source-client'] = bound(questionFingerprint(receipt.document, 'source-client'), '99');
    const incomplete = applyPaperSaveOutcome(saving, { status: 'incomplete', value: receipt, message: '题目已入库，试卷尚未保存', can_abandon: true });
    expect(incomplete.phase).toBe('incomplete');
    expect(incomplete.dirty).toBe(true);
    expect(incomplete.context).toEqual({ request_id: 'save-one' });
    expect(planPaperSave(incomplete.value).submit.content.content).toEqual([]);
    const retry = beginPaperSave(incomplete, 'ignored-new-request');
    expect(retry.context).toEqual({ request_id: 'save-one' });
    const saved = applyPaperSaveOutcome(retry, { status: 'saved', value: receipt });
    expect(saved).toMatchObject({ phase: 'editing', dirty: false, context: null, message: '' });
  });

  it('abandoning a partial save keeps created bindings for the next request', () => {
    const value = paper(single(), bound());
    value.bindings['source-client'] = bound(questionFingerprint(value.document, 'source-client'), '99');
    const saving = beginPaperSave(createPaperSaveState(value, true), 'save-one');
    const partial = applyPaperSaveOutcome(saving, { status: 'incomplete', value, message: '继续保存', can_abandon: true });
    const abandoned = abandonPaperSave(partial);
    expect(abandoned).toMatchObject({ phase: 'editing', dirty: true, context: null });
    expect(planPaperSave(abandoned.value).submit.content.content).toEqual([]);
    expect(beginPaperSave(abandoned, 'save-two').context).toEqual({ request_id: 'save-two' });
  });

  // Catches allowing edits during a request whose new records may already exist.
  it.each(['saving', 'incomplete'] as const)('freezes draft edits while %s', (phase) => {
    const value = paper();
    const saving = beginPaperSave(createPaperSaveState(value, true), 'save-one');
    const frozen = phase === 'saving' ? saving : applyPaperSaveOutcome(saving, { status: 'incomplete', value, message: '继续保存', can_abandon: false });
    const edit = clone(value);
    edit.paper.title = '这次更改必须被拒绝';
    expect(changePaperValue(frozen, edit)).toBe(frozen);
    expect(frozen.value.paper.title).toBe('当前试卷');
  });

  it('retains request identity after failure and resets it only when the draft changes', () => {
    const value = paper();
    const saving = beginPaperSave(createPaperSaveState(value, true), 'save-one');
    const failed = failPaperSave(saving, '网络暂不可用');
    expect(beginPaperSave(failed, 'save-two').context).toEqual({ request_id: 'save-one' });
    expect(changePaperValue(failed, clone(value))).toBe(failed);
    const edit = clone(value);
    edit.paper.title = '修改后的试卷';
    const changed = changePaperValue(failed, edit);
    expect(changed).toMatchObject({ dirty: true, context: null, phase: 'editing' });
    expect(beginPaperSave(changed, 'save-two').context).toEqual({ request_id: 'save-two' });
  });

  it('keeps editing frozen if continuing a partial save fails again', () => {
    const value = paper();
    const saving = beginPaperSave(createPaperSaveState(value, true), 'save-one');
    const partial = applyPaperSaveOutcome(saving, { status: 'incomplete', value, message: '继续保存', can_abandon: false });
    const failed = failPaperSave(beginPaperSave(partial, 'ignored'), '网络断开');
    expect(failed.phase).toBe('incomplete');
    expect(failed.context).toEqual({ request_id: 'save-one' });
  });

  it('cannot abandon a still-running save request', () => {
    const saving = beginPaperSave(createPaperSaveState(paper(), true), 'save-one');
    expect(abandonPaperSave(saving)).toBe(saving);
  });

  it.each(['paper-id', 'missing-client', 'unbound-saved'])(
    'rejects a mismatched %s save outcome while retaining the current draft', (change) => {
      const value = paper();
      const saving = beginPaperSave(createPaperSaveState(value, true), 'save-one');
      const result = clone(value);
      if (change === 'paper-id') result.paper.id = '999';
      if (change === 'missing-client') { result.document.content.content = []; result.document.questions = {}; result.bindings = {}; }
      expect(() => applyPaperSaveOutcome(saving, { status: 'saved', value: result })).toThrow();
      expect(saving.value.paper.id).toBe('100');
      expect(Object.keys(saving.value.document.questions)).toEqual(['source-client']);
    },
  );
});
