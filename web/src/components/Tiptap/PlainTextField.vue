<template>
  <div class="plain-text-field">
    <TiptapEditor
      :model-value="document"
      profile="plain"
      presentation="inline"
      :mode="readonly || disabled ? 'preview' : 'edit'"
      :show-toolbar="false"
      :show-panels="false"
      :plain-field-options="plainFieldOptions"
      @update:model-value="updateValue"
    />
    <span v-if="showWordLimit" :id="counterId" data-plain-word-count class="plain-text-field__count" role="status" aria-live="polite">
      {{ textLength }}{{ maximum === undefined ? '' : ` / ${maximum}` }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { JSONContent } from '@tiptap/core';
import { computed, getCurrentInstance } from 'vue';
import TiptapEditor from './index.vue';
import { documentToPlainText, plainTextToDocument } from './utils/plain-text';
import { normalizeMaxlength, type PlainFieldOptions } from './extensions/PlainField';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  modelValue?: string;
  readonly?: boolean;
  disabled?: boolean;
  maxlength?: string | number;
  rows?: number;
  placeholder?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  showWordLimit?: boolean;
}>(), {
  modelValue: '',
  readonly: false,
  disabled: false,
  rows: 2,
  placeholder: '',
  showWordLimit: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const document = computed(() => plainTextToDocument(props.modelValue));
const maximum = computed(() => normalizeMaxlength(props.maxlength));
const textLength = computed(() => documentToPlainText(document.value).length);
const counterId = `plain-field-count-${getCurrentInstance()!.uid}`;
const plainFieldOptions = computed<PlainFieldOptions>(() => ({
  maxlength: maximum.value,
  rows: props.rows,
  placeholder: props.placeholder,
  ariaLabel: props.ariaLabel,
  ariaLabelledby: props.ariaLabelledby,
  ariaDescribedby: [props.ariaDescribedby, props.showWordLimit ? counterId : ''].filter(Boolean).join(' '),
  disabled: props.disabled,
}));

function updateValue(value: JSONContent) {
  if (props.readonly || props.disabled) return;
  emit('update:modelValue', documentToPlainText(value));
}
</script>

<style scoped>
.plain-text-field { width: 100%; }
.plain-text-field__count { display: block; color: var(--el-text-color-secondary); font-size: 12px; text-align: right; }
:deep(.ruleexam-tiptap-plain-field .editor-main) { padding: 0; }
:deep(.ruleexam-tiptap-plain-field .ProseMirror) { padding: 8px 11px; border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); }
:deep(.ruleexam-tiptap-plain-field .ProseMirror p) { margin: 0; }
:deep(.ProseMirror p[data-placeholder]::before) { content: attr(data-placeholder); float: left; height: 0; color: var(--el-text-color-placeholder); pointer-events: none; }
</style>
