import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionContentV3 } from '../../api/question-document-types';
import { questionDraftWithContent, type QuestionDraftPayload } from '../../api/training-types';
import { createExtensions } from '../Tiptap/utils/createExtensions';
import { fromManualRichDoc, manualContentFromDraft, manualContentFromDocument, manualDraftWithContent, manualQuestionDocument, toManualRichDoc } from '../manual-question-content';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const rich = (): QuestionContentV3 => ({
  stem: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 3, textAlign: 'center', indent: 1, lineHeight: '1.75' }, content: [{ type: 'text', text: '富文本', marks: [
      { type: 'textStyle', attrs: { fontFamily: 'SimHei', fontSize: '18pt', color: '#336699' } }, { type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'highlight', attrs: { color: '#ffcc00' } },
    ] }] },
    { type: 'bulletList', content: [{ type: 'listItem', attrs: { indent: 1, lineHeight: '2' }, content: [{ type: 'paragraph', content: [
      { type: 'text', text: '首项', marks: [{ type: 'strike' }] }, { type: 'hardBreak' }, { type: 'image', attrs: { asset_id: '123' } },
    ] }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120], align: 'right' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '表格' }] }] }] }] },
    { type: 'paragraph' },
  ] },
  options: [{ id: 'stable_first', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }] }] } },
    { id: 'stable_second', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '124' } }] }] } }],
  analysis: { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '解析', marks: [{ type: 'superscript' }] }] }] }] },
  answer_option_ids: ['stable_second'],
});
const draft = (content = rich()): QuestionDraftPayload => ({ category_id: '10', type: 'single', difficulty: 'easy', stem: '旧缓存', options: [], answer: [], analysis: null, content_schema_version: 3, content_json: content });

describe('manual question canonical adapter', () => {
  it('preserves full rich schema3 through real Tiptap normalization and parent saving without HTML reconstruction', () => {
    const content = rich(); const editor = new Editor({ extensions: createExtensions('question'), content: manualQuestionDocument(content) }); editors.push(editor);
    const result = manualContentFromDocument(editor.getJSON(), content);
    expect(result).toEqual(content);
    const value = manualDraftWithContent(draft(), result);
    expect(value.stem).toContain('data-colwidth="120"'); expect(value.stem).toContain('line-height:1.75');
    expect(value.options[1]!.text).toBe('<p><img data-media-id="124"></p>');
    expect(questionDraftWithContent(value).content_json).toEqual(content);
  });

  it('retains untouched table/list/image subtrees when the author changes a rich stem text', () => {
    const content = rich(); const editor = new Editor({ extensions: createExtensions('question'), content: manualQuestionDocument(content) }); editors.push(editor);
    editor.commands.insertContentAt(3, '新增');
    const result = manualContentFromDocument(editor.getJSON(), content);
    expect(result.stem.content.slice(1)).toEqual(content.stem.content.slice(1));
    expect(result.options).toEqual(content.options); expect(result.analysis).toEqual(content.analysis);
    expect(result.stem.content[0]).not.toEqual(content.stem.content[0]);
  });

  it('opens formatted legacy HTML once, and keeps legacy and schema2 option IDs instead of relabeling', () => {
    const value: QuestionDraftPayload = { category_id: '10', difficulty: 'easy', type: 'single', stem: '<p><strong>旧题</strong><img data-media-id="22"></p>',
      options: [{ key: 'legacy_A', text: '<p><em>甲</em></p>' }, { key: 'legacy_B', text: '<p>乙</p>' }], answer: [1], analysis: null };
    const content = manualContentFromDraft(value);
    expect(content.stem.content[0]).toMatchObject({ type: 'paragraph', content: [{ type: 'text', text: '旧题', marks: [{ type: 'bold' }] }, { type: 'image', attrs: { asset_id: '22' } }] });
    expect(content.options.map((option) => option.id)).toEqual(['legacy_A', 'legacy_B']); expect(content.answer_option_ids).toEqual(['legacy_B']);
    const v2: any = { stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v2' }] }] },
      options: [{ id: 'v2_a', content: { type: 'doc', content: [] } }, { id: 'v2_b', content: { type: 'doc', content: [] } }], analysis: null, answer_option_ids: ['v2_a'] };
    expect(manualContentFromDraft({ ...value, content_schema_version: 2, content_json: v2 })).toEqual(v2);
  });

  it('rejects unknown formats, duplicate or missing stable IDs and foreign image URLs before dropping content', () => {
    const value = draft(); (value.content_json!.stem.content as any[]).push({ type: 'foreign' });
    expect(() => manualContentFromDraft(value)).toThrow();
    const duplicate = rich(); duplicate.options[1]!.id = duplicate.options[0]!.id; expect(() => manualContentFromDraft(draft(duplicate))).toThrow();
    const missing = rich(); missing.answer_option_ids = ['lost']; expect(() => manualContentFromDraft(draft(missing))).toThrow();
    expect(() => fromManualRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] })).toThrow();
    const old = { ...draft(), content_schema_version: 1 as const, content_json: null, stem: '<p><img src="blob:temporary"></p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] };
    expect(() => manualContentFromDraft(old)).toThrow();
  });

  it('does not silently flatten marked whitespace-only analysis when it is opened and edited elsewhere', () => {
    const content = rich(); content.analysis = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ', marks: [{ type: 'bold' }] }] }] };
    const normalized = fromManualRichDoc(toManualRichDoc(content.analysis), content.analysis);
    expect(normalized).toEqual(content.analysis);
  });
});
