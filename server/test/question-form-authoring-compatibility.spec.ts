import { describe, expect, it } from 'vitest';
import { validateAndSanitizeQuestionDraft, type QuestionDraftInput } from '../src/modules/questions/question-validator';
import { decodeAuthoringBundle, synchronizeFormAuthoring, type AuthoringQuestionWrite } from '../src/modules/questions/question-authoring-codec';
import type { AuthoringBundle } from '../src/common/question-authoring';
import { parseQuestionContent } from '../src/modules/questions/question-content-dispatch';
import { readFileSync } from 'node:fs';

const rich = {
  stem: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '题干', marks: [{ type: 'bold' }] }] }] },
  options: ['A', 'B'].map((id) => ({ id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] } })),
  analysis: null, answer_option_ids: ['A'],
};
const draft: QuestionDraftInput = {
  categoryId: '11', difficulty: 'easy', type: 'single', source: 'manual',
  stem: '', options: [], answer: [], analysis: null, scoreCents: 500,
};

describe('form authoring content compatibility', () => {
  // Catches the old unconditional schema-2 validator and version downgrade.
  it('accepts schema 3 without losing marks or short stable option ids', () => {
    const result = validateAndSanitizeQuestionDraft({ ...draft, contentSchemaVersion: 3, contentJson: rich });
    expect(result.contentSchemaVersion).toBe(3);
    expect(result.contentJson).toEqual(rich);
    expect(result.options).toEqual([{ key: 'A', text: '<p>A</p>' }, { key: 'B', text: '<p>B</p>' }]);
    expect(result.answer).toEqual([0]);
  });

  it('keeps the schema 2 marks ban', () => {
    expect(() => validateAndSanitizeQuestionDraft({ ...draft, contentSchemaVersion: 2, contentJson: rich }))
      .toThrow();
  });

  it('keeps an ordinary legacy form create on schema 2', () => {
    const result = validateAndSanitizeQuestionDraft({ ...draft, stem: '<p>题干</p>', options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [1] });
    expect(result.contentSchemaVersion).toBe(2);
    expect(result.contentJson?.answer_option_ids).toEqual(['B']);
  });
});

function authoringFixture(): AuthoringBundle {
  return { document: JSON.parse(readFileSync(new URL('../../tests/fixtures/question-authoring-v3/rich-authoring.json', import.meta.url), 'utf8')),
    option_ids: { question_fixture_00001: { editor_option_00000001: 'A', editor_option_00000002: 'B' } }, identities: {},
    layouts: { question_fixture_00001: { schema_version: 1, settings: { templateName: '测试', pageSize: 'A4', pageOrientation: 1, pageSizeReduce: { top: 15, bottom: 15, left: 15, right: 15 } } } } };
}

describe('form changes synchronize the immutable authoring document', () => {
  it('roundtrips empty paragraphs and controlled media when ordinary paragraphs are added or removed', () => {
    const bundle: AuthoringBundle = { document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: {} }, option_ids: {}, identities: {}, layouts: {} };
    const content = parseQuestionContent({ ...rich, schema: 3, type: 'single', stem: { type: 'doc', content: [
      { type: 'paragraph', content: [] }, { type: 'paragraph', content: [{ type: 'text', text: '原文' }] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '42' } }] }, { type: 'paragraph', content: [] },
    ] } });
    const original: AuthoringQuestionWrite = { client_id: 'plain_media_question', bundle, content, category_id: '11', difficulty: 'easy', type: 'single', score: 5 };
    const base = synchronizeFormAuthoring(null, original);
    const changed = parseQuestionContent({ ...content, stem: { type: 'doc', content: [
      { type: 'paragraph', content: [] }, { type: 'paragraph', content: [{ type: 'text', text: '新文' }] },
      { type: 'paragraph', content: [] }, { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '42' } }] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '44' } }] }, { type: 'paragraph', content: [{ type: 'text', text: '尾段' }] },
    ] } });
    const next = synchronizeFormAuthoring(base, { ...original, bundle: base, content: changed });
    expect(decodeAuthoringBundle(next)[0].content.stem).toEqual(changed.stem);
    const removed = parseQuestionContent({ ...changed, stem: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '42' } }] },
    ] } });
    const last = synchronizeFormAuthoring(next, { ...original, bundle: next, content: removed });
    expect(decodeAuthoringBundle(last)[0].content.stem).toEqual(removed.stem);
    expect(decodeAuthoringBundle(next)[0].content.stem).toEqual(changed.stem);
  });
  it('allows an ordinary schema 2 form revision to replace a legacy image field', () => {
    const empty: AuthoringBundle = {
      document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: {} },
      option_ids: {}, identities: {}, layouts: {},
    };
    const original: AuthoringQuestionWrite = {
      client_id: 'legacy_form_question', bundle: empty,
      category_id: '11', difficulty: 'easy', type: 'single', score: 5, concept_id: null,
      content: parseQuestionContent({
        schema: 2, type: 'single',
        stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '42' } }] }] },
        options: [
          { id: 'A', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] } },
          { id: 'B', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] } },
        ],
        analysis: null, answer_option_ids: ['A'],
      }),
    };
    const base = synchronizeFormAuthoring(null, original);
    const replacement = parseQuestionContent({
      ...original.content,
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '替换后的普通题干' }] }] },
    });

    const next = synchronizeFormAuthoring(base, { ...original, bundle: base, content: replacement });

    expect(decodeAuthoringBundle(next)[0].content.stem).toEqual(replacement.stem);
  });

  it('updates mirrors and answer flags while preserving rich nodes, stable ids and layout', () => {
    const base = authoringFixture(); const write = decodeAuthoringBundle(base)[0];
    const next = synchronizeFormAuthoring(base, { ...write, difficulty: 'hard', content: { ...write.content, answer_option_ids: ['B'] } });
    expect(next.document.content.content?.[0].content?.[0]).toEqual(base.document.content.content?.[0].content?.[0]);
    expect(next.document.content.content?.[0].content?.slice(1).map((n) => n.attrs?.checked)).toEqual([false, true]);
    expect(next.document.questions.question_fixture_00001.difficulty).toBe('hard');
    expect(next.option_ids).toEqual(base.option_ids);
    expect(next.layouts).toEqual(base.layouts);
    expect(base.document.content.content?.[0].content?.[1].attrs?.checked).toBe(true);
  });

  it('updates an expressible field and option order without flattening the other fields', () => {
    const base = authoringFixture(); const write = decodeAuthoringBundle(base)[0];
    const nextContent = structuredClone(write.content);
    nextContent.options.reverse();
    nextContent.analysis = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新解析', marks: [{ type: 'italic' }] }] }] };
    const next = synchronizeFormAuthoring(base, { ...write, content: nextContent });
    expect(next.document.content.content?.[0].content?.[0]).toEqual(base.document.content.content?.[0].content?.[0]);
    expect(next.document.content.content?.[0].content?.[1].attrs?.option_id).toBe('editor_option_00000002');
    expect(next.document.questions.question_fixture_00001.analysis).toEqual(nextContent.analysis);
    expect(decodeAuthoringBundle(next)[0].content.options.map((o) => o.id)).toEqual(['B', 'A']);
  });

  it('refuses an ambiguous form edit to a field containing an author-only control', () => {
    const base = authoringFixture();
    const stem = base.document.content.content![0].content![0];
    stem.content![0].content![0].marks = [{ type: 'link', attrs: { href: 'https://example.test', target: null, rel: 'noopener noreferrer', class: null, title: null } }];
    const write = decodeAuthoringBundle(base)[0]; const changed = structuredClone(write.content);
    changed.stem = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '覆盖' }] }] };
    expect(() => synchronizeFormAuthoring(base, { ...write, content: changed })).toThrow('stem');
    expect(stem.content![0].content![0].marks?.[0].type).toBe('link');
  });

  it('converts links to visible text for exams while retaining the original author mark', () => {
    const base = authoringFixture();
    base.document.content.content![0].content![0].content![0].content![0].marks = [
      { type: 'bold' }, { type: 'link', attrs: { href: 'https://example.test', target: null, rel: 'noopener noreferrer', class: null, title: null } },
    ];
    const result = decodeAuthoringBundle(base)[0];
    expect(JSON.stringify(result.content.stem)).not.toContain('href');
    expect(JSON.stringify(result.content.stem)).toContain('进入前应做什么');
    expect(JSON.stringify(result.bundle)).toContain('https://example.test');
  });

  it('rejects unknown nested author attrs with a precise path', () => {
    const base = authoringFixture(); Object.assign(base.document.content.content![0].content![0], { onclick: 'evil' });
    expect(() => decodeAuthoringBundle(base)).toThrow(/content.*onclick/);
  });

  it('preserves an unchanged link sibling when a precisely located text node changes', () => {
    const base = authoringFixture(); const inline = base.document.content.content![0].content![0].content![0].content!;
    inline[0].marks!.push({ type: 'link', attrs: { href: 'https://example.test', target: null, rel: 'noopener noreferrer', class: null, title: null } });
    inline.push({ type: 'text', text: '原尾句' });
    const write = decodeAuthoringBundle(base)[0]; const content = structuredClone(write.content);
    content.stem.content[0].content![1].text = '新尾句';
    const next = synchronizeFormAuthoring(base, { ...write, content });
    expect(next.document.content.content![0].content![0].content![0].content![0]).toEqual(inline[0]);
    expect(next.document.content.content![0].content![0].content![0].content![1].text).toBe('新尾句');
  });

  it('statically expands ordinary widgets while preserving their management attrs only in the author copy', () => {
    const base = authoringFixture();
    base.document.content.content![0].content![0].content![0].content!.push({ type: 'widgetField', attrs: {
      id: 'widget_1', name: '日期', type: 3, typeName: '日期', placeholder: '日期', width: 12, fontSize: 14,
      value: '2026/10/23', label: '日期', isRequired: 0, isReadonly: 0, isUnderline: 0, validate: 0, align: 1,
      dateFormat: 'YYYY/MM/DD', options: null, isMultiple: 0, dataSourceCode: null, group: null, checked: false, dynamicOptions: null, layout: 1,
    }, content: [{ type: 'text', text: '2026/10/23' }] });
    const write = decodeAuthoringBundle(base)[0];
    expect(JSON.stringify(write.content.stem)).toContain('2026/10/23');
    expect(JSON.stringify(write.content.stem)).not.toContain('widgetField');
    expect(JSON.stringify(write.content.stem)).not.toContain('checked');
    expect(JSON.stringify(write.bundle)).toContain('widgetField');
  });
});
