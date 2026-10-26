<template>
  <el-form label-position="left" label-width="76px" require-asterisk-position="right" class="question-properties" @submit.prevent>
    <h3 class="designer-property-group-title">基础属性</h3>
    <div class="designer-property-content">
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
      <el-input-number aria-label="分值" :model-value="meta.score_cents / 100" :min="0.01" :max="100" :precision="2" :step="0.5" :disabled="readonly" @update:model-value="patch({ score_cents: Math.round(Number($event) * 100) })" />
    </el-form-item>
    <el-form-item label="答案摘要"><span>{{ answerSummary || '未设置' }}</span></el-form-item>
    </div>
    <h3 class="designer-property-group-title">答案解析</h3>
    <div class="designer-property-content question-properties__rich" aria-label="解析">
      <TiptapEditor :key="clientId" ref="analysisEditor" :model-value="meta.analysis" profile="rich" :mode="readonly ? 'preview' : 'edit'" presentation="inline"
        :show-toolbar="!readonly" :show-panels="false" :media-resolver="mediaResolver" @update:model-value="patch({ analysis: $event })" />
      <input v-if="!readonly && canUploadMedia && mediaAdapter" ref="analysisInput" type="file" accept="image/*" aria-label="解析图片" hidden @change="chooseAnalysisImage" @cancel="cancelAnalysisImage" />
      <div v-if="!readonly && canUploadMedia && mediaAdapter" class="question-properties__media-actions">
        <el-button :disabled="analysisPending" @mousedown.prevent @click="chooseAnalysisPosition">插入解析图片</el-button>
        <span v-if="analysisUploading" role="status">解析图片上传中…</span>
        <div v-if="analysisError" role="alert">{{ analysisError }} <el-button :disabled="analysisUploading" @click="uploadAnalysisImage">重试解析图片</el-button><el-button @click="cancelAnalysisImage">取消待上传</el-button></div>
      </div>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { QuestionMeta } from '../../api/question-document-types';
import type { QuestionType as SingleQuestionType } from '../../api/training-types';
import type { DesignerMediaAdapter, DesignerOption } from './contracts';
import TiptapEditor from '../Tiptap/index.vue';
import { isControlledMediaAssetId, type MediaResolver } from '../Tiptap/extensions/MediaImage';
import { CONTROLLED_UPDATE_META } from '../Tiptap/utils/widgetNodeViewRegistry';
import type { QuestionRegulationOption } from '../Tiptap/components/QuestionSetting.vue';

const props = withDefaults(defineProps<{
  clientId: string; meta: QuestionMeta; answerSummary?: string; categories?: Array<{ id: string; name: string }>;
  regulations?: QuestionRegulationOption[];
  readonly?: boolean; categoryReadonly?: boolean; mediaResolver?: MediaResolver; difficultyOptions?: DesignerOption[];
  canUploadMedia?: boolean; mediaAdapter?: DesignerMediaAdapter;
}>(), { answerSummary: '', categories: () => [], regulations: () => [], readonly: false, categoryReadonly: false,
  difficultyOptions: () => [] });
const emit = defineEmits<{ change: [patch: Partial<QuestionMeta>]; 'type-change': [type: SingleQuestionType]; 'upload-state-change': [state: { pending: boolean }] }>();
const analysisEditor = ref<InstanceType<typeof TiptapEditor> | null>(null);
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
.question-properties .el-select,.question-properties .el-input-number { width:100%; }
.question-properties :deep(.el-form-item__content) { min-width:0; }
.question-properties :deep(.ruleexam-tiptap-inline-host) { width:100%; min-width:0; }
.question-properties__rich :deep(.ruleexam-tiptap-inline-host) { box-sizing:border-box; border:1px solid #e0e5ee; border-radius:4px; overflow:hidden; }
.question-properties__media-actions { width:100%; margin-top:8px; font-size:12px; }
.question-properties :deep(.ruleexam-tiptap .header) { min-height:36px; padding:4px; }
.question-properties :deep(.ruleexam-tiptap .header-menu) { min-width:0; padding:0; overflow-x:auto; justify-content:flex-start; }
.question-properties :deep(.ruleexam-tiptap .header-menu .menu-btn-groups) { justify-content:flex-start; }
.question-properties :deep(.ruleexam-tiptap .header-btns) { display:none; }
.question-properties :deep(.ruleexam-tiptap .editor-main) { padding:0; border:0; background:#fff; }
.question-properties :deep(.ruleexam-tiptap .ProseMirror) { min-height:150px; padding:10px; box-sizing:border-box; }
</style>
