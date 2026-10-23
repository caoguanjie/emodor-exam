import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions } from '../utils/createExtensions';
import { documentToPlainText, plainTextToDocument } from '../utils/plain-text';

const editors: Editor[] = [];

function readThroughPlainEditor(text: string): string {
  const editor = new Editor({
    content: plainTextToDocument(text),
    extensions: createExtensions('plain'),
  });
  editors.push(editor);
  return documentToPlainText(editor.getJSON());
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('plain Tiptap text conversion', () => {
  it.each([
    ['', ''],
    ['a', 'a'],
    ['a\nb', 'a\nb'],
    ['\n', '\n'],
    ['\n\n', '\n\n'],
    ['a\n', 'a\n'],
    ['a\n\n', 'a\n\n'],
    ['a\n\nb', 'a\n\nb'],
    ['a\r\nb\rc', 'a\nb\nc'],
  ])('round-trips %j through the actual plain schema as %j', (input, expected) => {
    expect(readThroughPlainEditor(input)).toBe(expected);
  });

  it('keeps angle brackets and ampersands as literal text instead of parsing HTML', () => {
    const input = '<script>alert("x")</script> & 1 < 2 > 0';
    const document = plainTextToDocument(input);

    expect(document).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: input }],
      }],
    });
    expect(readThroughPlainEditor(input)).toBe(input);
  });

  it('represents every logical line as a paragraph so empty and trailing lines remain observable', () => {
    expect(plainTextToDocument('first\n\nlast\n')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'last' }] },
        { type: 'paragraph' },
      ],
    });
  });

  it('converts hard breaks inside a paragraph and paragraph boundaries to line feeds', () => {
    const document: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'first' },
            { type: 'hardBreak' },
            { type: 'text', text: 'second' },
          ],
        },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'last' }] },
      ],
    };

    expect(documentToPlainText(document)).toBe('first\nsecond\n\nlast');
  });

  it.each(['heading', 'widgetField', 'mediaImage'])('rejects unsupported %s nodes instead of dropping them', (type) => {
    const document: JSONContent = {
      type: 'doc',
      content: [{ type, content: [{ type: 'text', text: '不可丢失' }] }],
    };

    expect(() => documentToPlainText(document)).toThrow(new RegExp(`不支持.*${type}`));
  });

  it('rejects rich marks instead of silently flattening a rich document', () => {
    const document: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '加粗', marks: [{ type: 'bold' }] }],
      }],
    };

    expect(() => documentToPlainText(document)).toThrow(/plain 文档不支持 marks/);
  });

  it('rejects malformed roots and misplaced plain nodes with a conversion error', () => {
    expect(() => documentToPlainText({ type: 'paragraph' })).toThrow(/根节点必须是 doc/);
    expect(() => documentToPlainText({
      type: 'doc',
      content: [{ type: 'text', text: '根节点文本' }],
    })).toThrow(/doc 只能包含 paragraph/);
  });
});
