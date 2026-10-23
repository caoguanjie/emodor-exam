import { Extension } from '@tiptap/core';
import { Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { documentToPlainText, plainTextToDocument } from '../utils/plain-text';
import { CONTROLLED_UPDATE_META } from '../utils/widgetNodeViewRegistry';

export interface PlainFieldOptions {
  maxlength?: number;
  rows: number;
  placeholder?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  disabled?: boolean;
}

export function normalizeMaxlength(value: string | number | undefined): number | undefined {
  if (value === undefined || (typeof value === 'string' && !/^\d+$/.test(value.trim()))) return undefined;
  const maximum = Number(value);
  return Number.isSafeInteger(maximum) && maximum >= 0 ? maximum : undefined;
}

function textLength(node: ProseMirrorNode): number {
  return documentToPlainText(node.toJSON()).length;
}

function fitText(text: string, budget: number): string {
  let result = '';
  for (const character of text.replace(/\r\n?/g, '\n')) {
    if (result.length + character.length > budget) break;
    result += character;
  }
  return result;
}

export const PlainField = Extension.create<{
  getOptions: () => PlainFieldOptions | undefined;
}>({
  name: 'plainField',
  addOptions() {
    return { getOptions: () => undefined };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('plainField'),
      filterTransaction: (transaction, state) => {
        if (!transaction.docChanged || transaction.getMeta(CONTROLLED_UPDATE_META) === true) return true;
        const maximum = this.options.getOptions()?.maxlength;
        if (maximum === undefined) return true;
        const previousLength = textLength(state.doc);
        const nextLength = textLength(transaction.doc);
        return nextLength <= maximum || (previousLength > maximum && nextLength <= previousLength);
      },
      props: {
        decorations: (state) => {
          const placeholder = this.options.getOptions()?.placeholder;
          if (!placeholder || state.doc.childCount !== 1 || textLength(state.doc) !== 0) return null;
          return DecorationSet.create(state.doc, [
            Decoration.node(0, state.doc.firstChild!.nodeSize, { 'data-placeholder': placeholder }),
          ]);
        },
        handlePaste: (view, event) => {
          const options = this.options.getOptions();
          if (!options || !event.clipboardData) return false;
          event.preventDefault();
          const incoming = event.clipboardData.getData('text/plain');
          if (!incoming) return true;
          const transaction = view.state.tr;
          const currentLength = textLength(view.state.doc);
          const remainderLength = textLength(transaction.deleteSelection().doc);
          const budget = options.maxlength === undefined
            ? Infinity
            : Math.max(0, Math.max(options.maxlength, currentLength) - remainderLength);
          const accepted = fitText(incoming, budget);
          if (!accepted && view.state.selection.empty) return true;
          // Open paragraph edges retain the surrounding text and paragraph boundaries.
          const document = view.state.schema.nodeFromJSON(plainTextToDocument(accepted));
          view.dispatch(view.state.tr
            .replaceSelection(new Slice(document.content, 1, 1))
            .setMeta('paste', true)
            .setMeta('uiEvent', 'paste')
            .scrollIntoView());
          return true;
        },
      },
    })];
  },
});
