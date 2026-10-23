import { describe, expect, it } from 'vitest';
import richContent from '../../tests/fixtures/question-authoring-v3/rich-content.json';
import studentContent from '../../tests/fixtures/question-authoring-v3/student-content.json';
import legacyShortIds from '../../tests/fixtures/question-authoring-v3/legacy-short-ids.json';
import richAuthoring from '../../tests/fixtures/question-authoring-v3/rich-authoring.json';
import unsafeContent from '../../tests/fixtures/question-authoring-v3/unsafe-content.json';
import { readonlyDoc } from '../src/modules/questions/question-content';

// Keep the first RED a collected behavior test even before the new module exists.
const richModulePath = '../src/modules/questions/question-content-v3';
const dispatchModulePath = '../src/modules/questions/question-content-dispatch';
const richCodec = () => import(richModulePath);
const dispatcher = () => import(dispatchModulePath);
const clone = <T>(value: T): T => structuredClone(value);
const paragraph = (text = '内容'): any => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: any[]): any => ({ type: 'doc', content });
const cell = (colspan = 1, rowspan = 1, colwidth: number[] | null = null): any => ({
  type: 'tableCell', attrs: { colspan, rowspan, colwidth, align: null }, content: [paragraph()],
});
const row = (...content: any[]): any => ({ type: 'tableRow', content });
const table = (...content: any[]): any => ({ type: 'table', content });

describe('schema 3 controlled rich content', () => {
  it('preserves merged cells, nested lists, images and every supported format', async () => {
    const { parseRichDocV3 } = await richCodec();
    expect(parseRichDocV3(richContent.stem)).toEqual(studentContent.stem);
  });

  it('rebuilds nodes so mutating the parsed result cannot change its input', async () => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc(paragraph());
    const result = parseRichDocV3(input);
    result.content[0].content[0].text = 'changed';
    expect(input.content[0].content[0].text).toBe('内容');
  });

  it('normalizes only validated hex and rgb colors', async () => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc({ type: 'paragraph', content: [{ type: 'text', text: '格式', marks: [
      { type: 'textStyle', attrs: { fontFamily: 'Microsoft YaHei', fontSize: '36pt', color: ' #AbC ' } },
      { type: 'highlight', attrs: { color: 'RGB(001,2, 255)' } },
    ] }] });
    expect(parseRichDocV3(input).content[0].content[0].marks).toEqual([
      { type: 'textStyle', attrs: { fontFamily: 'Microsoft YaHei', fontSize: '36pt', color: '#aabbcc' } },
      { type: 'highlight', attrs: { color: 'rgb(1, 2, 255)' } },
    ]);
  });

  it.each(['SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi'])('allows source font %s', async (fontFamily) => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc({ type: 'paragraph', content: [{ type: 'text', text: '字', marks: [{ type: 'textStyle', attrs: { fontFamily, fontSize: '9pt' } }] }] });
    expect(parseRichDocV3(input)).toEqual(input);
  });

  it.each(['1', '1.2', '1.5', '1.75', '2', '2.5', '3'])('allows source line height %s', async (lineHeight) => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc({ ...paragraph(), attrs: { indent: 10, lineHeight } });
    expect(parseRichDocV3(input)).toEqual(input);
  });

  it.each([
    ['fontFamily', 'Arial'], ['fontSize', '8pt'], ['fontSize', '37pt'], ['fontSize', '12px'], ['fontSize', '12.5pt'],
    ['color', 'red'], ['color', 'rgb(256,0,0)'], ['color', '#abcd'], ['color', 'url(https://example.invalid)'], ['style', 'color:red'],
  ])('rejects textStyle %s=%s', async (key, value) => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc({ type: 'paragraph', content: [{ type: 'text', text: '字', marks: [{ type: 'textStyle', attrs: { [key]: value } }] }] });
    expect(() => parseRichDocV3(input)).toThrow();
  });

  it.each([
    { type: 'heading', attrs: { level: 5 }, content: [] },
    { ...paragraph(), attrs: { indent: 11 } },
    { ...paragraph(), attrs: { indent: -1 } },
    { ...paragraph(), attrs: { lineHeight: '1.3' } },
    { ...paragraph(), attrs: { textAlign: 'unsafe' } },
    { type: 'orderedList', attrs: { start: 0 }, content: [] },
    { type: 'codeBlock', attrs: { language: 'javascript' }, content: [] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 1 }, content: [] }] }] },
  ])('rejects invalid structure or bounded block attrs %#', async (node) => {
    const { parseRichDocV3 } = await richCodec();
    expect(() => parseRichDocV3(doc(node))).toThrow();
  });

  it.each(['answer', 'analysis', 'checked', 'correct', 'src', 'onerror', 'data-owner'])('rejects a nested %s attr at its exact path', async (key) => {
    const { parseRichDocV3 } = await richCodec();
    const input = clone(richContent.stem) as any;
    input.content[6].content[1].content[1].content[0].content[0].attrs[key] = true;
    expect(() => parseRichDocV3(input)).toThrow(`$.content[6].content[1].content[1].content[0].content[0].attrs.${key}`);
  });

  it.each(['answer', 'analysis', 'checked', 'correct', 'src', 'onclick'])('rejects a nested %s node field', async (key) => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc({ type: 'paragraph', content: [{ type: 'text', text: '字', [key]: true }] });
    expect(() => parseRichDocV3(input)).toThrow();
  });

  it.each([
    { type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'https://example.invalid' } }] },
    { type: 'text', text: '未知', marks: [{ type: 'unknown' }] },
    { type: 'text', text: '重复', marks: [{ type: 'bold' }, { type: 'bold' }] },
    { type: 'text', text: '属性', marks: [{ type: 'bold', attrs: { checked: true } }] },
    { type: 'image', attrs: { asset_id: '42', src: 'https://example.invalid' } },
    { type: 'image', attrs: { asset_id: '0' } },
    { type: 'image', attrs: { asset_id: 42 } },
    { type: 'mediaImage', attrs: { asset_id: '42', alt: '作者图片' } },
    { type: 'widgetField', attrs: { checked: true } },
  ])('rejects unsafe or author-only inline content %#', async (node) => {
    const { parseRichDocV3 } = await richCodec();
    expect(() => parseRichDocV3(doc({ type: 'paragraph', content: [node] }))).toThrow();
  });

  it('rejects unsafe shared fixture and locates unknown node types', async () => {
    const { parseRichDocV3 } = await richCodec();
    expect(() => parseRichDocV3(unsafeContent)).toThrow('$.content[0].content[0].attrs');
    expect(() => parseRichDocV3(doc({ type: 'iframe', attrs: {} }))).toThrow('$.content[0].type');
  });

  it('keeps the existing schema 2 marks prohibition', () => {
    expect(() => readonlyDoc(richContent.options[0].content)).toThrow();
  });

  it('accepts 2,000 nodes and rejects the next node', async () => {
    const { parseRichDocV3 } = await richCodec();
    expect(parseRichDocV3(doc(...Array.from({ length: 1999 }, () => ({ type: 'paragraph', content: [] })))).content).toHaveLength(1999);
    expect(() => parseRichDocV3(doc(...Array.from({ length: 2000 }, () => ({ type: 'paragraph', content: [] }))))).toThrow('节点');
  });

  it('accepts 100,000 text characters and rejects the next character', async () => {
    const { parseRichDocV3 } = await richCodec();
    expect(parseRichDocV3(doc(paragraph('字'.repeat(100000)))).content[0].content[0].text).toHaveLength(100000);
    expect(() => parseRichDocV3(doc(paragraph('字'.repeat(100001))))).toThrow('文本');
  });

  it('accepts depth 16 and rejects depth 17', async () => {
    const { parseRichDocV3 } = await richCodec();
    const nested = (count: number) => {
      let block: any = paragraph();
      for (let i = 0; i < count; i++) block = { type: 'blockquote', content: [block] };
      return doc(block);
    };
    expect(parseRichDocV3(nested(13)).type).toBe('doc');
    expect(() => parseRichDocV3(nested(14))).toThrow('深度');
  });

  it('rejects cycles as a content error rather than overflowing recursion', async () => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc(); input.content.push(input);
    expect(() => parseRichDocV3(input)).toThrow();
  });
});

describe('schema 3 table grid validation', () => {
  it.each([
    table(row(cell(1, 2))),
    table(row(cell(), cell()), row(cell())),
    table(row(cell(), cell(1, 2)), row(cell(2))),
    table(row(cell(1, 1, [80])), row(cell(1, 1, [81]))),
    table(row(cell(2, 1, [80]))),
    table(row({ ...cell(), attrs: { ...cell().attrs, colspan: 101 } })),
    table(row({ ...cell(), attrs: { ...cell().attrs, colwidth: [-1] } })),
    table(row({ ...cell(), attrs: { ...cell().attrs, colwidth: [10001] } })),
    table(row({ ...cell(), attrs: { ...cell().attrs, align: 'justify' } })),
  ])('rejects out-of-bounds, ragged, overlapping or conflicting grids %#', async (input) => {
    const { parseRichDocV3 } = await richCodec();
    expect(() => parseRichDocV3(doc(input))).toThrow();
  });

  it('accepts a fully covered rowspan row with no originating cells', async () => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc(table(row(cell(1, 2, [0])), row()));
    expect(parseRichDocV3(input)).toEqual(input);
  });

  it('accepts a 10,000-slot expanded grid and rejects 10,100 slots', async () => {
    const { parseRichDocV3 } = await richCodec();
    const input = doc(table(row(cell(100, 100)), ...Array.from({ length: 99 }, () => row())));
    expect(parseRichDocV3(input)).toEqual(input);
    const oversized = doc(table(row(cell(100, 100), cell(1, 100)), ...Array.from({ length: 99 }, () => row())));
    expect(() => parseRichDocV3(oversized)).toThrow('10000');
  });
});

describe('content version dispatch and student projection', () => {
  it('adapts legacy schema 1 through the existing codec while preserving A/B', async () => {
    const { parseQuestionContent } = await dispatcher();
    const content = parseQuestionContent(legacyShortIds);
    expect(content.schema).toBe(2);
    expect(content.options.map((option: any) => option.id)).toEqual(['A', 'B']);
    expect(content.answer_option_ids).toEqual(['A']);
    expect(content.stem).toEqual(doc(paragraph('进入前应做什么？')));
  });

  it('supports schema 2 canonical input without allowing rich marks', async () => {
    const { parseQuestionContent } = await dispatcher();
    const input: any = { schema: 2, stem: doc(paragraph()), options: [{ id: 'A', content: doc(paragraph('是')) }, { id: 'B', content: doc(paragraph('否')) }], analysis: null, answer_option_ids: ['A'] };
    expect(parseQuestionContent(input)).toEqual(input);
    input.options[0].content.content[0].content[0].marks = [{ type: 'bold' }];
    expect(() => parseQuestionContent(input)).toThrow();
  });

  it('supports schema 3 canonical and snake/camel entity inputs without leaking envelope metadata', async () => {
    const { parseQuestionContent } = await dispatcher();
    const { schema, ...content } = richContent;
    expect(parseQuestionContent(richContent)).toEqual(richContent);
    expect(parseQuestionContent({ type: 'single', content_schema_version: 3, content_json: content, approved_by: '1' })).toEqual(richContent);
    expect(parseQuestionContent({ type: 'single', contentSchemaVersion: 3, contentJson: content })).toEqual(richContent);
  });

  it('projects only stem and options with detached structures', async () => {
    const { parseQuestionContent, projectStudentContent } = await dispatcher();
    const canonical = parseQuestionContent(richContent);
    const projected = projectStudentContent(canonical);
    expect(projected).toEqual(studentContent);
    expect(Object.keys(projected).sort()).toEqual(['options', 'stem']);
    projected.options[0].id = 'changed';
    expect(canonical.options[0].id).toBe('A');
  });

  it('preserves stable ids and answers when option order changes', async () => {
    const { parseQuestionContent, projectStudentContent } = await dispatcher();
    const input = clone(richContent); input.options.reverse();
    const result = parseQuestionContent(input);
    expect(result.options.map((option: any) => option.id)).toEqual(['B', 'A']);
    expect(result.answer_option_ids).toEqual(['A']);
    expect(projectStudentContent(result).options.map((option: any) => option.id)).toEqual(['B', 'A']);
  });

  it('collects deduplicated asset ids from stem, options and analysis', async () => {
    const { parseQuestionContent, collectContentAssetIds } = await dispatcher();
    expect(collectContentAssetIds(parseQuestionContent(richContent))).toEqual(['42', '43', '44']);
  });

  it.each(['answer', 'checked', 'correct', 'authoring_json', 'src'])('rejects unknown canonical field %s', async (field) => {
    const { parseQuestionContent } = await dispatcher();
    expect(() => parseQuestionContent({ ...richContent, [field]: true })).toThrow();
  });

  it.each([
    (input: any) => { input.options[1].id = 'A'; },
    (input: any) => { input.options[0].id = ''; },
    (input: any) => { input.options[0].id = 'has space'; },
    (input: any) => { input.options[0].checked = true; },
    (input: any) => { input.answer_option_ids = ['unknown']; },
    (input: any) => { input.answer_option_ids = ['A', 'A']; },
    (input: any) => { input.answer_option_ids = []; },
    (input: any) => { input.options = input.options.slice(0, 1); },
    (input: any) => { input.stem = doc(paragraph('  ')); },
  ])('rejects malformed option identity or answer membership %#', async (mutate) => {
    const { parseQuestionContent } = await dispatcher();
    const input = clone(richContent); mutate(input);
    expect(() => parseQuestionContent(input)).toThrow();
  });

  it.each([
    ['single', ['A', 'B']], ['multiple', ['A']], ['judgment', ['A', 'B']], ['image', ['A']],
  ])('validates %s answer counts when type is present', async (type, answer) => {
    const { parseQuestionContent } = await dispatcher();
    const { schema, ...content } = richContent;
    expect(() => parseQuestionContent({ type, content_schema_version: 3, content_json: { ...content, answer_option_ids: answer } })).toThrow();
  });

  it('validates type even with a canonical schema discriminator', async () => {
    const { parseQuestionContent } = await dispatcher();
    expect(() => parseQuestionContent({ ...richContent, type: 'multiple' })).toThrow();
  });

  it('revalidates untrusted canonical values at projection and asset collection boundaries', async () => {
    const { projectStudentContent, collectContentAssetIds } = await dispatcher();
    const input = clone(richContent) as any;
    input.stem.content[1].content[4].attrs.src = 'https://example.invalid';
    expect(() => projectStudentContent(input)).toThrow();
    expect(() => collectContentAssetIds(input)).toThrow();
  });

  it('rejects unknown schema versions', async () => {
    const { parseQuestionContent } = await dispatcher();
    expect(() => parseQuestionContent({ ...richContent, schema: 4 })).toThrow();
  });
});

describe('authoring document budget guard', () => {
  it('allows the shared authoring fixture without treating management nodes as exam content', async () => {
    const { assertAuthoringDocumentLimits } = await richCodec();
    expect(() => assertAuthoringDocumentLimits(richAuthoring)).not.toThrow();
  });

  it('accepts 100 authoring questions and rejects 101', async () => {
    const { assertAuthoringDocumentLimits } = await richCodec();
    const input: any = clone(richAuthoring);
    input.content.content = Array.from({ length: 100 }, () => clone(richAuthoring.content.content[0]));
    expect(() => assertAuthoringDocumentLimits(input)).not.toThrow();
    input.content.content.push(clone(richAuthoring.content.content[0]));
    expect(() => assertAuthoringDocumentLimits(input)).toThrow('100');
  });

  it('accepts 20,000 authoring nodes and rejects the next node', async () => {
    const { assertAuthoringDocumentLimits } = await richCodec();
    const input = { schema_version: 1, content: doc({ type: 'questionBlock', content: Array.from({ length: 19998 }, () => ({ type: 'paragraph' })) }), questions: {} };
    expect(() => assertAuthoringDocumentLimits(input)).not.toThrow();
    input.content.content[0].content.push({ type: 'paragraph' });
    expect(() => assertAuthoringDocumentLimits(input)).toThrow('20000');
  });

  it('counts nodes in analysis metadata as well as the body', async () => {
    const { assertAuthoringDocumentLimits } = await richCodec();
    const input = { content: doc(), questions: { first: { analysis: doc(...Array.from({ length: 19999 }, () => ({ type: 'paragraph' }))) } } };
    expect(() => assertAuthoringDocumentLimits(input)).toThrow('20000');
  });

  it('accepts authoring node depth 32 and rejects depth 33', async () => {
    const { assertAuthoringDocumentLimits } = await richCodec();
    const nested = (depth: number) => {
      let node: any = { type: 'paragraph' };
      for (let i = 1; i < depth; i++) node = { type: 'blockquote', content: [node] };
      return { content: node, questions: {} };
    };
    expect(() => assertAuthoringDocumentLimits(nested(32))).not.toThrow();
    expect(() => assertAuthoringDocumentLimits(nested(33))).toThrow('32');
  });

  it('accepts a serialized 2 MiB document and rejects one extra byte', async () => {
    const { assertAuthoringDocumentLimits } = await richCodec();
    const input = { content: doc(paragraph('')), questions: {} };
    const overhead = Buffer.byteLength(JSON.stringify(input));
    input.content.content[0].content[0].text = 'x'.repeat(2 * 1024 * 1024 - overhead);
    expect(() => assertAuthoringDocumentLimits(input)).not.toThrow();
    input.content.content[0].content[0].text += 'x';
    expect(() => assertAuthoringDocumentLimits(input)).toThrow('2 MiB');
  });
});
