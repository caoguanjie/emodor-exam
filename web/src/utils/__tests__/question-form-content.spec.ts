import { describe, expect, it } from 'vitest';
import { questionDraftFromView, questionDraftWithContent } from '../../api/training-types';
import richFixture from '../../../../tests/fixtures/question-authoring-v3/rich-content.json';
import { toQuestionFormValue } from '../question-form-content';

function richDraft() {
  const { schema: _schema, ...content } = structuredClone(richFixture);
  return questionDraftFromView({ category_id: '7', difficulty: 'easy', type: 'single', score: 5,
    stem: '过期题干', options: [{ key: 'old', text: '过期选项' }], answer: [0], analysis: '过期解析',
    content_schema_version: 3, content_json: content } as any);
}

describe('existing form preserves canonical schema 3', () => {
  function boundaryContent(indent: number, colwidth: number) {
    return { ...structuredClone(richFixture), stem: { type: 'doc', content: [
      { type: 'paragraph', attrs: { indent }, content: [{ type: 'text', text: '合法缩进' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: [colwidth], align: null },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '零宽列' }] }],
      }] }] },
    ] } } as any;
  }

  it.each([9, 10])('opens server-valid indent %s and zero colwidth without changing canonical content', (indent) => {
    const content = boundaryContent(indent, 0);
    const before = structuredClone(content);
    const value = toQuestionFormValue(content);
    expect(value.stem).toContain(`margin-left:${indent * 2}em`);
    expect(value.stem).toContain('data-colwidth="0"');
    expect(content).toEqual(before);
  });

  it.each([[-1, 0], [11, 0], [10, -1], [10, 10001]])('keeps server-invalid indent %s / colwidth %s rejected', (indent, colwidth) => {
    expect(() => toQuestionFormValue(boundaryContent(indent, colwidth))).toThrow();
  });
  // A schema-2 rebuild would erase every rich mark/table and change the answer identity.
  it('reads the canonical rich fields instead of stale compatibility projections', () => {
    const draft = richDraft();
    expect(draft.stem).toContain('<table>');
    expect(draft.stem).toContain('<strong>');
    expect(draft.options.map((option) => option.key)).toEqual(['A', 'B']);
    expect(draft.content_schema_version).toBe(3);
  });

  it('changes only answer and properties while preserving every rich field', () => {
    const draft = richDraft(); draft.difficulty = 'hard'; draft.answer = [1];
    const saved = questionDraftWithContent(draft);
    expect(saved.content_schema_version).toBe(3);
    const { schema: _schema, ...original } = richFixture;
    expect(saved.content_json).toEqual({ ...original, answer_option_ids: ['B'] });
  });

  it('reorders and deletes options by stable identity without regenerating rich content', () => {
    const draft = richDraft(); draft.options.reverse(); draft.answer = [1];
    const saved = questionDraftWithContent(draft);
    expect(saved.content_schema_version).toBe(3);
    expect(saved.content_json.options).toEqual([richFixture.options[1], richFixture.options[0]]);
    expect(saved.content_json.answer_option_ids).toEqual(['A']);
  });

  it('edits a precisely located rich text node without losing its marks or siblings', () => {
    const draft = richDraft(); draft.options[0]!.text = draft.options[0]!.text.replace('先通风检测', '先检查设备');
    const saved = questionDraftWithContent(draft);
    expect(saved.content_schema_version).toBe(3);
    expect(saved.content_json.options[0]!.content).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '先检查设备', marks: [{ type: 'bold' }] }, { type: 'image', attrs: { asset_id: '42' } },
    ] }] });
    expect(saved.content_json.stem).toEqual(richFixture.stem);
  });

  it('rejects an ambiguous rich-field rewrite and keeps the caller draft intact', () => {
    const draft = richDraft(); draft.stem = '<p>替换整份富文本</p>';
    const before = structuredClone(draft);
    expect(() => questionDraftWithContent(draft)).toThrow(/题干.*无法.*保留/);
    expect(draft).toEqual(before);
  });

  it('rejects invalid stable IDs and answer indices rather than silently discarding them', () => {
    const draft = richDraft(); draft.answer = [9];
    expect(() => questionDraftWithContent(draft)).toThrow(/答案/);
    draft.answer = [0]; draft.options[1]!.key = 'A';
    expect(() => questionDraftWithContent(draft)).toThrow(/选项/);
  });

  it('retains the ordinary schema 2 create path', () => {
    const saved = questionDraftWithContent({ category_id: '7', difficulty: 'easy', type: 'single',
      stem: '题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [1], analysis: null });
    expect(saved.content_schema_version).toBe(2);
    expect(saved.content_json.answer_option_ids).toEqual(['B']);
  });

  it('adds one stable option once and retains that ID through retries and deletion', () => {
    const draft = richDraft();
    draft.options.push({ key: 'new_option_1', text: '<p>新增选项</p>' });
    draft.options.splice(1, 1); draft.answer = [1];
    const saved = questionDraftWithContent(draft);
    expect(saved.content_json.options.map((option) => option.id)).toEqual(['A', 'new_option_1']);
    expect(saved.content_json.answer_option_ids).toEqual(['new_option_1']);
    expect(saved.content_json.options[0]).toEqual(richFixture.options[0]);
    expect(questionDraftWithContent(draft).content_json).toEqual(saved.content_json);
  });

  it('changes a plain analysis field while leaving the rich stem and options unchanged', () => {
    const draft = richDraft(); draft.analysis = '<p>新版解析</p>';
    const saved = questionDraftWithContent(draft);
    expect(saved.content_json.analysis).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新版解析' }] }] });
    expect(saved.content_json.stem).toEqual(richFixture.stem);
    expect(saved.content_json.options).toEqual(richFixture.options);
  });

  it('rejects newly introduced markup or external image attributes in a schema 3 plain field', () => {
    const draft = richDraft(); draft.analysis = '<p onclick="steal()">解析</p>';
    expect(() => questionDraftWithContent(draft)).toThrow(/解析/);
    draft.analysis = '<p><img src="https://attacker.test/a.png" data-media-id="44"></p>';
    expect(() => questionDraftWithContent(draft)).toThrow(/解析/);
  });

  it('does not rewrite an unchanged newline node when another rich text node changes', () => {
    const draft = richDraft();
    const content = draft.content_json as any;
    content.options[0].content.content[0].content.push({ type: 'text', text: '保留\r\n换行', marks: [{ type: 'italic' }] });
    const reopened = questionDraftFromView(draft);
    reopened.options[0]!.text = reopened.options[0]!.text.replace('先通风检测', '新文本');
    const saved = questionDraftWithContent(reopened);
    expect((saved.content_json.options[0]!.content.content[0] as any).content[2].text).toBe('保留\r\n换行');
  });

  it.each([
    ['leading', '<p></p><p>修改后</p>', [{ type: 'paragraph', content: [] }, { type: 'paragraph', content: [{ type: 'text', text: '修改后' }] }]],
    ['trailing', '<p>修改后</p><p></p>', [{ type: 'paragraph', content: [{ type: 'text', text: '修改后' }] }, { type: 'paragraph', content: [] }]],
    ['consecutive', '<p></p><p></p><p>修改后</p><p></p>', [{ type: 'paragraph', content: [] }, { type: 'paragraph', content: [] }, { type: 'paragraph', content: [{ type: 'text', text: '修改后' }] }, { type: 'paragraph', content: [] }]],
  ])('preserves %s empty paragraphs when a schema 3 plain field changes', (_name, html, paragraphs) => {
    const draft = richDraft(); draft.analysis = html as string;
    const saved = questionDraftWithContent(draft);
    expect(saved.content_json.analysis).toEqual({ type: 'doc', content: paragraphs });
    const reopened = questionDraftFromView({ ...draft, ...saved });
    expect(reopened.analysis).toBe(html);
  });

  it('preserves original adjacent text node boundaries while editing one plain node', () => {
    const draft = richDraft();
    draft.content_json!.analysis = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前句' }, { type: 'text', text: '尾句' }] }] };
    const reopened = questionDraftFromView(draft); reopened.analysis = '<p>新前句尾句</p>';
    const saved = questionDraftWithContent(reopened);
    expect(saved.content_json.analysis).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新前句' }, { type: 'text', text: '尾句' }] }] });
  });

  it('rejects a text edit when repeated adjacent nodes make the changed node ambiguous', () => {
    const draft = richDraft();
    draft.content_json!.analysis = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'A' }] }] };
    const reopened = questionDraftFromView(draft); reopened.analysis = '<p>AAA</p>';
    expect(() => questionDraftWithContent(reopened)).toThrow(/解析/);
  });

  it('accepts only the fixed form image alt and preserves images when ordinary paragraphs are added', () => {
    const draft = richDraft();
    draft.analysis = '<p></p><p><img data-media-id="44" alt="题目图片"></p><p>新增段落</p>';
    const saved = questionDraftWithContent(draft);
    expect(saved.content_json.analysis).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '44' } }] },
      { type: 'paragraph', content: [{ type: 'text', text: '新增段落' }] }] });
    const reopened = questionDraftFromView({ ...draft, ...saved });
    reopened.analysis = '<p><img data-media-id="44"></p>';
    expect(questionDraftWithContent(reopened).content_json.analysis).toEqual({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '44' } }] },
    ] });
    for (const attribute of ['alt="任意文字"', 'src="https://outside.test/a.png"', 'onerror="alert(1)"', 'class="x"']) {
      draft.analysis = `<p><img data-media-id="44" ${attribute}></p>`;
      expect(() => questionDraftWithContent(draft)).toThrow(/解析/);
    }
  });
});
