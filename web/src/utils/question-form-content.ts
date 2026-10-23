import type { CanonicalQuestionContent, ReadonlyRichDocV3 } from '../api/question-document-types';
import { normalizeQuestionContentV2, questionHtmlToReadonlyDoc, readonlyQuestionDocToHtml, type QuestionDraftPayload } from '../api/training-types';

export type QuestionFormValue = Pick<QuestionDraftPayload, 'stem' | 'options' | 'analysis' | 'answer'>;
export type QuestionFormField = keyof QuestionFormValue;

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const fail = (field: string, reason = '当前表单无法安全保留此字段的格式或节点结构'): never => { throw new Error(`${field}：${reason}；输入已保留，请调整修改后重试`); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const color = (value: unknown): string => typeof value === 'string' && /^(#[\da-f]{3,8}|rgba?\([\d.,% ]+\))$/i.test(value) ? value : fail('颜色');

/** An explicit, escaped read-only projection, never an HTML-to-document roundtrip. */
export function questionRichDocToFormHtml(input: ReadonlyRichDocV3): string {
  let count = 0;
  const visit = (node: any, depth: number): string => {
    if (++count > 10000 || depth > 16 || !node || typeof node !== 'object' || Array.isArray(node)) return fail('题目内容');
    if (Object.keys(node).some((key) => !['type', 'content', 'attrs', 'text', 'marks'].includes(key))) return fail('题目内容');
    const attrs = node.attrs || {};
    const children = () => (node.content || []).map((child: unknown) => visit(child, depth + 1)).join('');
    const blockStyle = (): string => {
      if (Object.keys(attrs).some((key) => !['level', 'textAlign', 'indent', 'lineHeight'].includes(key))) return fail('题目内容');
      const styles: string[] = [];
      if (attrs.textAlign != null) {
        if (!['left', 'center', 'right', 'justify'].includes(attrs.textAlign)) return fail('对齐');
        styles.push(`text-align:${attrs.textAlign}`);
      }
      if (attrs.indent !== undefined) {
        if (!Number.isInteger(attrs.indent) || attrs.indent < 0 || attrs.indent > 10) return fail('缩进');
        styles.push(`margin-left:${attrs.indent * 2}em`);
      }
      if (attrs.lineHeight != null && attrs.lineHeight !== 0) {
        if (!['1', '1.2', '1.5', '1.75', '2', '2.5', '3'].includes(attrs.lineHeight)) return fail('行距');
        styles.push(`line-height:${attrs.lineHeight}`);
      }
      return styles.length ? ` style="${styles.join(';')}"` : '';
    };
    const marked = (text: string): string => (node.marks || []).reduce((html: string, mark: any) => {
      if (!mark || Object.keys(mark).some((key) => !['type', 'attrs'].includes(key))) return fail('题目格式');
      const tags: Record<string, string> = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code', superscript: 'sup', subscript: 'sub' };
      if (tags[mark.type]) {
        if (mark.attrs && Object.keys(mark.attrs).length) return fail('题目格式');
        return `<${tags[mark.type]}>${html}</${tags[mark.type]}>`;
      }
      const ma = mark.attrs || {};
      if (mark.type === 'highlight' && Object.keys(ma).every((key) => key === 'color')) return `<span style="background-color:${escape(color(ma.color))}">${html}</span>`;
      if (mark.type !== 'textStyle' || Object.keys(ma).some((key) => !['fontFamily', 'fontSize', 'color'].includes(key))) return fail('题目格式');
      const styles: string[] = [];
      if (ma.fontFamily != null) {
        if (!['SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi'].includes(ma.fontFamily)) return fail('字体');
        styles.push(`font-family:${ma.fontFamily}`);
      }
      if (ma.fontSize != null) {
        if (!/^\d+(?:\.\d+)?(?:px|pt)$/.test(ma.fontSize)) return fail('字号');
        styles.push(`font-size:${ma.fontSize}`);
      }
      if (ma.color != null) styles.push(`color:${color(ma.color)}`);
      return `<span${styles.length ? ` style="${escape(styles.join(';'))}"` : ''}>${html}</span>`;
    }, text);
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.attrs || node.content) return fail('题目文字');
      return marked(escape(node.text));
    }
    if (node.type === 'hardBreak') return marked('<br>');
    if (node.type === 'image') {
      if (Object.keys(attrs).some((key) => key !== 'asset_id') || typeof attrs.asset_id !== 'string' || !/^[1-9]\d*$/.test(attrs.asset_id)) return fail('图片');
      return `<img data-media-id="${attrs.asset_id}">`;
    }
    if (node.marks) return fail('题目格式');
    if (node.type === 'doc') { if (node.attrs || !Array.isArray(node.content)) return fail('题目内容'); return children(); }
    if (node.type === 'paragraph' || node.type === 'listItem') return `<${node.type === 'paragraph' ? 'p' : 'li'}${blockStyle()}>${children()}</${node.type === 'paragraph' ? 'p' : 'li'}>`;
    if (node.type === 'heading') {
      if (![1, 2, 3, 4].includes(attrs.level)) return fail('标题');
      return `<h${attrs.level}${blockStyle()}>${children()}</h${attrs.level}>`;
    }
    if (node.type === 'orderedList') {
      if (Object.keys(attrs).some((key) => !['start', 'type'].includes(key)) || (attrs.start !== undefined && (!Number.isInteger(attrs.start) || attrs.start < 1)) || (attrs.type != null && !['1', 'a', 'A', 'i', 'I'].includes(attrs.type))) return fail('列表');
      return `<ol${attrs.start !== undefined ? ` start="${attrs.start}"` : ''}${attrs.type != null ? ` type="${attrs.type}"` : ''}>${children()}</ol>`;
    }
    if (node.type === 'codeBlock') {
      if (Object.keys(attrs).some((key) => key !== 'language') || attrs.language != null) return fail('代码块');
      return `<pre><code>${children()}</code></pre>`;
    }
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      if (Object.keys(attrs).some((key) => !['colspan', 'rowspan', 'colwidth', 'align'].includes(key)) || ![attrs.colspan, attrs.rowspan].every((value) => Number.isInteger(value) && value >= 1 && value <= 100) || (attrs.align != null && !['left', 'center', 'right'].includes(attrs.align)) || (attrs.colwidth != null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.some((value: number) => !Number.isInteger(value) || value < 0 || value > 10000)))) return fail('表格');
      const tag = node.type === 'tableHeader' ? 'th' : 'td';
      const styles = [attrs.align ? `text-align:${attrs.align}` : '',
        Array.isArray(attrs.colwidth) && attrs.colwidth.length && attrs.colwidth.every((value: number) => value > 0)
          ? `width:${attrs.colwidth.reduce((sum: number, value: number) => sum + value, 0)}px` : ''].filter(Boolean);
      return `<${tag} colspan="${attrs.colspan}" rowspan="${attrs.rowspan}"${attrs.colwidth ? ` data-colwidth="${attrs.colwidth.join(',')}"` : ''}${styles.length ? ` style="${styles.join(';')}"` : ''}>${children()}</${tag}>`;
    }
    const tags: Record<string, string> = { blockquote: 'blockquote', bulletList: 'ul', table: 'table', tableRow: 'tr', horizontalRule: 'hr' };
    const tag = tags[node.type];
    if (!tag || Object.keys(attrs).length) return fail('题目内容');
    return tag === 'hr' ? '<hr>' : `<${tag}>${children()}</${tag}>`;
  };
  return visit(input, 0);
}

export function toQuestionFormValue(content: CanonicalQuestionContent): QuestionFormValue {
  const { schema: _schema, ...fields } = content;
  const normalized = content.schema === 2 ? normalizeQuestionContentV2(fields) : content;
  const ids = normalized.options.map((option) => option.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) return fail('选项', '稳定选项 ID 非法或重复');
  if (normalized.answer_option_ids.some((id) => !ids.includes(id)) || new Set(normalized.answer_option_ids).size !== normalized.answer_option_ids.length) return fail('答案', '正确项身份不属于当前选项');
  const render = content.schema === 2 ? readonlyQuestionDocToHtml : questionRichDocToFormHtml;
  return { stem: render(normalized.stem as any), options: normalized.options.map((option) => ({ key: option.id, text: render(option.content as any) })),
    analysis: normalized.analysis ? render(normalized.analysis as any) : null,
    answer: normalized.options.flatMap((option, index) => normalized.answer_option_ids.includes(option.id) ? [index] : []) };
}

/** Schema 3 keeps paragraph and text boundaries, including explicit empty paragraphs. */
function parsePlainFormDoc(html: string, field: string): ReadonlyRichDocV3 {
  const template = document.createElement('template'); template.innerHTML = html;
  const content: ReadonlyRichDocV3['content'] = [];
  let pending: any[] = [];
  const flush = () => { if (pending.length) content.push({ type: 'paragraph', content: pending }); pending = []; };
  const inline = (node: ChildNode): any => {
    if (node.nodeType === 3) return node.nodeValue ? { type: 'text', text: node.nodeValue } : null;
    if (node.nodeType !== 1) return fail(field);
    const element = node as HTMLElement; const tag = element.tagName.toLowerCase();
    if (tag === 'br' && !element.attributes.length && !element.childNodes.length) return { type: 'hardBreak' };
    if (tag !== 'img' || [...element.attributes].some((attribute) => attribute.name !== 'data-media-id'
      && !(attribute.name === 'alt' && attribute.value === '题目图片')) || !/^[1-9]\d*$/.test(element.getAttribute('data-media-id') || '') || element.childNodes.length) return fail(field);
    return { type: 'image', attrs: { asset_id: element.getAttribute('data-media-id')! } };
  };
  for (const node of template.content.childNodes) {
    if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === 'p') {
      flush();
      if ((node as Element).attributes.length) return fail(field);
      content.push({ type: 'paragraph', content: [...node.childNodes].map(inline).filter(Boolean) });
    } else {
      const value = inline(node); if (value) pending.push(value);
    }
  }
  flush();
  return { type: 'doc', content };
}

function mergeRichField(base: ReadonlyRichDocV3 | null, html: string | null, field: string): ReadonlyRichDocV3 | null {
  if ((base ? questionRichDocToFormHtml(base) : null) === html) return base && clone(base);
  if (typeof document === 'undefined') return fail(field, '当前环境无法校验无损修改');
  const plain = (node: any): boolean => ['doc', 'paragraph', 'text', 'hardBreak', 'image'].includes(node.type) && !node.marks?.length
    && (node.type === 'image' || !node.attrs || !Object.keys(node.attrs).length) && (node.content || []).every(plain);
  if (!base) return html === null ? null : parsePlainFormDoc(html, field);
  if (html === null) return plain(base) ? null : fail(field);
  const before = document.createElement('template'); before.innerHTML = questionRichDocToFormHtml(base);
  const after = document.createElement('template'); after.innerHTML = html;
  const text: Array<{ previous: string; next: string }> = [];
  const compare = (left: Node, right: Node): boolean => {
    if (left.nodeType !== right.nodeType) return false;
    if (left.nodeType === 3) { text.push({ previous: left.nodeValue || '', next: right.nodeValue || '' }); return true; }
    if (left.nodeType === 1) {
      const a = left as Element, b = right as Element;
      if (a.tagName !== b.tagName || a.attributes.length !== b.attributes.length || [...a.attributes].some((attr) => b.getAttribute(attr.name) !== attr.value)) return false;
    }
    return left.childNodes.length === right.childNodes.length && [...left.childNodes].every((child, index) => compare(child, right.childNodes[index]!));
  };
  if (!compare(before.content, after.content)) return plain(base) ? parsePlainFormDoc(html, field) : fail(field);
  const result = clone(base);
  const leaves: Array<{ text: string }> = [];
  const collect = (node: any) => { if (node.type === 'text') leaves.push(node); (node.content || []).forEach(collect); };
  collect(result);
  // HTML may join adjacent text nodes. Locate one contiguous edit within exactly
  // one canonical node; preserve its siblings rather than rebuilding the paragraph.
  let cursor = 0;
  const normalized = (value: string) => value.replace(/\r\n?/g, '\n');
  for (const value of text) {
    const group: typeof leaves = []; let old = '';
    while (cursor < leaves.length && old.length < value.previous.length) {
      const leaf = leaves[cursor++]!; group.push(leaf); old += normalized(leaf.text);
    }
    if (old !== value.previous || !group.length) return fail(field);
    if (value.previous === value.next) continue;
    const candidates = group.flatMap((leaf, index) => {
      const prefix = group.slice(0, index).map((item) => normalized(item.text)).join('');
      const suffix = group.slice(index + 1).map((item) => normalized(item.text)).join('');
      return value.next.startsWith(prefix) && value.next.endsWith(suffix) && value.next.length > prefix.length + suffix.length ? [{ leaf, prefix, suffix }] : [];
    });
    if (candidates.length !== 1) return fail(field);
    const candidate = candidates[0]!;
    const nextText = value.next.slice(candidate.prefix.length, value.next.length - candidate.suffix.length);
    old = normalized(candidate.leaf.text);
    let start = 0;
    while (start < old.length && start < nextText.length && old[start] === nextText[start]) start++;
    let end = old.length, nextEnd = nextText.length;
    while (end > start && nextEnd > start && old[end - 1] === nextText[nextEnd - 1]) { end--; nextEnd--; }
    const sourceOffset = (target: number) => {
      let source = 0, logical = 0;
      while (logical < target) { if (candidate.leaf.text[source] === '\r' && candidate.leaf.text[source + 1] === '\n') source++; source++; logical++; }
      return source;
    };
    candidate.leaf.text = candidate.leaf.text.slice(0, sourceOffset(start)) + nextText.slice(start, nextEnd) + candidate.leaf.text.slice(sourceOffset(end));
  }
  if (cursor !== leaves.length) return fail(field);
  return result;
}

/** Apply only changed fields. Untouched rich subtrees are never rebuilt from their HTML projection. */
export function applyQuestionFormChanges(base: CanonicalQuestionContent, value: QuestionFormValue, changedFields: readonly QuestionFormField[]): CanonicalQuestionContent {
  toQuestionFormValue(base);
  const result = clone(base);
  const changed = new Set(changedFields);
  const ids = value.options.map((option) => option.key);
  if (new Set(ids).size !== ids.length || ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) return fail('选项', '稳定选项 ID 非法或重复');
  if (value.answer.some((index) => !Number.isInteger(index) || index < 0 || index >= ids.length) || new Set(value.answer).size !== value.answer.length) return fail('答案', '正确项索引非法或重复');
  if (base.schema === 2) {
    if (changed.has('stem')) result.stem = questionHtmlToReadonlyDoc(value.stem);
    if (changed.has('analysis')) result.analysis = value.analysis === null ? null : questionHtmlToReadonlyDoc(value.analysis);
    if (changed.has('options')) result.options = value.options.map((option) => ({ id: option.key, content: questionHtmlToReadonlyDoc(option.text) }));
  } else {
    if (changed.has('stem')) result.stem = mergeRichField(base.stem, value.stem, '题干')!;
    if (changed.has('analysis')) result.analysis = mergeRichField(base.analysis, value.analysis, '解析');
    if (changed.has('options')) result.options = value.options.map((option, index) => ({ id: option.key,
      content: mergeRichField(base.options.find((item) => item.id === option.key)?.content || null, option.text, `选项 ${String.fromCharCode(65 + index)}`)! }));
  }
  if (changed.has('answer') || changed.has('options')) result.answer_option_ids = value.answer.map((index) => ids[index]!);
  return result;
}
