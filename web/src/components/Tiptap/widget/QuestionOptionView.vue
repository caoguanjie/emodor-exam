<template>
  <NodeViewWrapper
    as="div"
    class="question-option"
    data-question-option
    :data-option-id="optionId"
    :data-checked="String(checked)"
    :data-review="String(runtime.getMode?.() === 'review')"
    :class="reviewClasses"
  >
    <button
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
    <button v-if="canRemove" class="question-option__remove" type="button" contenteditable="false"
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
const interactionDisabled = computed(() => (
  !isEditorMutationAllowed(props.editor) || (runtime.value.getMode?.() ?? 'edit') !== 'edit'
));
const canRemove = computed(() => !interactionDisabled.value
  && (meta.value?.type === 'single' || meta.value?.type === 'multiple')
  && (context.value.node?.childCount ?? 0) - 1 > 2);
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
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 50%;
  background: #fff;
  color: var(--el-text-color-regular, #606266);
  cursor: pointer;
}

.question-option__toggle[role='checkbox'] {
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

.question-option__content {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
}

.question-option__remove { flex: none; border: 0; background: transparent; color: var(--el-color-danger, #f56c6c); cursor: pointer; }

.question-option.is-correct {
  background: var(--el-color-success-light-9, #f0f9eb);
}

.question-option.is-correct { color: var(--el-color-success-dark-2, #529b2e); }
.question-option.is-wrong { color: var(--el-color-danger, #f56c6c); background: var(--el-color-danger-light-9, #fef0f0); }
.question-option[data-review='true'] .question-option__toggle { border-color: transparent; border-radius: 50%; background: transparent; color: inherit; }
.question-option[data-review='true'].is-selected .question-option__toggle { border: 2px solid currentColor; }
.question-option__missed { flex: none; color: var(--el-color-success-dark-2, #529b2e); font-size: 12px; }
</style>
