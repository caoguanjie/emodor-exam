<template>
  <el-form label-position="left" label-width="76px" require-asterisk-position="right" class="question-properties" @submit.prevent>
    <h3 class="designer-property-group-title">基础属性</h3>
    <div class="designer-property-content">
    <el-form-item v-if="questionPosition !== undefined" label="题目位置">
      <el-input class="question-properties__position" aria-label="题目位置" type="number" inputmode="numeric" :min="1" :max="questionCount" :step="1" v-model="positionDraft" :disabled="readonly || positionDisabled" @keydown.enter.prevent="moveToPosition">
        <template #suffix><span class="question-properties__position-hint">共 {{ questionCount }} 题</span></template>
        <template #append><el-button :disabled="readonly || positionDisabled || !validPosition" @click="moveToPosition">移动</el-button></template>
      </el-input>
    </el-form-item>
    <el-form-item label="类型" required>
      <el-select aria-label="类型" :model-value="meta.type" :disabled="readonly" @update:model-value="emit('type-change', $event)">
        <el-option label="单选题" value="single" /><el-option label="多选题" value="multiple" /><el-option label="判断题" value="judgment" />
      </el-select>
    </el-form-item>
    <el-form-item label="培训类别" required>
      <el-select aria-label="培训类别" :model-value="meta.category_id" :disabled="readonly || categoryReadonly" filterable @update:model-value="patch({ category_id: String($event) })">
        <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
    </el-form-item>
    <el-form-item label="难度" required>
      <el-radio-group aria-label="难度" :model-value="meta.difficulty" :disabled="readonly" @update:model-value="patch({ difficulty: $event as QuestionMeta['difficulty'] })">
        <el-radio-button v-for="item in difficultyOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <el-form-item v-if="regulations.length" label="资料来源">
      <span>{{ regulations.find((item) => String(item.id) === meta.regulation_id)?.title || (meta.regulation_id ? `资料 ${meta.regulation_id}` : '无来源') }}</span>
    </el-form-item>
    </div>
    <h3 class="designer-property-group-title">答案设置</h3>
    <div class="designer-property-content">
    <el-form-item label="本卷分值" required>
      <el-input aria-label="分值" type="number" inputmode="decimal" :min="0" :max="scoreLimit" :step="0.01" :model-value="scoreDraft" :disabled="readonly" @update:model-value="changeScore" @blur="finishScore"><template #append>分</template></el-input>
    </el-form-item>
    <el-form-item label="答案摘要"><span>{{ answerSummary || '未设置' }}</span></el-form-item>
    </div>
    <h3 class="designer-property-group-title">答案解析</h3>
    <div class="designer-property-content question-properties__rich" aria-label="解析">
      <div class="question-properties__analysis-body">
        <div v-if="!readonly" class="question-properties__analysis-toolbar" role="toolbar" aria-label="解析格式">
          <button v-for="item in analysisFormats" :key="item.name" type="button" :aria-label="item.label" :title="item.label"
            :aria-pressed="analysisFormatActive(item.name)" @mousedown.prevent @click="formatAnalysis(item.name)">
            <span v-if="item.name === 'bulletList'" aria-hidden="true">☷</span><SvgIcon v-else :icon-class="item.icon" />
          </button>
          <button v-if="canUploadMedia && mediaAdapter" type="button" aria-label="插入解析图片" title="插入解析图片"
            :disabled="analysisPending" @mousedown.prevent @click="chooseAnalysisPosition"><SvgIcon icon-class="image-line" /></button>
        </div>
        <TiptapEditor :key="clientId" ref="analysisEditor" :model-value="meta.analysis" profile="rich" :mode="readonly ? 'preview' : 'edit'" presentation="inline"
          compact :show-toolbar="false" :show-panels="false" :media-resolver="mediaResolver" @update:model-value="patch({ analysis: $event })" />
      </div>
      <input v-if="!readonly && canUploadMedia && mediaAdapter" ref="analysisInput" type="file" accept="image/*" aria-label="解析图片" hidden @change="chooseAnalysisImage" @cancel="cancelAnalysisImage" />
      <div v-if="!readonly && canUploadMedia && mediaAdapter && (analysisUploading || analysisError)" class="question-properties__media-actions">
        <span v-if="analysisUploading" role="status">解析图片上传中…</span>
        <div v-if="analysisError" role="alert">{{ analysisError }} <el-button :disabled="analysisUploading" @click="uploadAnalysisImage">重试解析图片</el-button><el-button @click="cancelAnalysisImage">取消待上传</el-button></div>
      </div>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { QuestionMeta } from '../../api/question-document-types';
import type { QuestionType as SingleQuestionType } from '../../api/training-types';
import type { DesignerMediaAdapter, DesignerOption } from './contracts';
import TiptapEditor from '../Tiptap/index.vue';
import SvgIcon from '../Tiptap/components/SvgIcon.vue';
import { isControlledMediaAssetId, type MediaResolver } from '../Tiptap/extensions/MediaImage';
import { CONTROLLED_UPDATE_META } from '../Tiptap/utils/widgetNodeViewRegistry';
import type { QuestionRegulationOption } from '../Tiptap/components/QuestionSetting.vue';

const props = withDefaults(defineProps<{
  clientId: string; meta: QuestionMeta; answerSummary?: string; categories?: Array<{ id: string; name: string }>;
  regulations?: QuestionRegulationOption[];
  readonly?: boolean; categoryReadonly?: boolean; totalScore?: number; mediaResolver?: MediaResolver; difficultyOptions?: DesignerOption[];
  canUploadMedia?: boolean; mediaAdapter?: DesignerMediaAdapter;
  questionPosition?: number; questionCount?: number; positionDisabled?: boolean;
}>(), { answerSummary: '', categories: () => [], regulations: () => [], readonly: false, categoryReadonly: false, totalScore: 100,
  difficultyOptions: () => [] });
const emit = defineEmits<{ change: [patch: Partial<QuestionMeta>]; 'type-change': [type: SingleQuestionType]; 'upload-state-change': [state: { pending: boolean }]; 'move-position': [position: number] }>();
const positionDraft = ref('');
watch(() => [props.clientId, props.questionPosition, props.questionCount], () => { positionDraft.value = String(props.questionPosition ?? ''); }, { immediate: true });
const validPosition = computed(() => positionDraft.value.trim() !== '' && Number.isInteger(Number(positionDraft.value)) && Number(positionDraft.value) >= 1 && Number(positionDraft.value) <= (props.questionCount ?? 0));
function moveToPosition() {
  if (props.readonly || props.positionDisabled || !validPosition.value) return;
  if (Number(positionDraft.value) === props.questionPosition) { ElMessage.info('当前题目已在该位置'); return; }
  emit('move-position', Number(positionDraft.value));
}
const scoreDraft = ref('');
const scoreLimit = computed(() => Number.isFinite(props.totalScore) && props.totalScore > 0 ? Math.min(999.99, props.totalScore) : 999.99);
watch(() => [props.clientId, props.meta.score_cents] as const, ([clientId, cents], previous) => {
  if (previous?.[0] === clientId && scoreDraft.value !== '' && Math.round(Number(scoreDraft.value) * 100) === cents) return;
  scoreDraft.value = String(cents / 100);
}, { immediate: true });
function changeScore(value: string) {
  if (props.readonly) return;
  scoreDraft.value = value;
  const score = Number(value);
  if (value.trim() && Number.isFinite(score) && score >= 0 && score <= scoreLimit.value) patch({ score_cents: Math.round(score * 100) });
}
function finishScore() {
  if (props.readonly) return;
  const score = Number(scoreDraft.value);
  if (!scoreDraft.value.trim() || !Number.isFinite(score)) { scoreDraft.value = String(props.meta.score_cents / 100); return; }
  const cents = Math.min(Math.round(scoreLimit.value * 100), Math.max(0, Math.round(score * 100)));
  scoreDraft.value = String(cents / 100);
  patch({ score_cents: cents });
}
const analysisEditor = ref<InstanceType<typeof TiptapEditor> | null>(null);
type AnalysisFormat = 'bold' | 'italic' | 'underline' | 'bulletList';
const analysisFormats: Array<{ name: AnalysisFormat; label: string; icon: string }> = [
  { name: 'bold', label: '解析加粗', icon: 'bold' },
  { name: 'italic', label: '解析斜体', icon: 'italic' },
  { name: 'underline', label: '解析下划线', icon: 'underline' },
  { name: 'bulletList', label: '解析无序列表', icon: 'list-unordered' },
];
const analysisRevision = ref(0);
watch(() => analysisEditor.value?.getEditor(), (editor, _previous, onCleanup) => {
  if (!editor) return;
  const refresh = () => { analysisRevision.value += 1; };
  editor.on('transaction', refresh);
  onCleanup(() => editor.off('transaction', refresh));
}, { flush: 'post' });
function analysisFormatActive(name: AnalysisFormat) {
  void analysisRevision.value;
  return analysisEditor.value?.getEditor()?.isActive(name) ?? false;
}
function formatAnalysis(name: AnalysisFormat) {
  if (props.readonly) return;
  const chain = analysisEditor.value?.getEditor()?.chain().focus();
  if (!chain) return;
  if (name === 'bold') chain.toggleBold().run();
  else if (name === 'italic') chain.toggleItalic().run();
  else if (name === 'underline') chain.toggleUnderline().run();
  else chain.toggleBulletList().run();
}
const analysisInput = ref<HTMLInputElement | null>(null); const analysisUploading = ref(false); const analysisPending = ref(false); const analysisError = ref('');
let analysisFile: File | null = null; let analysisSerial = 0;
let analysisAnchor: { editor: Editor; key: PluginKey<number | null> } | null = null;
function patch(value: Partial<QuestionMeta>) {
  if (props.readonly || props.categoryReadonly && Object.prototype.hasOwnProperty.call(value, 'category_id')) return;
  emit('change', value);
}
function chooseAnalysisPosition() {
  const editor = analysisEditor.value?.getEditor();
  if (!editor || props.readonly || !props.canUploadMedia || analysisPending.value || !editor.state.selection.$from.parent.isTextblock) return;
  const position = editor.state.selection.from;
  const key = new PluginKey<number | null>('analysisImageUpload');
  // A view-only placeholder follows edits without leaking File/blob/temporary nodes
  // into the controlled authoring document or changing its dirty baseline.
  editor.registerPlugin(new Plugin<number | null>({
    key,
    state: {
      init: () => position,
      apply(transaction, previous) {
        if (previous === null || transaction.getMeta(CONTROLLED_UPDATE_META)) return null;
        const mapped = transaction.mapping.mapResult(previous, 1);
        return mapped.deletedAcross || !transaction.doc.resolve(mapped.pos).parent.isTextblock ? null : mapped.pos;
      },
    },
    props: {
      decorations(state) {
        const anchor = key.getState(state);
        return anchor == null ? DecorationSet.empty : DecorationSet.create(state.doc, [Decoration.widget(anchor, () => {
          const placeholder = document.createElement('span');
          placeholder.dataset.analysisImageUpload = ''; placeholder.contentEditable = 'false'; placeholder.textContent = '待上传解析图片';
          return placeholder;
        }, { key: 'analysis-image-upload', side: 1 })]);
      },
    },
  }));
  analysisAnchor = { editor, key }; analysisPending.value = true; emit('upload-state-change', { pending: true });
  analysisInput.value?.click();
}
function cancelAnalysisImage() {
  analysisSerial += 1;
  if (analysisAnchor && !analysisAnchor.editor.isDestroyed) analysisAnchor.editor.unregisterPlugin(analysisAnchor.key);
  analysisAnchor = null; analysisFile = null; analysisUploading.value = false; analysisPending.value = false; analysisError.value = '';
  emit('upload-state-change', { pending: false });
}
async function chooseAnalysisImage(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) { cancelAnalysisImage(); return; }
  analysisFile = file;
  await uploadAnalysisImage();
}
async function uploadAnalysisImage() {
  if (!analysisFile || !props.mediaAdapter || props.readonly || !props.canUploadMedia || analysisUploading.value) return;
  const ticket = ++analysisSerial; const clientId = props.clientId; analysisError.value = ''; analysisUploading.value = true; emit('upload-state-change', { pending: true });
  try {
    const result = await props.mediaAdapter.upload(analysisFile);
    if (ticket !== analysisSerial || clientId !== props.clientId || props.readonly || !props.canUploadMedia) return;
    if (!isControlledMediaAssetId(result.asset_id)) throw new Error('上传结果缺少有效图片资源标识');
    const anchor = analysisAnchor;
    const position = anchor && !anchor.editor.isDestroyed ? anchor.key.getState(anchor.editor.state) : null;
    if (!anchor || position == null || !anchor.editor.chain().setTextSelection(position)
      .insertMediaImage({ asset_id: result.asset_id, alt: '解析图片' }).run()) throw new Error('原插入位置已失效，请取消待上传后重新选择位置');
    cancelAnalysisImage();
  } catch (failure) { if (ticket === analysisSerial) analysisError.value = failure instanceof Error ? failure.message : '解析图片上传失败'; }
  finally { if (ticket === analysisSerial) analysisUploading.value = false; }
}
watch(() => props.clientId, cancelAnalysisImage);
watch([() => props.readonly, () => props.canUploadMedia], ([readonly, allowed]) => { if (readonly || !allowed) cancelAnalysisImage(); });
onBeforeUnmount(cancelAnalysisImage);
</script>

<style scoped>
.question-properties__position { width:100%; min-width:0; border:1px solid var(--el-border-color); border-radius:var(--el-border-radius-base, 4px); overflow:hidden; box-sizing:border-box; transition:border-color .18s, box-shadow .18s; }
.question-properties__position:not(.is-disabled):hover { border-color:var(--el-border-color-hover); }
.question-properties__position:not(.is-disabled):focus-within { border-color:var(--el-color-primary); box-shadow:0 0 0 3px var(--el-color-primary-light-9); }
.question-properties .question-properties__position :deep(.el-input__wrapper),
.question-properties .question-properties__position :deep(.el-input__wrapper.is-focus) { border-radius:0; box-shadow:none !important; min-height:30px; }
.question-properties .question-properties__position :deep(.el-input-group__append) { width:48px; padding:0; border:0; border-left:1px solid var(--el-border-color-lighter); border-radius:0; box-shadow:none; overflow:hidden; }
.question-properties__position .el-button { width:100%; height:100%; min-height:30px; margin:0; padding:0 10px; border:0; border-radius:0; box-shadow:none; background:transparent; }
.question-properties__position .el-button:not(:disabled):hover { color:var(--el-color-primary); background:var(--el-color-primary-light-9); }
.question-properties__position-hint { font-size:12px; color:var(--el-text-color-placeholder); white-space:nowrap; }
.question-properties :deep(.el-input-group__append) { width:40px; padding:0; box-sizing:border-box; }
.question-properties :deep(input[type="number"]) { appearance:textfield; -moz-appearance:textfield; }
.question-properties :deep(input::-webkit-inner-spin-button),
.question-properties :deep(input::-webkit-outer-spin-button) { -webkit-appearance:none; margin:0; }
.question-properties .el-select,.question-properties .el-input { width:100%; }
.question-properties :deep(.el-form-item__content) { min-width:0; }
.question-properties :deep(.ruleexam-tiptap-inline-host) { width:100%; min-width:0; }
.question-properties__analysis-body { width:100%; min-width:0; box-sizing:border-box; overflow:hidden; border:1px solid var(--el-border-color, #dcdfe6); border-radius:6px; background:#fff; }
.question-properties__analysis-body:focus-within { border-color:var(--el-color-primary, #3056d3); }
.question-properties__analysis-toolbar { display:flex; align-items:center; gap:2px; min-height:36px; padding:0 6px; border-bottom:1px solid var(--el-border-color-lighter, #ebeef5); background:#fafbfc; }
.question-properties__analysis-toolbar button { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; padding:0; border:0; border-radius:4px; color:#475569; background:transparent; cursor:pointer; font-size:16px; }
.question-properties__analysis-toolbar button:hover,.question-properties__analysis-toolbar button[aria-pressed='true'] { background:#e8eef7; color:var(--el-color-primary, #409eff); }
.question-properties__analysis-toolbar button:disabled { opacity:.4; cursor:default; }
.question-properties__analysis-body :deep(.editor-main-wrapp) { border:0; box-shadow:none; background:transparent; }
.question-properties__media-actions { width:100%; margin-top:8px; font-size:12px; }
.question-properties :deep(.ruleexam-tiptap .header) { min-height:36px; padding:4px; }
.question-properties :deep(.ruleexam-tiptap .header-menu) { min-width:0; padding:0; overflow-x:auto; justify-content:flex-start; }
.question-properties :deep(.ruleexam-tiptap .header-menu .menu-btn-groups) { justify-content:flex-start; }
.question-properties :deep(.ruleexam-tiptap .header-btns) { display:none; }
.question-properties :deep(.ruleexam-tiptap .editor-main) { padding:0; border:0; background:#fff; }
.question-properties :deep(.ruleexam-tiptap .ProseMirror) { min-height:110px; padding:12px 20px; box-sizing:border-box; }
</style>
