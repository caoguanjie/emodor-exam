import type { JSONContent } from '@tiptap/core';

export class PlainTextConversionError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`${message}（${path}）`);
    this.name = 'PlainTextConversionError';
  }
}

function conversionError(path: string, message: string): never {
  throw new PlainTextConversionError(message, path);
}

function normalizeLineEndings(value: string): string {
  // HTTP、Windows 粘贴和旧数据可能混用 CRLF/CR；plain 契约统一输出 LF。
  return value.replace(/\r\n?/g, '\n');
}

function assertNoMarks(node: JSONContent, path: string): void {
  if (node.marks && node.marks.length > 0) {
    conversionError(path, 'plain 文档不支持 marks');
  }
}

function assertNoAttributes(node: JSONContent, path: string): void {
  if (node.attrs && Object.keys(node.attrs).length > 0) {
    conversionError(path, 'plain 文档不支持富文本属性');
  }
}

function paragraphToText(node: JSONContent, path: string): string {
  if (node.type !== 'paragraph') {
    conversionError(path, `plain doc 只能包含 paragraph，不支持节点 ${String(node.type)}`);
  }
  assertNoMarks(node, path);
  assertNoAttributes(node, path);
  if (node.text !== undefined) conversionError(path, 'paragraph 不能直接包含 text 字段');
  if (node.content !== undefined && !Array.isArray(node.content)) {
    conversionError(path, 'paragraph content 必须是数组');
  }

  return (node.content ?? []).map((child, index) => {
    const childPath = `${path}.content[${index}]`;
    assertNoMarks(child, childPath);
    assertNoAttributes(child, childPath);
    if (child.type === 'text') {
      if (typeof child.text !== 'string') conversionError(childPath, 'text 节点缺少字符串内容');
      if (child.content !== undefined) conversionError(childPath, 'text 节点不能包含子节点');
      return normalizeLineEndings(child.text);
    }
    if (child.type === 'hardBreak') {
      if (child.text !== undefined || child.content !== undefined) {
        conversionError(childPath, 'hardBreak 不能包含文本或子节点');
      }
      return '\n';
    }
    return conversionError(childPath, `plain paragraph 不支持节点 ${String(child.type)}`);
  }).join('');
}

export function plainTextToDocument(text: string): JSONContent {
  if (typeof text !== 'string') conversionError('$text', 'plain 文本必须是字符串');
  const lines = normalizeLineEndings(text).split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => (
      line.length > 0
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' }
    )),
  };
}

export function documentToPlainText(doc: JSONContent): string {
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') {
    conversionError('$', 'plain 文档根节点必须是 doc');
  }
  assertNoMarks(doc, '$');
  assertNoAttributes(doc, '$');
  if (doc.text !== undefined) conversionError('$', 'doc 不能直接包含 text 字段');
  if (doc.content !== undefined && !Array.isArray(doc.content)) {
    conversionError('$', 'doc content 必须是数组');
  }
  return (doc.content ?? [])
    .map((node, index) => paragraphToText(node, `$.content[${index}]`))
    .join('\n');
}
