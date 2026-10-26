import { describe, expect, it } from 'vitest';
import type { AuthoringCommitRequest, AuthoringReceipt } from '../../../api/question-document-types';
import { createPaperDesignerHost } from '../../../composables/paper-designer-host';
import { createPaperDesignerController } from '../../../composables/paper-designer-controller';
import { paperFixture, copy } from './paper-designer-fixtures';
import type { PaperDesignerValue } from '../contracts';
import { planPaperSave, questionFingerprint, validateDesignerLayout } from '../paper-designer-state';

async function setup(value = paperFixture(), access = { read: true, write: true, questionsRead: true, questionsWrite: true }) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const receipts = new Map<string, AuthoringReceipt>();
  let failCommit = false; let failConfig = false; let failQuestions = false; let failQuery = false;
  let savedConfig: any; let savedQuestions: any;
  const api = {
    async get(path: string) {
      calls.push({ method: 'get', path });
      if (failQuery) throw new Error('offline');
      if (path.includes('/commits/')) { const receipt = receipts.get(path.split('/').at(-1)!); if (!receipt) throw Object.assign(new Error('missing'), { code: 40401 }); return copy(receipt); }
      return { ...savedConfig, questions: savedQuestions?.items.map((item: any, sort: number) => ({ ...item, sort })) || [] };
    },
    async post(path: string, body: AuthoringCommitRequest) {
      calls.push({ method: 'post', path, body: copy(body) });
      const receipt = { request_id: body.request_id, bundle: copy(body.bundle), items: Object.keys(body.bundle.document.questions).map((client_id, index) => ({ client_id, question_id: String(80 + index), saved_version_id: String(90 + index), revision: 1 })) };
      receipts.set(body.request_id, receipt);
      if (failCommit) throw new Error('lost response'); return copy(receipt);
    },
    async put(path: string, body: any) {
      calls.push({ method: 'put', path, body: copy(body) });
      if (path.endsWith('/questions')) { if (failQuestions) throw Object.assign(new Error('题单写入失败'), { code: 40902 }); savedQuestions = copy(body); }
      else { if (failConfig) throw Object.assign(new Error('配置写入失败'), { code: 40001 }); savedConfig = copy(body); }
      return {};
    },
  };
  const host = createPaperDesignerHost({ api, paperId: value.paper.id, access });
  return { host, calls, receipts, api, setFailure(flags: { commit?: boolean; config?: boolean; questions?: boolean; query?: boolean }) { failCommit = flags.commit ?? failCommit; failConfig = flags.config ?? failConfig; failQuestions = flags.questions ?? failQuestions; failQuery = flags.query ?? failQuery; } };
}
function newPaper() { const value = paperFixture(); value.bindings.question_one = { kind: 'new' }; value.session = { option_ids: { question_one: { question_one_a: 'A', question_one_b: 'B' } }, identities: { question_one: { question_id: '40', expected_version_id: '50' } }, layouts: {} }; return value; }
function sourcedPaper() {
  const value = paperFixture(); value.paper.regulation_ids = ['30'];
  Object.assign(value.document.questions.question_one!, { regulation_id: '30', regulation_version_id: '31' });
  value.bindings.question_one = { kind: 'bound', question_id: '40', question_version_id: '50', revision: 1, baseline_fingerprint: questionFingerprint(value.document, 'question_one') };
  return value;
}

describe('fixed paper phased save and recovery', () => {
  it('loads a scoreless assembled question using its exact paper association score before save validation', async () => {
    const value = paperFixture(); const env = await setup(value);
    const document = copy(value.document);
    Object.assign(document.questions.question_one!, { question_id: '40', base_revision: 1 });
    delete (document.questions.question_one as any).score_cents;
    env.api.get = async () => ({ ...value.paper, status: 'draft', rules: [], questions: [{ question_id: '40', question_version_id: '50', score_cents: 10000, sort: 0 }] }) as any;
    env.api.post = async () => ({ document, option_ids: {},
      identities: { question_one: { question_id: '40', expected_version_id: '50' } }, layouts: {} }) as any;
    const loaded = await env.host.load();
    expect(loaded.document.questions.question_one!.score_cents).toBe(10000);
    expect((await env.host.saveDraft(loaded, { request_id: 'scoreless-load', intent: 'save' })).status).toBe('saved');
    expect(env.calls.some((call) => call.path === '/admin/question-documents/commit')).toBe(false);
    expect(env.calls.at(-1)!.body.items).toEqual([{ question_version_id: '50', score_cents: 10000 }]);
  });

  it('keeps current paper scores when a normalized commit receipt contains no question score', async () => {
    const env = await setup(newPaper()); const post = env.api.post;
    env.api.post = async (path, body) => {
      const response = await post(path, body);
      Object.values(response.bundle.document.questions).forEach((meta) => { delete (meta as any).score_cents; });
      return response;
    };
    const saved = await env.host.saveDraft(newPaper(), { request_id: 'scoreless-receipt', intent: 'save' });
    expect(saved.status).toBe('saved');
    expect(saved.value.document.questions.question_one!.score_cents).toBe(10000);
    expect(env.calls.at(-1)!.body.items).toEqual([{ question_version_id: '90', score_cents: 10000 }]);
    expect((await env.host.saveDraft(saved.value, { request_id: 'reuse-after-receipt', intent: 'save' })).status).toBe('saved');
    expect(env.calls.filter((call) => call.path === '/admin/question-documents/commit')).toHaveLength(1);
  });

  it('reuses existing question versions when only their paper scores are redistributed', async () => {
    const first = paperFixture('100', '10', 'first'); const second = paperFixture('100', '10', 'second');
    first.document.questions.first!.concept_id = null; second.document.questions.second!.concept_id = null;
    const value = { ...first, document: { ...first.document,
      content: { type: 'doc', content: [...first.document.content.content!, ...second.document.content.content!] },
      questions: { ...first.document.questions, ...second.document.questions } },
      bindings: { ...first.bindings, second: { ...second.bindings.second, question_id: '41', question_version_id: '51' } } } as PaperDesignerValue;
    for (const id of ['first', 'second']) {
      value.document.questions[id]!.score_cents = 5000;
      (value.bindings[id] as any).baseline_fingerprint = questionFingerprint(value.document, id);
    }
    value.document.questions.first!.score_cents = 7000; value.document.questions.second!.score_cents = 3000;
    const env = await setup(value);
    expect((await env.host.saveDraft(value, { request_id: 'paper-scores-only', intent: 'save' })).status).toBe('saved');
    expect(env.calls.some((call) => call.method === 'post')).toBe(false);
    expect(env.calls.at(-1)!.body.items).toEqual([{ question_version_id: '50', score_cents: 7000 }, { question_version_id: '51', score_cents: 3000 }]);
  });
  it.each([undefined, 7300])('assigns the initial paper score instead of assembled bank score %s', async (oldScore) => {
    const value = paperFixture(); const env = await setup(value);
    env.api.get = async () => ({ list: [{ question_id: '40', current_version_id: '50', category_id: '10',
      status: 'approved', difficulty: 'easy', type: 'single', stem: '题干' }], total: 1 }) as any;
    const document = copy(value.document);
    Object.assign(document.questions.question_one!, { question_id: '40', base_revision: 1 });
    if (oldScore === undefined) delete (document.questions.question_one as any).score_cents;
    else document.questions.question_one!.score_cents = oldScore;
    env.api.post = async () => ({ document, option_ids: {}, identities: { question_one: { question_id: '40', expected_version_id: '50' } }, layouts: {} }) as any;
    await env.host.questionLibrarySource.list({ category_id: '10', page: 1, page_size: 20 });
    const source = await env.host.questionLibrarySource.get('40');
    expect(source.document.questions.question_one!.score_cents).toBe(500);
    expect(source.binding.baseline_fingerprint).toBe(questionFingerprint(source.document, 'question_one'));
    expect(document.questions.question_one!.score_cents).toBe(oldScore);
  });
  it('reuses an unchanged sourced version with its original provenance and matching paper source filter', async () => {
    const value = sourcedPaper(); const snapshot = copy(value); const plan = planPaperSave(value);
    expect(plan.submit.questions).toEqual({}); expect(plan.reuse).toEqual([{ client_id: 'question_one', question_id: '40', question_version_id: '50', revision: 1, score_cents: 10000 }]);
    const env = await setup(value); const saved = await env.host.saveDraft(value, { request_id: 'sourced-reuse', intent: 'save' });
    expect(saved.status).toBe('saved'); expect(saved.value.document.questions.question_one).toMatchObject({ regulation_id: '30', regulation_version_id: '31' });
    expect(env.calls.some((call) => call.method === 'post')).toBe(false); expect(env.calls.at(-1)!.body.items).toEqual([{ question_version_id: '50', score_cents: 10000 }]); expect(value).toEqual(snapshot);
  });
  it('plans a changed sourced version as a manual copy without altering the source draft metadata', () => {
    const value = sourcedPaper(); value.document.questions.question_one!.difficulty = 'hard'; const snapshot = copy(value);
    const plan = planPaperSave(value); expect(plan.reuse).toEqual([]);
    expect(plan.submit.questions.question_one).toMatchObject({ difficulty: 'hard', regulation_id: null, regulation_version_id: null }); expect(value).toEqual(snapshot);
  });
  it('blocks a changed sourced copy before every HTTP call until the paper source filter is explicitly cleared', async () => {
    const value = sourcedPaper(); const env = await setup(value); const controller = createPaperDesignerController({ value, saveDraft: env.host.saveDraft });
    const changed = copy(value); changed.document.questions.question_one!.difficulty = 'hard'; controller.change(changed);
    expect(await controller.save()).toBe(false); expect(controller.error.value).toContain('修改副本将作为人工题保存，请先清空试卷关联资料/来源筛选');
    expect(controller.dirty.value).toBe(true); expect(controller.value.value).toEqual(changed); expect(env.calls).toEqual([]);
    const cleared = copy(controller.value.value); cleared.paper.regulation_ids = []; controller.change(cleared);
    expect(await controller.save()).toBe(true); expect(controller.value.value.document.questions.question_one).toMatchObject({ regulation_id: null, regulation_version_id: null });
  });
  it('commits a sourced copy as manual after clearing the filter and reuses the receipt version after reopening', async () => {
    const source = sourcedPaper(); const value = copy(source); value.paper.regulation_ids = []; value.document.questions.question_one!.difficulty = 'hard';
    const env = await setup(value); const saved = await env.host.saveDraft(value, { request_id: 'manual-copy', intent: 'save' });
    expect(saved.status).toBe('saved');
    const request = env.calls[0]!.body as AuthoringCommitRequest;
    expect(request.bundle.identities).toEqual({}); expect(request.bundle.document.questions.question_one).toMatchObject({ regulation_id: null, regulation_version_id: null });
    expect(saved.value.document.questions.question_one).toMatchObject({ regulation_id: null, regulation_version_id: null });
    expect(saved.value.bindings.question_one).toMatchObject({ kind: 'bound', question_id: '80', question_version_id: '90' });
    expect(env.calls.map((call) => call.path)).toEqual(['/admin/question-documents/commit', '/admin/papers/100', '/admin/papers/100/questions']);
    expect(env.calls[1]!.body.regulation_ids).toEqual([]); expect(env.calls[2]!.body.items).toEqual([{ question_version_id: '90', score_cents: 10000 }]);
    expect(source.document.questions.question_one).toMatchObject({ regulation_id: '30', regulation_version_id: '31' }); expect(source.bindings.question_one).toMatchObject({ question_id: '40', question_version_id: '50' });

    const receipt = env.receipts.get('manual-copy')!; const assembled = copy(receipt.bundle);
    assembled.identities.question_one = { question_id: '80', expected_version_id: '90' };
    Object.assign(assembled.document.questions.question_one!, { question_id: '80', base_revision: 1 });
    env.api.get = async () => ({ ...saved.value.paper, status: 'draft', rules: [], questions: [{ question_id: '80', question_version_id: '90', score_cents: 10000, sort: 0 }] });
    const post = env.api.post; env.api.post = async (path, body) => path === '/admin/question-documents/assemble' ? copy(assembled) as any : post(path, body);
    const reopened = await env.host.load(); expect(reopened.document.questions.question_one).toMatchObject({ regulation_id: null, regulation_version_id: null });
    expect((await env.host.saveDraft(reopened, { request_id: 'manual-reopen', intent: 'save' })).status).toBe('saved');
    expect(env.calls.filter((call) => call.path === '/admin/question-documents/commit')).toHaveLength(1);
    expect(env.calls.at(-1)!.body.items).toEqual([{ question_version_id: '90', score_cents: 10000 }]);
  });
  it('still rejects an unchanged external source outside the paper filter before every HTTP call', async () => {
    const value = sourcedPaper(); value.paper.regulation_ids = ['32']; const env = await setup(value);
    await expect(env.host.saveDraft(value, { request_id: 'outside-source', intent: 'save' })).rejects.toThrow('固定题目不在试卷资料筛选范围内'); expect(env.calls).toEqual([]);
  });
  it('commits new content without source write tokens and adapts saved_version_id before config and ordered links', async () => {
    const value = newPaper(); const { host, calls } = await setup(value);
    const result = await host.saveDraft(value, { request_id: 'request-one', intent: 'save' });
    expect(result.status).toBe('saved'); expect(calls.map((call) => call.path)).toEqual(['/admin/question-documents/commit', '/admin/papers/100', '/admin/papers/100/questions']);
    expect(calls[0]!.body.bundle.identities).toEqual({}); expect(calls[0]!.body.bundle.option_ids.question_one).toEqual({ question_one_a: 'A', question_one_b: 'B' });
    expect(calls[2]!.body).toEqual({ items: [{ question_version_id: '90', score_cents: 10000 }] });
    expect(result.value.bindings.question_one).toMatchObject({ kind: 'bound', question_version_id: '90' });
  });
  it('reuses unchanged and reverted source versions without creating a question', async () => {
    const value = paperFixture(); const { host, calls } = await setup(value);
    const controller = createPaperDesignerController({ value, saveDraft: host.saveDraft });
    const changed = copy(value); changed.document.questions.question_one!.difficulty = 'hard'; controller.change(changed); controller.change(copy(value));
    expect(await controller.save()).toBe(true); expect(calls.some((call) => call.method === 'post')).toBe(false);
    expect(calls.at(-1)!.body.items[0].question_version_id).toBe('50');
  });
  it('saves a changed bound question as a new copy and leaves original tokens out of the request', async () => {
    const value = newPaper(); value.bindings = paperFixture().bindings; value.document.questions.question_one!.difficulty = 'hard';
    const { host, calls } = await setup(value); await host.saveDraft(value, { request_id: 'copy-one', intent: 'save' });
    expect(calls[0]!.body.bundle.identities).toEqual({}); expect(calls.at(-1)!.body.items[0].question_version_id).toBe('90');
    expect(value.bindings.question_one).toMatchObject({ question_version_id: '50' });
  });
  it('queries the original request after a lost commit response, freezes edits and blocks close until its receipt is known', async () => {
    const value = newPaper(); const env = await setup(value); env.setFailure({ commit: true, query: true });
    const controller = createPaperDesignerController({ value, saveDraft: env.host.saveDraft }); const changed = copy(value); changed.paper.title = '未保存'; controller.change(changed);
    expect(await controller.save()).toBe(false); expect(controller.incomplete.value).toBe(true); expect(controller.canAbandon.value).toBe(false);
    expect(controller.change(copy(value))).toBe(false); expect(await controller.requestClose(async () => true)).toBe(false);
    const requestId = env.calls[0]!.body.request_id;
    env.setFailure({ query: false }); expect(await controller.save()).toBe(true);
    expect(env.calls.filter((call) => call.path === '/admin/question-documents/commit')).toHaveLength(1);
    expect(env.calls.find((call) => call.method === 'get')!.path).toBe(`/admin/question-documents/commits/${requestId}`);
    expect(controller.dirty.value).toBe(false);
  });
  it('continues only the question-list phase when configuration succeeded and links failed', async () => {
    const env = await setup(newPaper()); env.setFailure({ questions: true }); const controller = createPaperDesignerController({ value: newPaper(), saveDraft: env.host.saveDraft });
    expect(await controller.save()).toBe(false); expect(controller.dirty.value).toBe(true); expect(controller.canAbandon.value).toBe(true);
    env.setFailure({ questions: false }); expect(await controller.save()).toBe(true);
    expect(env.calls.filter((call) => call.method === 'post')).toHaveLength(1);
    expect(env.calls.filter((call) => call.method === 'put' && call.path === '/admin/papers/100')).toHaveLength(1);
    expect(env.calls.filter((call) => call.path.endsWith('/questions'))).toHaveLength(2);
  });
  it('keeps committed bindings when abandoning the remainder so the next save does not recreate questions', async () => {
    const env = await setup(newPaper()); env.setFailure({ config: true }); const controller = createPaperDesignerController({ value: newPaper(), saveDraft: env.host.saveDraft });
    expect(await controller.save()).toBe(false); controller.abandonSave(); expect(controller.value.value.bindings.question_one).toMatchObject({ question_version_id: '90' });
    env.setFailure({ config: false }); expect(await controller.save()).toBe(true); expect(env.calls.filter((call) => call.method === 'post')).toHaveLength(1);
  });
  it('does not accept controlled replacement while a commit receipt is unknown', async () => {
    const env = await setup(newPaper()); env.setFailure({ commit: true, query: true });
    const controller = createPaperDesignerController({ value: newPaper(), saveDraft: env.host.saveDraft });
    await controller.save(); expect(controller.replace(paperFixture('200'))).toBe(false);
    expect(controller.value.value.paper.id).toBe('100'); expect(controller.incomplete.value).toBe(true);
  });
  it('retries a missing receipt with the same original request ID and bytes', async () => {
    const env = await setup(newPaper()); env.setFailure({ commit: true });
    const first = await env.host.saveDraft(newPaper(), { request_id: 'stable', intent: 'save' });
    expect(first.status).toBe('incomplete'); env.receipts.clear(); env.setFailure({ commit: false });
    const second = await env.host.saveDraft(first.value, { request_id: 'stable', intent: 'save' }); expect(second.status).toBe('saved');
    const writes = env.calls.filter((call) => call.method === 'post'); expect(writes).toHaveLength(2); expect(writes[1]!.body).toEqual(writes[0]!.body);
  });
  it('reconciles lost config and link responses through GET before continuing without repeating confirmed writes', async () => {
    for (const stage of ['config', 'questions']) {
      const env = await setup(newPaper()); const write = env.api.put; let lost = false;
      env.api.put = async (path, body) => { const response = await write(path, body); if (!lost && (path.endsWith('/questions') === (stage === 'questions'))) { lost = true; throw new Error('lost response'); } return response; };
      const first = await env.host.saveDraft(newPaper(), { request_id: stage, intent: 'save' });
      expect(first.status).toBe('incomplete'); expect(env.host.canDiscard()).toBe(false);
      const second = await env.host.saveDraft(first.value, { request_id: stage, intent: 'save' }); expect(second.status).toBe('saved');
      expect(env.calls.filter((call) => call.method === 'get' && call.path === '/admin/papers/100')).toHaveLength(1);
      expect(env.calls.filter((call) => call.method === 'put' && call.path === '/admin/papers/100')).toHaveLength(1);
      expect(env.calls.filter((call) => call.method === 'put' && call.path.endsWith('/questions'))).toHaveLength(1);
    }
  });
  it('allows reuse with paper-write but requires question-write before a changed question can be committed', async () => {
    const access = { read: true, write: true, questionsRead: true, questionsWrite: false };
    const reuse = await setup(paperFixture(), access); expect((await reuse.host.saveDraft(paperFixture(), { request_id: 'reuse', intent: 'save' })).status).toBe('saved');
    const changed = newPaper(); const denied = await setup(changed, access); await expect(denied.host.saveDraft(changed, { request_id: 'denied', intent: 'save' })).rejects.toThrow(/权限/); expect(denied.calls).toEqual([]);
    const readDenied = await setup(paperFixture(), { ...access, read: false }); await expect(readDenied.host.load()).rejects.toThrow(/权限/); expect(readDenied.calls).toEqual([]);
  });
  it('persists layout and rejects medium, invalid totals, category mismatches and missing permissions before writes', async () => {
    const value = paperFixture(); value.paper_layout = { schema_version: 1, settings: { templateName: value.paper.title, pageSize: 'A5', pageOrientation: 2, pageSizeReduce: { top: 10, bottom: 20, left: 12, right: 13 } } };
    const env = await setup(value); await env.host.saveDraft(value, { request_id: 'layout', intent: 'save' }); expect(env.calls[0]!.body.designer_layout).toEqual(value.paper_layout);
    for (const mutation of [(v: PaperDesignerValue) => { v.document.questions.question_one!.difficulty = 'medium'; }, (v: PaperDesignerValue) => { v.document.questions.question_one!.score_cents = 5; }, (v: PaperDesignerValue) => { v.document.questions.question_one!.category_id = '11'; }]) {
      const invalid = paperFixture(); mutation(invalid); const isolated = await setup(invalid); await expect(isolated.host.saveDraft(invalid, { request_id: 'invalid', intent: 'save' })).rejects.toThrow(); expect(isolated.calls).toEqual([]);
    }
  });
  it('validates paper layout before creating any new question', async () => {
    const value = newPaper(); value.paper_layout = { schema_version: 1, settings: { templateName: '不合法', pageSize: 'A4', pageOrientation: 1, pageSizeReduce: { top: -1, bottom: 15, left: 15, right: 15 } } };
    const env = await setup(value); await expect(env.host.saveDraft(value, { request_id: 'bad-layout', intent: 'save' })).rejects.toThrow(/布局|页边距/); expect(env.calls).toEqual([]);
  });
  it.each([
    ['decimal-margin', { top: 0.5 }, '纸张'], ['negative-margin', { top: -1 }, '纸张'], ['large-margin', { top: 100 }, '纸张'],
    ['empty-template-name', {}, ''], ['blank-template-name', {}, '   '], ['long-template-name', {}, '名'.repeat(129)],
  ])('rejects server-invalid layout %s before every HTTP call', async (_name, margin, templateName) => {
    const value = newPaper(); value.paper_layout = { schema_version: 1, settings: { templateName: templateName as string, pageSize: 'A4', pageOrientation: 1,
      pageSizeReduce: { top: 15, bottom: 15, left: 15, right: 15, ...margin as object } } };
    expect(() => validateDesignerLayout(value.paper_layout)).toThrow();
    const env = await setup(value); await expect(env.host.saveDraft(value, { request_id: 'invalid-layout', intent: 'save' })).rejects.toThrow(); expect(env.calls).toEqual([]);
  });
  it.each([
    ['duration_minutes', 0], ['duration_minutes', 1441], ['duration_minutes', 1.5], ['duration_minutes', '30'],
    ['max_attempts', 0], ['max_attempts', 101], ['max_attempts', 1.5], ['max_attempts', '3'],
    ['pass_score', 0], ['pass_score', 0.001], ['pass_score', 100.01], ['pass_score', '60'],
    ['partial_credit_ratio', -0.01], ['partial_credit_ratio', 1.01], ['partial_credit_ratio', '0.5'],
    ['requires_learning', 1], ['requires_learning', 'false'],
    ['course_ids', ['41', '41']], ['course_ids', ['wrong-id']], ['course_ids', Array.from({ length: 101 }, (_, i) => String(i + 1))],
  ])('rejects invalid %s=%j before creating any new question', async (field, invalid) => {
    const value = newPaper(); Object.assign(value.paper, { [field as string]: invalid }); const snapshot = copy(value);
    const env = await setup(value); await expect(env.host.saveDraft(value, { request_id: 'invalid-strategy', intent: 'save' })).rejects.toThrow(); expect(env.calls).toEqual([]); expect(value).toEqual(snapshot);
  });
  it('accepts server strategy and layout boundary values without narrowing pass score or partial credit to integers', async () => {
    for (const paper of [{ duration_minutes: 1, max_attempts: 1, pass_score: 0.01, partial_credit_ratio: 0, requires_learning: false }, { duration_minutes: 1440, max_attempts: 100, pass_score: 99.5, partial_credit_ratio: 0.375, requires_learning: true }]) {
      const value = newPaper(); Object.assign(value.paper, paper); value.paper_layout = { schema_version: 1, settings: { templateName: '😀'.repeat(128), pageSize: 'A5', pageOrientation: 2, pageSizeReduce: { top: 0, bottom: 99, left: 0, right: 99 } } };
      const env = await setup(value); expect((await env.host.saveDraft(value, { request_id: 'valid-strategy', intent: 'save' })).status).toBe('saved'); expect(env.calls[1]!.body).toMatchObject(paper);
    }
  });
  it('preserves an ordered one-hundred-question reuse set and rejects the one-hundred-and-first before writes', async () => {
    const value = paperFixture(); value.document.content.content = []; value.document.questions = {}; value.bindings = {};
    for (let index = 0; index < 100; index += 1) {
      const id = `q_${index}`; const item = paperFixture('100', '10', id); item.document.questions[id]!.score_cents = 100; item.document.questions[id]!.concept_id = null;
      const { questionFingerprint } = await import('../paper-designer-state');
      value.document.content.content.push(item.document.content.content![0]!); value.document.questions[id] = item.document.questions[id]!;
      value.bindings[id] = { kind: 'bound', question_id: String(index + 1), question_version_id: String(index + 101), revision: 1, baseline_fingerprint: questionFingerprint(item.document, id) };
    }
    value.document.content.content.reverse(); const env = await setup(value); expect((await env.host.saveDraft(value, { request_id: 'one-hundred', intent: 'save' })).status).toBe('saved');
    expect(env.calls.some((call) => call.method === 'post')).toBe(false); expect(env.calls.at(-1)!.body.items.map((item: any) => item.question_version_id)).toEqual(Array.from({ length: 100 }, (_, index) => String(200 - index)));
    const extra = paperFixture('100', '10', 'extra'); value.document.content.content.push(extra.document.content.content![0]!); value.document.questions.extra = extra.document.questions.extra!; value.bindings.extra = extra.bindings.extra!;
    const denied = await setup(value); await expect(denied.host.saveDraft(value, { request_id: 'too-many', intent: 'save' })).rejects.toThrow(/100/); expect(denied.calls).toEqual([]);
  });
  it('splits assembled authoring bundles into precise bindings and sessions while retaining legacy medium and layout', async () => {
    const value = paperFixture(); const env = await setup(value);
    const layout = { schema_version: 1, settings: { templateName: '旧卷', pageSize: 'A5', pageOrientation: 2, pageSizeReduce: { top: 0, bottom: 15, left: 15, right: 15 } } };
    env.api.get = async () => ({ ...value.paper, status: 'draft', designer_layout: layout, rules: [], questions: [{ question_id: '40', question_version_id: '50', score_cents: 10000, sort: 0 }] });
    env.api.post = async () => ({ document: { ...copy(value.document), questions: { question_one: { ...copy(value.document.questions.question_one), difficulty: 'medium', question_id: '40', base_revision: 2 } } }, option_ids: { question_one: { question_one_a: 'A', question_one_b: 'B' } }, identities: { question_one: { question_id: '40', expected_version_id: '50' } }, layouts: { question_one: layout } }) as any;
    const loaded = await env.host.load(); expect(loaded.document.questions.question_one!.difficulty).toBe('medium'); expect(loaded.bindings.question_one).toMatchObject({ question_id: '40', question_version_id: '50', revision: 2 });
    expect(loaded.session).toEqual({ option_ids: { question_one: { question_one_a: 'A', question_one_b: 'B' } }, identities: {}, layouts: { question_one: layout } }); expect(loaded.paper_layout).toEqual(layout);
    await expect(env.host.saveDraft(loaded, { request_id: 'medium', intent: 'save' })).rejects.toThrow();
  });
  it('uses main paginated libraries and assembles the selected exact approved version with stable IDs', async () => {
    const value = paperFixture(); const env = await setup(value); const queries: any[] = [];
    env.api.get = (async (path: string, config: any) => { queries.push({ path, ...config }); return path === '/ai/questions' ? { list: [{ question_id: '40', current_version_id: '50', status: 'approved', revision: 1, category_id: '10', difficulty: 'easy', type: 'single', stem: '题干' }], total: 81 }
      : { items: [{ ...value.paper, rules: [{ type: 'single', count: 1, score_cents: 10000 }] }], total: 25, page: 2, page_size: 20 }; }) as any;
    env.api.post = async (_path: string, body: any) => { expect(body).toEqual({ version_ids: ['50'] }); return { document: { ...copy(value.document), questions: { question_one: { ...value.document.questions.question_one, question_id: '40', base_revision: 1 } } }, option_ids: { question_one: { question_one_a: 'A', question_one_b: 'B' } }, identities: { question_one: { question_id: '40', expected_version_id: '50' } }, layouts: {} } as any; };
    const page = await env.host.questionLibrarySource.list({ category_id: '10', keyword: '安全', page: 3, page_size: 20 });
    expect(page.total).toBe(81); expect(page.page).toBe(3); expect(queries[0]).toEqual({ path: '/ai/questions', params: { category_id: '10', keyword: '安全', page: 3, page_size: 20, status: 'approved' } });
    const question = await env.host.questionLibrarySource.get('40'); expect(question.session!.option_ids.question_one).toEqual({ question_one_a: 'A', question_one_b: 'B' }); expect(question.binding.question_version_id).toBe('50');
    const papers = await env.host.paperLibrarySource.list({ keyword: '完整', page: 2, page_size: 20 }); expect(papers).toMatchObject({ total: 25, page: 2, items: [{ id: '100', question_count: 1 }] }); expect(queries[1].params).toEqual({ keyword: '完整', page: 2, page_size: 20, mode: 'fixed' });
    env.host.dispose(); await expect(env.host.questionLibrarySource.get('40')).rejects.toThrow(/会话/);
  });
});
