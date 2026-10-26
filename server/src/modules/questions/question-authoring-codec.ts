import { createHash } from 'node:crypto';
import { Errors, BizError } from '../../common/errors';
import type { AuthoringBundle, JSONContent, JSONMark, JSONValue, QuestionMeta, VersionTokens } from '../../common/question-authoring';
import type { CanonicalQuestionContent, ReadonlyRichDocV3, ReadonlyRichMarkV3, ReadonlyRichNodeV3 } from '../../common/question-content-v3';
import type { CreateQuestionDto } from './question.dto';
import type { QuestionVersion } from '../../entities/question-version.entity';
import type { Difficulty, QuestionType } from '../../common/training-contracts';
import { parseQuestionContent } from './question-content-dispatch';
import { assertAuthoringDocumentLimits, parseRichDocV3 } from './question-content-v3';
import { parseDesignerLayout } from '../exams/paper.dto';

export interface AuthoringQuestionWrite extends Pick<CreateQuestionDto, 'category_id' | 'type' | 'difficulty'> {
  client_id: string;
  bundle: AuthoringBundle;
  identity?: VersionTokens[string];
  content: CanonicalQuestionContent;
}
export interface AuthoringSavedItem {
  client_id: string;
  question_id: string;
  saved_version_id: string;
  revision: number;
  bundle: AuthoringBundle;
}
type Obj = Record<string, unknown>;
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
function fail(path: string, message: string): never { throw Errors.param(`${path}: ${message}`, { path }); }
function object(value: unknown, path: string, allowed?: readonly string[]): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, '必须是对象');
  const result = value as Obj;
  for (const key of Object.keys(result)) if (['__proto__', 'constructor', 'prototype'].includes(key) || (allowed && !allowed.includes(key))) fail(`${path}.${key}`, '不支持的字段');
  return result;
}
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) return fail(path, '必须是数组'); return value; }
function id(value: unknown, path: string): string { if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) return fail(path, '必须是十进制 ID'); return value; }
function localId(value: unknown, path: string): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return fail(path, '本地 ID 非法'); return value; }
function json(value: unknown, path: string): JSONValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map((child, index) => json(child, `${path}[${index}]`));
  return Object.fromEntries(Object.entries(object(value, path)).map(([key, child]) => [key, json(child, `${path}.${key}`)]));
}
/** Stable object order, meaningful array order. Unknown keys are rejected before hashing. */
export function canonicalAuthoringHash(value: AuthoringBundle): string {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input && typeof input === 'object'
    ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, child]) => [key, normalize(child)])) : input;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export function withoutAuthoringScores(bundle: AuthoringBundle): AuthoringBundle {
  const result = structuredClone(bundle);
  for (const meta of Object.values(result.document.questions)) { delete meta.score_cents; delete meta.concept_id; }
  return result;
}

/** Compare question content/format/layout independently of paper scores and local identities. */
export function authoringQuestionHash(bundle: AuthoringBundle): string {
  const value = withoutAuthoringScores(bundle);
  const client = Object.keys(value.document.questions)[0];
  const meta = value.document.questions[client];
  delete meta.question_id; delete meta.base_revision;
  value.document.content.content![0].attrs = { client_id: 'question' };
  value.document.questions = { question: meta };
  value.option_ids = { question: value.option_ids[client] || {} };
  value.layouts = value.layouts[client] ? { question: value.layouts[client] } : {};
  value.identities = {};
  return canonicalAuthoringHash(value);
}

const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function authorMarks(value: unknown, path: string): { author: JSONMark[]; exam: JSONMark[] } {
  const author = array(value, path).map((raw, index) => {
    const p = `${path}[${index}]`; const mark = object(raw, p, ['type', 'attrs']);
    if (typeof mark.type !== 'string') return fail(`${p}.type`, 'mark 缺少类型');
    if (mark.type === 'link') {
      const attrs = object(mark.attrs, `${p}.attrs`, ['href', 'target', 'rel', 'class', 'title']);
      if (typeof attrs.href !== 'string' || !/^https?:\/\/[^\s]+$/i.test(attrs.href)
        || attrs.target !== null || attrs.rel !== 'noopener noreferrer' || attrs.class !== null || attrs.title !== null) fail(`${p}.attrs`, '链接必须使用固定安全属性');
      try { const url = new URL(attrs.href); if (!url.hostname || url.username || url.password) fail(`${p}.attrs.href`, '链接非法'); } catch { fail(`${p}.attrs.href`, '链接非法'); }
    }
    const attrs = mark.attrs === undefined ? undefined : Object.fromEntries(Object.entries(object(mark.attrs, `${p}.attrs`)).map(([key, child]) => [key, json(child, `${p}.attrs.${key}`)]));
    return { type: mark.type, ...(attrs === undefined ? {} : { attrs }) };
  });
  if (new Set(author.map((mark) => mark.type)).size !== author.length) fail(path, '不能重复 mark');
  return { author, exam: author.filter((mark) => mark.type !== 'link') };
}

const widgetKeys = ['id', 'name', 'type', 'typeName', 'placeholder', 'width', 'fontSize', 'value', 'label', 'isRequired', 'isReadonly', 'isUnderline', 'validate', 'align', 'dateFormat', 'options', 'isMultiple', 'dataSourceCode', 'group', 'checked', 'dynamicOptions', 'layout'];
function widgetAttrs(raw: unknown, path: string): Record<string, JSONValue> {
  const attrs = object(raw, path, widgetKeys);
  if (Object.keys(attrs).length !== widgetKeys.length) fail(path, '控件属性不完整');
  localId(attrs.id, `${path}.id`);
  if (![1, 2, 3, 4, 6].includes(Number(attrs.type)) || typeof attrs.type !== 'number') fail(`${path}.type`, '只允许普通展示控件');
  for (const [key, limit] of [['name', 128], ['typeName', 64], ['placeholder', 500], ['value', 2000], ['label', 2000]] as const) {
    if (typeof attrs[key] !== 'string' || Array.from(attrs[key]).length > limit || (key === 'name' && !attrs[key])) fail(`${path}.${key}`, '控件文字非法');
  }
  if (!Number.isInteger(attrs.width) || Number(attrs.width) < 1 || Number(attrs.width) > 100 || !Number.isInteger(attrs.fontSize) || Number(attrs.fontSize) < 9 || Number(attrs.fontSize) > 36) fail(path, '控件宽度或字号非法');
  for (const key of ['isRequired', 'isReadonly', 'isUnderline', 'validate', 'isMultiple']) if (attrs[key] !== 0 && attrs[key] !== 1) fail(`${path}.${key}`, '只允许 0/1');
  const dateFormats = ['YYYY-MM-DD', 'YYYY/MM/DD', 'MM/DD/YYYY', 'DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM', 'YYYY/MM', 'MM-YYYY', 'MM/YYYY', 'YYYY-MM-DD HH:mm:ss', 'YYYY/MM/DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY/MM/DD HH:mm'];
  if (![1, 2, 3].includes(Number(attrs.align)) || !dateFormats.includes(String(attrs.dateFormat))) fail(path, '控件对齐或日期格式非法');
  if ((attrs.options !== null && (typeof attrs.options !== 'string' || attrs.options.length > 500)) || (attrs.type !== 2 && (attrs.options !== null || attrs.isMultiple !== 0))) fail(`${path}.options`, '控件选项非法');
  if ((attrs.dataSourceCode !== null && attrs.dataSourceCode !== '') || attrs.group !== null || attrs.checked !== false || attrs.layout !== 1) fail(path, '控件不能携带数据源、答案或动态布局');
  if (attrs.dynamicOptions !== null) {
    if (attrs.type !== 2 || !Array.isArray(attrs.dynamicOptions) || attrs.dynamicOptions.length > 100) fail(`${path}.dynamicOptions`, '下拉静态选项非法');
    attrs.dynamicOptions.forEach((rawOption, index) => {
      const p = `${path}.dynamicOptions[${index}]`; const option = object(rawOption, p, ['value', 'label', 'selected']);
      if ((typeof option.value !== 'string' && !(typeof option.value === 'number' && Number.isFinite(option.value))) || typeof option.label !== 'string' || !option.label || option.label.length > 100 || (own(option, 'selected') && typeof option.selected !== 'boolean')) fail(p, '下拉静态选项非法');
    });
  }
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, json(value, `${path}.${key}`)]));
}

/** Source editor-only nodes are deliberately converted, then checked by T1's exam parser. */
function authorRich(raw: unknown, path: string, widgets: boolean): { author: JSONContent; exam: ReadonlyRichDocV3 } {
  const read = (value: unknown, p: string): { author: JSONContent; exam: JSONContent } => {
    const node = object(value, p, ['type', 'attrs', 'content', 'marks', 'text']);
    if (typeof node.type !== 'string') return fail(`${p}.type`, '节点缺少类型');
    if (node.type === 'widgetField') {
      if (!widgets) fail(p, '解析不支持通用控件');
      if (own(node, 'marks') || own(node, 'text')) fail(p, '控件不能携带 marks/text');
      const attrs = widgetAttrs(node.attrs, `${p}.attrs`);
      const children = node.content === undefined ? [] : array(node.content, `${p}.content`).map((child, index) => {
        const parsed = read(child, `${p}.content[${index}]`);
        if (!['text', 'hardBreak'].includes(parsed.author.type || '')) fail(`${p}.content[${index}]`, '控件只能包含静态文字');
        return parsed;
      });
      if (!children.length) fail(p, '控件缺少可见静态文字，无法保真转换');
      // An inline wrapper cannot survive in examination content. Its validated
      // children are expanded by the parent below, retaining all visible text.
      return { author: { type: 'widgetField', attrs, ...(node.content === undefined ? {} : { content: children.map((child) => child.author) }) }, exam: { type: '__static_widget', content: children.map((child) => child.exam) } };
    }
    if (node.type === 'mediaImage') {
      if (own(node, 'text') || own(node, 'content')) fail(p, '图片不接受正文');
      const attrs = object(node.attrs, `${p}.attrs`, ['asset_id', 'alt']); const asset = id(attrs.asset_id, `${p}.attrs.asset_id`);
      if (attrs.alt !== undefined && attrs.alt !== null && (typeof attrs.alt !== 'string' || attrs.alt.length > 500)) fail(`${p}.attrs.alt`, '图片替代文字非法');
      if (node.marks !== undefined && array(node.marks, `${p}.marks`).length) fail(`${p}.marks`, '图片格式无法静态转换');
      return { author: { type: 'mediaImage', attrs: { asset_id: asset, ...(attrs.alt === undefined ? {} : { alt: attrs.alt as string | null }) }, ...(node.marks === undefined ? {} : { marks: [] }) }, exam: { type: 'image', attrs: { asset_id: asset } } };
    }
    const children = node.content === undefined ? undefined : array(node.content, `${p}.content`).map((child, index) => read(child, `${p}.content[${index}]`));
    const marks = node.marks === undefined ? undefined : authorMarks(node.marks, `${p}.marks`);
    const attrs = node.attrs === undefined ? undefined : Object.fromEntries(Object.entries(object(node.attrs, `${p}.attrs`)).map(([key, value]) => [key, json(value, `${p}.attrs.${key}`)]));
    const shared: JSONContent = { type: node.type, ...(attrs === undefined ? {} : { attrs }), ...(node.text === undefined ? {} : { text: typeof node.text === 'string' ? node.text : fail(`${p}.text`, '文本必须是字符串') }) };
    return {
      author: { ...shared, ...(children === undefined ? {} : { content: children.map((child) => child.author) }), ...(marks === undefined ? {} : { marks: marks.author }) },
      exam: { ...shared, ...(children === undefined ? {} : { content: children.flatMap((child) => child.exam.type === '__static_widget' ? child.exam.content || [] : [child.exam]) }), ...(marks === undefined || !marks.exam.length ? {} : { marks: marks.exam }) },
    };
  };
  const result = read(raw, path);
  try { return { author: result.author, exam: parseRichDocV3(result.exam) }; }
  catch (error) { if (error instanceof BizError && error.code === 40001) { const detail = object(error.data || {}, path); fail(path + String(detail.path || '$').slice(1), error.message); } throw error; }
}

function metaOf(raw: unknown, path: string, legacy: boolean): QuestionMeta {
  const meta = object(raw, path, ['type', 'category_id', 'difficulty', 'concept_id', 'regulation_id', 'regulation_version_id', 'analysis', 'score_cents', 'question_id', 'base_revision']);
  if (!legacy && own(meta, 'concept_id')) fail(`${path}.concept_id`, '考点组已取消，请移除此字段');
  if (meta.type !== 'single' && meta.type !== 'multiple' && meta.type !== 'judgment') return fail(`${path}.type`, '只支持三种客观题');
  if (meta.difficulty !== 'easy' && meta.difficulty !== 'medium' && meta.difficulty !== 'hard') return fail(`${path}.difficulty`, '难度非法');
  if (own(meta, 'score_cents') && (!Number.isInteger(meta.score_cents) || Number(meta.score_cents) < 1 || Number(meta.score_cents) > 10000)) fail(`${path}.score_cents`, '分值须为 1–10000 整数分');
  const nullable = (key: string) => meta[key] === null ? null : id(meta[key], `${path}.${key}`);
  const regulation_id = nullable('regulation_id'); const regulation_version_id = nullable('regulation_version_id');
  if (regulation_version_id && !regulation_id) fail(path, '资料版本缺少来源');
  const result: QuestionMeta = { type: meta.type, category_id: id(meta.category_id, `${path}.category_id`), difficulty: meta.difficulty,
    ...(legacy && own(meta, 'concept_id') ? { concept_id: nullable('concept_id') } : {}), regulation_id, regulation_version_id, ...(own(meta, 'score_cents') ? { score_cents: Number(meta.score_cents) } : {}), analysis: authorRich(meta.analysis, `${path}.analysis`, false).author };
  if (own(meta, 'question_id') !== own(meta, 'base_revision')) fail(path, 'question_id/base_revision 必须成对出现');
  if (own(meta, 'question_id')) {
    result.question_id = id(meta.question_id, `${path}.question_id`);
    if (meta.base_revision !== null && (!Number.isInteger(meta.base_revision) || Number(meta.base_revision) < 1)) fail(`${path}.base_revision`, '版本修订号非法');
    result.base_revision = meta.base_revision === null ? null : Number(meta.base_revision);
  }
  return result;
}

export function decodeAuthoringBundle(input: unknown, decodeOptions: { legacy?: boolean } = {}): AuthoringQuestionWrite[] {
  const bundle = object(input, '$.bundle', ['document', 'option_ids', 'identities', 'layouts']);
  const document = object(bundle.document, '$.bundle.document', ['schema_version', 'content', 'questions']);
  if (document.schema_version !== 1) fail('$.bundle.document.schema_version', '只支持作者版本 1');
  assertAuthoringDocumentLimits(document);
  const root = object(document.content, '$.bundle.document.content', ['type', 'content']);
  if (root.type !== 'doc') fail('$.bundle.document.content.type', '根必须是 doc');
  const questions = object(document.questions, '$.bundle.document.questions');
  const mappings = object(bundle.option_ids, '$.bundle.option_ids');
  const identities = object(bundle.identities, '$.bundle.identities');
  const layouts = object(bundle.layouts, '$.bundle.layouts');
  const used = new Set<string>();
  const usedIdentity = new Set<string>();
  const result = array(root.content, '$.bundle.document.content.content').map((rawBlock, index) => {
    const path = `$.bundle.document.content.content[${index}]`; const block = object(rawBlock, path, ['type', 'attrs', 'content']);
    if (block.type !== 'questionBlock') fail(`${path}.type`, '只允许 questionBlock');
    const attrs = object(block.attrs, `${path}.attrs`, ['client_id']); const client = localId(attrs.client_id, `${path}.attrs.client_id`);
    if (used.has(client)) fail(`${path}.attrs.client_id`, '题块 ID 重复'); used.add(client);
    const meta = metaOf(questions[client], `$.bundle.document.questions.${client}`, Boolean(decodeOptions.legacy));
    const parts = array(block.content, `${path}.content`);
    const stem = object(parts[0], `${path}.content[0]`, ['type', 'content']);
    if (stem.type !== 'questionStem') fail(`${path}.content[0].type`, '题块首项必须是题干');
    const stemValue = authorRich({ type: 'doc', content: stem.content }, `${path}.content[0]`, true);
    const mapping = mappings[client] === undefined ? {} : object(mappings[client], `$.bundle.option_ids.${client}`);
    const optionMap: Record<string, string> = {}; const editorIds = new Set<string>(); const checked: string[] = [];
    const options = parts.slice(1).map((rawOption, optionIndex) => {
      const p = `${path}.content[${optionIndex + 1}]`; const option = object(rawOption, p, ['type', 'attrs', 'content']);
      if (option.type !== 'questionOption') fail(`${p}.type`, '题块只允许题干及选项');
      const oa = object(option.attrs, `${p}.attrs`, ['option_id', 'checked']); const editor = localId(oa.option_id, `${p}.attrs.option_id`);
      if (editorIds.has(editor)) fail(`${p}.attrs.option_id`, '选项 ID 重复'); editorIds.add(editor);
      if (typeof oa.checked !== 'boolean') fail(`${p}.attrs.checked`, '正确标记必须是布尔值');
      const stable = mapping[editor] ?? editor; if (typeof stable !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(stable)) fail(`$.bundle.option_ids.${client}.${editor}`, '稳定选项 ID 非法');
      optionMap[editor] = stable; if (oa.checked) checked.push(stable);
      const parsed = authorRich({ type: 'doc', content: option.content }, p, true);
      return { author: { type: 'questionOption', attrs: { option_id: editor, checked: oa.checked }, content: parsed.author.content } satisfies JSONContent, id: stable, content: parsed.exam };
    });
    for (const key of Object.keys(mapping)) if (!editorIds.has(key)) fail(`$.bundle.option_ids.${client}.${key}`, '映射不属于当前选项');
    const analysis = authorRich(meta.analysis, `$.bundle.document.questions.${client}.analysis`, false);
    const content = parseQuestionContent({ schema: 3, type: meta.type, stem: stemValue.exam, options: options.map(({ id, content }) => ({ id, content })), analysis: analysis.exam.content.length ? analysis.exam : null, answer_option_ids: checked });
    if (content.schema !== 3) throw Errors.internal('作者内容版本不一致');
    if (meta.type === 'judgment' && (richCompatibilityHtml(content.options[0].content) !== '<p>正确</p>' || richCompatibilityHtml(content.options[1].content) !== '<p>错误</p>')) fail(`${path}.content`, '判断题必须使用正确/错误固定选项');
    let identity: VersionTokens[string] | undefined;
    if (identities[client] !== undefined) {
      const token = object(identities[client], `$.bundle.identities.${client}`, ['question_id', 'expected_version_id', 'expected_enabled']);
      if (!decodeOptions.legacy && typeof token.expected_enabled !== 'boolean') fail(`$.bundle.identities.${client}.expected_enabled`, '必须显式提供布尔值');
      identity = { question_id: id(token.question_id, `$.bundle.identities.${client}.question_id`), expected_version_id: token.expected_version_id === null ? null : id(token.expected_version_id, `$.bundle.identities.${client}.expected_version_id`), expected_enabled: typeof token.expected_enabled === 'boolean' ? token.expected_enabled : true };
      if (usedIdentity.has(identity.question_id)) fail(`$.bundle.identities.${client}`, '同一身份不能在批次内重复修订'); usedIdentity.add(identity.question_id);
      if (meta.question_id !== undefined && meta.question_id !== identity.question_id) fail(`$.bundle.document.questions.${client}.question_id`, '身份与版本令牌不一致');
    } else if (meta.question_id !== undefined) fail(`$.bundle.document.questions.${client}.question_id`, '修订必须携带精确身份');
    const single: AuthoringBundle = {
      document: { schema_version: 1, content: { type: 'doc', content: [{ type: 'questionBlock', attrs: { client_id: client }, content: [{ type: 'questionStem', content: stemValue.author.content }, ...options.map((option) => option.author)] }] }, questions: { [client]: meta } },
      option_ids: { [client]: optionMap }, identities: identity ? { [client]: identity } : {}, layouts: layouts[client] === undefined ? {} : { [client]: parseDesignerLayout(layouts[client]) },
    };
    return { client_id: client, bundle: single, ...(identity ? { identity } : {}), content, category_id: meta.category_id, difficulty: meta.difficulty, type: meta.type };
  });
  if (!result.length || result.length > 100) fail('$.bundle.document.content.content', '题目须为 1–100 题');
  for (const [field, values] of [['questions', questions], ['option_ids', mappings], ['identities', identities], ['layouts', layouts]] as const) for (const key of Object.keys(values)) if (!used.has(key)) fail(`$.bundle.${field}.${key}`, '字段不属于当前题块');
  return result;
}

function examAuthor(node: unknown): JSONContent {
  const value = object(node, '$');
  const result: JSONContent = { type: String(value.type) };
  if (value.type === 'image') { const attrs = object(value.attrs, '$.attrs'); result.type = 'mediaImage'; result.attrs = { asset_id: String(attrs.asset_id), alt: null }; return result; }
  if (value.attrs !== undefined) result.attrs = Object.fromEntries(Object.entries(object(value.attrs, '$.attrs')).map(([key, child]) => [key, json(child, `$.attrs.${key}`)]));
  if (typeof value.text === 'string') result.text = value.text;
  if (value.marks !== undefined) result.marks = authorMarks(value.marks, '$.marks').author;
  if (value.content !== undefined) result.content = array(value.content, '$.content').map(examAuthor);
  return result;
}

/** Only the author copy adopts schema 3 structure; the legacy exam facts stay untouched. */
function schema2AuthorDoc(doc: unknown): JSONContent {
  const author = examAuthor(doc);
  const normalize = (node: JSONContent): JSONContent => {
    if (node.content) {
      node.content = node.content.filter((child) => child.type !== 'text' || child.text !== '').map(normalize);
      if (node.type === 'doc') node.content = node.content.map((child) => child.type === 'mediaImage'
        ? { type: 'paragraph', content: [child] } : child);
    }
    return node;
  };
  return normalize(author);
}

/** Build only facts known from an old version; no historical formatting is invented. */
export function synchronizeFormAuthoring(base: AuthoringBundle | null, input: AuthoringQuestionWrite): AuthoringBundle {
  const content = parseQuestionContent({ ...input.content, type: input.type });
  const preserveAuthoredRichStructure = content.schema === 3;
  const client = input.client_id;
  const empty: AuthoringBundle = { document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: {} }, option_ids: {}, identities: {}, layouts: {} };
  const result = structuredClone(base || empty);
  const previous = base ? decodeAuthoringBundle(base, { legacy: true })[0] : null;
  if (previous && (Object.keys(base!.document.questions).length !== 1 || previous.client_id !== client)) fail('$.bundle', '必须是同一题目的单题原稿');
  const oldBlock = result.document.content.content?.[0];
  const oldOptions = oldBlock?.content?.slice(1) || [];
  const oldMapping = result.option_ids[client] || {};
  const reverse = new Map(Object.entries(oldMapping).map(([editor, stable]) => [stable, editor]));
  const protectedNode = (node: JSONContent): boolean => node.type === 'widgetField' || Boolean(node.marks?.some((mark) => mark.type === 'link')) || Boolean(node.content?.some(protectedNode));
  const merge = (author: JSONContent, oldExam: unknown, newExam: unknown, path: string): JSONContent => {
    if (equal(oldExam, newExam)) return structuredClone(author);
    const oldValue = object(oldExam, path); const nextValue = object(newExam, path);
    const oldChildren = Array.isArray(oldValue.content) ? oldValue.content : [];
    const nextChildren = Array.isArray(nextValue.content) ? nextValue.content : [];
    if (oldValue.type !== nextValue.type || !equal(oldValue.attrs, nextValue.attrs) || !equal(oldValue.marks, nextValue.marks) || oldChildren.length !== nextChildren.length) {
      if (protectedNode(author)) fail(path, '包含作者专有节点，当前表单无法定位安全变更');
      // A plain field is fully expressible. Rich structures require an explicit
      // structure-preserving edit rather than a display-value reconstruction.
      const plain = (node: JSONContent): boolean => {
        if (!['doc', 'paragraph', 'text', 'hardBreak', 'mediaImage'].includes(node.type || '') || node.marks?.length) return false;
        if (node.type === 'mediaImage') return Boolean(node.attrs && Object.keys(node.attrs).every((key) => ['asset_id', 'alt'].includes(key))
          && typeof node.attrs.asset_id === 'string' && /^[1-9]\d*$/.test(node.attrs.asset_id)
          && (node.attrs.alt == null || typeof node.attrs.alt === 'string' && node.attrs.alt.length <= 500) && !node.content?.length);
        return !node.attrs && (node.content || []).every(plain);
      };
      if (!plain(author)) fail(path, '当前表单无法保留此字段的格式或节点结构');
      const converted = examAuthor(newExam);
      const media = new Map<string, JSONContent[]>();
      const collect = (node: JSONContent) => {
        if (node.type === 'mediaImage') { const key = String(node.attrs?.asset_id); media.set(key, [...(media.get(key) || []), node]); }
        node.content?.forEach(collect);
      };
      collect(author);
      const restore = (node: JSONContent) => {
        if (node.type === 'mediaImage') {
          const matches = media.get(String(node.attrs?.asset_id));
          if (matches?.length) {
            if (matches.some((item) => !equal(item.attrs, matches[0].attrs))) fail(path, '重复图片的作者属性不同，无法定位安全变更');
            node.attrs = structuredClone(matches[0].attrs);
          }
        }
        node.content?.forEach(restore);
      };
      restore(converted);
      return converted;
    }
    const converted = examAuthor(newExam);
    if (author.marks) converted.marks = structuredClone(author.marks);
    if (author.type === 'mediaImage') return { ...author, attrs: { ...author.attrs, ...converted.attrs } };
    if (author.content) {
      if (oldChildren.length !== author.content.length) fail(path, '展开控件后无法定位安全变更');
      converted.content = author.content.map((child, index) => merge(child, oldChildren[index], nextChildren[index], `${path}.content[${index}]`));
    }
    return converted;
  };
  const field = (name: string, next: unknown, old: unknown, author: JSONContent | undefined): JSONContent => (
    !preserveAuthoredRichStructure ? schema2AuthorDoc(next) : author && old ? merge(author, old, next, `$.${name}`) : examAuthor(next)
  );
  const stem = field('stem', content.stem, previous?.content.stem, oldBlock?.content?.[0] ? { type: 'doc', content: oldBlock.content[0].content } : undefined);
  const optionMap: Record<string, string> = {};
  const options = content.options.map((option) => {
    const editor = reverse.get(option.id) || option.id; optionMap[editor] = option.id;
    const oldOption = previous?.content.options.find((item) => item.id === option.id);
    const author = oldOptions.find((node) => node.attrs?.option_id === editor);
    const rich = field(`options.${option.id}`, option.content, oldOption?.content, author ? { type: 'doc', content: author.content } : undefined);
    return { type: 'questionOption', attrs: { option_id: editor, checked: content.answer_option_ids.includes(option.id) }, content: rich.content };
  });
  const oldMeta = result.document.questions[client];
  const analysis = content.analysis ? field('analysis', content.analysis, previous?.content.analysis, oldMeta?.analysis) : { type: 'doc', content: [] };
  if (!content.analysis && oldMeta && protectedNode(oldMeta.analysis)) fail('$.analysis', '当前表单无法安全删除作者专有节点');
  const incomingMeta = input.bundle.document.questions[client];
  result.document = { schema_version: 1, content: { type: 'doc', content: [{ type: 'questionBlock', attrs: { client_id: client }, content: [{ type: 'questionStem', content: stem.content }, ...options] }] }, questions: {
    [client]: { type: input.type, category_id: input.category_id, difficulty: input.difficulty,
      regulation_id: incomingMeta?.regulation_id ?? oldMeta?.regulation_id ?? null, regulation_version_id: incomingMeta?.regulation_version_id ?? oldMeta?.regulation_version_id ?? null,
      analysis,
      ...(input.identity ? { question_id: input.identity.question_id, base_revision: oldMeta?.base_revision ?? null } : {}) },
  } };
  result.option_ids = { [client]: optionMap }; result.identities = input.identity ? { [client]: input.identity } : {};
  assertAuthoringDocumentLimits(result.document);
  return result;
}

/** Assemble exact question facts without importing a historical suggested score. */
export function assembleVersionAuthoring(version: QuestionVersion, client: string, expectedEnabled = true): AuthoringBundle {
  let base = version.authoringJson ? structuredClone(version.authoringJson) : null;
  const oldClient = Object.keys(base?.document.questions || {})[0];
  if (base && oldClient !== client) {
    const block = base.document.content.content?.[0]; if (block) block.attrs = { client_id: client };
    base = { document: { ...base.document, questions: { [client]: base.document.questions[oldClient] } },
      option_ids: { [client]: base.option_ids[oldClient] || {} }, identities: base.identities[oldClient] ? { [client]: base.identities[oldClient] } : {},
      layouts: base.layouts[oldClient] ? { [client]: base.layouts[oldClient] } : {} };
  }
  const identity = { question_id: String(version.questionId), expected_version_id: String(version.id), expected_enabled: expectedEnabled };
  const placeholder: AuthoringBundle = { document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: { [client]: {
    type: version.type as QuestionType, category_id: String(version.categoryId), difficulty: version.difficulty as Difficulty,
    regulation_id: version.regulationId, regulation_version_id: version.regulationVersionId, analysis: { type: 'doc', content: [] },
  } } }, option_ids: {}, identities: {}, layouts: {} };
  const bundle = withoutAuthoringScores(synchronizeFormAuthoring(base, { client_id: client, bundle: base || placeholder, identity,
    content: parseQuestionContent(version), category_id: String(version.categoryId), type: version.type as QuestionType,
    difficulty: version.difficulty as Difficulty }));
  bundle.document.questions[client].question_id = String(version.questionId);
  bundle.document.questions[client].base_revision = Number(version.revision);
  return bundle;
}

export function joinAuthoringBundles(bundles: AuthoringBundle[]): AuthoringBundle {
  return { document: { schema_version: 1, content: { type: 'doc', content: bundles.flatMap((bundle) => bundle.document.content.content || []) }, questions: Object.assign({}, ...bundles.map((bundle) => bundle.document.questions)) },
    option_ids: Object.assign({}, ...bundles.map((bundle) => bundle.option_ids)), identities: Object.assign({}, ...bundles.map((bundle) => bundle.identities)), layouts: Object.assign({}, ...bundles.map((bundle) => bundle.layouts)) };
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Compatibility HTML is derived from validated content; it never becomes the authoring source. */
export function richCompatibilityHtml(doc: ReadonlyRichDocV3): string {
  const mark = (value: string, format: ReadonlyRichMarkV3): string => {
    const tags = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code', superscript: 'sup', subscript: 'sub' };
    if (format.type === 'highlight') return `<mark style="background-color:${escapeHtml(format.attrs.color)}">${value}</mark>`;
    if (format.type === 'textStyle') {
      const { fontFamily, fontSize, color } = format.attrs;
      const style = [fontFamily && `font-family:${fontFamily}`, fontSize && `font-size:${fontSize}`, color && `color:${color}`].filter(Boolean).join(';');
      return `<span style="${escapeHtml(style)}">${value}</span>`;
    }
    const tag = tags[format.type];
    return `<${tag}>${value}</${tag}>`;
  };
  const render = (node: ReadonlyRichNodeV3): string => {
    if (node.type === 'text') return (node.marks || []).reduce(mark, escapeHtml(node.text));
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'image') return `<img data-media-id="${node.attrs.asset_id}">`;
    if (node.type === 'horizontalRule') return '<hr>';
    const inner = (node.content || []).map(render).join('');
    if (node.type === 'doc') return inner;
    const tag = node.type === 'heading' ? `h${node.attrs.level}` : {
      paragraph: 'p', blockquote: 'blockquote', bulletList: 'ul', orderedList: 'ol', listItem: 'li',
      codeBlock: 'pre', table: 'table', tableRow: 'tr', tableCell: 'td', tableHeader: 'th',
    }[node.type];
    let attrs = '';
    if (node.type === 'tableCell' || node.type === 'tableHeader') attrs = ` colspan="${node.attrs.colspan}" rowspan="${node.attrs.rowspan}"`;
    return `<${tag}${attrs}>${inner}</${tag}>`;
  };
  return render(doc);
}
