import { Extension, type Extensions } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Highlight } from '@tiptap/extension-highlight';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { ClearFormat } from '../extensions/ClearFormat';
import { IndentExtension } from '../extensions/IndentExtension';
import { ParagraphLineHeight } from '../extensions/ParagraphLineHeight';
import { MediaImage, type MediaResolver } from '../extensions/MediaImage';
import { PlainField, type PlainFieldOptions } from '../extensions/PlainField';
import {
  createQuestionNodes,
  type QuestionNodeRuntime,
} from '../extensions/QuestionNodes';
import { WidgetNodes } from '../extensions/WidgetNodes';
import type { EditorProfile } from '../type';
import { canApplyEditorTransaction } from './widgetNodeViewRegistry';

export type { EditorProfile } from '../type';
export type { QuestionNodeRuntime } from '../extensions/QuestionNodes';

const AuthoringMutationGuard = Extension.create({
  name: 'authoringMutationGuard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('authoringMutationGuard'),
        filterTransaction: (transaction) => (
          !transaction.docChanged || canApplyEditorTransaction(this.editor, transaction)
        ),
      }),
    ];
  },
});

export const AUTHORING_FONT_FAMILIES = [
  'SimSun',
  'SimHei',
  'Microsoft YaHei',
  'FangSong',
  'KaiTi',
] as const;

function isAuthoringFontSize(value: string): boolean {
  const match = /^(\d{1,2})pt$/.exec(value);
  if (!match) return false;
  const size = Number(match[1]);
  return size >= 9 && size <= 36 && String(size) === match[1];
}

function isAuthoringFontFamily(value: string): boolean {
  return AUTHORING_FONT_FAMILIES.some((family) => family === value);
}

function isRgbChannel(value: string): boolean {
  if (!/^\d{1,3}$/.test(value)) return false;
  const channel = Number(value);
  return channel >= 0 && channel <= 255;
}

export function isAuthoringColor(value: string): boolean {
  if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return true;
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(value);
  return Boolean(match && match.slice(1).every(isRgbChannel));
}

const AuthoringFontSize = FontSize.extend({
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }) => {
        if (!isAuthoringFontSize(fontSize)) return false;
        return chain().setMark('textStyle', { fontSize }).run();
      },
      unsetFontSize: () => ({ chain }) => (
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()
      ),
    };
  },
});

const AuthoringFontFamily = FontFamily.extend({
  addCommands() {
    return {
      setFontFamily: (fontFamily: string) => ({ chain }) => {
        if (!isAuthoringFontFamily(fontFamily)) return false;
        return chain().setMark('textStyle', { fontFamily }).run();
      },
      unsetFontFamily: () => ({ chain }) => (
        chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run()
      ),
    };
  },
});

const AuthoringColor = Color.extend({
  addCommands() {
    return {
      setColor: (color: string) => ({ chain }) => {
        if (!isAuthoringColor(color)) return false;
        return chain().setMark('textStyle', { color }).run();
      },
      unsetColor: () => ({ chain }) => (
        chain().setMark('textStyle', { color: null }).removeEmptyTextStyle().run()
      ),
    };
  },
});

const AuthoringHighlight = Highlight.extend({
  addCommands() {
    const validAttributes = (attributes?: { color: string }) => (
      attributes === undefined || isAuthoringColor(attributes.color)
    );
    return {
      setHighlight: (attributes?: { color: string }) => ({ commands }) => (
        validAttributes(attributes) && commands.setMark(this.name, attributes)
      ),
      toggleHighlight: (attributes?: { color: string }) => ({ commands }) => (
        validAttributes(attributes) && commands.toggleMark(this.name, attributes)
      ),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

const plainStarterKit = StarterKit.configure({
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  heading: false,
  horizontalRule: false,
  italic: false,
  link: false,
  listItem: false,
  listKeymap: false,
  orderedList: false,
  strike: false,
  trailingNode: false,
  underline: false,
});

const richStarterKit = StarterKit.configure({
  heading: { levels: [1, 2, 3, 4] },
  link: {
    openOnClick: false,
    HTMLAttributes: {
      target: null,
      rel: 'noopener noreferrer',
      class: null,
      title: null,
    },
  },
});

const questionStarterKit = StarterKit.configure({
  document: false,
  trailingNode: false,
  heading: { levels: [1, 2, 3, 4] },
  link: {
    openOnClick: false,
    HTMLAttributes: {
      target: null,
      rel: 'noopener noreferrer',
      class: null,
      title: null,
    },
  },
});

function richExtensions(starterKit: typeof richStarterKit, mediaResolver?: MediaResolver): Extensions {
  return [
  starterKit,
  AuthoringMutationGuard,
  IndentExtension,
  Superscript,
  Subscript,
  ClearFormat,
  TextStyle,
  AuthoringFontSize,
  ParagraphLineHeight,
  AuthoringColor,
  AuthoringHighlight.configure({ multicolor: true }),
  AuthoringFontFamily.configure({ types: ['textStyle'] }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TableKit.configure({
    table: {
      resizable: true,
      handleWidth: 5,
    },
  }),
  MediaImage.configure({ mediaResolver }),
  ];
}

export function createExtensions(
  profile: EditorProfile,
  questionRuntime: QuestionNodeRuntime = {},
  mediaResolver?: MediaResolver,
  getPlainFieldOptions: () => PlainFieldOptions | undefined = () => undefined,
): Extensions {
  if (profile === 'plain') return [plainStarterKit, AuthoringMutationGuard, PlainField.configure({ getOptions: getPlainFieldOptions })];
  if (profile === 'question') {
    return [
      ...richExtensions(questionStarterKit, mediaResolver),
      ...createQuestionNodes(questionRuntime),
      WidgetNodes,
    ];
  }
  return richExtensions(richStarterKit, mediaResolver);
}
