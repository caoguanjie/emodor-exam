<template>
    <div class="widget-setting">
        <div class="basic-attrs" v-if="showBasicAttrs">
            <div class="attr-title">基础属性</div>
            <div class="attr-container">
                <div class="attr-item">
                    <span class="label">文件名</span>
                    <span class="value">{{ tiptapTemplate.templateSetting.templateName }}</span>
                </div>
                <div class="attr-item">
                    <span class="label">字符数</span>
                    <span class="value">{{ characterCount }}</span>
                </div>
                <div class="attr-item">
                    <span class="label">创建者</span>
                    <span class="value">{{ tiptapTemplate.creator }}</span>
                </div>
                <div class="attr-item">
                    <span class="label">创建时间</span>
                    <span class="value">{{ tiptapTemplate.createTime }}</span>
                </div>
                <div class="attr-item">
                    <span class="label">更新者</span>
                    <span class="value">{{ tiptapTemplate.updater }}</span>
                </div>
                <div class="attr-item">
                    <span class="label">更新时间</span>
                    <span class="value">{{ tiptapTemplate.updateTime }}</span>
                </div>
            </div>
        </div>
        <div class="widget-setting-form" v-else>
            <el-form :model="templateControl" label-width="76px" :require-asterisk-position="'right'"
                :disabled="readonly">
                <div class="attr-title">基础属性</div>
                <div class="attr-container base-attr-container">
                    <el-form-item label="控件ID" prop="id" class="">
                        <el-input v-model="templateControl.id" disabled />
                    </el-form-item>
                    <el-form-item label="控件名称" prop="name">
                        <el-input v-model="templateControl.name" disabled />
                    </el-form-item>
                    <el-form-item label="控件类型" prop="typeName">
                        <el-input v-model="templateControl.typeName" disabled />
                    </el-form-item>
                    <el-form-item label="提示文字" prop="placeholder">
                        <el-input v-model="templateControl.placeholder" @input="updateTemplateControlDebounce" />
                    </el-form-item>
                    <el-form-item label="分组id" prop="placeholder">
                        <el-input v-model="templateControl.group" @input="updateTemplateControlDebounce" />
                    </el-form-item>
                </div>
                <div class="attr-title">属性配置</div>
                <div class="attr-container attr-btn-container">
                    <div class="attr-btn-item_checkbox"
                        :class="{ checked: templateControl.isReadonly, disabled: readonly }" :aria-disabled="readonly"
                        @click="toggleProperty('isReadonly')">只读
                        <el-icon>
                            <Check />
                        </el-icon>
                    </div>
                    <div class="attr-btn-item_checkbox"
                        :class="{ checked: templateControl.isRequired, disabled: readonly }" :aria-disabled="readonly"
                        @click="toggleProperty('isRequired')">必填
                        <el-icon>
                            <Check />
                        </el-icon>
                    </div>
                    <!-- <div class="attr-btn-item_checkbox" :class="templateControl.isEdit ? 'checked' : ''"
                        @click="templateControl.isEdit = templateControl.isEdit ? 0 : 1">禁用
                        <el-icon>
                            <Check />
                        </el-icon>
                    </div> -->
                    <div class="attr-btn-item_checkbox"
                        :class="{ checked: templateControl.isUnderline, disabled: readonly }" :aria-disabled="readonly"
                        @click="toggleProperty('isUnderline')">下划线
                        <el-icon>
                            <Check />
                        </el-icon>
                    </div>
                </div>


                <div class="attr-title">样式属性</div>
                <div class="attr-container">
                    <el-form-item label="对齐方式" prop="align" class="">
                        <el-select v-model="templateControl.align" clearable @change="updateTemplateControlDebounce">
                            <el-option v-for="(item, index) in AlignTypeOptions" :key="index" :label="item.label"
                                :value="item.value" />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="显示字数" prop="width">
                        <el-input v-model="templateControl.width" type="text" maxlength="4" @keydown="keydownNumber"
                            @input="updateTemplateControlDebounce" />
                    </el-form-item>
                </div>


                <div class="attr-title">高级属性</div>
                <div class="attr-container">
                    <el-form-item prop="options" v-if="selectWigdet">
                        <template #label>
                            <div class="label-container">
                                <span>选择项</span>
                                <el-tooltip placement="top-start">
                                    <template #content>
                                        下拉选择项格式: 参数名:示例值<br />例如：选项一:值一\n选项二:值二
                                    </template>
                                    <el-icon color="#7a8794">
                                        <QuestionFilled />
                                    </el-icon>
                                </el-tooltip>
                            </div>
                        </template>
                        <div class="textarea-container">
                            <el-input v-model="templateControl.options" type="textarea" :rows="6" autosize
                                maxlength="500" resize="none" @blur="cleanOptionsInput"
                                @input="updateTemplateControlDebounce" />
                            <div class="textarea-tip">字段之间以英文冒号( : )分隔，多条记录以换行分隔</div>
                        </div>
                    </el-form-item>
                    <el-form-item label="是否多选" prop="isMultiple" class=""
                        v-if="templateControl.type === ControlType.select">
                        <el-checkbox v-model="templateControl.isMultiple" label=""
                            @change="updateTemplateControlDebounce" />
                    </el-form-item>
                    <el-form-item label="时间格式" prop="dateFormat" class=""
                        v-if="templateControl.type === ControlType.date">
                        <el-select v-model="templateControl.dateFormat" placeholder="" clearable
                            @change="updateTemplateControlDebounce">
                            <el-option v-for="(item, index) in DateFormatOptions" :key="index" :label="item.label"
                                :value="item.value" />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="排列方式" prop="layout" class=""
                        v-if="templateControl.type === ControlType.checkbox || templateControl.type === ControlType.radio">
                        <el-select v-model="templateControl.layout" placeholder="" clearable @change="toggleLayout">
                            <el-option v-for="(item, index) in LayoutOptions" :key="index" :label="item.label"
                                :value="item.value" />
                        </el-select>
                    </el-form-item>
                </div>
            </el-form>
        </div>
    </div>
</template>

<script lang='ts' setup>
import type { Editor } from '@tiptap/vue-3'
import type { EditorEvents } from '@tiptap/core';
import { TemplateControl, TiptapTemplate, AlignTypeOptions, DateFormatOptions, LayoutOptions, ControlType } from '../type';
import { Check, QuestionFilled } from '@element-plus/icons-vue';
import { useDebounceFn } from '@vueuse/core';
import { keydownNumber } from '../utils/function'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useDynamicOptions } from '../utils/commonWidget';
import { CONTROLLED_UPDATE_META } from '../utils/widgetNodeViewRegistry';
// 模板设置
const tiptapTemplate = defineModel<TiptapTemplate>({
    default: () => new TiptapTemplate(),
});

const props = withDefaults(defineProps<{
    editor: Editor | null;
    readonly?: boolean;
}>(), {
    editor: null,
    readonly: false,
})
// 保留原始响应式对象用于表单绑定
const templateControl = ref<any>(new TemplateControl())
const activeWidgetId = ref<string | null>(null);
// 字符数
const characterCount = ref(0);
// 是否显示基础属性
const showBasicAttrs = ref(true)
const { dynamicOptions } = useDynamicOptions({
    dataSourceCodeFunc: () => templateControl.value.dataSourceCode,
    optionsFunc: () => templateControl.value.options
})
const selectWigdet = computed(() => {
    return templateControl.value.type === ControlType.select || templateControl.value.type === ControlType.checkbox || templateControl.value.type === ControlType.radio;
});
type PendingControlUpdate = {
    targetId: string;
    attrs: Record<string, unknown>;
};
const commitTemplateControlDebounce = useDebounceFn((pending: PendingControlUpdate) => {
    if (!props.editor || props.readonly || !props.editor.isEditable) return;
    if (activeWidgetId.value !== pending.targetId) return;
    props.editor.commands.updateField(pending.targetId, pending.attrs);
}, 300);
function updateTemplateControlDebounce() {
    const targetId = activeWidgetId.value;
    if (!targetId || !props.editor || props.readonly || !props.editor.isEditable) return;
    commitTemplateControlDebounce({
        targetId,
        attrs: JSON.parse(JSON.stringify(templateControl.value)) as Record<string, unknown>,
    });
}
// 添加属性切换方法
const toggleProperty = (propName: string) => {
    if (props.readonly || !props.editor?.isEditable) return;
    templateControl.value[propName] = templateControl.value[propName] ? 0 : 1;
    updateTemplateControlDebounce();
};

// 添加排序顺序的方法
const toggleLayout = (layout: number) => {
    if (props.readonly || !props.editor?.isEditable) return;
    // updateTemplateControlDebounce();
    props.editor?.commands.updateFieldAttrs(templateControl.value.id, templateControl.value.group, { layout });
};


// 防抖搜索器
const updateAttrsDebounce = useDebounceFn((pending: { targetId: string; attrs: Record<string, unknown> }) => {
    if (activeWidgetId.value !== pending.targetId) return;
    // 更新表单显示但不触发更新
    templateControl.value = new TemplateControl(pending.attrs);
}, 300)
function handleSelectionUpdate({ editor }: EditorEvents['selectionUpdate']) {
    const { $from, $to } = editor.state.selection;
    const fromNode = $from.node();
    const toNode = $to.node();
    if (fromNode.type.name === 'widgetField' && toNode.type.name === 'widgetField' && fromNode.attrs.id) {
        const targetId = String(fromNode.attrs.id);
        if (activeWidgetId.value !== targetId) {
            commitTemplateControlDebounce.cancel();
            updateAttrsDebounce.cancel();
            activeWidgetId.value = targetId;
        }
        updateAttrsDebounce({ targetId, attrs: { ...fromNode.attrs } })
        showBasicAttrs.value = false;
    } else {
        commitTemplateControlDebounce.cancel();
        updateAttrsDebounce.cancel();
        activeWidgetId.value = null;
        showBasicAttrs.value = true;
    }
}

function handleEditorUpdate({ editor }: EditorEvents['update']) {
    characterCount.value = editor.getText().length;
}

function handleEditorTransaction({ transaction }: EditorEvents['transaction']) {
    if (transaction.getMeta(CONTROLLED_UPDATE_META) !== true) return;
    commitTemplateControlDebounce.cancel();
    updateAttrsDebounce.cancel();
    activeWidgetId.value = null;
    showBasicAttrs.value = true;
}

function detachEditor(editor: Editor | null | undefined) {
    editor?.off('selectionUpdate', handleSelectionUpdate);
    editor?.off('update', handleEditorUpdate);
    editor?.off('transaction', handleEditorTransaction);
}

const stopEditorWatch = watch(() => props.editor, (current, previous) => {
    detachEditor(previous);
    if (!current) {
        characterCount.value = 0;
        return;
    }
    current.on('selectionUpdate', handleSelectionUpdate);
    current.on('update', handleEditorUpdate);
    current.on('transaction', handleEditorTransaction);
    characterCount.value = current.getText().length;
}, { immediate: true });

onUnmounted(() => {
    stopEditorWatch();
    detachEditor(props.editor);
    commitTemplateControlDebounce.cancel();
    updateAttrsDebounce.cancel();
})
// 清除选项的值，并处理静态数据
function cleanOptionsInput() {
    if (props.readonly || !props.editor?.isEditable) return;
    if (!templateControl.value.options) {
        return
    }

    // 1. 替换多个连续换行符为单个换行符
    let cleaned = templateControl.value.options.replace(/\n+/g, '\n');

    // 2. 分割行并处理每行
    let lines = cleaned.split('\n').map((line: string) => {
        // 3. 去除行首和行尾的空白字符
        let trimmed = line.trim();
        // 4. 处理中文的冒号
        trimmed = trimmed.replace(/：/g, ':');
        // 5. 处理转义冒号（将转义的冒号恢复）
        return trimmed.replace(/\\:/g, ':');
    }).filter((line: any) => line); // 5.过滤掉空行
    templateControl.value.options = lines.join('\n');
    nextTick(() => {
        if (!templateControl.value.dataSourceCode) {
            // 如果没有动态数据源，则处理静态选项
            templateControl.value.dynamicOptions = dynamicOptions.value;
            updateDynamicOptions();
        }
    })
}
function updateDynamicOptions() {
    if (props.readonly || !props.editor?.isEditable) return;
    if (templateControl.value.type === ControlType.radio || templateControl.value.type === ControlType.checkbox) {

        props.editor?.commands.updateDynamicOptions(templateControl.value.group, templateControl.value.dynamicOptions, templateControl.value.options)
    }
}
</script>
<style lang='scss' scoped>
.widget-setting {
    height: 100%;
    overflow-y: auto;
    overflow-y: overlay;
    padding-bottom: 40px;
    box-sizing: border-box;
}

.attr-title {
    padding: 0 16px;
    width: 100%;
    line-height: 34px;
    font-size: 14px;
    background: #F5F7FA;
    color: #606266;
    font-weight: 600;
    box-shadow: inset 0px -1px 0px 0px #EAECEE, inset 0px 1px 0px 0px #EAECEE;
}

.attr-container {
    padding: 16px;

    .attr-item {
        display: flex;
        align-items: flex-start;
        min-height: 32px;
        margin-bottom: 10px;

        span.label {
            width: 76px;
            line-height: 20px;
            font-size: 14px;
            color: #7a8794;
            white-space: nowrap;
        }

        span.value {
            flex: 1;
            line-height: 20px;
            font-size: 14px;
            color: #303133;
        }
    }
}

:deep(.el-form-item__label) {
    font-size: 14px;
    color: #7a8794;
    white-space: nowrap;
    padding-right: 0;
    justify-content: flex-start
}

:deep(.el-input-group__append) {
    padding: 0 8px;
    background-color: #f5f7fb;
    color: #000;
    min-width: 25px;
}


:deep(.el-form-item) {
    margin-bottom: 12px;
}

.base-attr-container {
    :deep(.el-form-item) {
        margin-bottom: 2px;
    }
}

:deep(.el-input) {
    &.is-disabled {
        cursor: pointer;

        .el-input__wrapper,
        .el-input__wrapper:hover {
            box-shadow: none !important;
        }

        .el-input__inner {
            cursor: pointer;
            --el-disabled-text-color: #303133;

        }
    }

    .el-input__wrapper {
        --el-input-border-color: #e0e5ee;
        --el-disabled-bg-color: transparent;

        &:hover {
            box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
        }

    }
}

// 按钮组
.attr-btn-container {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 8px;
}

.attr-btn-item_checkbox {
    width: 75px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: pointer;
    border: 1px solid #e0e2eb;
    border-radius: 4px;
    color: #999BA1;
    user-select: none;

    .el-icon {
        display: none !important;
        color: #fff;
        display: initial;
        position: absolute;
        right: -1px;
        top: 0;
        font-size: 10px
    }

    &:hover {
        border-color: var(--el-color-primary);
        color: var(--el-color-primary);
    }

    &.checked {
        position: relative;
        border-color: var(--el-color-primary);
        color: var(--el-color-primary);

        &::before {
            background: var(--el-color-primary);
            border-bottom-left-radius: 4px;
            content: "";
            display: block;
            height: 12px;
            position: absolute;
            right: -1px;
            top: -1px;
            width: 12px;
        }

        .el-icon {
            display: block !important;
        }

    }

    &.disabled {
        cursor: not-allowed;
        opacity: .6;
        pointer-events: none;
    }
}

.label-container {
    display: flex;
    align-items: center;

    .el-icon {
        margin-left: 2px;
    }
}

.textarea-container {
    display: flex;
    flex-direction: column;
    // border: 1px solid #e0e5ee;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 0 0 1px #e0e5ee inset !important;

    .textarea-tip {
        padding: 5px 0 5px 11px;
        color: #B5B8BE;
        font-size: 12px;
        line-height: 18px;
        z-index: 1;
    }
}



// 重置elment表单样式
:deep(.el-select__wrapper),
:deep(.el-input__wrapper) {
    --el-input-border-color: #e0e5ee;
    // --el-input-hover-border-color: var(--el-color-primary);

    &:hover {
        box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
    }
}

:deep(.el-textarea__inner) {
    min-height: 150px !important;
    // 只有上、左、右三个边框阴影box-shadow
    box-shadow:
        inset 0 1px 0 #e0e5ee,
        /* 上边框 */
        inset -1px 0 0 #e0e5ee,
        /* 左边框 */
        inset 1px 0 0 #e0e5ee;

    /* 右边框 */
    &:hover {
        box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
    }

    &.textarea-box {
        box-shadow: 0 0 0 1px #e0e5ee inset !important;
    }
}

.textarea-box {
    :deep(.el-textarea__inner) {
        box-shadow: 0 0 0 1px #e0e5ee inset;
    }
}

</style>
