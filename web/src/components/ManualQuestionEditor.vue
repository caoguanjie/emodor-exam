<template>
  <section class="manual-question-editor" @keydown.ctrl.enter.prevent="requestSave" @keydown.meta.enter.prevent="requestSave">
    <div class="manual-question-editor__grid">
      <div class="manual-question-editor__meta-field"><span>题型 <em aria-hidden="true">*</em></span>
        <el-select aria-label="题型" :model-value="draft.type" :disabled="locked" @update:model-value="requestType">
          <el-option label="单选题" value="single" /><el-option label="多选题" value="multiple" /><el-option label="判断题" value="judgment" />
        </el-select>
      </div>
      <div class="manual-question-editor__meta-field"><span>培训类别 <em aria-hidden="true">*</em></span>
        <el-select aria-label="培训类别" :model-value="draft.category_id" :disabled="locked" filterable @update:model-value="changeCategory">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </div>
      <div class="manual-question-editor__meta-field"><span>难度 <em aria-hidden="true">*</em></span>
        <el-radio-group aria-label="难度" :model-value="draft.difficulty" :disabled="locked" @update:model-value="changeDifficulty">
          <el-radio-button v-if="historicalDifficulty" :value="draft.difficulty" disabled>{{ historicalDifficulty }}</el-radio-button>
          <el-radio-button v-for="item in difficultyOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <div v-if="message" role="alert" class="manual-question-editor__error">{{ message }}</div>
    <div v-if="confirmJudgment" role="alertdialog" aria-label="转换为判断题" aria-modal="false" class="manual-question-editor__confirmation">
      <p>转换为判断题会替换现有选项及答案，题干和解析将保留。</p>
      <button type="button" :disabled="locked" @click="confirmJudgment = false">取消转换</button>
      <button type="button" :disabled="locked" @click="changeType('judgment')">确认转换</button>
    </div>

    <div class="manual-question-editor__heading">
      <div class="manual-question-editor__field-label">题干与选项 <span aria-hidden="true">*</span></div>
      <span class="manual-question-editor__hint">点击选项字母或右侧“设为答案”修改正确答案</span>
    </div>
    <div class="manual-question-editor__body">
      <div v-if="!locked" class="manual-question-editor__toolbar" role="toolbar" aria-label="题干与选项格式">
        <button type="button" aria-label="加粗" :aria-pressed="formatActive('question', 'bold')" @mousedown.prevent @click="format('question', 'bold')"><SvgIcon icon-class="bold" /></button>
        <button type="button" aria-label="斜体" :aria-pressed="formatActive('question', 'italic')" @mousedown.prevent @click="format('question', 'italic')"><SvgIcon icon-class="italic" /></button>
        <button type="button" aria-label="下划线" :aria-pressed="formatActive('question', 'underline')" @mousedown.prevent @click="format('question', 'underline')"><SvgIcon icon-class="underline" /></button>
        <button type="button" aria-label="无序列表" :aria-pressed="formatActive('question', 'bulletList')" @mousedown.prevent @click="format('question', 'bulletList')">☷</button>
        <button v-if="canUploadMedia" type="button" aria-label="插入题目图片" :disabled="pending" @mousedown.prevent @click="chooseImage('question')"><SvgIcon icon-class="image-line" /></button>
      </div>
      <TiptapEditor v-if="!hydrateError" ref="questionEditor" class="question-authoring-surface" :model-value="questionDocument" :runtime-questions="questions" :display-meta="displayMeta"
        profile="question" :mode="locked ? 'preview' : 'edit'" presentation="inline" compact :show-toolbar="false" :show-panels="false"
        protect-question-structure :allow-structure="false" reorder-options show-answer-labels :media-resolver="getMediaImageContent"
        @update:model-value="changeQuestion" @edit-blocked="reportError" @selection-change="toolbarRevision++" />
    </div>
    <details class="manual-question-editor__analysis" :open="analysisExpanded" @toggle="analysisExpanded = ($event.target as HTMLDetailsElement).open">
      <summary>答案解析 <span>（选填）</span></summary>
      <div class="manual-question-editor__body">
        <div v-if="!locked" class="manual-question-editor__toolbar" role="toolbar" aria-label="解析格式">
          <button type="button" aria-label="解析加粗" :aria-pressed="formatActive('analysis', 'bold')" @mousedown.prevent @click="format('analysis', 'bold')"><SvgIcon icon-class="bold" /></button>
          <button type="button" aria-label="解析斜体" :aria-pressed="formatActive('analysis', 'italic')" @mousedown.prevent @click="format('analysis', 'italic')"><SvgIcon icon-class="italic" /></button>
          <button type="button" aria-label="解析下划线" :aria-pressed="formatActive('analysis', 'underline')" @mousedown.prevent @click="format('analysis', 'underline')"><SvgIcon icon-class="underline" /></button>
          <button type="button" aria-label="解析无序列表" @mousedown.prevent @click="format('analysis', 'bulletList')">☷</button>
          <button v-if="canUploadMedia" type="button" aria-label="插入解析图片" :disabled="pending" @mousedown.prevent @click="chooseImage('analysis')"><SvgIcon icon-class="image-line" /></button>
        </div>
        <TiptapEditor v-if="!hydrateError" ref="analysisEditor" :model-value="analysisDocument" profile="rich" :mode="locked ? 'preview' : 'edit'"
          presentation="inline" compact :show-toolbar="false" :show-panels="false" :media-resolver="getMediaImageContent"
          @update:model-value="changeAnalysis" />
      </div>
    </details>
    <input ref="fileInput" type="file" accept="image/*" aria-label="选择题目图片" hidden @change="fileChanged" @cancel="cancelImage" />
    <div v-if="pending" class="manual-question-editor__upload" role="status">
      <span>{{ uploading ? '图片上传中…' : uploadError || '等待选择图片' }}</span>
      <button v-if="uploadError" type="button" :disabled="locked || uploading" @click="uploadImage">重试上传</button>
      <button type="button" :disabled="disabled" @click="cancelImage">取消上传</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { JSONContent } from '@tiptap/core';
import type { QuestionContentV3 } from '../api/question-document-types';
import type { QuestionDraftPayload, QuestionType } from '../api/training-types';
import { getMediaImageContent, uploadMedia } from '../api/media';
import TiptapEditor from './Tiptap/index.vue';
import SvgIcon from './Tiptap/components/SvgIcon.vue';
import type { QuestionRuntimeMeta } from './Tiptap/extensions/QuestionNodes';
import { isControlledMediaAssetId } from './Tiptap/extensions/MediaImage';
import { questionContentTarget } from './Tiptap/extensions/QuestionEditingProtection';
import { anchorManualImageUpload } from './manual-question-upload';
import { emptyRichDoc, fromManualRichDoc, judgmentOptions, MANUAL_QUESTION_ID, manualContentFromDocument,
  manualContentFromDraft, manualDraftWithContent, manualQuestionDocument, richDocHasContent, toManualRichDoc } from './manual-question-content';

const props = withDefaults(defineProps<{
  modelValue: QuestionDraftPayload;
  categories?: Array<{ id: string; name: string }>;
  difficultyOptions?: Array<{ value: string; label: string }>;
  disabled?: boolean;
  canUploadMedia?: boolean;
}>(), { categories: () => [], difficultyOptions: () => [], disabled: false, canUploadMedia: false });
const emit = defineEmits<{
  'update:modelValue': [value: QuestionDraftPayload];
  'upload-state-change': [state: { pending: boolean }];
  'uncommitted-change': [value: boolean];
  error: [message: string];
  save: [];
}>();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const draft = ref<QuestionDraftPayload>(clone(props.modelValue));
const content = shallowRef<QuestionContentV3 | null>(null);
const questionDocument = shallowRef<JSONContent>({ type: 'doc', content: [] });
const analysisDocument = shallowRef<JSONContent>(emptyRichDoc());
const questionEditor = ref<InstanceType<typeof TiptapEditor> | null>(null);
const analysisEditor = ref<InstanceType<typeof TiptapEditor> | null>(null);
const hydrateError = ref(''); const questionError = ref(''); const analysisError = ref(''); const message = ref(''); const analysisExpanded = ref(false);
const confirmJudgment = ref(false); const toolbarRevision = ref(0);
const uncommittedChange = ref(false);
const locked = computed(() => props.disabled || Boolean(hydrateError.value));
const displayMeta = computed(() => ({ [MANUAL_QUESTION_ID]: { type: draft.value.type, hideOrdinal: true } }));
const questions = computed<Record<string, QuestionRuntimeMeta>>(() => ({ [MANUAL_QUESTION_ID]: {
  type: draft.value.type, category_id: draft.value.category_id, difficulty: draft.value.difficulty || 'easy',
  concept_id: null, regulation_id: null, regulation_version_id: null, analysis: analysisDocument.value,
} }));
const historicalDifficulty = computed(() => draft.value.difficulty && !props.difficultyOptions.some((item) => item.value === draft.value.difficulty)
  ? `${({ easy: '简单', medium: '中级', hard: '困难' } as Record<string, string>)[draft.value.difficulty] || draft.value.difficulty}（历史，当前停用）` : '');
function getEditor() { return questionEditor.value?.getEditor(); }
function getAnalysisEditor() { return analysisEditor.value?.getEditor(); }
function reportError(value: string) { message.value = value; emit('error', value); }
function failure(value: unknown) { return value instanceof Error ? value.message : '无法安全保留题目内容，请检查后重试'; }
function setUncommittedChange(value: boolean) {
  if (uncommittedChange.value === value) return;
  uncommittedChange.value = value; emit('uncommitted-change', value);
}
function publish(next: QuestionContentV3) {
  if (locked.value) return;
  content.value = next; draft.value = manualDraftWithContent(draft.value, next); message.value = questionError.value || analysisError.value;
  setUncommittedChange(Boolean(questionError.value || analysisError.value));
  emit('error', message.value);
  emit('update:modelValue', clone(draft.value));
}
function changeQuestion(document: JSONContent) {
  if (locked.value || !content.value) return;
  try {
    const next = manualContentFromDocument(document, content.value);
    questionError.value = ''; questionDocument.value = document; publish(next); toolbarRevision.value++;
  } catch (error) { questionError.value = failure(error); setUncommittedChange(true); reportError(questionError.value); }
}
function changeAnalysis(document: JSONContent) {
  if (locked.value || !content.value) return;
  try {
    const analysis = fromManualRichDoc(document, content.value.analysis);
    analysisError.value = ''; analysisDocument.value = document;
    publish({ ...content.value, analysis: richDocHasContent(analysis) ? analysis : null });
  } catch (error) { analysisError.value = failure(error); setUncommittedChange(true); reportError(analysisError.value); }
}
function changeCategory(value: unknown) {
  if (locked.value || !content.value) return;
  draft.value = { ...draft.value, category_id: String(value) }; publish(content.value);
}
function changeDifficulty(value: unknown) {
  if (locked.value || !content.value || !props.difficultyOptions.some((item) => item.value === value)) return;
  draft.value = { ...draft.value, difficulty: value as QuestionDraftPayload['difficulty'] }; publish(content.value);
}
function requestType(value: unknown) {
  if (locked.value || pending.value || !content.value || !['single', 'multiple', 'judgment'].includes(String(value)) || value === draft.value.type) return;
  if (questionError.value || analysisError.value) { reportError('请先修复当前内容中不支持的格式，再切换题型'); return; }
  if (value === 'single' && content.value.answer_option_ids.length > 1) { reportError('当前有多个正确答案，请先仅保留一个正确答案再切换为单选题'); return; }
  if (value === 'judgment') { confirmJudgment.value = true; return; }
  changeType(value as QuestionType);
}
function changeType(type: QuestionType) {
  if (locked.value || pending.value || !content.value) return;
  const next = type === 'judgment' ? { ...content.value, options: judgmentOptions(), answer_option_ids: [] } : clone(content.value);
  confirmJudgment.value = false; draft.value = { ...draft.value, type };
  questionDocument.value = manualQuestionDocument(next); publish(next);
}
type Target = 'question' | 'analysis';
type Format = 'bold' | 'italic' | 'underline' | 'bulletList' | 'orderedList';
function targetEditor(target: Target) { return target === 'question' ? getEditor() : getAnalysisEditor(); }
function formatActive(target: Target, mark: Format) { void toolbarRevision.value; return targetEditor(target)?.isActive(mark) || false; }
function format(target: Target, mark: Format) {
  const editor = targetEditor(target); if (locked.value || !editor) return;
  const chain = editor.chain().focus();
  if (mark === 'bold') chain.toggleBold().run(); else if (mark === 'italic') chain.toggleItalic().run();
  else if (mark === 'underline') chain.toggleUnderline().run(); else if (mark === 'bulletList') chain.toggleBulletList().run();
  else chain.toggleOrderedList().run();
  toolbarRevision.value++;
}

const fileInput = ref<HTMLInputElement | null>(null); const pending = ref(false); const uploading = ref(false); const uploadError = ref('');
let uploadAnchor: ReturnType<typeof anchorManualImageUpload> = null;
let uploadFile: File | null = null; let uploadSerial = 0; let abort: AbortController | null = null;
function setPending(value: boolean) { if (pending.value !== value) { pending.value = value; emit('upload-state-change', { pending: value }); } }
function chooseImage(target: Target) {
  const editor = targetEditor(target);
  if (locked.value || !props.canUploadMedia || pending.value || !editor || target === 'question' && draft.value.type === 'judgment'
    && questionContentTarget(editor.state.doc, editor.state.selection.from)?.optionId) return;
  uploadAnchor = anchorManualImageUpload(editor, target === 'question');
  if (!uploadAnchor) { reportError('请先在题干、选项或解析中选择图片插入位置'); return; }
  setPending(true); fileInput.value?.click();
}
function cancelImage() {
  uploadSerial++; abort?.abort(); abort = null; uploadAnchor?.cancel(); uploadAnchor = null; uploadFile = null;
  uploading.value = false; uploadError.value = ''; setPending(false);
  if (fileInput.value) fileInput.value.value = '';
}
function fileChanged(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) { cancelImage(); return; }
  uploadFile = file; void uploadImage();
}
async function uploadImage() {
  if (!uploadFile || !uploadAnchor || locked.value || !props.canUploadMedia || uploading.value) return;
  const ticket = ++uploadSerial; const anchor = uploadAnchor; abort = new AbortController();
  uploading.value = true; uploadError.value = '';
  try {
    const result = await uploadMedia(uploadFile, 'question', { signal: abort.signal });
    if (ticket !== uploadSerial || locked.value || !props.canUploadMedia) return;
    if (!isControlledMediaAssetId(result.asset_id) || result.status !== 'ready') throw new Error('图片上传结果无效，请重试');
    const position = anchor.position();
    if (position == null || !anchor.editor.chain().setTextSelection(position).insertMediaImage({ asset_id: result.asset_id }).run()) {
      throw new Error('原插入位置已失效，请取消上传后重新选择位置');
    }
    cancelImage();
  } catch (error) {
    if (ticket === uploadSerial) { uploadError.value = `图片上传失败，可在原位置重试：${failure(error)}`; emit('error', uploadError.value); }
  } finally { if (ticket === uploadSerial) uploading.value = false; }
}
function validate() { return hydrateError.value || questionError.value || analysisError.value || (pending.value ? '请等待图片上传完成或取消上传' : ''); }
function getDraft(): QuestionDraftPayload {
  const error = validate();
  if (error) throw new Error(error);
  return clone(draft.value);
}
function requestSave() { if (!locked.value && !validate()) emit('save'); }
function hydrate(value: QuestionDraftPayload) {
  cancelImage(); confirmJudgment.value = false; hydrateError.value = ''; questionError.value = ''; analysisError.value = ''; message.value = ''; draft.value = clone(value);
  setUncommittedChange(false);
  try {
    const next = manualContentFromDraft(value); content.value = next; draft.value = manualDraftWithContent(value, next);
    questionDocument.value = manualQuestionDocument(next); analysisDocument.value = next.analysis ? toManualRichDoc(next.analysis) : emptyRichDoc();
    analysisExpanded.value = richDocHasContent(next.analysis);
    emit('error', '');
  } catch (error) {
    hydrateError.value = `无法打开题目：${failure(error)}`; content.value = null;
    reportError(hydrateError.value);
  }
}
// Parent v-model echoes must not remount editors, cancel uploads or change the chosen collapse state.
watch(() => props.modelValue, (value) => {
  if (JSON.stringify(value) !== JSON.stringify(draft.value)) hydrate(value);
}, { deep: true, flush: 'sync' });
watch(() => [props.disabled, props.canUploadMedia], () => { if (props.disabled || !props.canUploadMedia) cancelImage(); });
hydrate(props.modelValue);
onBeforeUnmount(cancelImage);
defineExpose({ getEditor, getAnalysisEditor, validate, getDraft });
</script>

<style scoped>
.manual-question-editor { color: var(--el-text-color-primary, #303133); }
.manual-question-editor__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-bottom: 22px; }
.manual-question-editor__meta-field { display: grid; gap: 6px; font-size: 14px; }
.manual-question-editor__meta-field em { color: var(--el-color-danger); font-style: normal; }
.manual-question-editor__grid .el-select { width: 100%; }
.manual-question-editor__grid .el-radio-group { display: flex; flex-wrap: nowrap; width: 100%; }
.manual-question-editor__grid :deep(.el-radio-button) { flex: 1; }
.manual-question-editor__grid :deep(.el-radio-button__inner) { box-sizing: border-box; width: 100%; }
.manual-question-editor__heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 16px; margin-bottom: 10px; }
.manual-question-editor__field-label { font-size: 14px; }
.manual-question-editor__field-label > span { color: var(--el-color-danger); }
.manual-question-editor__body { box-sizing: border-box; overflow: hidden; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; transition: border-color .15s; }
.manual-question-editor__body:focus-within { border-color: var(--el-color-primary, #3056d3); }
.manual-question-editor__toolbar { display: flex; align-items: center; gap: 2px; min-height: 36px; padding: 0 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 5px 5px 0 0; background: #fafbfc; }
.manual-question-editor__toolbar button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 4px; color: #475569; background: transparent; cursor: pointer; font-size: 16px; }
.manual-question-editor__toolbar button:hover,.manual-question-editor__toolbar button[aria-pressed='true'] { background: #e8eef7; color: var(--el-color-primary, #409eff); }
.manual-question-editor__toolbar button:disabled { opacity: .4; cursor: default; }
.manual-question-editor__divider { height: 18px; margin: 0 5px; border-left: 1px solid var(--el-border-color); }
.manual-question-editor__hint { color: var(--el-text-color-secondary, #909399); font-size: 12px; }
.manual-question-editor__analysis { margin-top: 18px; border-top: 1px solid var(--el-border-color-lighter); }
.manual-question-editor__analysis summary { display: flex; align-items: center; gap: 8px; padding: 16px 0; color: var(--el-text-color-regular, #606266); cursor: pointer; font-size: 14px; font-weight: 600; line-height: 22px; list-style: none; }
.manual-question-editor__analysis summary::-webkit-details-marker { display: none; }
.manual-question-editor__analysis summary::before { content: ''; flex: 0 0 6px; width: 6px; height: 6px; margin: 0 4px 0 2px; border-right: 1.5px solid var(--el-text-color-secondary, #909399); border-bottom: 1.5px solid var(--el-text-color-secondary, #909399); transform: rotate(-45deg); transition: transform .15s; }
.manual-question-editor__analysis[open] summary::before { transform: translateY(-2px) rotate(45deg); }
.manual-question-editor__analysis summary span { margin-left: -6px; color: inherit; }
.manual-question-editor__analysis summary:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; border-radius: 4px; }
.manual-question-editor__error,.manual-question-editor__confirmation { padding: 10px 14px; margin-bottom: 14px; border-radius: 5px; background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); font-size: 14px; }
.manual-question-editor__confirmation button,.manual-question-editor__upload button { margin: 0 8px; padding: 5px 10px; border: 1px solid var(--el-border-color); border-radius: 4px; background: #fff; cursor: pointer; }
.manual-question-editor__upload { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; font-size: 13px; }
.manual-question-editor :deep(.ruleexam-tiptap .editor-main) { padding: 0; border: 0; background: transparent; }
.manual-question-editor :deep(.ruleexam-tiptap .editor-main-wrapp) { border: 0; box-shadow: none; background: transparent; }
.manual-question-editor :deep(.question-block) { margin: 0; border: 0; border-radius: 0; }
.manual-question-editor :deep(.question-block__header) { display: none; }
.manual-question-editor__analysis :deep(.ProseMirror) { box-sizing: border-box; min-height: 110px; padding: 12px 20px; }
.manual-question-editor :deep(.question-image-upload-placeholder),.manual-question-editor :deep([data-manual-image-upload]) { padding: 2px 5px; border: 1px dashed #94a3b8; color: #64748b; font-size: 12px; }
@media (max-width: 760px) { .manual-question-editor__grid { gap: 10px; } .manual-question-editor :deep(.question-option__order) { gap: 0; } }
</style>
