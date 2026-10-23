<template>
    <div class="left-control-panel">
        <div class="search-bar">
            <el-input v-model="searchKey" style="width: 288px" autocomplete="off" maxlength="500" placeholder="搜索"
                :prefix-icon="Search" />
        </div>
        <div class="control-content">
            <div class="control-left">
                <div class="control-left-item " :class="{ 'active': activeTab === index }" @click="activeTab = index"
                    v-for="(item, index) in treeData" :key="index">
                    <SvgIcon :icon-class="item.icon || 'general'" class="control-left-item-icon"></SvgIcon>
                    <div class="control-left-item-label">{{ item.name }}</div>
                </div>

            </div>
            <div class="control-right">
                <template v-if="activeTab === 0">
                    <div class="control-right-group" v-for="item in treeChildren" :key="item.id">
                        <div class="control-right-group-title">{{ item.name }}</div>
                        <div class="control-right-group-content">
                            <DraggableControl class="control-right-group-content-item" v-for="el in item.children"
                                :key="el.id" :control="el" @click="updateAttrs(el)" />
                            <!-- <div class="control-right-group-content-item " v-for="el in item.children" :key="el.id"
                                @click="updateAttrs">
                                <SvgIcon :icon-class="ControlType[el.type as number]" class="control-right-item-icon">
                                </SvgIcon>
                                <span>{{ el.name }}</span>
                            </div> -->
                        </div>
                    </div>
                </template>


                <div class="control-right-group" v-else>
                    <!-- <div class="control-right-group-title">常用</div> -->
                    <div class="control-right-group-content control-right-group-content-single">
                        <DraggableControl class="control-right-group-content-item" v-for="(item, index) in treeChildren"
                            :key="index" :control="item" @click="updateAttrs" />
                    </div>
                    <!-- <div v-for="(item, index) in treeChildren" :key="index"
                        @click="updateAttrs">
                        <SvgIcon :icon-class="ControlType[item.type as number]" class="control-right-item-icon">
                        </SvgIcon>
                        <span>{{ item.name }}</span>
                    </div>

                </div> -->
                </div>

            </div>
        </div>
    </div>
</template>

<script lang='ts' setup>
import SvgIcon from './SvgIcon.vue';
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus';
import { Editor } from '@tiptap/vue-3';
import { computed, onMounted, ref } from 'vue';
import data from '../utils/templateControl.json';
import { TemplateControl } from '../type';
import { commonWidgetData } from '../utils/commonWidget';
import DraggableControl from './DraggableControl.vue';
import { getAuthoringControlDecision } from '../extensions/QuestionNodes';
const searchKey = ref('')
const props = defineProps({
    editor: {
        type: Editor,
        default: null
    }
})
const activeTab = ref(0)
const treeData = ref<TemplateControl[]>([])
const treeChildren = computed(() => {
    const children = treeData.value[activeTab.value]?.children || [];
    const keyword = searchKey.value.trim().toLocaleLowerCase();
    if (!keyword) return children;

    return children
        .map((group) => {
            if (group.name?.toLocaleLowerCase().includes(keyword)) return group;
            const matchedChildren = group.children?.filter((item) => [
                item.name,
                item.typeName,
                item.placeholder,
            ].some(value => value?.toLocaleLowerCase().includes(keyword))) || [];
            return matchedChildren.length ? { ...group, children: matchedChildren } : null;
        })
        .filter((group): group is Partial<TemplateControl> => Boolean(group));
})

function toControlTree(items: Partial<TemplateControl>[]): Partial<TemplateControl>[] {
    const nodes = new Map<string, Partial<TemplateControl>>();
    const roots: Partial<TemplateControl>[] = [];

    items.forEach((item) => nodes.set(String(item.id), { ...item, children: [] }));
    nodes.forEach((item) => {
        const parent = item.parentId ? nodes.get(String(item.parentId)) : undefined;
        if (parent) parent.children?.push(item);
        else roots.push(item);
    });
    return roots.sort((left, right) => (left.sort || 0) - (right.sort || 0));
}
const updateAttrs = (item: Partial<TemplateControl>) => {
    // props.editor.commands.updateAttributes('customNodes', { count: 1 })
    // props.editor.commands.insertWidgetNode()
    // props.editor?.commands.insertField({
    //     'data-widget-type': 'select',
    //     'data-placeholder': '请输入姓名',
    //     'data-id': `text_${Date.now()}`,
    //     'data-min-font-num': '12'
    // });
    if (!props.editor) return;
    const decision = getAuthoringControlDecision(props.editor, item);
    if (!decision.allowed) {
        ElMessage.warning(decision.reason || '此位置不能插入该控件');
        return;
    }
    if (!props.editor.commands.insertAuthoringControl(item)) {
        ElMessage.warning('控件未能插入到当前光标位置');
    }

}

onMounted(() => {
    const tree = toControlTree(data.data as Partial<TemplateControl>[]);
    treeData.value = [...commonWidgetData, ...tree] as TemplateControl[];
});
</script>
<style lang='scss' scoped>
.left-control-panel {
    height: 100%;
    width: 320px;
    display: flex;
    flex-direction: column;
}

.search-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    border-bottom: 1px solid #e6eaee;
}

.control-content {
    flex: 1;
    display: flex;
    align-items: stretch;
    height: 0;

    .control-left {
        background: #f3f5f7;
        height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        position: relative;
        width: 64px;

        &::before {
            background: #e6eaee;
            content: "";
            display: block;
            height: 100%;
            position: absolute;
            right: 0;
            top: 0;
            width: 1px;
        }
    }

    .control-right {
        overflow-y: auto;
        padding: 8px 16px;
    }
}

.control-left-item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    font-size: 12px;
    width: 64px;
    height: 64px;
    color: #7a8794;
    cursor: pointer;

    &.active {
        color: #3a84ff;
        background-color: #fff;
        border-bottom: 1px solid #e6eaee;
        border-top: 1px solid #e6eaee;
        color: #000;
        position: relative;

    }

    &:hover {
        color: #000;

    }

    &:first-child {
        border-top-color: #fff !important;
    }

    .control-left-item-icon {
        font-size: 18px;
        margin-bottom: 4px;
    }
}

.control-right-group {
    &:not(:first-child) {
        margin-top: 16px;
    }

    .control-right-group-title {
        font-size: 12px;
        color: #7a8794;
        line-height: 32px;
    }

    .control-right-group-content {
        // 网格列之间的间隙为8像素
        grid-column-gap: 8px;
        display: grid;
        // 设置列宽，2=2列，1fr=每列占用等量的可用空间
        grid-template-columns: repeat(2, 1fr)
    }

    .control-right-group-content-single {
        grid-template-columns: repeat(1, 1fr);

        .control-right-group-content-item {
            width: 224px;
        }
    }

    .control-right-group-content-item {
        display: flex;
        align-items: center;
        width: 108px;
        height: 32px;
        padding: 0 8px;
        margin-bottom: 8px;
        overflow: hidden;
        cursor: pointer;
        border: 1px solid #d9dbe3;
        border-radius: 2px;
        background-color: #fff;
        user-select: none;

        &:hover {
            border-color: #5199f8;
            // cursor: copy;
        }

        .control-right-item-icon {
            margin-right: 4px;
            color: rgb(141, 149, 158);
            font-size: 14px;
        }
    }
}
</style>
