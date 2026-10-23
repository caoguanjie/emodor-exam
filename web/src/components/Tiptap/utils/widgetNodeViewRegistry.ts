/*
 * NodeView 与运行时状态都按 Editor 实例隔离。
 * 相同 widget id 可以同时存在于正文、解析和预览实例中，卸载一个实例不会清空其它实例。
 */

import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { reactive, type ComponentInternalInstance } from 'vue';

export const CONTROLLED_UPDATE_META = 'ruleexamControlledUpdate';

type NodeViewInstance = ComponentInternalInstance;

type EditorRuntime = {
  controlledUpdateDepth: number;
  mutationEnabled: boolean;
};

const nodeViewsByEditor = new WeakMap<Editor, Map<string, NodeViewInstance>>();
const editorRuntime = new WeakMap<Editor, EditorRuntime>();

function getRuntime(editor: Editor): EditorRuntime {
  let runtime = editorRuntime.get(editor);
  if (!runtime) {
    runtime = reactive({ controlledUpdateDepth: 0, mutationEnabled: editor.isEditable });
    editorRuntime.set(editor, runtime);
  }
  return runtime;
}

export function registerNodeView(editor: Editor, id: string, instance: NodeViewInstance) {
  let registry = nodeViewsByEditor.get(editor);
  if (!registry) {
    registry = new Map<string, NodeViewInstance>();
    nodeViewsByEditor.set(editor, registry);
  }
  registry.set(id, instance);
}

export function unregisterNodeView(editor: Editor, id: string) {
  const registry = nodeViewsByEditor.get(editor);
  registry?.delete(id);
  if (registry?.size === 0) nodeViewsByEditor.delete(editor);
}

export function getNodeView(editor: Editor, id: string) {
  return nodeViewsByEditor.get(editor)?.get(id);
}

export function clearNodeView(editor: Editor) {
  nodeViewsByEditor.delete(editor);
}

export function setEditorMutationEnabled(editor: Editor, enabled: boolean) {
  getRuntime(editor).mutationEnabled = enabled;
}

export function beginEditorControlledUpdate(editor: Editor) {
  getRuntime(editor).controlledUpdateDepth += 1;
}

export function endEditorControlledUpdate(editor: Editor) {
  const runtime = getRuntime(editor);
  runtime.controlledUpdateDepth = Math.max(0, runtime.controlledUpdateDepth - 1);
}

export function isEditorControlledUpdate(editor: Editor): boolean {
  return getRuntime(editor).controlledUpdateDepth > 0;
}

export function isEditorMutationAllowed(editor: Editor): boolean {
  const runtime = getRuntime(editor);
  return runtime.mutationEnabled && editor.isEditable && runtime.controlledUpdateDepth === 0;
}

export function canApplyEditorTransaction(editor: Editor, transaction: Transaction): boolean {
  return transaction.getMeta(CONTROLLED_UPDATE_META) === true || isEditorMutationAllowed(editor);
}

export function disposeEditorRuntime(editor: Editor) {
  nodeViewsByEditor.delete(editor);
  editorRuntime.delete(editor);
}
