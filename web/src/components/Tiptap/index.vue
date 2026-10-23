<template>
    <component :is="presentationContainer" v-bind="presentationContainerProps"
        @update:model-value="handleDialogVisibility">
        <div class="ruleexam-tiptap ruleexam-tiptap-editor"
            :class="[effectivePresentation === 'dialog' ? 'ruleexam-tiptap-dialog' : 'ruleexam-tiptap-inline',
                { 'ruleexam-tiptap-plain-field': profile === 'plain' && plainFieldOptions }]"
            :data-editor-mode="mode" :data-editor-profile="profile" @controlled-media-state="reportMediaReady">
            <div v-if="showHeader" class="header">
                <div v-if="effectivePresentation === 'dialog'" class="header-title">
                    <div class="header-title-wrapp">
                        <div class="header-title-logo"></div>
                        <EditDiv v-model="templateData.templateSetting.templateName" class="header-title-text"
                            :disabled="isReadonly" />
                    </div>
                </div>
                <div v-if="shouldShowToolbar" class="header-menu">
                    <MenuBtn :editor />
                </div>
                <div v-if="effectivePresentation === 'dialog'" class="header-btns">
                    <el-button type="primary" @click="handleSave">保存</el-button>
                    <el-button style="--el-button-text-color: var(--fits-base-main-color)"
                        @click="handleClose">关闭</el-button>
                </div>
            </div>

            <DndScope :enabled="shouldShowPanels">
                <el-container class="editor-layout" :class="{ 'editor-layout--panels': shouldShowPanels }">
                    <el-aside v-if="shouldShowPanels" class="editor-sidebar editor-sidebar-left" width="320px">
                        <LeftControlPanel :editor />
                        <slot name="left-sidebar" />
                    </el-aside>
                    <el-main class="editor-main">
                        <div class="editor-main-wrapp" :class="{ 'editor-main-wrapp--fluid': !usesPaperLayout }"
                            :style="editorMainWrapper">
                            <ContextMenu v-if="!usesPlainField" v-bind="contextMenuState" :editor :readonly="isReadonly"
                                v-model:visible="contextMenuState.visible" />

                            <DropControl v-if="shouldShowPanels" :style="editorMainContentStyle" :editor="editor"
                                :readonly="isReadonly" @contextmenu="openContextMenu($event)">
                                <editor-content :editor="editor" />
                            </DropControl>
                            <div v-else class="drop-control" :style="editorMainContentStyle"
                                @contextmenu="openContextMenu($event)">
                                <editor-content :editor="editor" />
                            </div>
                            <div v-if="usesPaperLayout" class="editor-wrapper-split-line"
                                :style="{ top: editorMainWrapper.minHeight }"></div>
                        </div>
                    </el-main>
                    <el-aside v-if="shouldShowPanels" class="editor-sidebar editor-sidebar-right" width="288px">
                        <el-tabs v-model="activeName" class="tabs-template">
                            <el-tab-pane v-if="hasQuestionSettingsSlot" label="题目属性" name="question">
                                <slot
                                    v-if="questionSettingsSlotProps.client_id"
                                    name="question-settings"
                                    v-bind="questionSettingsSlotProps"
                                />
                                <ElEmpty v-else description="请在中间选择题目" :image-size="72" />
                            </el-tab-pane>
                            <el-tab-pane label="控件设置" name="1">
                                <WidgetSetting :editor="editor ?? null" :readonly="isReadonly" v-model="templateData" />
                            </el-tab-pane>
                            <el-tab-pane label="模板设置" name="0">
                                <TemplateSetting v-model="templateData.templateSetting" />
                            </el-tab-pane>
                        </el-tabs>
                    </el-aside>
                </el-container>
            </DndScope>
        </div>
    </component>
</template>

<script lang='ts' setup>
import 'virtual:svg-icons-register';
import type { Editor as TiptapCoreEditor, JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { ElDialog, ElEmpty } from 'element-plus';
import { computed, defineComponent, getCurrentInstance, h, nextTick, onBeforeUnmount, reactive, ref, shallowRef, useSlots, watch } from 'vue';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'vue3-dnd';
import EditDiv from './components/EditDiv.vue'
import MenuBtn from './components/MenuBtn.vue'
import ContextMenu from './components/ContextMenu.vue'
import LeftControlPanel from './components/LeftControlPanel.vue'
import TemplateSetting from './components/TemplateSetting.vue'
import WidgetSetting from './components/WidgetSetting.vue'
import type { DocumentIssue, QuestionMeta, ReviewOptionState } from '../../api/question-document-types';
import { TiptapTemplate, type EditorMode, type EditorPresentation, type EditorProfile } from './type'
import DropControl from './components/DropControl.vue'
import './styles/editor.scss';
import { createExtensions } from './utils/createExtensions';
import type { MediaResolver } from './extensions/MediaImage';
import type { PlainFieldOptions } from './extensions/PlainField';
import {
    beginEditorControlledUpdate,
    clearNodeView,
    CONTROLLED_UPDATE_META,
    disposeEditorRuntime,
    endEditorControlledUpdate,
    isEditorControlledUpdate,
    setEditorMutationEnabled,
} from './utils/widgetNodeViewRegistry'

const EMPTY_RICH_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

function emptyDocument(profile: EditorProfile): JSONContent {
    return profile === 'question'
        ? { type: 'doc', content: [] }
        : cloneDocument(EMPTY_RICH_DOCUMENT);
}

interface Props {
    modelValue?: JSONContent;
    profile?: EditorProfile;
    mode?: EditorMode;
    showToolbar?: boolean;
    showPanels?: boolean;
    presentation?: EditorPresentation;
    questions?: Record<string, QuestionMeta>;
    displayMeta?: Record<string, { type: QuestionMeta['type']; hideOrdinal?: boolean }>;
    compact?: boolean;
    review?: Record<string, ReviewOptionState[]>;
    dialogVisible?: boolean;
    mediaResolver?: MediaResolver;
    plainFieldOptions?: PlainFieldOptions;
    protectQuestionStructure?: boolean;
    allowStructure?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    profile: 'question',
    mode: 'edit',
    showToolbar: true,
    showPanels: true,
    presentation: 'inline',
    questions: () => ({}),
    review: () => ({}),
    displayMeta: () => ({}),
    protectQuestionStructure: false,
    allowStructure: true,
});
const slots = useSlots();

const emit = defineEmits<{
    'update:modelValue': [document: JSONContent];
    'update:dialogVisible': [visible: boolean];
    'question-meta-change': [change: { client_id: string; patch: Partial<QuestionMeta> }];
    'selection-change': [selection: { client_id: string | null; option_id: string | null }];
    save: [];
    close: [];
    'media-ready': [result: { pending: boolean; ok: boolean }];
    'edit-blocked': [message: string];
    'upload-state-change': [state: { pending: boolean; count: number }];
    'remove-request': [clientId: string];
    'move-request': [change: { client_id: string; to_index: number }];
}>();

const vnodeProps = getCurrentInstance()?.vnode.props ?? {};
const hasExplicitPresentation = Object.prototype.hasOwnProperty.call(vnodeProps, 'presentation');
const hasDialogVisibleProp = Object.prototype.hasOwnProperty.call(vnodeProps, 'dialogVisible')
    || Object.prototype.hasOwnProperty.call(vnodeProps, 'dialog-visible');
const effectivePresentation = computed<EditorPresentation>(() => (
    !hasExplicitPresentation && hasDialogVisibleProp ? 'dialog' : props.presentation
));
const internalDialogVisible = ref(true);
const dialogOpen = computed(() => hasDialogVisibleProp ? (props.dialogVisible ?? false) : internalDialogVisible.value);
const presentationContainer = computed(() => effectivePresentation.value === 'dialog' ? ElDialog : 'div');
const presentationContainerProps = computed(() => effectivePresentation.value === 'dialog'
    ? {
        modelValue: dialogOpen.value,
        showClose: false,
        fullscreen: true,
        closeOnPressEscape: false,
        closeOnClickModal: false,
        class: 'ruleexam-tiptap-dialog-host',
      }
    : { class: 'ruleexam-tiptap-inline-host' });

const DndScope = defineComponent({
    name: 'RuleExamTiptapDndScope',
    props: { enabled: { type: Boolean, default: false } },
    setup(scopeProps, { slots }) {
        return () => scopeProps.enabled
            ? h(DndProvider, { backend: HTML5Backend }, { default: () => slots.default?.() })
            : slots.default?.();
    },
});

const hasQuestionSettingsSlot = computed(() => props.profile === 'question' && Boolean(slots['question-settings']));
const activeName = ref(hasQuestionSettingsSlot.value ? 'question' : '1')
const templateData = ref<TiptapTemplate>(new TiptapTemplate())
const isComposing = ref(false);
const usesPlainField = computed(() => props.profile === 'plain' && Boolean(props.plainFieldOptions));
const compositionStartDocument = shallowRef<JSONContent | null>(null);
const pendingExternalDocument = shallowRef<JSONContent | null>(null);
const questionContentRevision = ref(0);
const selectedQuestion = ref<{ client_id: string | null; option_id: string | null }>({
    client_id: null,
    option_id: null,
});
let restoreSelectionTimer: ReturnType<typeof setTimeout> | null = null;
const contextMenuState = reactive({
    visible: false,
    top: 0,
    left: 0,
    isTableView: false,
    isSelection: false,
    savedSelection: null as any
})

const isReadonly = computed(() => props.mode !== 'edit');
const shouldShowToolbar = computed(() => props.showToolbar && props.profile !== 'plain' && !isReadonly.value);
const shouldShowPanels = computed(() => props.showPanels && props.profile === 'question' && !isReadonly.value);
const showHeader = computed(() => effectivePresentation.value === 'dialog' || shouldShowToolbar.value);
const usesPaperLayout = computed(() => props.profile === 'question' && !props.compact);

// 编辑器主要容器的样式
const editorMainWrapper = computed(() => {
    if (props.compact) return { width: '100%', minHeight: '0px', padding: '0px' };
    if (props.profile === 'plain' && props.plainFieldOptions) {
        return { width: '100%', minHeight: '0px', padding: '0px' };
    }
    if (!usesPaperLayout.value) {
        return {
            width: '100%',
            minHeight: '160px',
            padding: '16px',
        };
    }
    const width = templateData.value.templateSetting.pageSize === 'A4' ? '210mm' : '148mm';
    const height = templateData.value.templateSetting.pageSize === 'A4' ? '297mm' : '210mm';

    return {
        //templateData.value.templateSetting.pageOrientation === 1  竖向和横向的判断
        width: templateData.value.templateSetting.pageOrientation === 1 ? width : height,
        minHeight: templateData.value.templateSetting.pageOrientation === 1 ? height : width,
        paddingLeft: templateData.value.templateSetting.pageSizeReduce.left + 'mm',
        paddingRight: templateData.value.templateSetting.pageSizeReduce.right + 'mm',
        paddingTop: templateData.value.templateSetting.pageSizeReduce.top + 'mm',
        paddingBottom: templateData.value.templateSetting.pageSizeReduce.bottom + 'mm',

    }
})
// 编辑器最小高度的样式
const editorMainContentStyle = computed(() => {
    if (props.compact) return { minHeight: '0px' };
    if (props.profile === 'plain' && props.plainFieldOptions) return { minHeight: '0px' };
    if (!usesPaperLayout.value) return { minHeight: '128px' };
    const minHeight = parseInt(editorMainWrapper.value.minHeight);
    const paddingTop = templateData.value.templateSetting.pageSizeReduce.top;
    const paddingBottom = templateData.value.templateSetting.pageSizeReduce.bottom;
    const mmValue = minHeight - paddingTop - paddingBottom;
    // console.log('mmValue', mmValue);
    const pxValueDynamic = mmToPxDynamic(mmValue);
    return {
        minHeight: pxValueDynamic + 'px',
    }
})

function blockReadonlyEvent(event: Event): boolean {
    if (!isReadonly.value) return false;
    event.preventDefault();
    return true;
}

const editor = useEditor({
    content: emptyDocument(props.profile),
    editable: props.mode === 'edit',
    extensions: createExtensions(props.profile, {
        protectStructure: () => props.protectQuestionStructure,
        allowStructure: () => props.allowStructure,
        onEditBlocked: (message) => emit('edit-blocked', message),
        onUploadsChange: (state) => emit('upload-state-change', state),
        onQuestionRemoveRequest: (clientId) => emit('remove-request', clientId),
        onQuestionMoveRequest: (change) => emit('move-request', change),
        getQuestionMeta: (clientId) => props.questions[clientId],
        getDisplayMeta: (clientId) => props.displayMeta[clientId],
        getMode: () => props.mode,
        getReviewState: (clientId) => props.review[clientId],
        onQuestionMetaChange: (change) => emit('question-meta-change', change),
    }, props.mediaResolver, () => props.plainFieldOptions),
    editorProps: {
        attributes: () => {
            const options = props.profile === 'plain' ? props.plainFieldOptions : undefined;
            if (!options) return {};
            const rows = Number.isInteger(options.rows) && options.rows > 0 ? options.rows : 2;
            return {
                role: 'textbox',
                'aria-multiline': 'true',
                'aria-readonly': String(isReadonly.value),
                'aria-disabled': String(Boolean(options.disabled)),
                tabindex: options.disabled ? '-1' : '0',
                style: `box-sizing:content-box;line-height:1.5;height:${rows * 1.5}em;min-height:${rows * 1.5}em;overflow-y:auto;`,
                ...(options.ariaLabel ? { 'aria-label': options.ariaLabel } : {}),
                ...(options.ariaLabelledby ? { 'aria-labelledby': options.ariaLabelledby } : {}),
                ...(options.ariaDescribedby ? { 'aria-describedby': options.ariaDescribedby } : {}),
                ...(options.placeholder ? { 'aria-placeholder': options.placeholder } : {}),
            };
        },
        handlePaste: (_view, event) => blockReadonlyEvent(event),
        handleDrop: (_view, event) => blockReadonlyEvent(event),
        handleDOMEvents: {
            paste: (_view, event) => blockReadonlyEvent(event),
            drop: (_view, event) => blockReadonlyEvent(event),
            beforeinput: (_view, event) => blockReadonlyEvent(event),
            compositionstart: ({ state }, event) => {
                if (isReadonly.value) {
                    event.preventDefault();
                    return true;
                }
                isComposing.value = true;
                compositionStartDocument.value = state.doc.toJSON();
                return false;
            },
            compositionend: (_view, event) => {
                if (isReadonly.value) {
                    event.preventDefault();
                    settleComposition();
                    return true;
                }
                nextTick(settleComposition);
                return false;
            },
        },
    },
    onUpdate: ({ editor: currentEditor }) => {
        questionContentRevision.value += 1;
        if (props.mode === 'edit' && !isEditorControlledUpdate(currentEditor)) {
            emit('update:modelValue', currentEditor.getJSON());
        }
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
        updateSelectionStatus()
        publishQuestionSelection(currentEditor);
    }
})

function cloneDocument<T>(document: T): T {
    return JSON.parse(JSON.stringify(document)) as T;
}

function sameDocument(left: JSONContent, right: JSONContent): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function resolveQuestionSelection(currentEditor: TiptapCoreEditor) {
    const { selection } = currentEditor.state;
    let clientId: string | null = null;
    let optionId: string | null = null;
    for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
        const node = selection.$from.node(depth);
        if (node.type.name === 'questionOption') optionId = String(node.attrs.option_id);
        if (node.type.name === 'questionBlock') {
            clientId = String(node.attrs.client_id);
            break;
        }
    }
    const nodeAfter = selection.$from.nodeAfter;
    if (nodeAfter?.type.name === 'questionBlock') clientId = String(nodeAfter.attrs.client_id);
    if (nodeAfter?.type.name === 'questionOption') optionId = String(nodeAfter.attrs.option_id);
    return { client_id: clientId, option_id: optionId };
}

function questionAnswerSummary(currentEditor: TiptapCoreEditor | undefined, clientId: string | null): string {
    if (!currentEditor || !clientId) return '';
    let answer = '';
    currentEditor.state.doc.forEach((block) => {
        if (answer || block.type.name !== 'questionBlock' || block.attrs.client_id !== clientId) return;
        const labels: string[] = [];
        let optionIndex = 0;
        block.forEach((child) => {
            if (child.type.name !== 'questionOption') return;
            if (child.attrs.checked === true) labels.push(String.fromCharCode(65 + optionIndex));
            optionIndex += 1;
        });
        answer = labels.join('、');
    });
    return answer;
}

function publishQuestionSelection(currentEditor: TiptapCoreEditor) {
    const selection = resolveQuestionSelection(currentEditor);
    selectedQuestion.value = selection;
    emit('selection-change', selection);
}

const QUESTION_SETTING_KEYS = new Set<keyof QuestionMeta>([
    'category_id',
    'difficulty',
    'concept_id',
    'regulation_id',
    'regulation_version_id',
    'analysis',
    'score_cents',
]);

function questionSettingChange(clientId: string, patch: Partial<QuestionMeta>): boolean {
    if (
        isReadonly.value
        || selectedQuestion.value.client_id !== clientId
        || !props.questions[clientId]
    ) return false;
    const entries = Object.entries(patch) as Array<[keyof QuestionMeta, QuestionMeta[keyof QuestionMeta]]>;
    if (entries.length === 0 || entries.some(([key]) => !QUESTION_SETTING_KEYS.has(key))) return false;
    const safePatch = Object.fromEntries(entries) as Partial<QuestionMeta>;
    emit('question-meta-change', { client_id: clientId, patch: cloneDocument(safePatch) });
    return true;
}

const questionSettingsSlotProps = computed(() => {
    questionContentRevision.value;
    const clientId = selectedQuestion.value.client_id;
    return {
        client_id: clientId,
        option_id: selectedQuestion.value.option_id,
        meta: clientId ? props.questions[clientId] : undefined,
        answer_summary: questionAnswerSummary(editor.value ?? undefined, clientId),
        readonly: isReadonly.value,
        change: (patch: Partial<QuestionMeta>) => (
            clientId ? questionSettingChange(clientId, patch) : false
        ),
    };
});

function settleComposition() {
    if (!isComposing.value) return;
    const instance = editor.value;
    const pending = pendingExternalDocument.value;
    const compositionStart = compositionStartDocument.value;
    isComposing.value = false;
    pendingExternalDocument.value = null;
    compositionStartDocument.value = null;
    if (instance && pending && compositionStart && sameDocument(instance.getJSON(), compositionStart)) {
        applyExternalDocument(pending);
    }
}

function resetSelection() {
    const instance = editor.value;
    if (!instance) return;
    contextMenuState.visible = false;
    contextMenuState.savedSelection = null;
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.atStart(instance.state.doc)));
    publishQuestionSelection(instance);
}

function applyExternalDocument(document: JSONContent) {
    const instance = editor.value;
    // The authoring codec represents an absent analysis as an empty doc.
    // Rich ProseMirror documents need one editable block; keep that placeholder
    // local to the view until a user actually edits the field.
    const input = props.profile === 'rich' && document.type === 'doc'
        && Array.isArray(document.content) && document.content.length === 0
        ? { ...document, content: cloneDocument(EMPTY_RICH_DOCUMENT.content) }
        : document;
    if (!instance || sameDocument(instance.getJSON(), input)) return;
    beginEditorControlledUpdate(instance);
    try {
        instance.chain()
            .setContent(cloneDocument(input), {
                emitUpdate: false,
                errorOnInvalidContent: true,
            })
            .setMeta(CONTROLLED_UPDATE_META, true)
            .setMeta('addToHistory', false)
            .command(({ tr }) => {
                closeHistory(tr);
                return true;
            })
            .run();
        questionContentRevision.value += 1;
        resetSelection();
    } finally {
        const release = () => {
            if (!instance.isDestroyed) endEditorControlledUpdate(instance);
        };
        // A sibling editor's invalid input can reject Vue's current flush.
        // It must not leave this editor's mutation guard permanently locked.
        void nextTick().then(release, release);
    }
}

function setContent(document: JSONContent) {
    if (!editor.value || isComposing.value) {
        pendingExternalDocument.value = cloneDocument(document);
        return;
    }
    applyExternalDocument(document);
}

function reportMediaReady() {
    if (!editor.value || editor.value.isDestroyed) return;
    const images = [...editor.value.view.dom.querySelectorAll<HTMLElement>('[data-media-state]')];
    emit('media-ready', {
        pending: images.some((image) => image.dataset.mediaState === 'loading'),
        ok: images.every((image) => image.dataset.mediaState === 'loaded'),
    });
}

watch(editor, (instance, previous) => {
    if (previous && previous !== instance) {
        clearNodeView(previous);
        disposeEditorRuntime(previous);
    }
    if (instance) {
        setEditorMutationEnabled(instance, props.mode === 'edit');
        const initialDocument = pendingExternalDocument.value ?? props.modelValue ?? emptyDocument(props.profile);
        pendingExternalDocument.value = null;
        applyExternalDocument(initialDocument);
        publishQuestionSelection(instance);
        void nextTick(reportMediaReady);
    }
}, { immediate: true });

watch(() => props.modelValue, (document) => {
    if (!document) return;
    if (!editor.value || sameDocument(editor.value.getJSON(), document)) return;
    if (isComposing.value) {
        pendingExternalDocument.value = cloneDocument(document);
        return;
    }
    applyExternalDocument(document);
}, { deep: true });

watch(() => props.mode, (mode) => {
    const instance = editor.value;
    if (!instance) return;
    const editable = mode === 'edit';
    if (!editable) settleComposition();
    if (editable) {
        instance.setEditable(true, false);
        setEditorMutationEnabled(instance, true);
    } else {
        setEditorMutationEnabled(instance, false);
        instance.setEditable(false, false);
    }
    contextMenuState.visible = false;
});

watch(() => props.plainFieldOptions, () => {
    if (props.profile === 'plain' && editor.value && !editor.value.isDestroyed) editor.value.view.setProps({});
}, { deep: true });

// 更新选区状态显示
function updateSelectionStatus() {
    if (!editor.value) return;
    const { selection } = editor.value.state;
    // 选中内容是否为空
    contextMenuState.isSelection = !selection?.empty;
}
// 保存选区状态（核心方法）
function saveSelection() {
    if (!editor.value) return;
    const { selection } = editor.value.state;
    if (selection instanceof CellSelection) {
        // 如果是表格单元格选区，则保存选区状态
        contextMenuState.savedSelection = {
            type: 'cell',
            anchorPos: selection.$anchorCell.pos,
            headPos: selection.$headCell.pos
        };
    } else {
        // 如果不是表格单元格选区，则保存普通选区状态
        contextMenuState.savedSelection = {
            type: 'text',
            from: selection.from,
            to: selection.to
        };

    }
}
// 立即恢复选区（核心方法）
function restoreSelectionImmediately() {
    if (!editor.value || !contextMenuState.savedSelection) return;
    try {
        editor.value.commands.focus();
        if (contextMenuState.savedSelection.type === 'cell') {
            // 如果是表格单元格选区，则恢复选区状态
            editor.value.commands.setCellSelection({
                anchorCell: contextMenuState.savedSelection.anchorPos,
                headCell: contextMenuState.savedSelection.headPos
            });
        } else {
            // 如果不是表格单元格选区，则恢复普通选区状态
            editor.value.commands.setTextSelection({
                from: contextMenuState.savedSelection.from,
                to: contextMenuState.savedSelection.to
            })

        }
    } catch (error) {
        console.error('恢复选区失败:', error);
    }
}
function openContextMenu(e: MouseEvent) {
    if (usesPlainField.value) return;
    if (!editor.value) return;
    // 保存当前选区
    saveSelection();
    e.preventDefault();
    // e.stopPropagation();
    const { clientX, clientY } = e;
    contextMenuState.left = clientX;
    contextMenuState.top = clientY + 5;
    // 获取鼠标位置下的所有元素
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    // 查找表格元素
    let tableElement = null;
    for (const element of elements) {
        if (element.tagName === 'TABLE') {
            tableElement = element;
            break;
        }
    }
    // 如果找到了表格元素，则显示上下文菜单
    contextMenuState.isTableView = !!tableElement;

    contextMenuState.visible = true;
    // 立即恢复选区（用户无感知）
    if (restoreSelectionTimer) clearTimeout(restoreSelectionTimer);
    restoreSelectionTimer = setTimeout(() => {
        restoreSelectionImmediately();
        restoreSelectionTimer = null;
    }, 0);
}
function closeContextMenu() {
    contextMenuState.visible = false;
}
const stopWatch = watch(() => contextMenuState.visible, (value) => {
    if (value) {
        document.body.addEventListener('click', closeContextMenu);
    } else {
        // 恢复保存的光标位置
        // contextMenuState.savedSelection = null;
        document.body.removeEventListener('click', closeContextMenu);
    }
})
onBeforeUnmount(() => {
    stopWatch();
    document.body.removeEventListener('click', closeContextMenu);
    if (restoreSelectionTimer) clearTimeout(restoreSelectionTimer);
    if (editor.value) {
        clearNodeView(editor.value);
        disposeEditorRuntime(editor.value);
    }
})

function handleDialogVisibility(visible: boolean) {
    if (!hasDialogVisibleProp) internalDialogVisible.value = visible;
    emit('update:dialogVisible', visible);
    if (!visible) emit('close');
}

function handleSave() {
    emit('save');
}

function handleClose() {
    handleDialogVisibility(false);
}

function getJSON(): JSONContent {
    return editor.value?.getJSON() ?? cloneDocument(props.modelValue ?? emptyDocument(props.profile));
}

function focus(clientId?: string) {
    const instance = editor.value;
    if (!instance) return;
    if (clientId) {
        let position: number | null = null;
        instance.state.doc.forEach((node, offset) => {
            if (node.type.name === 'questionBlock' && node.attrs.client_id === clientId) position = offset + 2;
        });
        if (position !== null) instance.view.dispatch(instance.state.tr.setSelection(TextSelection.near(instance.state.doc.resolve(position))));
        publishQuestionSelection(instance);
    }
    instance.commands.focus();
}

function validate(): DocumentIssue[] {
    const issues: DocumentIssue[] = [];
    editor.value?.state.doc.descendants((node, position) => {
        if (node.type.name === 'questionBlock') {
            const clientId = String(node.attrs.client_id ?? '');
            const meta = props.questions[clientId];
            if (!meta) {
                issues.push({
                    path: `questions.${clientId}`,
                    code: 'question_metadata_missing',
                    message: '题目属性尚未填写',
                });
            } else if (!meta.category_id) {
                issues.push({
                    path: `questions.${clientId}.category_id`,
                    code: 'question_category_required',
                    message: '请选择培训类别',
                });
            }
        }
        if (node.type.name === 'widgetField' && node.attrs.isRequired === 1 && node.textContent.trim() === '') {
            issues.push({
                path: `content@${position}`,
                code: 'required_widget_empty',
                message: '必填控件不能为空',
            });
        }
    });
    return issues;
}

defineExpose({ getJSON, setContent, focus, validate, getEditor: () => editor.value });
/**
 * 获取屏幕的dpi
 */
function getDPI() {
    const ratio = window.devicePixelRatio || 1;
    // window.screen.availWidth 是指屏幕的可用宽度，不包括任务栏等系统界面
    const screenDPI = Math.round((window.screen.width / window.screen.availWidth) * ratio * 96);
    return screenDPI;
}
/**
 * 将毫米转像素
 * @param mm
 */
function mmToPxDynamic(mm: number) {
    const dpi = getDPI();// 动态获取屏幕的dpi
    const mmPerInch = 25.4;// 每英寸的毫米数
    const px = (mm * dpi) / mmPerInch;   // 计算像素值的公式
    return px.toFixed(2); // 返回像素值，保留两位小数
}

</script>
<style lang='scss' scoped>
.header {
    display: flex;
    align-items: center;
    min-height: 56px;
    padding: 0 16px;
    box-sizing: border-box;
    border-bottom: 1px solid #e6eaee;
    font-size: 14px;
    min-width: 0;

    .header-title {
        flex: 0 1 308px;
        min-width: 308px;
        font-weight: 600;

        .header-title-wrapp {
            gap: 4px;
            display: inline-flex;
            align-items: center;
            max-width: 100%;

            .header-title-logo {
                background: url(data:image/png;base64,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) no-repeat 100% / 100%;
                display: block;
                height: 24px;
                width: 24px;
            }

            .header-title-text {
                -webkit-box-align: center;
                -ms-flex-align: center;
                -webkit-align-items: center;
                align-items: center;
                border-radius: 4px;
                cursor: pointer;
                display: -webkit-box;
                display: -webkit-flex;
                display: -ms-flexbox;
                display: flex;
                font-weight: 600;
                overflow: hidden;
                min-width: 0;
                padding: 4px 8px;
                box-shadow: none
            }
        }
    }

    .header-menu {
        flex: 1;
        min-width: 0;
        padding: 0 30px;
        display: flex;
        align-items: center;
        height: 44px;
        justify-content: center;
        background-color: #fff;
        overflow-x: auto;
        overflow-y: hidden;
    }

    .header-btns {
        flex: 0 0 auto;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        white-space: nowrap;
    }
}

@media (max-width: 1399px) {
    .header {
        flex-wrap: wrap;
        align-content: center;
        row-gap: 4px;
        padding-block: 6px;

        .header-title {
            flex: 1 1 0;
            min-width: 0;
        }

        .header-menu {
            order: 3;
            flex: 1 0 100%;
            height: 40px;
            padding: 0;
            justify-content: flex-start;
        }
    }
}
</style>
<style lang="scss">
.ruleexam-tiptap-dialog-host {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100vw;
    min-width: 0;
    overflow: hidden;

    .el-dialog__header {
        display: none;
        padding: 0;
    }

    .el-dialog__body {
        display: flex;
        flex: 1 1 auto;
        padding: 0;
        min-width: 0;
        min-height: 0;
        height: auto;
        overflow: hidden;
    }
}

.ruleexam-tiptap-editor {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;

    &.ruleexam-tiptap-dialog {
        flex: 1 1 auto;
        height: 100%;
    }

    .editor-layout {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }

    .editor-sidebar {
        flex: 0 0 auto;
        min-height: 0;
    }

    .editor-main {
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        background: #f3f5f7;
        border-left: 1px solid #e6eaee;
        border-right: 1px solid #e6eaee;
        overflow: auto;

        .editor-main-wrapp {
            position: relative;
            max-width: none;
            box-sizing: border-box;
            margin: 24px auto;
            background: #fff;
            border: 1px solid #e6eaee;
            box-shadow: 0 2px 4px 0 rgba(0, 0, 0, .102);

            &.editor-main-wrapp--fluid {
                margin: 0;
                border: 0;
                box-shadow: none;
            }

            .editor-wrapper-split-line {
                position: absolute;
                left: 0;
                display: block;
                width: 100%;
                height: 1px;
                content: "";
                border-top: 1px dashed #adf;
            }

        }
    }
}

.ruleexam-tiptap-editor .tabs-template {
    height: 100%;

    .el-tabs__nav-wrap:after {
        --el-border-color-light: #e0e5ee;
        height: 1px;
    }

    .el-tabs__header {
        margin: 0;
    }

    .el-tabs__content {
        height: calc(100% - 40px);

        &>* {
            height: 100%;
        }
    }

    .el-tabs__item {
        --el-text-color-primary: #7a8794;
        padding: 0 12px;

        &.is-active {
            font-weight: 700;
        }
    }

    &.el-tabs--top>.el-tabs__header .el-tabs__item:nth-child(2) {
        padding-left: 8px;
    }
}
</style>
