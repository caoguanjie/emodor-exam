<template>
    <div :ref="connectDropRef" :class="{ 'is-over': dropCollect.isOver && dropCollect.canDrop, 'is-disabled': readonly }"
        class="drop-control">
        <slot />
    </div>
</template>

<script lang='ts' setup>
import { Editor } from '@tiptap/vue-3';
import { ElMessage } from 'element-plus';
import { useDrop } from 'vue3-dnd';
import { nextTick, shallowRef, type ComponentPublicInstance } from 'vue';
import { TemplateControl } from '../type';
import { getAuthoringControlDecision } from '../extensions/QuestionNodes';
import {
    collectQuestionDropGeometry,
    resolveQuestionDropPosition,
} from '../utils/questionDropGeometry';

const props = defineProps({
    editor: {
        type: Editor,
        default: null
    },
    readonly: {
        type: Boolean,
        default: false
    }
});
const dropCanvas = shallowRef<HTMLElement | null>(null);

// 拖放逻辑
const [dropCollect, dropRef] = useDrop({
    accept: 'CONTROL',
    canDrop: () => !props.readonly && Boolean(props.editor?.isEditable),
    drop: (item: TemplateControl, monitor) => {
        if (!props.editor || props.readonly || !props.editor.isEditable) return;

        // 获取光标位置
        const dropPosition = getDropPosition(monitor, props.editor.view);
        if (dropPosition === null) return;
        const decision = getAuthoringControlDecision(props.editor, item, dropPosition);
        if (!decision.allowed) {
            ElMessage.warning(decision.reason || '此位置不能放置该控件');
            return;
        }
        const inserted = props.editor.commands.insertAuthoringControl(item, dropPosition);
        if (!inserted) {
            ElMessage.warning('控件未能插入到此位置');
            return;
        }
        nextTick(() => {
            props.editor?.commands.focus();
        });
    },

    collect: monitor => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
    })
});

function connectDropRef(
    element: Element | ComponentPublicInstance | null,
    refs: Record<string, unknown> = {},
) {
    const componentElement = (element as ComponentPublicInstance | null)?.$el;
    const resolved = element instanceof HTMLElement
        ? element
        : componentElement instanceof HTMLElement ? componentElement : null;
    dropCanvas.value = resolved;
    dropRef(element, refs);
}

// 计算拖放位置
const getDropPosition = (monitor: any, view: any) => {
    const dropOffset = monitor.getClientOffset();
    if (!dropOffset || !dropCanvas.value) return null;

    const coords = { left: dropOffset.x, top: dropOffset.y };
    const pos = view.posAtCoords(coords);
    return resolveQuestionDropPosition(
        view.state.doc,
        collectQuestionDropGeometry(dropCanvas.value),
        { x: dropOffset.x, y: dropOffset.y },
        pos?.pos ?? null,
    );
};

</script>
