<template>

  <span class="widget-container" ref="container" :data-checked="node.attrs.checked ? '1' : null"
    :class="{ 'is-disabled': interactionDisabled }">
    <span contenteditable="false" class="prefix-start" :aria-disabled="interactionDisabled" @click.stop="handleChecked">​</span>
    <NodeViewContent class="custom-field-content" as="span" :style="$attrs.style" data-placeholder
      :contenteditable="!interactionDisabled"></NodeViewContent>
    <span contenteditable="false" class="prefix-end">​</span>
  </span>
</template>

<script setup lang='ts'>

import { NodeViewRendererProps, NodeViewContent } from '@tiptap/vue-3';
import { useDebounceFn } from '@vueuse/core';
import { computed, onUnmounted, toRefs, watch } from 'vue';
import { isEditorMutationAllowed } from '../utils/widgetNodeViewRegistry';

const props = defineProps({
  focus: {
    type: Boolean,
    default: false
  },
  nodeViewProps: {
    type: Object as () => NodeViewRendererProps,
    default: () => ({})
  },
  readonly: {
    type: Boolean,
    default: false
  }
})
const { node } = toRefs(props.nodeViewProps);
const interactionDisabled = computed(() => (
  props.readonly || !props.nodeViewProps.editor || !isEditorMutationAllowed(props.nodeViewProps.editor)
));
function handleChecked() {
  if (interactionDisabled.value) return;
  const { editor, node } = props.nodeViewProps;
  editor.commands.updateFieldAttrs(node.attrs.id, node.attrs.group, {
    checked: !node.attrs.checked
  })
}
type PendingLabelUpdate = {
  generation: number;
  id: string;
  group: string | null;
  label: string;
};

let updateGeneration = 0;
const updateDebounce = useDebounceFn((pending: PendingLabelUpdate) => {
  const { editor, node } = props.nodeViewProps;
  if (interactionDisabled.value
    || pending.generation !== updateGeneration
    || node.attrs.id !== pending.id
    || node.attrs.group !== pending.group) return;
  editor.commands.updateFieldAttrs(pending.id, pending.group, { label: pending.label })
}, 500)
function cancelPendingUpdate() {
  updateGeneration += 1;
  updateDebounce.cancel();
}
const stopWatch = watch(() => props.nodeViewProps.node.textContent, (newText) => {
  if (interactionDisabled.value) return;
  const { id, group } = props.nodeViewProps.node.attrs;
  updateDebounce({ generation: updateGeneration, id, group, label: newText })
})
const stopGuardWatch = watch([
  () => props.nodeViewProps.node.attrs.id,
  () => props.nodeViewProps.node.attrs.group,
  interactionDisabled,
], ([id, group, disabled], previous) => {
  if (disabled || (previous && (id !== previous[0] || group !== previous[1]))) {
    cancelPendingUpdate();
  }
}, { flush: 'sync' });
onUnmounted(() => {
  stopWatch()
  stopGuardWatch()
  cancelPendingUpdate()
})
</script>
