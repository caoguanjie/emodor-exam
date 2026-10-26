<template>
  <NodeViewWrapper
    as="section"
    class="question-block"
    :class="{ 'is-active': isActive, 'question-block--structured': canChangeStructure }"
    @click.capture="selectCard"
    data-question-block
    :data-client-id="clientId"
    :data-question-type="meta?.type ?? 'pending'"
  >
    <header class="question-block__header" contenteditable="false">
      <button v-if="canChangeStructure" type="button" data-question-drag-handle draggable="true"
        class="question-block__drag" aria-label="拖拽题目排序" @dragstart.stop="dragQuestion">
        ⠿
      </button>
      <span v-if="!displayMeta?.hideOrdinal">第 {{ ordinal }} 题</span>
      <span class="question-block__type">{{ typeLabel }}</span>
      <span v-if="!meta" class="question-block__pending">待补齐题目属性</span>
      <span v-if="canChangeStructure" class="question-block__actions">
        <el-tooltip content="复制题目" placement="top" :show-after="0">
          <button type="button" class="question-block__action" aria-label="复制题目" :disabled="!canCopy"
            @mousedown.prevent @click.stop="runtime.onQuestionCopyRequest?.(clientId)"><CopyDocument /></button>
        </el-tooltip>
        <el-tooltip content="删除题目" placement="top" :show-after="0">
          <button type="button" data-question-remove class="question-block__action question-block__remove"
            aria-label="删除题目" @mousedown.prevent @click.stop="runtime.onQuestionRemoveRequest?.(clientId)"><Delete /></button>
        </el-tooltip>
      </span>
    </header>
    <NodeViewContent class="question-block__content" />
    <footer v-if="canEditOptions" class="question-block__options" contenteditable="false">
      <button type="button" aria-label="添加选项" :disabled="optionCount >= 26"
        @mousedown.prevent @click.stop="props.editor.chain().addQuestionOption(clientId).focus().run()">
        <svg class="question-block__add-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v12M2 8h12" /></svg>
        添加选项
      </button>
    </footer>
  </NodeViewWrapper>
</template>

<script lang="ts" setup>
import { nodeViewProps, NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import { computed, ref, onBeforeUnmount } from 'vue';
import { CopyDocument, Delete } from '@element-plus/icons-vue';
import { ElTooltip } from 'element-plus';
import { TextSelection } from '@tiptap/pm/state';
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
const revision = ref(0);
const refresh = () => { revision.value += 1; };
props.editor.on('transaction', refresh);
onBeforeUnmount(() => props.editor.off('transaction', refresh));
const isActive = computed(() => {
  void revision.value;
  if (!canChangeStructure.value) return false;
  const position = props.getPos();
  if (position == null) return false;
  const { from, to } = props.editor.state.selection;
  return from >= position && from < position + props.node.nodeSize && to <= position + props.node.nodeSize;
});
const canCopy = computed(() => {
  void revision.value;
  return isEditorMutationAllowed(props.editor) && props.editor.state.doc.childCount < 100;
});
function selectCard() {
  if (!canChangeStructure.value || isActive.value || !isEditorMutationAllowed(props.editor)) return;
  const position = props.getPos();
  if (position == null) return;
  props.editor.view.dispatch(props.editor.state.tr.setSelection(TextSelection.near(props.editor.state.doc.resolve(position + 2))));
}
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
  void revision.value;
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
  margin: 0 0 16px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  background: #fff;
}

.question-block__header {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  gap: 10px;
  min-height: 36px;
  padding: 4px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
  color: var(--el-text-color-regular, #606266);
  font-family: var(--el-font-family);
  font-size: 13px;
  line-height: 20px;
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
.question-block__drag { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; height: 28px; padding: 0; border-radius: 4px; color: var(--el-text-color-placeholder); cursor: grab; font-size: 18px; }
.question-block__drag:hover { background: var(--el-fill-color-light, #f5f7fa); }
.question-block__drag:active { cursor: grabbing; }
.question-block.is-active { border-color: var(--el-color-primary, #3056d3); }
.question-block--structured:not(.is-active) :deep(.question-option__remove) { visibility: hidden; pointer-events: none; }
.question-block__actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.question-block__action { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 28px; height: 28px; padding: 6px; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-secondary, #7a8794); cursor: pointer; }
.question-block__action svg { width: 16px; height: 16px; }
.question-block__action:hover { background: var(--el-fill-color-light, #f5f7fa); color: var(--el-color-primary); }
.question-block__remove:hover { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.question-block__action:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
.question-block__action:disabled { opacity: .35; cursor: default; }

.question-block__pending,
.question-block__image-hint {
  color: var(--el-text-color-secondary, #909399);
}

.question-block__content {
  display: block;
  padding: 12px;
}

.question-block__options { padding: 0 20px 12px; }
.question-block__options button { display: inline-flex; align-items: center; gap: 8px; border: 0; background: transparent; color: var(--el-color-primary, #409eff); cursor: pointer; }
.question-block__add-icon { flex: none; width: 16px; height: 16px; }
.question-block--structured .question-block__options button { gap: 4px; padding: 4px 0; font-family: var(--el-font-family); font-size: 12px; font-weight: 400; line-height: 20px; color: #3056d3; }
.question-block--structured .question-block__add-icon { width: 12px; height: 12px; }
.question-block__options button:disabled,.question-block--structured .question-block__options button:disabled { color: var(--el-text-color-disabled, #a8abb2); cursor: default; }
</style>
