<template>
    <NodeViewContent v-bind="$attrs" as="span" :contenteditable="!readonly"></NodeViewContent>
</template>

<script lang='ts' setup>
/*
 * @Author: caoguanjie
 * @Date: 2025-07-30 10:55:35
 * @Last Modified by: caoguanjie
 * @Last Modified time: 2025-07-30 10:59:25
 * @Description: 文本输入框
 */
import { NodeViewContent } from '@tiptap/vue-3'

withDefaults(defineProps<{ readonly?: boolean }>(), {
    readonly: false,
})

</script>
<style lang='scss' scoped>
/* @import url(); 引入css类 */
</style>
