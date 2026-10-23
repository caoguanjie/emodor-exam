import type { PaperDesignerValue } from '../contracts';
import { questionFingerprint } from '../paper-designer-state';

export function paperFixture(id = '100', category = '10', client = 'question_one'): PaperDesignerValue {
  const value: PaperDesignerValue = {
    paper: { id, title: `试卷 ${id}`, category_id: category, mode: 'fixed', pass_score: 60, duration_minutes: 30,
      max_attempts: 3, partial_credit_ratio: 0.5, requires_learning: false, regulation_ids: [], course_ids: [] },
    document: {
      schema_version: 1,
      content: { type: 'doc', content: [{ type: 'questionBlock', attrs: { client_id: client }, content: [
        { type: 'questionStem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `题干 ${client}` }] }] },
        { type: 'questionOption', attrs: { option_id: `${client}_a`, checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '先检测' }] }] },
        { type: 'questionOption', attrs: { option_id: `${client}_b`, checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '直接进入' }] }] },
      ] }] },
      questions: { [client]: { type: 'single', category_id: category, difficulty: 'easy', concept_id: '20',
        regulation_id: null, regulation_version_id: null, score_cents: 10000, analysis: { type: 'doc', content: [{ type: 'paragraph' }] } } },
    },
    bindings: {},
  };
  value.bindings[client] = { kind: 'bound', question_id: '40', question_version_id: '50', revision: 1,
    baseline_fingerprint: questionFingerprint(value.document, client) };
  return value;
}

export function blankPaper(): PaperDesignerValue {
  const value = paperFixture();
  value.document.content.content = []; value.document.questions = {}; value.bindings = {};
  return value;
}

export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
