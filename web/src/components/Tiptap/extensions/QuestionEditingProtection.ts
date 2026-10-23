import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { QuestionNodeRuntime } from './QuestionNodes';
import { CONTROLLED_UPDATE_META } from '../utils/widgetNodeViewRegistry';

export const QUESTION_STRUCTURE_META = 'ruleexamQuestionStructure';
export const QUESTION_DRAG_MIME = 'application/x-ruleexam-question';
export const QUESTION_EDIT_BLOCKED = '请逐题编辑或使用题块删除按钮';
type UploadAnchor = { position: number; clientId: string; optionId: string | null };
const uploadsKey = new PluginKey<Map<string, UploadAnchor>>('questionUploadAnchors');

export function questionContentTarget(doc: PMNode, position: number) {
  const resolved = doc.resolve(position);
  let optionId: string | null = null;
  let inContent = false;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === 'questionOption') { optionId = String(node.attrs.option_id); inContent = true; }
    if (node.type.name === 'questionStem') inContent = true;
    if (node.type.name === 'questionBlock') return inContent
      ? { clientId: String(node.attrs.client_id), optionId } : null;
  }
  return null;
}

function sameContentTarget(doc: PMNode, selection: Selection): boolean {
  const from = questionContentTarget(doc, selection.from);
  const to = questionContentTarget(doc, selection.to);
  return Boolean(from && to && from.clientId === to.clientId && from.optionId === to.optionId);
}

function crossesQuestions(doc: PMNode, selection: Selection): boolean {
  if (selection.empty) return false;
  let count = 0;
  doc.forEach((node, offset) => {
    if (selection.from < offset + node.nodeSize && selection.to > offset) count += 1;
  });
  return count > 1;
}

function ids(doc: PMNode): string[] {
  const result: string[] = [];
  doc.forEach((node) => result.push(String(node.attrs.client_id)));
  return result;
}

function questionOffset(doc: PMNode, clientId: string): number | undefined {
  let position: number | undefined;
  doc.forEach((node, offset) => { if (node.attrs.client_id === clientId) position = offset; });
  return position;
}

function containsStructure(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((node) => {
    if (['questionBlock', 'questionStem', 'questionOption', 'widgetField'].includes(node.type.name)) found = true;
  });
  return found;
}

export function beginQuestionImageUpload(editor: Editor, token: string): boolean {
  const target = questionContentTarget(editor.state.doc, editor.state.selection.from);
  if (!target || !sameContentTarget(editor.state.doc, editor.state.selection)) return false;
  editor.view.dispatch(editor.state.tr.setMeta(uploadsKey, { add: { token, ...target, position: editor.state.selection.from } }));
  return true;
}

export function questionImageUploadAnchor(editor: Editor, token: string): UploadAnchor | undefined {
  return uploadsKey.getState(editor.state)?.get(token);
}

export function cancelQuestionImageUpload(editor: Editor, token: string) {
  editor.view.dispatch(editor.state.tr.setMeta(uploadsKey, { remove: token }));
}

export function createQuestionEditingProtection(runtime: QuestionNodeRuntime) {
  return Extension.create({
    name: 'questionEditingProtection',
    addProseMirrorPlugins() {
      const protectedDocument = () => runtime.protectStructure?.() === true;
      const blocked = () => { runtime.onEditBlocked?.(QUESTION_EDIT_BLOCKED); return true; };
      return [new Plugin<Map<string, UploadAnchor>>({
        key: uploadsKey,
        state: {
          init: () => new Map(),
          apply(transaction, previous, oldState) {
            const next = new Map<string, UploadAnchor>();
            if (!transaction.getMeta(CONTROLLED_UPDATE_META)) previous.forEach((anchor, token) => {
              if (transaction.getMeta(QUESTION_STRUCTURE_META)?.kind === 'move') {
                const previousOffset = questionOffset(oldState.doc, anchor.clientId);
                const nextOffset = questionOffset(transaction.doc, anchor.clientId);
                if (previousOffset !== undefined && nextOffset !== undefined) {
                  next.set(token, { ...anchor, position: anchor.position - previousOffset + nextOffset });
                }
                return;
              }
              const mapped = transaction.mapping.mapResult(anchor.position, 1);
              const target = questionContentTarget(transaction.doc, mapped.pos);
              if (!mapped.deletedAcross && target?.clientId === anchor.clientId && target.optionId === anchor.optionId) {
                next.set(token, { ...anchor, position: mapped.pos });
              }
            });
            const change = transaction.getMeta(uploadsKey);
            if (change?.add) {
              const { token, ...anchor } = change.add;
              next.set(token, anchor);
            }
            if (change?.remove) next.delete(change.remove);
            return next;
          },
        },
        filterTransaction(transaction, state) {
          if (!protectedDocument() || !transaction.docChanged || transaction.getMeta(CONTROLLED_UPDATE_META)
            || transaction.getMeta(QUESTION_STRUCTURE_META)) return true;
          const previousIds = ids(state.doc);
          const nextIds = ids(transaction.doc);
          if (crossesQuestions(state.doc, state.selection) || JSON.stringify(previousIds) !== JSON.stringify(nextIds)
            || new Set(nextIds).size !== nextIds.length || nextIds.some((id) => !id || id === 'null')) {
            blocked(); return false;
          }
          return true;
        },
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, [...(uploadsKey.getState(state) ?? [])].map(([token, anchor]) => (
              Decoration.widget(anchor.position, () => {
                const placeholder = document.createElement('span');
                placeholder.className = 'question-image-upload-placeholder';
                placeholder.textContent = '图片上传中…';
                placeholder.dataset.uploadToken = token;
                placeholder.contentEditable = 'false';
                return placeholder;
              }, { key: token, side: 1 })
            )));
          },
          handleDOMEvents: {
            cut(view, event) {
              if (!protectedDocument() || !crossesQuestions(view.state.doc, view.state.selection)) return false;
              event.preventDefault(); return blocked();
            },
            beforeinput(view, event) {
              if (!protectedDocument() || !crossesQuestions(view.state.doc, view.state.selection)) return false;
              event.preventDefault(); return blocked();
            },
          },
          handlePaste(view, event, slice) {
            if (!protectedDocument()) return false;
            if (!sameContentTarget(view.state.doc, view.state.selection) || containsStructure(slice)) {
              event.preventDefault(); return blocked();
            }
            return false;
          },
          handleDrop(view, event, slice) {
            if (!protectedDocument()) return false;
            const clientId = event.dataTransfer?.getData(QUESTION_DRAG_MIME);
            if (clientId) {
              event.preventDefault();
              const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
              if (position === undefined) return true;
              let toIndex = 0;
              let fromIndex = -1;
              view.state.doc.forEach((node, offset, index) => {
                if (node.attrs.client_id === clientId) fromIndex = index;
                if (position >= offset) toIndex = index + (position > offset + node.nodeSize / 2 ? 1 : 0);
              });
              if (fromIndex < 0) return true;
              if (fromIndex < toIndex) toIndex -= 1;
              const count = view.state.doc.childCount;
              runtime.onQuestionMoveRequest?.({ client_id: clientId, to_index: Math.min(toIndex, count - 1) });
              return true;
            }
            if (containsStructure(slice) || crossesQuestions(view.state.doc, view.state.selection)) {
              event.preventDefault(); return blocked();
            }
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (position === undefined || !questionContentTarget(view.state.doc, position)) {
              event.preventDefault(); return blocked();
            }
            return false;
          },
          transformCopied(slice, view) {
            if (!protectedDocument() || !crossesQuestions(view.state.doc, view.state.selection)) return slice;
            const text = slice.content.textBetween(0, slice.content.size, '\n');
            return new Slice(Fragment.fromArray(text.split('\n').map((line) => (
              view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line) : undefined)
            ))), 0, 0);
          },
        },
        view(view) {
          let count = uploadsKey.getState(view.state)?.size ?? 0;
          return { update(currentView) {
            const nextCount = uploadsKey.getState(currentView.state)?.size ?? 0;
            if (count !== nextCount) { count = nextCount; runtime.onUploadsChange?.({ pending: count > 0, count }); }
          } };
        },
      })];
    },
  });
}
