import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { questionContentTarget, QUESTION_STRUCTURE_META } from './Tiptap/extensions/QuestionEditingProtection';
import { CONTROLLED_UPDATE_META } from './Tiptap/utils/widgetNodeViewRegistry';

function optionOffset(document: Node, optionId: string): number | undefined {
  let result: number | undefined;
  document.descendants((node, position) => { if (node.type.name === 'questionOption' && node.attrs.option_id === optionId) result = position; });
  return result;
}

/** A view-only anchor follows edits; no File, URL or placeholder enters the saved JSON. */
export function anchorManualImageUpload(editor: Editor, question: boolean) {
  const selection = editor.state.selection;
  if (!selection.$from.parent.isTextblock) return null;
  const target = question ? questionContentTarget(editor.state.doc, selection.from) : null;
  const end = question ? questionContentTarget(editor.state.doc, selection.to) : null;
  if (question && (!target || target.clientId !== end?.clientId || target.optionId !== end.optionId)) return null;
  const key = new PluginKey<number | null>('manualQuestionImageUpload');
  editor.registerPlugin(new Plugin<number | null>({
    key,
    state: {
      init: () => selection.from,
      apply(transaction, previous, oldState) {
        if (previous === null || transaction.getMeta(CONTROLLED_UPDATE_META)) return null;
        if (target?.optionId && transaction.getMeta(QUESTION_STRUCTURE_META)?.kind === 'option-move') {
          const before = optionOffset(oldState.doc, target.optionId);
          const after = optionOffset(transaction.doc, target.optionId);
          return before === undefined || after === undefined ? null : previous - before + after;
        }
        const mapped = transaction.mapping.mapResult(previous, 1);
        if (mapped.deletedAcross || !transaction.doc.resolve(mapped.pos).parent.isTextblock) return null;
        if (target) {
          const current = questionContentTarget(transaction.doc, mapped.pos);
          if (current?.clientId !== target.clientId || current.optionId !== target.optionId) return null;
        }
        return mapped.pos;
      },
    },
    props: {
      decorations(state) {
        const position = key.getState(state);
        return position == null ? DecorationSet.empty : DecorationSet.create(state.doc, [Decoration.widget(position, () => {
          const placeholder = document.createElement('span');
          placeholder.dataset.manualImageUpload = ''; placeholder.contentEditable = 'false'; placeholder.textContent = '待上传图片';
          return placeholder;
        }, { key: 'manual-question-image-upload', side: 1 })]);
      },
    },
  }));
  return {
    editor,
    position: () => editor.isDestroyed ? null : key.getState(editor.state) ?? null,
    cancel: () => { if (!editor.isDestroyed) editor.unregisterPlugin(key); },
  };
}
