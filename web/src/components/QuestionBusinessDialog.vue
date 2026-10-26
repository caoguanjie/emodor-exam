<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="760px"
    :class="dialogClass"
    :append-to="appendTo"
    :align-center="mode === 'preview'"
    destroy-on-close
    :before-close="beforeClose"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template v-if="$slots['title-extra']" #header="{ titleId, titleClass }">
      <div class="question-business-dialog__heading">
        <span :id="titleId" :class="titleClass">{{ title }}</span>
        <slot name="title-extra" />
      </div>
    </template>
    <slot v-if="mode === 'preview'" name="preview" />
    <div
      v-if="mode !== 'preview' || preserveEditor"
      v-show="mode !== 'preview'"
      class="question-business-dialog__editor-pane"
    >
      <slot name="editor" />
    </div>

    <template #footer>
      <slot v-if="mode === 'preview'" name="preview-footer" />
      <slot v-else name="editor-footer" />
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type QuestionDialogMode = 'preview' | 'create' | 'edit';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  mode: QuestionDialogMode;
  appendTo?: string | HTMLElement;
  beforeClose?: (done: () => void) => void;
  preserveEditor?: boolean;
}>(), {
  appendTo: 'body',
  beforeClose: undefined,
  preserveEditor: false,
});

const emit = defineEmits<{
  'update:modelValue': [visible: boolean];
  closed: [];
}>();

const title = computed(() => props.mode === 'preview' ? '题目预览' : props.mode === 'create' ? '新增试题' : '修订试题');
const dialogClass = computed(() => [
  'question-business-dialog',
  props.mode === 'preview' ? 'question-preview-dialog' : 're-form-dialog manual-question-dialog',
]);
</script>

<style>
.question-business-dialog__heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 14px;
  min-width: 0;
}
.question-business-dialog__editor-pane {
  display: contents;
}
.el-dialog.question-business-dialog.question-preview-dialog {
  display: flex;
  flex-direction: column;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 64px);
  padding: 0;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 16px 48px rgb(15 23 42 / 20%);
}
.question-preview-dialog .el-dialog__header {
  flex: 0 0 52px;
  min-height: 52px;
  margin: 0;
  padding: 14px 48px 14px 24px;
  border-bottom: 1px solid var(--re-border, #e6eaee);
  box-sizing: border-box;
  background: var(--re-surface, #fff);
}
.question-preview-dialog .el-dialog__title {
  display: block;
  color: var(--re-text, #323233);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.question-preview-dialog .el-dialog__headerbtn {
  top: 0;
  right: 8px;
  width: 44px;
  height: 52px;
}
.question-preview-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 20px 24px;
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--re-surface, #fff);
}
.question-preview-dialog .el-dialog__footer {
  flex: 0 0 60px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-height: 60px;
  padding: 0 24px;
  border-top: 1px solid var(--re-border, #e6eaee);
  box-sizing: border-box;
  background: var(--re-surface, #fff);
}
.question-preview-dialog .el-dialog__footer .el-button {
  min-width: 68px;
  height: 32px;
  margin-left: 0;
}
</style>
