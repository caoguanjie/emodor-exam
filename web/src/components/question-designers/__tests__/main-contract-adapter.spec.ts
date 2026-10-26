import { describe, expect, it } from 'vitest';
import type { AuthoringBundle, AuthoringReceipt, QuestionAuthoringDocument } from '../../../api/question-document-types';
import { applyAuthoringReceipt, toAuthoringBundle, validateDesignerLayout } from '../paper-designer-state';

function document(): QuestionAuthoringDocument {
  return { schema_version: 1, content: { type: 'doc', content: [{ type: 'questionBlock', attrs: { client_id: 'local-one' }, content: [
    { type: 'questionStem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '先做什么？' }] }] },
    { type: 'questionOption', attrs: { option_id: 'editor-a', checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '检查' }] }] },
    { type: 'questionOption', attrs: { option_id: 'editor-b', checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '进入' }] }] },
  ] }] }, questions: { 'local-one': { type: 'single', category_id: '10', difficulty: 'easy', concept_id: null,
    regulation_id: null, regulation_version_id: null, score_cents: 10000, analysis: { type: 'doc', content: [{ type: 'paragraph' }] } } } };
}
function session() {
  return { option_ids: { 'local-one': { 'editor-a': 'A', 'editor-b': 'B' } },
    identities: { 'local-one': { question_id: '40', expected_version_id: '50', expected_enabled: true } }, layouts: {} };
}

describe('main authoring contract adapter', () => {
  it('rejects an existing identity without its original enabled baseline', () => {
    const state = session();
    delete (state.identities['local-one'] as { expected_enabled?: boolean }).expected_enabled;
    expect(() => toAuthoringBundle(document(), state)).toThrow(/启用状态/);
  });
  it('strips paper scores and legacy concepts while preserving the original enabled baseline', () => {
    const value = document();
    value.questions['local-one']!.concept_id = '19';
    const state = session();
    Object.assign(state.identities['local-one']!, { expected_enabled: false });
    const bundle = toAuthoringBundle(value, state);
    expect(bundle.document.questions['local-one']).not.toHaveProperty('concept_id');
    expect(bundle.document.questions['local-one']).not.toHaveProperty('score_cents');
    expect(bundle.identities['local-one']).toMatchObject({ expected_enabled: false });
    expect(value.questions['local-one']!.score_cents).toBe(10000);
  });
  // Rebuilding stable IDs from display order would change the correct answer after reordering.
  it('preserves short A/B stable IDs and version tokens when editor options are reordered', () => {
    const value = document();
    const children = value.content.content![0]!.content!;
    [children[1], children[2]] = [children[2]!, children[1]!];
    const bundle = toAuthoringBundle(value, session());
    expect(bundle.option_ids).toEqual({ 'local-one': { 'editor-b': 'B', 'editor-a': 'A' } });
    expect(bundle.identities).toEqual({ 'local-one': { question_id: '40', expected_version_id: '50', expected_enabled: true } });
    expect(bundle.document.content.content![0]!.content![2]!.attrs).toEqual({ option_id: 'editor-a', checked: true });
  });

  it('gives a new option one stable ID that survives a save retry', () => {
    const value = document();
    value.content.content![0]!.content!.push({ type: 'questionOption', attrs: { option_id: 'editor-c', checked: false }, content: [{ type: 'paragraph' }] });
    const first = toAuthoringBundle(value, session());
    const retry = toAuthoringBundle(value, first);
    expect(first.option_ids['local-one']!['editor-c']).toBeTruthy();
    expect(retry.option_ids).toEqual(first.option_ids);
    expect(first.option_ids['local-one']!['editor-a']).toBe('A');
  });

  it('adopts the saved version and normalized original from the exact receipt', () => {
    const value = toAuthoringBundle(document(), session());
    const normalized: AuthoringBundle = structuredClone(value);
    normalized.document.questions['local-one']!.difficulty = 'hard';
    normalized.identities['local-one'] = { question_id: '40', expected_version_id: '51', expected_enabled: true };
    const receipt: AuthoringReceipt = { request_id: 'request-one', bundle: normalized,
      items: [{ client_id: 'local-one', question_id: '40', saved_version_id: '51', revision: 2 }] };
    expect(applyAuthoringReceipt(value, receipt)).toEqual(normalized);
    expect(value.document.questions['local-one']!.difficulty).toBe('easy');
  });

  it('rejects a receipt with a foreign client without changing the pending state', () => {
    const value = toAuthoringBundle(document(), session());
    const original = structuredClone(value);
    expect(() => applyAuthoringReceipt(value, { request_id: 'request-one', bundle: value,
      items: [{ client_id: 'other-client', question_id: '40', saved_version_id: '51', revision: 2 }] })).toThrow();
    expect(value).toEqual(original);
  });

  it('rejects a receipt that replaces existing short stable option IDs', () => {
    const value = toAuthoringBundle(document(), session());
    const normalized = structuredClone(value);
    normalized.option_ids['local-one']!['editor-a'] = 'replacement';
    expect(() => applyAuthoringReceipt(value, { request_id: 'request-one', bundle: normalized,
      items: [{ client_id: 'local-one', question_id: '40', saved_version_id: '51', revision: 2 }] })).toThrow();
    expect(value.option_ids['local-one']!['editor-a']).toBe('A');
  });

  it('accepts only the actual controlled paper layout fields, including zero margins', () => {
    const layout = { schema_version: 1, settings: { templateName: '纸张', pageSize: 'A5', pageOrientation: 2,
      pageSizeReduce: { top: 0, bottom: 20, left: 12, right: 13 } } };
    expect(validateDesignerLayout(layout)).toEqual(layout);
    expect(() => validateDesignerLayout({ ...layout, settings: { ...layout.settings, style: 'url(evil)' } })).toThrow();
    expect(() => validateDesignerLayout({ ...layout, settings: { ...layout.settings, pageSizeReduce: { ...layout.settings.pageSizeReduce, top: -1 } } })).toThrow();
  });
});
