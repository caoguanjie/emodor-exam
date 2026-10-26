<template>
  <NodeViewWrapper
    as="div"
    class="question-option"
    data-question-option
    :data-option-id="optionId"
    :data-checked="String(checked)"
    :data-review="String(runtime.getMode?.() === 'review')"
    :class="[reviewClasses, { 'question-option--manual': manualActions }]"
    @dragover="acceptOptionDrag"
    @drop="dropOption"
  >
    <span v-if="canReorder && manualActions" class="question-option__sort" contenteditable="false">
      <button type="button" data-option-drag-handle draggable="true" class="question-option__drag"
        :aria-label="`拖拽选项 ${label} 排序`" @dragstart.stop="dragOption">⠿</button>
      <span class="question-option__order">
        <button type="button" :aria-label="`上移选项 ${label}`" :title="`上移选项 ${label}`" :disabled="optionIndex === 0" @mousedown.prevent
          @click.stop="props.editor.commands.moveQuestionOption(optionId, optionIndex - 1)">↑</button>
        <button type="button" :aria-label="`下移选项 ${label}`" :title="`下移选项 ${label}`" :disabled="optionIndex === optionCount - 1" @mousedown.prevent
          @click.stop="props.editor.commands.moveQuestionOption(optionId, optionIndex + 1)">↓</button>
      </span>
    </span>
    <button v-if="canReorder && !manualActions" type="button" data-option-drag-handle draggable="true" contenteditable="false"
      class="question-option__drag" :aria-label="`拖拽选项 ${label} 排序`" @dragstart.stop="dragOption">⠿</button>
    <button
      v-if="manualActions"
      class="question-option__toggle"
      type="button"
      contenteditable="false"
      data-option-letter
      style="display: inline-flex; align-items: center; justify-content: center"
      :disabled="interactionDisabled"
      :role="meta?.type === 'multiple' ? 'checkbox' : 'radio'"
      :aria-checked="checked"
      :class="{ 'question-option__toggle--multiple': meta?.type === 'multiple' }"
      @mousedown.prevent
      @click="toggleChecked"
    >
      {{ label }}
    </button>
    <button
      v-else
      class="question-option__toggle"
      type="button"
      contenteditable="false"
      :disabled="interactionDisabled"
      :role="meta?.type === 'multiple' ? 'checkbox' : 'radio'"
      :aria-checked="checked"
      @mousedown.prevent
      @click="toggleChecked"
    >
      {{ label }}
    </button>
    <NodeViewContent
      class="question-option__content"
      data-question-option-content
      :contenteditable="contentEditable"
    />
    <span v-if="manualActions" class="question-option__actions" contenteditable="false">
      <span v-if="checked" class="question-option__answer-label" data-answer-label>✓ 正确答案</span>
      <button v-if="checked && meta?.type === 'multiple' && !interactionDisabled" type="button" class="question-option__unset-answer" data-unset-answer
        :aria-label="`取消选项 ${label} 的正确答案`" @mousedown.prevent @click.stop="toggleChecked">取消答案</button>
      <button v-else-if="!checked && !interactionDisabled" type="button" class="question-option__set-answer" data-set-answer
        :aria-label="`设选项 ${label} 为正确答案`" @mousedown.prevent @click.stop="toggleChecked">设为答案</button>
      <button v-if="canRemove" class="question-option__remove" type="button" :aria-label="`删除选项 ${label}`"
        @mousedown.prevent @click.stop="props.editor.commands.removeQuestionOption(optionId)">×</button>
    </span>
    <span v-if="canReorder && !manualActions" class="question-option__order" contenteditable="false">
      <button type="button" :aria-label="`上移选项 ${label}`" :disabled="optionIndex === 0" @mousedown.prevent
        @click.stop="props.editor.commands.moveQuestionOption(optionId, optionIndex - 1)">上移</button>
      <button type="button" :aria-label="`下移选项 ${label}`" :disabled="optionIndex === optionCount - 1" @mousedown.prevent
        @click.stop="props.editor.commands.moveQuestionOption(optionId, optionIndex + 1)">下移</button>
    </span>
    <button v-if="canRemove && !manualActions" class="question-option__remove" type="button" contenteditable="false"
      :aria-label="`删除选项 ${label}`" @mousedown.prevent
      @click.stop="props.editor.commands.removeQuestionOption(optionId)">删除</button>
    <span v-if="review?.missed" class="question-option__missed">漏选</span>
  </NodeViewWrapper>
</template>

<script lang="ts" setup>
import { nodeViewProps, NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import type { Transaction } from '@tiptap/pm/state';
import { computed, onBeforeUnmount, ref } from 'vue';
import type { QuestionNodeRuntime } from '../extensions/QuestionNodes';
import { isEditorMutationAllowed } from '../utils/widgetNodeViewRegistry';

const props = defineProps(nodeViewProps);
// Retained option nodes do not receive new node props when a sibling is added or removed.
// Invalidate their parent context without keeping a second document or option list.
const documentRevision = ref(0);
const refreshContext = ({ transaction }: { transaction: Transaction }) => {
  if (!transaction.docChanged) return;
  documentRevision.value += 1;
};
props.editor.on('transaction', refreshContext);
onBeforeUnmount(() => props.editor.off('transaction', refreshContext));
const optionId = computed(() => String(props.node.attrs.option_id ?? ''));
const runtime = computed<QuestionNodeRuntime>(() => {
  const extension = props.editor.extensionManager.extensions.find(({ name }) => name === 'questionOption');
  return (extension?.options as { runtime?: QuestionNodeRuntime } | undefined)?.runtime ?? {};
});

const context = computed(() => {
  void documentRevision.value;
  const position = typeof props.getPos === 'function' ? props.getPos() : 0;
  const $position = props.editor.state.doc.resolve(Math.max(0, Number(position)));
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.type.name !== 'questionBlock') continue;
    return { clientId: String(node.attrs.client_id), node };
  }
  return { clientId: '', node: null };
});
const meta = computed(() => runtime.value.getQuestionMeta?.(context.value.clientId)
  ?? runtime.value.getDisplayMeta?.(context.value.clientId));
const review = computed(() => runtime.value.getMode?.() === 'review'
  ? runtime.value.getReviewState?.(context.value.clientId)?.find((item) => item.option_id === optionId.value)
  : undefined);
const checked = computed(() => runtime.value.getMode?.() === 'edit' || !runtime.value.getMode
  ? Boolean(props.node.attrs.checked) : Boolean(review.value?.selected));
const manualActions = computed(() => runtime.value.showAnswerLabels?.() === true);
const interactionDisabled = computed(() => (
  !isEditorMutationAllowed(props.editor) || (runtime.value.getMode?.() ?? 'edit') !== 'edit'
));
const canRemove = computed(() => !interactionDisabled.value
  && (meta.value?.type === 'single' || meta.value?.type === 'multiple')
  && (context.value.node?.childCount ?? 0) - 1 > 2);
const canReorder = computed(() => !interactionDisabled.value && runtime.value.canReorderOptions?.() === true
  && (meta.value?.type === 'single' || meta.value?.type === 'multiple'));
const optionCount = computed(() => (context.value.node?.childCount ?? 1) - 1);
const optionIndex = computed(() => label.value.charCodeAt(0) - 65);
const OPTION_DRAG_MIME = 'application/x-ruleexam-question-option';
function dragOption(event: DragEvent) {
  if (!canReorder.value || !event.dataTransfer) { event.preventDefault(); return; }
  event.dataTransfer.setData(OPTION_DRAG_MIME, JSON.stringify({ client_id: context.value.clientId, option_id: optionId.value }));
  event.dataTransfer.effectAllowed = 'move';
}
function acceptOptionDrag(event: DragEvent) {
  if (canReorder.value && event.dataTransfer?.types?.includes(OPTION_DRAG_MIME)) event.preventDefault();
}
function dropOption(event: DragEvent) {
  if (!canReorder.value) return;
  const raw = event.dataTransfer?.getData(OPTION_DRAG_MIME);
  if (!raw) return;
  event.preventDefault(); event.stopPropagation();
  try {
    const data = JSON.parse(raw);
    if (data.client_id === context.value.clientId) props.editor.commands.moveQuestionOption(data.option_id, optionIndex.value);
  } catch { /* Ignore foreign drag payloads. */ }
}
const contentEditable = computed(() => !interactionDisabled.value && meta.value?.type !== 'judgment');
const label = computed(() => {
  const parent = context.value.node;
  if (!parent) return '';
  let optionIndex = 0;
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.child(index);
    if (child.type.name !== 'questionOption') continue;
    if (child.attrs.option_id === optionId.value) return String.fromCharCode(65 + optionIndex);
    optionIndex += 1;
  }
  return '';
});
const reviewClasses = computed(() => ({
  'is-selected': review.value?.selected,
  'is-correct': review.value?.correct,
  'is-missed': review.value?.missed,
  'is-wrong': review.value?.selected && !review.value.correct,
}));

function toggleChecked() {
  if (interactionDisabled.value) return;
  const next = meta.value?.type === 'multiple' ? !props.node.attrs.checked : true;
  props.editor.commands.setQuestionOptionChecked(optionId.value, next);
}
</script>

<style scoped>
.question-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 4px;
}

.question-option__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 50%;
  background: #fff;
  color: var(--el-text-color-regular, #606266);
  cursor: pointer;
  line-height: 1;
}

.question-option__toggle[role='checkbox'],
.question-option__toggle--multiple {
  border-radius: 4px;
}

.question-option[data-checked='true'] .question-option__toggle {
  border-color: var(--el-color-primary, #409eff);
  background: var(--el-color-primary, #409eff);
  color: #fff;
}

.question-option__toggle:disabled {
  cursor: default;
}
.question-option--manual .question-option__toggle { user-select: none; }

.question-option__content {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
}

.question-option__remove { flex: none; border: 0; background: transparent; color: var(--el-color-danger, #f56c6c); cursor: pointer; }
.question-option__drag { flex: none; border: 0; background: transparent; color: var(--el-text-color-placeholder); cursor: grab; font-size: 18px; }
.question-option__order { display: flex; flex: none; gap: 4px; }
.question-option__order button { padding: 3px; border: 0; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; }
.question-option__order button:disabled { opacity: .35; cursor: default; }
.question-option__answer-label { flex: none; padding: 3px 7px; border-radius: 4px; background: var(--el-color-primary-light-9, #ecf5ff); color: var(--el-color-primary, #409eff); font-size: 12px; line-height: 20px; white-space: nowrap; }
.question-option__actions { display: flex; flex: none; align-items: center; gap: 8px; min-height: 26px; }
.question-option__set-answer,.question-option__unset-answer { padding: 3px 0; border: 0; background: transparent; color: var(--el-color-primary, #409eff); font-size: 12px; line-height: 20px; white-space: nowrap; cursor: pointer; opacity: 0; pointer-events: none; }
.question-option__unset-answer { color: var(--el-text-color-secondary, #909399); }
.question-option--manual:hover .question-option__set-answer,.question-option--manual:focus-within .question-option__set-answer,
.question-option--manual:hover .question-option__unset-answer,.question-option--manual:focus-within .question-option__unset-answer { opacity: 1; pointer-events: auto; }
.question-option--manual .question-option__remove { width: 24px; height: 24px; padding: 0; border-radius: 4px; color: var(--el-text-color-placeholder, #a8abb2); font-size: 19px; line-height: 24px; }
.question-option--manual .question-option__remove:hover,.question-option--manual .question-option__remove:focus-visible { background: var(--el-color-danger-light-9, #fef0f0); color: var(--el-color-danger, #f56c6c); }
.question-option__sort { display: flex; flex-direction: row-reverse; flex: none; align-items: center; gap: 0; }
.question-option__sort .question-option__drag { padding: 0; width: 14px; }
.question-option__sort .question-option__order { flex-direction: column; gap: 0; opacity: 0; pointer-events: none; }
.question-option__sort .question-option__order button { width: 18px; height: 13px; padding: 0; font-size: 12px; line-height: 13px; }
.question-option--manual:hover .question-option__order,.question-option--manual:focus-within .question-option__order { opacity: 1; pointer-events: auto; }

.question-option.is-correct {
  background: var(--el-color-success-light-9, #f0f9eb);
}

.question-option.is-correct { color: var(--el-color-success-dark-2, #529b2e); }
.question-option.is-wrong { color: var(--el-color-danger, #f56c6c); background: var(--el-color-danger-light-9, #fef0f0); }
.question-option[data-review='true'] .question-option__toggle { border-color: transparent; border-radius: 50%; background: transparent; color: inherit; }
.question-option[data-review='true'].is-selected .question-option__toggle { border: 2px solid currentColor; }
.question-option__missed { flex: none; color: var(--el-color-success-dark-2, #529b2e); font-size: 12px; }
</style>
