<template>
    <date-picker v-model:value="dateModel" v-model:open="isFocus" :format="dateFormat" :type="dateType"
        :disabled="interactionDisabled"
        popup-class="ruleexam-tiptap-date-picker-popup" valueType="format" :clearable="false">
        <template #input>
            <NodeViewContent as="span" v-bind="$attrs"></NodeViewContent>
        </template>
        <template #footer>
            <button class="mx-btn mx-btn-text" :disabled="interactionDisabled" @click="handlecClear">
                清除
            </button>
            <button class="mx-btn mx-btn-text" :disabled="interactionDisabled" @click="handleToday">
                今天
            </button>
            <button class="mx-btn mx-btn-text" :disabled="interactionDisabled" @click="handleConfirm">
                确定
            </button>
        </template>
    </date-picker>
</template>

<script lang='ts' setup>
/*
 * @Author: caoguanjie
 * @Date: 2025-07-30 16:06:10
 * @Last Modified by: caoguanjie
 * @Last Modified time: 2025-08-20 11:12:06
 */
import DatePicker from 'vue-datepicker-next';
import 'vue-datepicker-next/index.css';
import 'vue-datepicker-next/locale/zh-cn.es';
import { NodeViewRendererProps, NodeViewContent } from '@tiptap/vue-3'
import moment from 'moment';
import { computed, effectScope, nextTick, onUnmounted, ref, watch } from 'vue';
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
const isFocus = ref(props.focus);
const interactionDisabled = computed(() => (
    props.readonly || !props.nodeViewProps.editor || !isEditorMutationAllowed(props.nodeViewProps.editor)
));
// 使用计算属性确保数据源唯一
const dateText = computed(() => props.nodeViewProps.node.textContent)
const dateFormat = computed(() => props.nodeViewProps.node.attrs.dateFormat)
// 转换为日期对象（用于选择器）
const dateModel = computed({
    get() {
        if (!dateText.value) return null
        const date = moment(dateText.value, dateFormat.value, true)
        return date.isValid() ? date.format(dateFormat.value) : null
    },
    set(value: string) {
        if (interactionDisabled.value) return;
        // console.log('dateValue', value)
        const { editor, node } = props.nodeViewProps
        editor.commands.insertFieldText(node.attrs.id, value)
    }
})
// 根据格式返回类型
const dateType = computed(() => {
    const formatValue = dateFormat.value;
    // 检查是否是时间格式（包含 HH:mm 或类似时间部分）
    if (formatValue.includes('HH:mm') || formatValue.includes('hh:mm')) {
        return 'datetime';
    } else if (formatValue === 'YYYY-MM' || formatValue === 'YYYY/MM' ||
        formatValue === 'MM-YYYY' || formatValue === 'MM/YYYY') {
        return 'month';
    } else {
        return 'date';
    }
})

// 清除
function handlecClear() {
    if (interactionDisabled.value) return;
    dateModel.value = ''
    isFocus.value = false;
}
// 今天
function handleToday() {
    if (interactionDisabled.value) return;
    dateModel.value = moment().format(dateFormat.value)
    isFocus.value = false;
}
// 确定
function handleConfirm() {
    if (interactionDisabled.value) return;
    // 空日期沿用“确定即今天”；非法的非空原值必须原样保留。
    if (!dateModel.value && !dateText.value) {
        dateModel.value = moment().format(dateFormat.value)
    }
    isFocus.value = false;
}
const scope = effectScope();
scope.run(() => {
    // 响应格式变化：直接更新节点内容
    watch(dateFormat, (newVal, oldVal) => {
        if (!dateText.value || interactionDisabled.value) return

        const date = moment(dateText.value, oldVal, true)
        if (!date.isValid()) {
            console.error(`日期解析失败: ${dateText.value} with format ${oldVal}`)
            return
        }

        const newText = date.format(newVal)
        const { editor, node } = props.nodeViewProps
        nextTick(() => {
            if (interactionDisabled.value) return;
            // 需要等待节点更新完成，才插入，不然会被覆盖
            editor.commands.insertFieldText(node.attrs.id, newText)
        })
    })
    watch(() => props.focus, (focus) => {
        isFocus.value = Boolean(focus) && !interactionDisabled.value;
    }, { immediate: true });
    watch(interactionDisabled, (disabled) => {
        if (disabled) isFocus.value = false;
    });
})
onUnmounted(() => {
    scope.stop()
})
</script>
<style lang='scss'>
// 输入框样式
.mx-datepicker.custom-field-content {
    width: inherit;

    &.field-empty::after {
        content: none !important;
    }

    .mx-icon-calendar {
        display: none;
    }
}

.ruleexam-tiptap-date-picker-popup {
    z-index: 3000;
}
</style>
