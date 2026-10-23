<!-- 可编辑的div -->
<template>
    <div class="editableDiv-wrapp" :class="{ 'is-focus': !isBlur }" tabindex="-1">
        <div ref="editableDivRef" :contenteditable='!disabled' :placeholder class="input"
            :class="{ 'is-disabled': disabled }" tabindex="0" @input='input' @focus="inputFocus" @blur="inputBlur"
            v-text="innerText">
        </div>
    </div>

</template>

<script lang='ts' setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const modelValue = defineModel<string>({ default: '' })
const props = defineProps({
    placeholder: {
        type: String,
        default: '请输入'
    },
    // 只读属性
    disabled: {
        type: Boolean,
        default: false
    }
})


const innerText = ref(modelValue.value);

const emit = defineEmits(['focus', 'blur', 'input'])
const editableDivRef = ref<HTMLElement>()
const isBlur = ref(true); // 解决赋值时光标自动定位到起始位置

function input(event: any) {
    if (props.disabled) return;
    // 过滤掉空格和\n
    // event.target.innerText = event.target.innerText.replace(/(^\s*)|(\s*$)/g, '');
    // if (event.target.innerText.trim() === '') {
    //     event.target.innerText = ''
    // }
    innerText.value = event.target.innerText;
    modelValue.value = innerText.value;
    emit('input', innerText.value.replace(/(^\s*)|(\s*$)/g, ''))
}
function inputFocus(event: any) {
    // 光标移动到最后
    po_Last_Div()
    isBlur.value = false
    emit('focus')
}
function inputBlur(event: any) {
    // 空字符会让v-html指令产生多个br标签
    if (event.target.innerHTML === '<br>') {
        innerText.value = ''
    }
    isBlur.value = true;
    emit('blur')
}

watch(() => modelValue.value, (newVal: any) => {
    if (isBlur.value && innerText.value !== newVal) {
        innerText.value = newVal
    }
})
// 这里解决的是，tab键后，光标会定位到起始位置的问题
function po_Last_Div() {
    if (window.getSelection && editableDivRef.value) {//ie11 10 9 ff safari
        // editableDivRef.value.focus(); //解决不获取焦点无法定位问题
        var range = window.getSelection();//创建range
        range?.selectAllChildren(editableDivRef.value);//range 选择obj下所有子内容
        range?.collapseToEnd();//光标移至最后
    }
}
// 监听键盘的粘贴事件，解决粘贴内容格式问题
function getEditableRange(editable: HTMLElement): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editable.contains(range.startContainer) || !editable.contains(range.endContainer)) return null;
    return range;
}

function getTextOffset(editable: HTMLElement, node: Node, offset: number): number {
    const prefix = document.createRange();
    prefix.selectNodeContents(editable);
    prefix.setEnd(node, offset);
    return prefix.toString().length;
}

function restoreCaret(editable: HTMLElement, targetOffset: number) {
    if (editableDivRef.value !== editable) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let remaining = targetOffset;
    let textNode = walker.nextNode();
    while (textNode) {
        const length = textNode.textContent?.length ?? 0;
        if (remaining <= length) {
            range.setStart(textNode, remaining);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return;
        }
        remaining -= length;
        textNode = walker.nextNode();
    }
    range.selectNodeContents(editable);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

const handlePaste = (e: ClipboardEvent) => {
    if (props.disabled) return;
    e.stopPropagation();
    // 取消默认的粘贴行为
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const editable = editableDivRef.value;
    if (!editable) return;
    const range = getEditableRange(editable);
    let caretOffset: number;
    if (range) {
        caretOffset = getTextOffset(editable, range.startContainer, range.startOffset) + text.length;
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    } else {
        caretOffset = (editable.textContent?.length ?? 0) + text.length;
        editable.append(document.createTextNode(text));
    }
    const nextValue = editable.textContent ?? '';
    innerText.value = nextValue;
    modelValue.value = nextValue;
    emit('input', nextValue.replace(/(^\s*)|(\s*$)/g, ''))
    nextTick(() => restoreCaret(editable, caretOffset));
}
onMounted(() => {
    nextTick(() => {
        //  监听键盘的粘贴事件，解决粘贴内容格式问题
        editableDivRef.value?.addEventListener('paste', handlePaste)
    })
})
onBeforeUnmount(() => {
    editableDivRef.value?.removeEventListener('paste', handlePaste)
})
</script>
<style lang='scss' scoped>
.editableDiv-wrapp {
    width: 100%;
    line-height: 20px;
    min-height: 20px;
    padding: 8px 10px;
    box-shadow: 0 0 0 1px #E3E3E3 inset;
    position: relative;



    &.is-focus {
        box-shadow: 0 0 0 2px #c3e0fe inset !important;


        &::after {
            content: "";
            position: absolute;
            top: 2px;
            left: 2px;
            width: calc(100% - 4px);
            height: calc(100% - 4px);
            z-index: 0;
            box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
        }
    }

    &:has(.is-disabled) {
        &::after {
            box-shadow: 0 0 0 1px transparent inset !important;
        }
    }



}

.input {

    line-height: 1.5;
    margin: 1px;
    width: 100%;
    outline: none;
    /*去掉聚焦时的默认外边框*/
    // overflow: hidden;
    // white-space: nowrap;
    white-space: pre-wrap;
    /*保留换行符并自动换行*/
    display: block;

    &.is-disabled {
        background-color: #F9FAFC;
    }
}

.input:empty::before {
    content: attr(placeholder);
    color: #ADADAD;
    font-size: 14px;
}
</style>
