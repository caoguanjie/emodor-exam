<template>
  <section class="paper-designer template-designer" :aria-busy="saving">
    <header class="paper-designer__toolbar designer-header">
      <div class="designer-header__title">
        <SvgIcon icon-class="clipboard-line" class="designer-header__logo" />
        <el-input class="designer-header__name" aria-label="顶部试卷标题" :model-value="value.paper.title" :disabled="locked"
          placeholder="未命名试卷" @update:model-value="changePaper({ title: $event })" />
      </div>
      <fieldset class="paper-designer__format designer-header__format" :disabled="locked">
        <div v-if="mode !== 'readonly'" class="designer-header__tools">
          <MenuBtn v-if="mainEditor" :editor="mainEditor" />
          <el-button v-if="mediaAdapter" :disabled="locked || uploading" @mousedown.prevent @click="chooseImage"><SvgIcon icon-class="image-line" />插入图片</el-button>
        </div>
      </fieldset>
      <div class="designer-header__actions">
        <span class="paper-designer__status designer-header__status" role="status">{{ saving ? '保存中…' : incomplete ? '保存未完成' : dirty ? '未保存' : '已保存' }}</span>
        <template v-if="mode !== 'readonly'">
          <el-button v-if="incomplete && canAbandon" :disabled="saving" @click="controller.abandonSave">放弃本次保存</el-button>
          <el-button type="primary" :loading="saving" :disabled="saving || uploading" @click="save">{{ incomplete ? '继续保存' : '保存' }}</el-button>
        </template>
        <el-button :disabled="saving" @click="requestClose">关闭</el-button>
      </div>
    </header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="failedUpload" title="图片上传失败，可在原位置重试。" type="warning" :closable="false">
      <el-button :disabled="locked" @click="uploadFile(failedUpload)">重试上传</el-button><el-button @click="cancelImage">移除占位</el-button>
    </el-alert>
    <div class="paper-designer__body designer-body">
      <PaperLibrarySidebar class="paper-designer__library" :question-source="questionLibrarySource" :paper-source="paperLibrarySource"
        :category-id="value.paper.category_id" :categories="categories" :disabled="locked || uploading" :readonly="mode === 'readonly'"
        @add-question="addQuestion" @insert-question="insertQuestion" @use-paper="requestUsePaper" />
      <main class="paper-designer__canvas designer-canvas">
        <div class="paper-designer__sheet designer-sheet" :style="sheetStyle">
          <div class="paper-designer__document-title">
            <el-input aria-label="试卷标题" class="paper-designer__title" :model-value="value.paper.title" :disabled="locked" placeholder="输入试卷标题"
              @focus="panel = 'paper'" @update:model-value="changePaper({ title: $event })" />
          </div>
          <div class="designer-sheet__body">
          <QuestionEditor :key="editorKey" ref="editor" class="designer-sheet__content" :model-value="value.document" :disabled="locked" :categories="categories"
            :default-category-id="value.paper.category_id" :concept-api="conceptApi || noConceptApi" :concept-access="conceptAccess"
            :concept-options-api="conceptOptionsApi" :media-resolver="mediaResolver" :can-upload-media="!!mediaAdapter"
            :show-toolbar="false" :show-panels="false" compact allow-structure
            @update:model-value="changeDocument" @selection-change="selectQuestion" @structure-change="changeStructure"
            @remove-request="removeQuestion" @move-request="moveQuestion($event.client_id, $event.to_index)" @edit-blocked="error = $event"
            @upload-state-change="editorUploading = $event.pending" />
          <el-empty v-if="!questionCount" class="designer-sheet__empty" :image-size="80" description="从左侧新增题目，或从试题库、试卷库加入内容。" />
          </div>
          <div class="designer-sheet__page-boundary" aria-hidden="true" />
        </div>
      </main>
      <aside class="paper-designer__properties designer-properties" aria-label="试卷和题目属性">
        <el-tabs v-model="panel" class="designer-property-tabs" aria-label="属性类型">
          <el-tab-pane label="题目属性" name="question" :disabled="!selectedMeta" />
          <el-tab-pane label="试卷设置" name="paper" />
          <el-tab-pane label="模板设置" name="template" />
        </el-tabs>
        <QuestionProperties v-if="selectedMeta" v-show="panel === 'question'" :client-id="selectedId" :meta="selectedMeta" :answer-summary="answerSummary"
          :categories="categories" :regulations="questionRegulations" :concept-api="conceptAccess.read ? conceptApi : undefined" :concept-options-api="conceptOptionsApi"
          :readonly="locked" category-readonly :media-resolver="mediaResolver" :can-upload-media="!!mediaAdapter" :media-adapter="mediaAdapter" :difficulty-options="difficultyOptions"
          @change="changeMeta" @type-change="changeType" @upload-state-change="analysisUploading = $event.pending" />
        <PaperProperties v-if="panel === 'paper'" :model-value="value.paper" :categories="categories" :regulations="categoryRegulations" :courses="categoryCourses"
          :readonly="locked" :has-questions="!!questionCount" @change="changePaper" />
        <div v-else-if="panel === 'template'" class="designer-template-settings" :inert="locked">
          <TemplateSetting :model-value="templateSetting" :readonly="locked" @update:model-value="changeLayout" />
        </div>
      </aside>
    </div>
    <el-dialog :model-value="!!pendingPaper" title="使用整卷" width="480px" :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false" append-to-body>
      <p>选择追加到末尾或整卷替换当前草稿。</p>
      <template #footer>
        <el-button @click="applyPendingPaper('append')">追加到末尾</el-button>
        <el-button type="primary" @click="applyPendingPaper('replace')">整卷替换</el-button><el-button @click="pendingPaper = null">取消</el-button>
      </template>
    </el-dialog>
    <el-dialog :model-value="!!confirmation" title="确认操作" width="480px" :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false" append-to-body>
      <p>{{ confirmation?.message }}</p>
      <template #footer><el-button type="primary" @click="answerConfirmation(true)">{{ confirmation?.label }}</el-button><el-button @click="answerConfirmation(false)">取消</el-button></template>
    </el-dialog>
    <input ref="fileInput" class="paper-designer__file" aria-label="选择题目图片" type="file" accept="image/*" @change="fileChanged" @cancel="cancelImage" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { JSONContent, QuestionAuthoringDocument, QuestionMeta } from '../../api/question-document-types';
import type { QuestionConceptAccess, QuestionConceptApi, QuestionConceptOptionsApi } from '../../api/question-authoring';
import type { DesignerMediaAdapter, DesignerMode, DesignerOption, DesignerPaper, PaperCourseOption, PaperDesignerValue, PaperLibrarySource, QuestionLibrarySource, SavePaperDraft } from './contracts';
import type { QuestionRegulationOption } from '../Tiptap/components/QuestionSetting.vue';
import { insertPaper, paperLoadAction, validateDesignerLayout } from './paper-designer-state';
import { createPaperDesignerController } from '../../composables/paper-designer-controller';
import QuestionEditor, { type QuestionStructureChange } from './QuestionDocumentEditor.vue';
import QuestionProperties from './QuestionProperties.vue';
import PaperProperties from './PaperProperties.vue';
import PaperLibrarySidebar from './PaperLibrarySidebar.vue';
import MenuBtn from '../Tiptap/components/MenuBtn.vue';
import SvgIcon from '../Tiptap/components/SvgIcon.vue';
import TemplateSetting from '../Tiptap/components/TemplateSetting.vue';
import { TemplateSetting as TemplateSettingModel } from '../Tiptap/type';
import { designerSheetStyle } from './designer-sheet-style';
import './designer-shell.css';
import type { MediaResolver } from '../Tiptap/extensions/MediaImage';

const props = withDefaults(defineProps<{
  modelValue: PaperDesignerValue; mode?: DesignerMode; saveDraft: SavePaperDraft;
  categories?: Array<{ id: string; name: string }>; regulations?: QuestionRegulationOption[]; courses?: PaperCourseOption[];
  conceptApi?: QuestionConceptApi; conceptAccess?: QuestionConceptAccess;
  conceptOptionsApi?: QuestionConceptOptionsApi; mediaResolver?: MediaResolver; mediaAdapter?: DesignerMediaAdapter;
  questionLibrarySource?: QuestionLibrarySource; paperLibrarySource?: PaperLibrarySource;
  difficultyOptions?: DesignerOption[];
}>(), { mode: 'create', categories: () => [], regulations: () => [], courses: () => [], difficultyOptions: () => [], conceptAccess: () => ({ read: false, create: false, edit: false, delete: false }) });
const emit = defineEmits<{
  'update:modelValue': [value: PaperDesignerValue]; close: []; 'dirty-change': [dirty: boolean];
  'selection-change': [selection: { client_id: string | null; option_id: string | null }];
}>();
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const controller = createPaperDesignerController({ value: props.modelValue, mode: props.mode,
  saveDraft: (value, context) => props.saveDraft(value, context), onChange: (value) => emit('update:modelValue', value) });
const { value, dirty, saving, incomplete, canAbandon, locked, error } = controller;
const editor = ref<InstanceType<typeof QuestionEditor> | null>(null); const mainEditor = shallowRef<Editor>(); const editorKey = ref(0);
const selectedId = ref(Object.keys(value.value.document.questions)[0] || '');
const panel = ref<'question' | 'paper' | 'template'>(selectedId.value ? 'question' : 'paper');
const templateSetting = ref(new TemplateSettingModel({ ...value.value.paper_layout?.settings, templateName: value.value.paper.title }));
const sheetStyle = computed(() => designerSheetStyle(templateSetting.value));
function changeLayout(settings: TemplateSettingModel) {
  if (locked.value) return;
  try {
    const paper_layout = validateDesignerLayout({ schema_version: 1, settings });
    controller.change({ ...value.value, paper: { ...value.value.paper, title: settings.templateName }, paper_layout });
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '纸张设置不合法'; }
}
// Controlled hydration is presentation-only; a legacy paper has the default layout,
// not the preceding paper's settings, and must not produce a user edit.
watch([() => value.value.paper_layout, () => value.value.paper.title], ([layout, title]) => {
  const next = new TemplateSettingModel({ ...layout?.settings, templateName: title });
  if (JSON.stringify(next) !== JSON.stringify(templateSetting.value)) templateSetting.value = next;
}, { deep: true });
const questionCount = computed(() => Object.keys(value.value.document.questions).length);
const selectedMeta = computed(() => value.value.document.questions[selectedId.value]);
const categoryRegulations = computed(() => props.regulations.filter((item) => !item.category_id || item.category_id === value.value.paper.category_id));
const categoryCourses = computed(() => props.courses.filter((item) => !item.category_id || item.category_id === value.value.paper.category_id));
const questionRegulations = computed(() => {
  const selected = value.value.paper.regulation_ids || [];
  return selected.length ? categoryRegulations.value.filter((item) => selected.includes(String(item.id))) : categoryRegulations.value;
});
const answerSummary = computed(() => {
  const block = value.value.document.content.content?.find((item) => item.attrs?.client_id === selectedId.value);
  return (block?.content || []).filter((node) => node.type === 'questionOption').flatMap((node, index) => node.attrs?.checked
    ? [selectedMeta.value?.type === 'judgment' ? ['正确', '错误'][index] : String.fromCharCode(65 + index)] : []).join('、');
});
const noConceptApi: QuestionConceptApi = { list: async () => ({ items: [], total: 0, page: 1, page_size: 20 }),
  create: async () => { throw new Error('无考点写入权限'); }, update: async () => { throw new Error('无考点写入权限'); }, remove: async () => { throw new Error('无考点写入权限'); } };
function selectQuestion(selection: { client_id: string | null; option_id: string | null }) {
  if (selection.client_id && value.value.document.questions[selection.client_id]) { selectedId.value = selection.client_id; panel.value = 'question'; }
  emit('selection-change', selection);
}
async function resetEditor() { editorKey.value += 1; await nextTick(); mainEditor.value = editor.value?.getEditor(); }
function changeDocument(document: QuestionAuthoringDocument) {
  if (!controller.change({ ...value.value, document })) void resetEditor();
}
function changeStructure(event: QuestionStructureChange) {
  if (locked.value) return;
  const previous = value.value.bindings;
  const bindings = Object.fromEntries(Object.keys(event.document.questions).map((id) => [id, previous[id] || { kind: 'new' as const }]));
  if (controller.change({ ...value.value, document: event.document, bindings })) {
    if (event.kind === 'add') { selectedId.value = event.client_id; panel.value = 'question'; }
  } else void resetEditor();
}
function addQuestion(type: 'single' | 'multiple' | 'judgment') {
  if (locked.value || uploading.value) return;
  if (!value.value.paper.category_id) { error.value = '请先选择培训类别'; panel.value = 'paper'; return; }
  if (questionCount.value >= 100) { error.value = '每份试卷最多 100 题'; return; }
  editor.value?.addQuestion(type);
}
function changePaper(patch: Partial<DesignerPaper>) {
  if (questionCount.value && patch.category_id !== undefined && patch.category_id !== value.value.paper.category_id) { error.value = '请先清空题单，或通过整卷替换更改培训类别'; return; }
  controller.change({ ...value.value, paper: { ...value.value.paper, ...patch, id: value.value.paper.id } });
}
function changeMeta(patch: Partial<QuestionMeta>) {
  if (!selectedMeta.value || 'category_id' in patch || 'question_id' in patch || 'base_revision' in patch || 'generation_ref' in patch
    || 'regulation_id' in patch || 'regulation_version_id' in patch) return;
  if (patch.regulation_id && !questionRegulations.value.some((item) => String(item.id) === patch.regulation_id)) { error.value = '题目资料来源必须在试卷所选资料范围内'; return; }
  controller.change({ ...value.value, document: { ...value.value.document,
    questions: { ...value.value.document.questions, [selectedId.value]: { ...selectedMeta.value, ...patch } } } });
}
const confirmation = shallowRef<{ message: string; label: string; resolve: (answer: boolean) => void } | null>(null);
function ask(message: string, label = '确认'): Promise<boolean> {
  if (confirmation.value) return Promise.resolve(false);
  return new Promise((resolve) => { confirmation.value = { message, label, resolve }; });
}
function answerConfirmation(answer: boolean) { const pending = confirmation.value; confirmation.value = null; pending?.resolve(answer); }
async function removeQuestion(clientId: string) {
  if (locked.value || uploading.value) return;
  const revision = controller.revision.value;
  if (await ask('确定从当前试卷删除这道题吗？试题库中的原题会保留。', '删除题目') && revision === controller.revision.value && !locked.value) editor.value?.removeQuestion(clientId);
}
function moveQuestion(clientId: string, toIndex: number) { if (!locked.value && !uploading.value) editor.value?.moveQuestion(clientId, toIndex); }
async function changeType(type: 'single' | 'multiple' | 'judgment') {
  if (locked.value || !selectedMeta.value || selectedMeta.value.type === type) return;
  const next = copy(value.value); const id = selectedId.value; const meta = next.document.questions[id]!;
  const block = next.document.content.content!.find((item) => item.attrs?.client_id === id)!;
  const options = (block.content || []).filter((node) => node.type === 'questionOption');
  if (meta.type === 'multiple' && type === 'single' && options.filter((node) => node.attrs?.checked).length > 1) { error.value = '请先只保留一个正确答案，再切换为单选题'; return; }
  if (meta.type === 'judgment' || type === 'judgment') {
    const revision = controller.revision.value;
    if (!await ask('切换判断题会重建选项和答案，题干将保留。确定切换吗？') || revision !== controller.revision.value || locked.value) return;
    const labels = type === 'judgment' ? ['正确', '错误'] : ['', ''];
    block.content = [block.content!.find((node) => node.type === 'questionStem')!, ...labels.map((label): JSONContent => ({
      type: 'questionOption', attrs: { option_id: crypto.randomUUID(), checked: false }, content: [{ type: 'paragraph', ...(label ? { content: [{ type: 'text', text: label }] } : {}) }],
    }))];
  }
  const hadConcept = meta.concept_id !== null;
  meta.type = type; meta.concept_id = null;
  if (controller.change(next) && hadConcept) error.value = '题型已改变，请重新选择考点';
}
async function focusFirst(id: string) { selectedId.value = id; panel.value = 'question'; await nextTick(); editor.value?.focus(id); }
function insertQuestion(source: Awaited<ReturnType<QuestionLibrarySource['get']>>) {
  if (locked.value || uploading.value) return;
  const ids = Object.keys(source.document.questions);
  if (ids.length !== 1) { error.value = '试题库必须返回恰好一道题'; return; }
  const result = insertPaper(value.value, { paper: { ...value.value.paper, category_id: source.document.questions[ids[0]!]!.category_id },
    document: source.document, bindings: { [ids[0]!]: source.binding }, ...(source.session ? { session: source.session } : {}) }, 'append');
  if (!result.ok) { error.value = result.issues.map((issue) => issue.message).join('；'); return; }
  if (controller.change(result.value)) void focusFirst(String(result.value.document.content.content!.at(-1)!.attrs!.client_id));
}
const pendingPaper = ref<PaperDesignerValue | null>(null); let pendingRevision = 0;
function requestUsePaper(source: PaperDesignerValue) {
  if (locked.value || uploading.value) return;
  pendingPaper.value = copy(source); pendingRevision = controller.revision.value;
  if (paperLoadAction(value.value) === 'load') {
    applyPendingPaper('replace');
    pendingPaper.value = null;
  }
}
function applyPendingPaper(action: 'append' | 'replace') {
  if (!pendingPaper.value || locked.value || uploading.value) return;
  if (pendingRevision !== controller.revision.value) { pendingPaper.value = null; error.value = '当前草稿已变化，请重新选择来源试卷'; return; }
  const result = insertPaper(value.value, pendingPaper.value, action);
  if (!result.ok) { error.value = result.issues.map((issue) => issue.message).join('；'); return; }
  const firstInsertedIndex = action === 'append' ? questionCount.value : 0;
  pendingPaper.value = null;
  if (controller.change(result.value)) {
    const blocks = result.value.document.content.content || [];
    const id = String(blocks[firstInsertedIndex]?.attrs?.client_id || '');
    if (id) void focusFirst(id);
  }
}
async function requestClose() {
  if (uploading.value && !dirty.value) {
    const revision = controller.revision.value;
    if (await ask('图片尚未上传完成，确定关闭并放弃本次上传吗？', '关闭试卷') && revision === controller.revision.value && !saving.value) { cancelImage(); emit('close'); }
    return;
  }
  if (await controller.requestClose(() => ask('当前试卷有未保存内容，确定关闭并放弃修改吗？', '关闭试卷'))) { cancelImage(); emit('close'); }
}
function save() { return uploading.value ? Promise.resolve(false) : controller.save(); }
const fileInput = ref<HTMLInputElement | null>(null); const editorUploading = ref(false); const uploadingFile = ref(false); const analysisUploading = ref(false);
const failedUpload = shallowRef<File | null>(null); const uploading = computed(() => editorUploading.value || uploadingFile.value || analysisUploading.value);
let imageToken: string | null = null; let imageSerial = 0;
function chooseImage() {
  if (locked.value || !props.mediaAdapter) return;
  imageToken = editor.value?.beginImageUpload() ?? null;
  if (!imageToken) { error.value = '请先将光标放到题干或选项中'; return; }
  fileInput.value?.click();
}
function cancelImage() {
  imageSerial += 1;
  if (imageToken) editor.value?.cancelImageUpload(imageToken);
  imageToken = null; failedUpload.value = null; uploadingFile.value = false;
  if (fileInput.value) fileInput.value.value = '';
}
function fileChanged(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (file) void uploadFile(file); else cancelImage(); }
async function uploadFile(file: File) {
  if (!imageToken || !props.mediaAdapter || locked.value) return;
  const token = imageToken; const ticket = ++imageSerial; uploadingFile.value = true; failedUpload.value = null;
  try {
    const uploaded = await props.mediaAdapter.upload(file);
    if (ticket !== imageSerial) return;
    if (!editor.value?.completeImageUpload(token, uploaded.asset_id)) error.value = '原插入位置已删除，请重新选择位置';
    cancelImage();
  } catch (failure) {
    if (ticket === imageSerial) { failedUpload.value = file; error.value = failure instanceof Error ? failure.message : '图片上传失败'; }
  } finally { if (ticket === imageSerial) uploadingFile.value = false; }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || uploading.value) { event.preventDefault(); event.returnValue = ''; } }
watch(() => props.modelValue, (next) => { if (controller.replace(next)) { pendingPaper.value = null; cancelImage(); } }, { deep: true });
watch(() => props.mode, (mode) => { controller.mode.value = mode; if (mode === 'readonly') { pendingPaper.value = null; answerConfirmation(false); cancelImage(); } });
watch(() => Object.keys(value.value.document.questions), (ids) => { if (!ids.includes(selectedId.value)) { selectedId.value = ids[0] || ''; if (panel.value !== 'template') panel.value = selectedId.value ? 'question' : 'paper'; } });
watch([dirty, uploading], ([changed, pending]) => emit('dirty-change', changed || pending), { immediate: true });
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); await nextTick(); mainEditor.value = editor.value?.getEditor(); });
onBeforeUnmount(() => { controller.invalidate(); window.removeEventListener('beforeunload', beforeUnload); answerConfirmation(false); cancelImage(); });
defineExpose({ requestClose, save, addQuestion, removeQuestion, moveQuestion });
</script>

<style scoped>
.paper-designer__document-title { padding-bottom:12px; margin-bottom:24px; border-bottom:1px solid var(--el-border-color-light, #e6eaee); }
.paper-designer__title { font-size:22px; }
.paper-designer__title :deep(.el-input__wrapper) { box-shadow:none; background:transparent; }
.paper-designer__title :deep(.el-input__inner) { text-align:center; font-weight:600; }
.paper-designer__file { display:none; }
</style>
