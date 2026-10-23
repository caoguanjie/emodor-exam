<template>
  <NodeViewWrapper
    as="section"
    class="question-block"
    data-question-block
    :data-client-id="clientId"
    :data-question-type="meta?.type ?? 'pending'"
  >
    <header class="question-block__header" contenteditable="false">
      <button v-if="canChangeStructure" type="button" data-question-drag-handle draggable="true"
        class="question-block__drag" aria-label="拖拽题目排序" @dragstart.stop="dragQuestion">⠿</button>
      <span v-if="!displayMeta?.hideOrdinal">第 {{ ordinal }} 题</span>
      <span class="question-block__type">{{ typeLabel }}</span>
      <span v-if="!meta" class="question-block__pending">待补齐题目属性</span>
      <button v-if="canChangeStructure" type="button" data-question-remove class="question-block__remove"
        aria-label="删除题目" @mousedown.prevent @click.stop="runtime.onQuestionRemoveRequest?.(clientId)">删除</button>
    </header>
    <NodeViewContent class="question-block__content" />
    <footer v-if="canEditOptions" class="question-block__options" contenteditable="false">
      <button type="button" aria-label="添加选项" :disabled="optionCount >= 26"
        @mousedown.prevent @click.stop="props.editor.commands.addQuestionOption(clientId)">添加选项</button>
    </footer>
  </NodeViewWrapper>
</template>

<script lang="ts" setup>
import { nodeViewProps, NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import { computed } from 'vue';
import type { QuestionNodeRuntime } from '../extensions/QuestionNodes';
import { QUESTION_DRAG_MIME } from '../extensions/QuestionEditingProtection';
import { isEditorMutationAllowed } from '../utils/widgetNodeViewRegistry';

const props = defineProps(nodeViewProps);
const clientId = computed(() => String(props.node.attrs.client_id ?? ''));
const runtime = computed<QuestionNodeRuntime>(() => {
  const extension = props.editor.extensionManager.extensions.find(({ name }) => name === 'questionBlock');
  return (extension?.options as { runtime?: QuestionNodeRuntime } | undefined)?.runtime ?? {};
});
const displayMeta = computed(() => runtime.value.getDisplayMeta?.(clientId.value));
const meta = computed(() => runtime.value.getQuestionMeta?.(clientId.value) ?? displayMeta.value);
const canChangeStructure = computed(() => runtime.value.protectStructure?.() === true
  && runtime.value.allowStructure?.() !== false && runtime.value.getMode?.() === 'edit');
const canEditOptions = computed(() => isEditorMutationAllowed(props.editor)
  && (runtime.value.getMode?.() ?? 'edit') === 'edit' && (meta.value?.type === 'single' || meta.value?.type === 'multiple'));
const optionCount = computed(() => props.node.childCount - 1);
function dragQuestion(event: DragEvent) {
  if (!canChangeStructure.value || !event.dataTransfer) { event.preventDefault(); return; }
  event.dataTransfer.setData(QUESTION_DRAG_MIME, clientId.value);
  event.dataTransfer.effectAllowed = 'move';
}
const typeLabel = computed(() => {
  switch (meta.value?.type) {
    case 'single': return '单选题';
    case 'multiple': return '多选题';
    case 'judgment': return '判断题';
    default: return '待定题型';
  }
});
const ordinal = computed(() => {
  let index = 1;
  let found = false;
  props.editor.state.doc.forEach((node) => {
    if (found || node.type.name !== 'questionBlock') return;
    if (node.attrs.client_id === clientId.value) found = true;
    else index += 1;
  });
  return index;
});
</script>

<style scoped>
.question-block {
  margin: 0 0 20px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  background: #fff;
}

.question-block__header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  user-select: none;
}

.question-block__type {
  color: var(--el-color-primary, #409eff);
}

.question-block__drag,.question-block__remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.question-block__drag { cursor: grab; font-size: 20px; }
.question-block__remove { margin-left: auto; color: var(--el-color-danger, #f56c6c); }

.question-block__pending,
.question-block__image-hint {
  color: var(--el-text-color-secondary, #909399);
}

.question-block__content {
  display: block;
  padding: 12px;
}

.question-block__options { padding: 0 20px 12px; }
.question-block__options button { border: 0; background: transparent; color: var(--el-color-primary, #409eff); cursor: pointer; }
.question-block__options button:disabled { color: var(--el-text-color-disabled, #a8abb2); cursor: default; }
</style>
