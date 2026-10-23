import { parseDocument } from 'htmlparser2';
import { Errors } from '../../common/errors';
import type { QuestionContentV2, ReadonlyTiptapDoc, ReadonlyTiptapNode } from '../../common/training-contracts';

const optionId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function keys(value: Record<string, any>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw Errors.param('题目内容包含不支持的字段');
}

/** Rebuild every node; never return management JSON directly to a learner. */
export function readonlyDoc(value: unknown): ReadonlyTiptapDoc {
  let nodes = 0;
  let textLength = 0;
  function read(node: unknown, depth: number, parent: string): ReadonlyTiptapNode {
    if (!object(node) || ++nodes > 2000 || depth > 4) throw Errors.param('题目内容结构非法或超限');
    const type = node.type;
    if (type === 'text' && parent === 'paragraph') {
      keys(node, ['type', 'text']);
      if (typeof node.text !== 'string' || (textLength += node.text.length) > 100000) throw Errors.param('题目文本非法或超限');
      return { type, text: node.text };
    }
    if (type === 'hardBreak' && parent === 'paragraph') { keys(node, ['type']); return { type }; }
    if (type === 'image' && ['doc', 'paragraph'].includes(parent)) {
      keys(node, ['type', 'attrs']);
      if (!object(node.attrs)) throw Errors.param('题目图片非法');
      keys(node.attrs, ['asset_id']);
      if (typeof node.attrs.asset_id !== 'string' || !/^[1-9]\d*$/.test(node.attrs.asset_id)) throw Errors.param('题目图片只能引用受控媒体');
      return { type, attrs: { asset_id: node.attrs.asset_id } };
    }
    if ((type === 'doc' && depth === 1) || (type === 'paragraph' && parent === 'doc')) {
      keys(node, ['type', 'content']);
      if (!Array.isArray(node.content)) throw Errors.param('题目内容必须是数组');
      return { type, content: node.content.map((child: unknown) => read(child, depth + 1, type)) };
    }
    throw Errors.param('题目内容包含不支持的节点');
  }
  return read(value, 1, '') as ReadonlyTiptapDoc;
}

/** Legacy HTML is normalized once at version creation or frozen-snapshot read. */
export function legacyHtmlDoc(html: unknown): ReadonlyTiptapDoc {
  if (typeof html !== 'string') throw Errors.param('历史题目内容非法');
  const root = parseDocument(html, { decodeEntities: true });
  const blocks: ReadonlyTiptapNode[] = [];
  let inline: ReadonlyTiptapNode[] = [];
  const flush = () => { if (inline.length) blocks.push({ type: 'paragraph', content: inline }); inline = []; };
  function visit(node: any): void {
    if (node.type === 'text') { if (node.data) inline.push({ type: 'text', text: node.data }); return; }
    if (['script', 'style'].includes(node.name)) return;
    if (node.name === 'br') { inline.push({ type: 'hardBreak' }); return; }
    if (node.name === 'img') {
      if (node.attribs?.src || !/^[1-9]\d*$/.test(node.attribs?.['data-media-id'] || '')) throw Errors.param('图片只能引用受控媒体');
      inline.push({ type: 'image', attrs: { asset_id: node.attribs['data-media-id'] } }); return;
    }
    const block = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote', 'pre', 'tr'].includes(node.name);
    if (block) flush();
    for (const child of node.children || []) visit(child);
    if (block) flush();
  }
  for (const child of root.children) visit(child);
  flush();
  return readonlyDoc({ type: 'doc', content: blocks });
}

export function questionContent(value: any): QuestionContentV2 {
  if (!object(value)) throw Errors.param('题目内容非法');
  const schema = value.contentSchemaVersion ?? value.content_schema_version ?? 1;
  if (schema !== 1 && schema !== 2) throw Errors.param('题目内容版本不支持');
  let content: any;
  if (schema === 2) {
    content = value.contentJson ?? value.content_json;
    if (!object(content)) throw Errors.param('题目 v2 内容缺失');
    keys(content, ['stem', 'options', 'analysis', 'answer_option_ids']);
  } else {
    if (!Array.isArray(value.options) || !Array.isArray(value.answer)) throw Errors.param('历史题目选项或答案非法');
    content = {
      stem: legacyHtmlDoc(value.stem),
      options: value.options.map((option: unknown) => {
        if (!object(option)) throw Errors.param('历史题目选项非法');
        return { id: option.key, content: legacyHtmlDoc(option.text) };
      }),
      analysis: value.analysis == null ? null : legacyHtmlDoc(value.analysis),
      answer_option_ids: value.answer.map((index: unknown) => {
        if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= value.options.length) throw Errors.param('历史答案下标非法');
        return value.options[Number(index)].key;
      }),
    };
  }
  if (!Array.isArray(content.options) || content.options.length < 2 || content.options.length > 26) throw Errors.param('题目选项非法');
  const ids = new Set<string>();
  const options = content.options.map((option: unknown) => {
    if (!object(option)) throw Errors.param('题目选项非法');
    keys(option, ['id', 'content']);
    if (!optionId(option.id) || ids.has(option.id)) throw Errors.param('题目选项 ID 缺失、重复或非法');
    ids.add(option.id);
    return { id: option.id, content: readonlyDoc(option.content) };
  });
  const answer = content.answer_option_ids;
  if (!Array.isArray(answer) || new Set(answer).size !== answer.length || answer.some((id) => !ids.has(id))) throw Errors.param('题目答案 ID 非法');
  if (['single', 'judgment'].includes(value.type) ? answer.length !== 1 : value.type === 'multiple' ? answer.length < 2 : true) throw Errors.param('题型不支持或答案数量非法');
  if (value.type === 'judgment' && options.length !== 2) throw Errors.param('判断题必须有两个选项');
  const stem = readonlyDoc(content.stem);
  const visible = (node: ReadonlyTiptapNode): boolean => node.type === 'image' || Boolean(node.text?.trim()) || Boolean(node.content?.some(visible));
  if (!visible(stem) || options.some((option) => !visible(option.content))) throw Errors.param('题干和选项不能为空');
  return { stem, options, analysis: content.analysis == null ? null : readonlyDoc(content.analysis), answer_option_ids: [...answer] };
}

export function docHtml(doc: ReadonlyTiptapDoc): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const render = (node: ReadonlyTiptapNode): string => node.type === 'text' ? escape(node.text!) : node.type === 'hardBreak' ? '<br>' : node.type === 'image' ? `<img data-media-id="${node.attrs!.asset_id}">` : node.type === 'paragraph' ? `<p>${(node.content || []).map(render).join('')}</p>` : (node.content || []).map(render).join('');
  return render(doc);
}

export function contentMediaIds(docs: Array<ReadonlyTiptapDoc | null>): string[] {
  const ids = new Set<string>();
  const visit = (node: ReadonlyTiptapNode) => { if (node.type === 'image') ids.add(node.attrs!.asset_id); node.content?.forEach(visit); };
  docs.forEach((doc) => doc && visit(doc));
  return [...ids];
}
