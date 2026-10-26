import { generateJSON, getSchema, type JSONContent } from '@tiptap/core';
import type { QuestionContentV3, ReadonlyRichDocV3 } from '../api/question-document-types';
import { newQuestionOptionId, normalizeQuestionContentV2, type QuestionDraftPayload } from '../api/training-types';
import { questionRichDocToFormHtml, toQuestionFormValue } from '../utils/question-form-content';
import { createExtensions } from './Tiptap/utils/createExtensions';

export const MANUAL_QUESTION_ID = 'manual_question';
export const emptyRichDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const schema = getSchema(createExtensions('rich'));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const unsupported = (): never => { throw new Error('无法安全保留当前题目内容，请检查不支持的格式后重试'); };

export function toManualRichDoc(value: JSONContent): JSONContent {
  const result = clone(value);
  const visit = (node: JSONContent) => {
    if (node.type === 'image') node.type = 'mediaImage';
    node.content?.forEach(visit);
  };
  visit(result);
  if (result.type === 'doc' && !result.content?.length) result.content = [{ type: 'paragraph' }];
  return result;
}

/** Keep untouched canonical subtrees, including explicit empty paragraphs and text boundaries. */
export function fromManualRichDoc(value: JSONContent, previous?: ReadonlyRichDocV3 | null): ReadonlyRichDocV3 {
  const normalized = (node: JSONContent) => schema.nodeFromJSON(node).toJSON();
  const visit = (node: JSONContent, old?: JSONContent): JSONContent => {
    if (old && same(normalized(node), normalized(toManualRichDoc(old)))) return clone(old);
    const result = clone(node);
    if (result.type === 'mediaImage') {
      return { type: 'image', attrs: { asset_id: result.attrs?.asset_id } };
    }
    if (result.attrs) {
      const defaults: Record<string, unknown> = { textAlign: null, indent: 0, lineHeight: 0 };
      if (['paragraph', 'heading', 'listItem'].includes(result.type || '')) {
        for (const [key, defaultValue] of Object.entries(defaults)) if (result.attrs[key] === defaultValue || result.attrs[key] === null) delete result.attrs[key];
      }
      if (!Object.keys(result.attrs).length) delete result.attrs;
    }
    if (result.content) result.content = result.content.map((child, index) => visit(child, old?.content?.[index]));
    return result;
  };
  const result = visit(value, previous || undefined) as ReadonlyRichDocV3;
  questionRichDocToFormHtml(result);
  return result;
}

function parseLegacy(html: string | null): ReadonlyRichDocV3 {
  const source = String(html || '');
  const template = document.createElement('template'); template.innerHTML = source;
  // Legacy input is parsed once. Never silently discard foreign nodes, links or external images.
  const allowed = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'STRIKE', 'CODE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'SPAN', 'SUP', 'SUB', 'MARK', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG']);
  for (const element of template.content.querySelectorAll('*')) {
    if (!allowed.has(element.tagName) || element.tagName === 'IMG' && (!/^[1-9]\d*$/.test(element.getAttribute('data-media-id') || '') || element.hasAttribute('src'))) unsupported();
    if ([...element.attributes].some((attr) => /^on/i.test(attr.name) || ['href', 'src', 'srcset'].includes(attr.name))) unsupported();
  }
  return fromManualRichDoc(generateJSON(source, createExtensions('rich')));
}

export function manualContentFromDraft(value: QuestionDraftPayload): QuestionContentV3 {
  let content: QuestionContentV3;
  if (value.content_schema_version === 3) {
    if (!value.content_json || Object.keys(value.content_json).some((key) => !['stem', 'options', 'analysis', 'answer_option_ids'].includes(key))) unsupported();
    content = clone(value.content_json) as QuestionContentV3;
  } else if (value.content_schema_version === 2) {
    content = normalizeQuestionContentV2(value.content_json) as QuestionContentV3;
  } else {
    let options = value.options.map((option) => ({ id: option.key, content: parseLegacy(option.text) }));
    if (value.type === 'judgment' && options.length === 0) options = judgmentOptions();
    if (options.length === 0) options = ['', '', '', ''].map((text, index) => ({ id: newQuestionOptionId([{ key: String(index), text }]), content: fromManualRichDoc(emptyRichDoc()) }));
    if (value.answer.some((index) => !Number.isInteger(index) || !options[index])) unsupported();
    content = { stem: parseLegacy(value.stem), options, analysis: value.analysis ? parseLegacy(value.analysis) : null,
      answer_option_ids: value.answer.map((index) => options[index]!.id) };
  }
  if (!Array.isArray(content.options) || content.options.length < 2 || content.options.length > 26
    || content.options.some((option) => Object.keys(option).some((key) => !['id', 'content'].includes(key)))) unsupported();
  toQuestionFormValue({ schema: 3, ...content });
  // Reject formats absent from the real editor schema before opening an editable copy.
  [content.stem, ...content.options.map((option) => option.content), ...(content.analysis ? [content.analysis] : [])]
    .forEach((doc) => schema.nodeFromJSON(toManualRichDoc(doc)).check());
  return content;
}

export function manualQuestionDocument(content: QuestionContentV3): JSONContent {
  return { type: 'doc', content: [{ type: 'questionBlock', attrs: { client_id: MANUAL_QUESTION_ID }, content: [
    { type: 'questionStem', content: toManualRichDoc(content.stem).content },
    ...content.options.map((option) => ({ type: 'questionOption', attrs: { option_id: option.id, checked: content.answer_option_ids.includes(option.id) },
      content: toManualRichDoc(option.content).content })),
  ] }] };
}

export function manualContentFromDocument(document: JSONContent, previous: QuestionContentV3): QuestionContentV3 {
  const blocks = document.content;
  if (document.type !== 'doc' || blocks?.length !== 1 || blocks[0]!.type !== 'questionBlock' || blocks[0]!.attrs?.client_id !== MANUAL_QUESTION_ID) unsupported();
  const [stem, ...options] = blocks![0]!.content || [];
  if (stem?.type !== 'questionStem' || options.length < 2 || options.length > 26 || options.some((option) => option.type !== 'questionOption')) unsupported();
  const next: QuestionContentV3 = { stem: fromManualRichDoc({ type: 'doc', content: stem.content }, previous.stem),
    options: options.map((option) => ({ id: option.attrs?.option_id, content: fromManualRichDoc({ type: 'doc', content: option.content }, previous.options.find((item) => item.id === option.attrs?.option_id)?.content) })),
    analysis: clone(previous.analysis), answer_option_ids: options.filter((option) => option.attrs?.checked).map((option) => option.attrs!.option_id) };
  toQuestionFormValue({ schema: 3, ...next });
  return next;
}

export function manualDraftWithContent(value: QuestionDraftPayload, content: QuestionContentV3): QuestionDraftPayload {
  const fields = toQuestionFormValue({ schema: 3, ...content });
  return { category_id: value.category_id, difficulty: value.difficulty, type: value.type,
    ...(Object.prototype.hasOwnProperty.call(value, 'concept_id') ? { concept_id: value.concept_id } : {}),
    ...fields, content_schema_version: 3, content_json: clone(content) };
}

export function judgmentOptions(): QuestionContentV3['options'] {
  return ['正确', '错误'].map((text) => ({ id: newQuestionOptionId([]), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }));
}

export function richDocHasContent(document: JSONContent | null): boolean {
  return Boolean(document && (document.type === 'image' || document.type === 'mediaImage' || document.type === 'table' || document.type === 'horizontalRule'
    || document.text?.trim() || document.content?.some(richDocHasContent)));
}
