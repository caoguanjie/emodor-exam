<template>
    <div :ref="dragRef" :style="{ opacity: collect.isDragging ? 0.5 : 1 }">
        <SvgIcon :icon-class="ControlType[control.type as number]" class="control-right-item-icon">
        </SvgIcon>
        <span>{{ control.name }}</span>
    </div>
</template>

<script lang="ts" setup>
import SvgIcon from './SvgIcon.vue';
import { useDrag } from 'vue3-dnd';
import { TemplateControl, ControlType } from '../type';
const props = defineProps({
    control: {
        type: Object as () => Partial<TemplateControl>,
        required: true
    }
})


const [collect, dragRef] = useDrag({
    type: 'CONTROL',  // 需要和 useDrop中的属性accept:[] 中一个对应才能拖拽
    options: {
        dropEffect: 'copy',
    },
    item: () => ({
        ...props.control
    }),
    collect: monitor => ({
        isDragging: monitor.isDragging()
    })
});

</script>
<style lang="scss" scoped>
.control-right-item-icon {
    margin-right: 4px;
    color: rgb(141, 149, 158);
    font-size: 14px;
}
</style>
