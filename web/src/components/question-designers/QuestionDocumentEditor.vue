<template>
  <section class="question-editor">
    <div v-if="!disabled && showPanels && allowStructure" class="question-editor__actions">
      <el-button v-for="item in types" :key="item.type" size="small" @click="addQuestion(item.type)">添加{{ item.label }}</el-button>
      <span>每份最多 100 题；图片选项仍使用单选或多选题。</span>
    </div>
    <TiptapEditor ref="editor" :model-value="local.content" :questions="local.questions" profile="question"
      :mode="disabled ? 'preview' : 'edit'" presentation="inline" :media-resolver="mediaResolver"
      :show-toolbar="showToolbar" :show-panels="showPanels" :compact="compact" protect-question-structure
      :allow-structure="allowStructure"
      @update:model-value="changeContent" @question-meta-change="changeMeta" @selection-change="changeSelection"
      @edit-blocked="emit('edit-blocked', $event)" @upload-state-change="emit('upload-state-change', $event)"
      @remove-request="emit('remove-request', $event)" @move-request="emit('move-request', $event)"
      @save="emit('save', clone(local))">
      <template #left-sidebar><slot name="libraries" /></template>
      <template #question-settings="{ client_id, meta, answer_summary, readonly, change }">
        <QuestionSetting v-if="client_id" :key="client_id" :client-id="client_id" :meta="meta" :answer-summary="answer_summary"
          :categories="categories" :regulations="regulations" :concept-api="conceptApi || noConceptApi" :concept-access="conceptAccess || noConceptAccess"
          :concept-options-api="conceptOptionsApi"
          :readonly="readonly" :change="change" :media-resolver="mediaResolver" :can-upload-media="canUploadMedia" />
      </template>
    </TiptapEditor>
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import type { JSONContent, QuestionAuthoringDocument, QuestionMeta } from '../../api/question-document-types';
import type { QuestionConceptAccess, QuestionConceptApi, QuestionConceptOptionsApi } from '../../api/question-authoring';
import type { QuestionType } from '../../api/training-types';
import TiptapEditor from '../Tiptap/index.vue';
import QuestionSetting, { type QuestionRegulationOption } from '../Tiptap/components/QuestionSetting.vue';
import { nanoid } from '../Tiptap/extensions/WidgetNodes';
import { isControlledMediaAssetId, type MediaResolver } from '../Tiptap/extensions/MediaImage';
import { beginQuestionImageUpload, cancelQuestionImageUpload, questionImageUploadAnchor, questionContentTarget,
  QUESTION_STRUCTURE_META } from '../Tiptap/extensions/QuestionEditingProtection';
import { isEditorMutationAllowed } from '../Tiptap/utils/widgetNodeViewRegistry';

export interface QuestionStructureChange {
  kind: 'add' | 'remove' | 'move';
  client_id: string;
  from_index?: number;
  to_index?: number;
  client_ids: string[];
  document: QuestionAuthoringDocument;
}

const props = withDefaults(defineProps<{
  modelValue: QuestionAuthoringDocument;
  categories?: Array<{ id: string; name: string }>;
  regulations?: QuestionRegulationOption[];
  defaultCategoryId?: string;
  conceptApi?: QuestionConceptApi;
  conceptAccess?: QuestionConceptAccess;
  conceptOptionsApi?: QuestionConceptOptionsApi;
  disabled?: boolean;
  canUploadMedia?: boolean;
  mediaResolver?: MediaResolver;
  showToolbar?: boolean;
  showPanels?: boolean;
  compact?: boolean;
  allowStructure?: boolean;
}>(), { categories: () => [], regulations: () => [], defaultCategoryId: '', disabled: false, canUploadMedia: false,
  showToolbar: true, showPanels: true, compact: false, allowStructure: true });
const emit = defineEmits<{
  'update:modelValue': [value: QuestionAuthoringDocument];
  save: [value: QuestionAuthoringDocument];
  'selection-change': [value: { client_id: string | null; option_id: string | null }];
  'structure-change': [value: QuestionStructureChange];
  'edit-blocked': [message: string];
  'upload-state-change': [state: { pending: boolean; count: number }];
  'remove-request': [clientId: string];
  'move-request': [change: { client_id: string; to_index: number }];
}>();
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
const noConceptAccess: QuestionConceptAccess = { read: false, create: false, edit: false, delete: false };
const noConceptApi: QuestionConceptApi = {
  async list() { return { items: [], total: 0, page: 1, page_size: 20 }; },
  async create() { throw new Error('考点管理已停用'); },
  async update() { throw new Error('考点管理已停用'); },
  async remove() { throw new Error('考点管理已停用'); },
};
const local = ref(clone(props.modelValue));
// Creation commands announce the type before Tiptap dispatches their content.
// Retain only that transaction's initial metadata, never arbitrary late patches.
const pendingCreations = new Map<string, QuestionMeta>();
const editor = ref<InstanceType<typeof TiptapEditor> | null>(null);
const selected = ref<{ client_id: string | null; option_id: string | null }>({ client_id: null, option_id: null });
const types: Array<{ type: QuestionType; label: string }> = [{ type: 'single', label: '单选题' }, { type: 'multiple', label: '多选题' }, { type: 'judgment', label: '判断题' }];
let structure: Omit<QuestionStructureChange, 'client_ids' | 'document'> | null = null;
const rich = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });

function publish(value: QuestionAuthoringDocument) {
  if (props.disabled) return;
  local.value = clone(value); emit('update:modelValue', clone(value));
}
function metadata(type: QuestionType): QuestionMeta {
  return { type, category_id: props.defaultCategoryId, difficulty: 'easy',
    regulation_id: null, regulation_version_id: null, score_cents: 500, analysis: rich() };
}
function changeContent(content: JSONContent) {
  const blocks = content.content || [];
  const orderedIds = blocks.map((block) => String(block.attrs?.client_id));
  const oldIds = (local.value.content.content || []).map((block) => String(block.attrs?.client_id));
  if (blocks.some((block) => block.type !== 'questionBlock') || new Set(orderedIds).size !== orderedIds.length
    || orderedIds.some((id) => !id || id === 'undefined' || id === 'null')
    || (!structure && JSON.stringify(orderedIds) !== JSON.stringify(oldIds))) {
    editor.value?.setContent(local.value.content);
    emit('edit-blocked', '请使用题目结构命令');
    return;
  }
  const ids = new Set(orderedIds);
  const questions = Object.fromEntries(Object.entries(local.value.questions).filter(([id]) => ids.has(id)));
  for (const id of ids) {
    const pending = pendingCreations.get(id);
    if (pending && !questions[id]) questions[id] = pending;
    pendingCreations.delete(id);
  }
  const document = { ...local.value, content, questions };
  if (structure) emit('structure-change', { ...structure, client_ids: orderedIds, document: clone(document) });
  publish(document);
}
function changeMeta({ client_id, patch }: { client_id: string; patch: Partial<QuestionMeta> }) {
  if (props.disabled) return;
  if (!local.value.content.content?.some((node) => node.attrs?.client_id === client_id)) {
    if (Object.keys(patch).length !== 1 || !types.some((item) => item.type === patch.type)) return;
    const pending = metadata(patch.type!);
    pendingCreations.set(client_id, pending);
    void nextTick(() => {
      if (pendingCreations.get(client_id) === pending) pendingCreations.delete(client_id);
    });
    return;
  }
  const existing = local.value.questions[client_id];
  if (!existing && !patch.type) return;
  const meta = { ...(existing || metadata(patch.type!)), ...patch };
  publish({ ...local.value, questions: { ...local.value.questions, [client_id]: meta } });
}
function getEditor() { return editor.value?.getEditor(); }
function applyStructure(transaction: Transaction, change: Omit<QuestionStructureChange, 'client_ids' | 'document'>) {
  const instance = getEditor();
  if (!instance || props.disabled || !props.allowStructure || !isEditorMutationAllowed(instance)) return false;
  structure = change;
  try {
    instance.view.dispatch(closeHistory(transaction).setMeta(QUESTION_STRUCTURE_META, change).setMeta('addToHistory', false));
    return true;
  } finally { structure = null; }
}
function addQuestion(type: QuestionType): string | null {
  const instance = getEditor();
  if (!instance || props.disabled || !props.allowStructure || !types.some((item) => item.type === type)
    || Object.keys(local.value.questions).length >= 100) return null;
  const clientId = nanoid();
  const labels = type === 'judgment' ? ['正确', '错误'] : ['', ''];
  const options: JSONContent[] = labels.map((label) => ({ type: 'questionOption', attrs: { option_id: nanoid(), checked: false },
    content: [{ type: 'paragraph', ...(label ? { content: [{ type: 'text', text: label }] } : {}) }] }));
  const block = instance.schema.nodeFromJSON({
    type: 'questionBlock', attrs: { client_id: clientId }, content: [{ type: 'questionStem', content: [{ type: 'paragraph' }] }, ...options],
  });
  pendingCreations.set(clientId, metadata(type));
  const position = instance.state.doc.content.size;
  const transaction = instance.state.tr.insert(position, block);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + 3)));
  if (!applyStructure(transaction, { kind: 'add', client_id: clientId, to_index: instance.state.doc.childCount })) {
    pendingCreations.delete(clientId); return null;
  }
  editor.value?.focus(clientId);
  return clientId;
}
function blocksWithPositions() {
  const blocks: Array<{ clientId: string; position: number; size: number }> = [];
  getEditor()?.state.doc.forEach((node, position) => blocks.push({ clientId: String(node.attrs.client_id), position, size: node.nodeSize }));
  return blocks;
}
function removeQuestion(clientId: string): boolean {
  const instance = getEditor();
  const blocks = blocksWithPositions();
  const index = blocks.findIndex((block) => block.clientId === clientId);
  if (!instance || index < 0 || props.disabled || !props.allowStructure) return false;
  const block = blocks[index];
  return applyStructure(instance.state.tr.delete(block.position, block.position + block.size),
    { kind: 'remove', client_id: clientId, from_index: index });
}
function moveQuestion(clientId: string, toIndex: number): boolean {
  const instance = getEditor();
  const blocks = blocksWithPositions();
  const fromIndex = blocks.findIndex((block) => block.clientId === clientId);
  if (!instance || props.disabled || !props.allowStructure || fromIndex < 0 || !Number.isInteger(toIndex)
    || toIndex < 0 || toIndex >= blocks.length || toIndex === fromIndex) return false;
  const block = blocks[fromIndex];
  const node = instance.state.doc.child(fromIndex);
  const transaction = instance.state.tr.delete(block.position, block.position + block.size);
  const remaining = blocks.filter((_, index) => index !== fromIndex);
  const targetPosition = remaining.slice(0, toIndex).reduce((size, item) => size + item.size, 0);
  transaction.insert(targetPosition, node);
  return applyStructure(transaction, { kind: 'move', client_id: clientId, from_index: fromIndex, to_index: toIndex });
}
function canInsertImage() {
  const instance = getEditor();
  if (!instance || props.disabled || !props.canUploadMedia || !isEditorMutationAllowed(instance)) return false;
  const from = questionContentTarget(instance.state.doc, instance.state.selection.from);
  const to = questionContentTarget(instance.state.doc, instance.state.selection.to);
  return Boolean(from && to && from.clientId === to.clientId && from.optionId === to.optionId);
}
function insertImage(assetId: string, alt?: string): boolean {
  return canInsertImage() && Boolean(getEditor()?.commands.insertMediaImage({ asset_id: assetId, alt }));
}
function beginImageUpload(): string | null {
  const instance = getEditor();
  if (!instance || !canInsertImage()) return null;
  const token = nanoid();
  return beginQuestionImageUpload(instance, token) ? token : null;
}
function completeImageUpload(token: string, assetId: string, alt?: string): boolean {
  const instance = getEditor();
  if (!instance || props.disabled || !props.canUploadMedia || !isControlledMediaAssetId(assetId)
    || (alt !== undefined && Array.from(alt).length > 500)) return false;
  const anchor = questionImageUploadAnchor(instance, token);
  if (!anchor) { emit('edit-blocked', '原插入位置已失效，请重新选择图片插入位置'); return false; }
  instance.commands.setTextSelection(anchor.position);
  const inserted = instance.commands.insertMediaImage({ asset_id: assetId, alt });
  if (inserted) cancelQuestionImageUpload(instance, token);
  return inserted;
}
function cancelImageUpload(token: string) {
  const instance = getEditor();
  if (instance) cancelQuestionImageUpload(instance, token);
}
function changeSelection(value: { client_id: string | null; option_id: string | null }) {
  selected.value = value; emit('selection-change', value);
}
watch(() => props.modelValue, (value) => {
  if (JSON.stringify(value) !== JSON.stringify(local.value)) {
    pendingCreations.clear();
    local.value = clone(value);
  }
}, { deep: true, flush: 'sync' });
defineExpose({ focus: (clientId?: string) => editor.value?.focus(clientId), getEditor, addQuestion, removeQuestion,
  moveQuestion, insertImage, canInsertImage, beginImageUpload, completeImageUpload, cancelImageUpload });
</script>

<style scoped>
.question-editor__actions,.question-editor__media { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:12px; }
.question-editor__actions span { font-size:12px; color:var(--el-text-color-secondary); }
.question-editor__media .media-upload { max-width:320px; }
</style>
