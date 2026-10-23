<template>
    <ul v-show="visible" :style="{ left: left + 'px', top: top + 'px' }" class="ruleexam-tiptap-context-menu">
        <li :class="{ 'ruleexam-tiptap-context-menu__item--disabled': !isSelection }" @click.stop="copyText">
            <svg-icon icon-class="file-copy-line" />
            <span>复制</span>
        </li>
        <li :class="{ 'ruleexam-tiptap-context-menu__item--disabled': !isSelection || mutationDisabled }"
            :aria-disabled="!isSelection || mutationDisabled" @click.stop="cut">
            <svg-icon icon-class="clipboard-line" />
            <span>剪切</span>
        </li>
        <li :class="{ 'ruleexam-tiptap-context-menu__item--disabled': mutationDisabled }"
            :aria-disabled="mutationDisabled" @click.stop="cliboard()">
            <svg-icon icon-class="scissors-line" />
            <span>粘贴</span>
        </li>
        <li v-show="isTableView" :class="{ 'ruleexam-tiptap-context-menu__item--disabled': mutationDisabled }"
            :aria-disabled="mutationDisabled" @click.stop="addRowAfter()">
            <svg-icon icon-class="insert-row-bottom" />
            <span>新增行</span>
        </li>
        <li v-show="isTableView" :class="{ 'ruleexam-tiptap-context-menu__item--disabled': mutationDisabled }"
            :aria-disabled="mutationDisabled" @click.stop="addColumnAfter()">
            <svg-icon icon-class="insert-column-right" />
            <span>新增列</span>

        </li>
        <li v-show="isTableView" :class="{ 'ruleexam-tiptap-context-menu__item--disabled': mutationDisabled }"
            :aria-disabled="mutationDisabled" @click.stop="deleteRow()">
            <svg-icon icon-class="delete-row" />
            <span>删除行</span>

        </li>
        <li v-show="isTableView" :class="{ 'ruleexam-tiptap-context-menu__item--disabled': mutationDisabled }"
            :aria-disabled="mutationDisabled" @click.stop="deleteColumn()">
            <svg-icon icon-class="delete-column" />
            <span>删除列</span>

        </li>
        <li v-show="isTableView" :class="{ 'ruleexam-tiptap-context-menu__item--disabled': mutationDisabled }"
            :aria-disabled="mutationDisabled" @click.stop="mergeCells()">
            <svg-icon icon-class="merge-cells-horizontal" />
            <span>合并单元格</span>

        </li>
        <li v-show="isTableView" :class="{ 'ruleexam-tiptap-context-menu__item--disabled': mutationDisabled }"
            :aria-disabled="mutationDisabled" @click.stop="splitCells()">
            <svg-icon icon-class="split-cells-horizontal" />
            <span>分解单元格</span>

        </li>


    </ul>
</template>

<script setup lang="ts">

import SvgIcon from './SvgIcon.vue';
import { Editor } from '@tiptap/vue-3';
import { useClipboard } from '@vueuse/core';
import { computed } from 'vue';
const visible = defineModel('visible', { default: false });
const props = defineProps({
    editor: {
        type: Editor,
        default: null
    },

    top: {
        type: Number,
        default: 0
    },
    left: {
        type: Number,
        default: 0
    },
    isTableView: {
        // 是否是表格视图
        type: Boolean,
        default: false
    },
    isSelection: {
        // 是否选中内容
        type: Boolean,
        default: false
    },
    readonly: {
        type: Boolean,
        default: false
    },

});

const { text, copy, copied, isSupported } = useClipboard()
const mutationDisabled = computed(() => props.readonly || !props.editor?.isEditable);
function copyText() {
    // 复制
    copy(getSelectedText())
    visible.value = false;
}

function cliboard() {
    if (mutationDisabled.value) return;
    // 粘贴 ：将清理后的文本插入到编辑器中
    navigator.clipboard.readText().then((text) => {
        if (mutationDisabled.value) return;
        // text 就是剪贴板的内容
        props.editor?.commands.insertContent(text);
    })
    visible.value = false;
}
function cut() {
    if (mutationDisabled.value || !props.isSelection) return;
    // 剪切
    const text = getSelectedText();
    if (text) {
        props.editor?.commands.deleteSelection();
        copy(text);
    }
}
function getSelectedText() {
    if (!props.editor) {
        return '';
    }
    const { state } = props.editor;
    const { selection } = state;
    const { from, to } = selection;
    const slice = state.doc.slice(from, to);
    const text = slice.content.textBetween(0, slice.content.size, ' ');

    return text;
};

function addRowAfter() {
    if (mutationDisabled.value) return;
    // 新增行
    props.editor?.chain().focus().addRowAfter().run()
    visible.value = false;
}
function addColumnAfter() {
    if (mutationDisabled.value) return;
    // 新增列
    props.editor?.chain().focus().addColumnAfter().run()
    visible.value = false;
}

function deleteRow() {
    if (mutationDisabled.value) return;
    // 删除行
    props.editor?.commands.deleteRow();
    visible.value = false;
}

function deleteColumn() {
    if (mutationDisabled.value) return;
    // 删除列
    props.editor?.commands.deleteColumn();
    visible.value = false;
}
function mergeCells() {
    if (mutationDisabled.value) return;
    // 合并单元格
    props.editor?.commands.mergeCells();
    visible.value = false;
}
function splitCells() {
    if (mutationDisabled.value) return;
    // 分解单元格
    props.editor?.commands.splitCell();
    visible.value = false;
}

</script>

<style lang="scss" scoped>
.ruleexam-tiptap-context-menu {
    margin: 0;
    background: #fff;
    z-index: 10000;
    position: fixed;
    list-style-type: none;
    padding: 5px 0;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 400;
    color: #333;
    box-shadow: 0 3px 12px 2px rgba(0, 0, 0, .1);
    border: 1px solid #e0e5ee;


    max-height: 308px;
    overflow-y: auto;
    overflow-y: overlay;
    padding: 4px;


    li {
        display: flex;
        align-items: center;
        margin: 0;
        padding: 4px 8px;
        min-height: 28px;
        user-select: none;
        white-space: normal;
        outline: 0;
        cursor: pointer;

        &+li {
            margin-top: 2px;
        }

        &:hover {
            background: #f2f4f7;
        }

        .svg-icon {
            margin-right: 4px;
        }

        &.ruleexam-tiptap-context-menu__item--disabled {
            color: #7a8794;
            cursor: not-allowed;
            background: #fff;
        }
    }
}
</style>
