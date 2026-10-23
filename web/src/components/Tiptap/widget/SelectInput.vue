<template>
    <el-tooltip ref="popperRef" v-model:visible="isFocus" :disabled="interactionDisabled" :gpu-acceleration="false" pure manual-mode effect="light"
        :transition="`${ns.namespace.value}-zoom-in-top`" persistent trigger="click" @before-show="onSuggestionShow"
        @hide="onHide" :fallback-placements="['bottom-start', 'top-start']" popper-class="ruleexam-tiptap-select-input"
        placement="bottom-start" :show-arrow="false" :offset="2" :hide-after="100">

        <NodeViewContent as="span" v-bind="$attrs" ref="inputRef" :contenteditable="!interactionDisabled">
        </NodeViewContent>

        <template #content>
            <div ref="regionRef" :class="[ns.b('suggestion'), 'FitsAutoComplete']"
                :style="{ 'minWidth': selectWidth, outline: 'none', }" role="region" tabindex="0">
                <el-scrollbar :id="listboxId" tag="ul" :wrap-class="ns.be('suggestion', 'wrap')"
                    :view-class="ns.be('suggestion', 'list')" role="listbox">
                    <li v-for="(item, index) in dynamicOptions" :id="`${listboxId}-item-${index}`"
                        :class="{ highlighted: highlightedIndex === index, disabled: interactionDisabled }" :key="index" role="option"
                        @click.stop="handleSelect(item, index, $event)">
                        <label class="el-checkbox" :class="{ 'is-checked': item.selected }">
                            <span class="el-checkbox__input" :class="{ 'is-checked': item.selected }" v-if="multiple">
                                <input class="el-checkbox__original" type="checkbox" :value="item.value">
                                <span class="el-checkbox__inner"></span>
                            </span>
                            <span class="el-checkbox__label">{{ item.label }}</span>
                        </label>
                    </li>
                    <div v-if="!dynamicOptions.length" class="no-data">暂无数据</div>
                </el-scrollbar>
            </div>
        </template>
    </el-tooltip>
</template>

<script lang='ts' setup>
import { NodeViewRendererProps, NodeViewContent } from '@tiptap/vue-3';
import { useNamespace } from 'element-plus';
import { computed, effectScope, getCurrentInstance, onMounted, onUnmounted, ref, watch } from 'vue';
import { nanoid } from '../extensions/WidgetNodes';
import { ControlType, OptionType, TemplateControl } from '../type';
import { isEditorMutationAllowed, registerNodeView, unregisterNodeView } from '../utils/widgetNodeViewRegistry';
import dataSourceList from '../utils/dataSourceList.json'
import Fuse from 'fuse.js'

type DataSourceItem = { dictionaryID: string; name: string; code: string };
const dataSourceItems = dataSourceList.result.items as DataSourceItem[];
/*
 * @Author: caoguanjie
 * @Date: 2025-08-01 17:04:36
 * @Last Modified by: caoguanjie
 * @Last Modified time: 2025-08-06 14:15:44
 */
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
const seletModel = ref<OptionType | OptionType[]>();
const isFocus = ref(props.focus);
const listboxId = nanoid();
const highlightedIndex = ref(-1)
const regionRef = ref<HTMLElement>()
const ns = useNamespace('autocomplete')
const selectWidth = ref('');
const inputRef = ref<any>();
const interactionDisabled = computed(() => (
    props.readonly || !props.nodeViewProps.editor || !isEditorMutationAllowed(props.nodeViewProps.editor)
));

// 控件的属性
const templateControl = computed(() => {
    return new TemplateControl(props.nodeViewProps.node.attrs);
})
// 静态下拉选择项
const options = computed<OptionType[]>(() => {
    return templateControl.value.optionItems;
})
// 动态的下拉选择项.value
const dynamicOptions = ref<OptionType[]>(options.value);

// 是否多选
const multiple = computed(() => {
    return templateControl.value.isMultiple
});
// 下拉框显示
// 下拉框显示
const onSuggestionShow = () => {
    if (interactionDisabled.value) {
        isFocus.value = false;
        return;
    }
    if (isFocus.value) {
        const { editor, node } = props.nodeViewProps
        const targetItemIndex = dynamicOptions.value.findIndex(item => item.label === node.textContent);
        highlightedIndex.value = targetItemIndex;
        selectWidth.value = `${inputRef.value!.$el.offsetWidth}px`
        if (multiple.value) {
            // 如果选择是单选的，变成数组
            if (!Array.isArray(seletModel.value)) {
                // 第一次选择，判断selectModel.value是否为空
                seletModel.value = seletModel.value ? [seletModel.value] : []
            }
            dynamicOptions.value.forEach(item => {
                const index = (seletModel.value as OptionType[]).findIndex((el: OptionType) => el.label === item.label);
                if (index !== -1) {
                    item.selected = true;
                }
            })
        }
    }
}
// 下拉框隐藏
const onHide = () => {
    highlightedIndex.value = -1;
    if (multiple.value) {
        // 取消选中状态
        dynamicOptions.value.forEach(item => {
            item.selected = false;
        })
    }
}
function handleSelect(item: OptionType, index: number, event?: MouseEvent) {
    if (interactionDisabled.value) return;
    // 如果事件目标是复选框，则不处理
    if (event && (event.target as HTMLElement).classList.contains('el-checkbox__original')) {
        return;
    }
    if (multiple.value) {
        item.selected = !item.selected;
        highlightedIndex.value = index;
        // console.log('多选', seletModel.value, item.selected, JSON.stringify(dynamicOptions.value))
        seletModel.value = dynamicOptions.value.filter(item => item.selected);
    } else {
        seletModel.value = item;
        isFocus.value = false;
        highlightedIndex.value = index;
    }

}
const scope = effectScope();
scope.run(() => {
    // 响应格式变化：直接更新节点内容
    watch(() => seletModel.value, (newVal, oldVal) => {
        if (interactionDisabled.value) return;
        const { editor, node } = props.nodeViewProps
        // 需要等待节点更新完成，才插入，不然会被覆盖
        editor.commands.insertFieldText(node.attrs.id, newVal ?? '')
    })
    // 当数据源变化时，更新节点内容
    watch(() => props.nodeViewProps.node.attrs.dataSourceCode, (newVal) => {
        // console.error('dataSourceCode', ne
        if (newVal) {
            const fuse = new Fuse(dataSourceItems, {
                keys: ['dictionaryID']
            })
            dynamicOptions.value = fuse.search(newVal).map(item => {
                return {
                    label: item.item.name,
                    value: item.item.code,
                    selected: false
                }
            })
        } else {
            dynamicOptions.value = options.value
        }
    })
    // 假如options.value有数据，则动态数据源为options.value
    watch(() => options.value, (newVal) => {
        if (newVal.length > 0 && !props.nodeViewProps.node.attrs.dataSourceCode) {
            dynamicOptions.value = newVal
        }
    })
    watch(() => props.focus, (focus) => {
        isFocus.value = Boolean(focus) && !interactionDisabled.value;
    }, { immediate: true });
    watch(interactionDisabled, (disabled) => {
        if (disabled) isFocus.value = false;
    });
})
// 输入区域键盘事件处理
const handleKeyDown = (event: KeyboardEvent) => {
    if (interactionDisabled.value) return;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            highlight(highlightedIndex.value + 1);
            break;
        case 'ArrowUp':
            event.preventDefault();
            highlight(highlightedIndex.value - 1);
            break;
        case 'Enter':
            event.preventDefault();
            if (!isFocus.value) {
                isFocus.value = true;
                return
            } else if (highlightedIndex.value === -1) {
                isFocus.value = false;
                return
            }
            if (highlightedIndex.value >= 0) {
                handleSelect(dynamicOptions.value[highlightedIndex.value], highlightedIndex.value)
            }
            break;
        case 'Escape':
            event.preventDefault();
            isFocus.value = false;
            break;
        default:
            break;
    }
};
function highlight(index: number) {
    if (!isFocus.value) return;
    if (index < 0) {
        highlightedIndex.value = -1
        return
    }
    if (index >= dynamicOptions.value.length) {
        index = dynamicOptions.value.length - 1
    }
    // 查询弹窗对象
    const suggestion = regionRef.value!.querySelector(
        `.${ns.be('suggestion', 'wrap')}`
    )!
    // 查询列表项对象
    const suggestionList = suggestion.querySelectorAll<HTMLElement>(
        `.${ns.be('suggestion', 'list')} li`
    )!

    const highlightItem = suggestionList[index]
    const scrollTop = suggestion.scrollTop
    const { offsetTop, scrollHeight } = highlightItem

    if (offsetTop + scrollHeight > scrollTop + suggestion.clientHeight) {
        suggestion.scrollTop += scrollHeight
    }
    if (offsetTop < scrollTop) {
        suggestion.scrollTop -= scrollHeight
    }
    highlightedIndex.value = index;


}
onMounted(() => {
    const instance = getCurrentInstance()
    instance && registerNodeView(props.nodeViewProps.editor, props.nodeViewProps.node.attrs.id, instance)
})
onUnmounted(() => {
    scope.stop();
    // 注销节点视图实例
    unregisterNodeView(props.nodeViewProps.editor, props.nodeViewProps.node.attrs.id)
})
// 暴露方法给父组件（Tiptap NodeView）
defineExpose({
    handleKeyDown
});
</script>
<style lang='scss' scoped>
.no-data {
    margin: 0;
    text-align: center;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
</style>
<style lang='scss'>
.ruleexam-tiptap-select-input {
    border: 1px solid var(--el-border-color-light);
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
}
</style>
