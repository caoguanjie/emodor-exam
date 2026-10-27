<template>
  <div class="paper-designer-page">
    <div v-if="!designerVisible" v-loading="loading || designerLoading" class="page-card paper-designer-status">
      <el-alert v-if="designerError" :title="designerError" type="error" :closable="false" />
      <el-alert v-else-if="paper && !canDesign" :title="unavailableMessage" type="info" :closable="false" />
      <span v-else>正在加载试卷设计器…</span>
      <div class="paper-designer-status__actions">
        <el-button @click="closeDesigner">返回试卷管理</el-button>
        <el-button v-if="designerError" type="primary" :loading="loading || designerLoading" @click="reloadDesigner">重试设计器</el-button>
      </div>
    </div>
    <el-dialog :model-value="designerVisible" fullscreen :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false" class="paper-designer-dialog" destroy-on-close>
      <el-alert v-if="designerError" :title="designerError" type="error" :closable="false" />
      <el-alert v-if="designerHistoricalDifficulties" type="warning" :closable="false" title="当前草稿保留中级或已停用难度题目；请明确重新分类后再保存或发布。" />
      <PaperDesigner v-if="designerValue && designerHost && designerVisible" :model-value="designerValue" mode="edit"
        :save-draft="saveDesignerDraft" :categories="categories" :regulations="designerRegulations" :courses="designerCourses"
        :question-library-source="designerHost.questionLibrarySource" :paper-library-source="designerHost.paperLibrarySource"
        :difficulty-options="authoringOptions.difficultyOptions.value"
        :media-resolver="designerMediaResolver" :media-adapter="designerMediaAdapter"
        @update:model-value="designerValue = $event" @dirty-change="designerDirty = $event" @close="closeDesigner" @saved="onDesignerSaved" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type { Id, Page, TrainingPaperDetail } from '../../api/training-types';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';
import PaperDesigner from '../../components/question-designers/PaperDesigner.vue';
import type { PaperDesignerValue, SaveContext } from '../../components/question-designers/contracts';
import { createPaperDesignerHost } from '../../composables/paper-designer-host';
import { useAuthoringOptions } from '../../composables/useAuthoringOptions';
import { uploadMedia } from '../../api/media';
import { resolvePcMediaSource } from '../../services/media-content';

interface NamedOption { id: Id; name?: string; title?: string }
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const paperId = String(route.params.id);
const detailRouteKey = route.fullPath;
const paper = ref<TrainingPaperDetail | null>(null);
const categories = ref<Array<{ id: Id; name: string }>>([]);
const loading = ref(false);
const canDesign = computed(() => paper.value?.status === 'draft' && paper.value?.mode === 'fixed' && auth.can('papers:write') && auth.can('questions:read'));
const unavailableMessage = computed(() => paper.value?.status !== 'draft'
  ? '已发布或历史试卷不可编辑，请返回试卷管理查看预览。'
  : paper.value?.mode !== 'fixed' ? '此历史试卷不支持当前设计器，请返回试卷管理查看预览。' : '当前账号没有试卷设计权限。');
const designerVisible = ref(false);
const designerLoading = ref(false);
const designerError = ref('');
const designerDirty = ref(false);
const designerValue = ref<PaperDesignerValue | null>(null);
const designerHost = shallowRef<ReturnType<typeof createPaperDesignerHost> | null>(null);
const authoringOptions = useAuthoringOptions();
let viewContext = 0;
let designerOperation = 0;
let designerRelationOperation = 0;
let viewActive = true;
let viewDestroyed = false;
const designerRelationOptions = ref<{ category: Id; courses: NamedOption[] }>({ category: '', courses: [] });
const designerHistoricalDifficulties = computed(() => Object.values(designerValue.value?.document.questions || {}).some((meta) => !authoringOptions.difficultyOptions.value.some((option) => option.value === meta.difficulty)));
const designerRegulations = computed(() => (designerValue.value?.paper.regulation_ids || []).map((id) => ({ id, title: `资料 ${id}`, category_id: designerValue.value?.paper.category_id || '' })));
const designerCourses = computed(() => designerRelationOptions.value.courses.map((item) => ({ id: item.id, title: item.title || item.name || String(item.id), category_id: designerRelationOptions.value.category })));
const designerMediaResolver = (id: string) => { if (!auth.can('media:read')) return Promise.reject(new Error('无图片读取权限')); return resolvePcMediaSource(id); };
const designerMediaAdapter = computed(() => auth.can('media:write') && auth.can('questions:write') ? { upload: (file: File) => uploadMedia(file, 'question') } : undefined);
const designerGuardDirty = computed(() => designerVisible.value && (designerDirty.value || !!designerHost.value?.busy.value || !!designerHost.value?.pending.value));
useUnsavedChanges(designerGuardDirty, { canDiscard: () => designerHost.value?.canDiscard() !== false,
  onBlocked: () => { designerError.value = '保存结果尚未确认，请继续保存查询原请求'; }, onDiscard: releaseDesigner });
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function releaseDesigner() { designerOperation += 1; designerRelationOperation += 1; designerVisible.value = false; designerDirty.value = false; designerHost.value?.dispose(); designerHost.value = null; designerValue.value = null; }
watch(() => [designerValue.value?.paper.category_id, designerValue.value?.paper.requires_learning] as const, async ([category, requiresLearning]) => {
  const operation = ++designerRelationOperation;
  const context = viewContext;
  if (!category || !requiresLearning) { designerRelationOptions.value = { category: '', courses: [] }; return; }
  if (category === designerRelationOptions.value.category) return;
  designerRelationOptions.value = { category: '', courses: [] };
  try {
    const courses = await http.get('/admin/papers/course-options', { params: { category_id: category, page: 1, page_size: 100 } }) as Page<NamedOption>;
    if (context === viewContext && operation === designerRelationOperation && designerValue.value?.paper.category_id === category && designerValue.value?.paper.requires_learning) designerRelationOptions.value = { category, courses: courses.items };
  } catch (failure) { if (operation === designerRelationOperation) designerError.value = failure instanceof Error ? failure.message : '关联选项载入失败'; }
});
async function openDesigner() {
  if (!viewActive || route.fullPath !== detailRouteKey || !canDesign.value || designerLoading.value || designerVisible.value) return;
  const operation = ++designerOperation; const context = viewContext; designerLoading.value = true; designerError.value = '';
  const host = createPaperDesignerHost({ api: http, paperId, access: { read: auth.can('papers:read'), write: auth.can('papers:write'), questionsRead: auth.can('questions:read'), questionsWrite: auth.can('questions:write') } });
  try {
    await authoringOptions.load();
    if (authoringOptions.error.value || !authoringOptions.difficultyOptions.value.length) throw new Error(authoringOptions.error.value || '没有启用的难度，请重试设计器');
    const value = await host.load();
    if (operation !== designerOperation || context !== viewContext || !viewActive || !canDesign.value) { host.dispose(); return; }
    designerRelationOptions.value = { category: '', courses: [] };
    designerHost.value?.dispose(); designerHost.value = host; designerValue.value = value; designerDirty.value = false; designerVisible.value = true;
  } catch (failure) { host.dispose(); if (operation === designerOperation && context === viewContext) designerError.value = failure instanceof Error ? failure.message : '设计器载入失败'; }
  finally { if (operation === designerOperation) designerLoading.value = false; }
}
async function saveDesignerDraft(value: PaperDesignerValue, context: SaveContext) {
  if (!canDesign.value || !designerHost.value || authoringOptions.error.value || !authoringOptions.difficultyOptions.value.length) throw new Error('当前无试卷编辑权限或难度目录不可用');
  if (Object.values(value.document.questions).some((meta) => !authoringOptions.difficultyOptions.value.some((option) => option.value === meta.difficulty))) throw new Error('请将停用难度题目明确重新分类后再保存');
  const host = designerHost.value;
  const view = viewContext;
  const operation = designerOperation;
  const submitted = clone(value);
  if (submitted.paper.regulation_ids?.length) {
    if (!await confirmLegacyPaperConversion()) throw new Error('已取消保存，旧版选题限制未变更');
    if (view !== viewContext || operation !== designerOperation || host !== designerHost.value || !canDesign.value || !viewActive) throw new Error('当前试卷编辑会话已变化，请重新保存');
    submitted.paper.regulation_ids = [];
  }
  const outcome = await host.saveDraft(submitted, context);
  return outcome;
}
async function onDesignerSaved() { ElMessage.success('试卷已保存'); await closeDesigner(); }
async function closeDesigner() {
  if (designerHost.value?.canDiscard() === false) { designerError.value = '保存结果尚未确认，请继续保存查询原请求'; return; }
  releaseDesigner();
  await router.replace('/admin/papers');
}
async function confirmLegacyPaperConversion(): Promise<boolean> {
  try {
    await ElMessageBox.confirm('当前草稿保留旧版选题范围限制。转换会解除该限制，保留现有题目来源和历史发布版本。是否转换并继续保存？', '转换为当前试卷配置', {
      type: 'warning', confirmButtonText: '转换并保存', cancelButtonText: '取消',
    });
    return true;
  } catch { return false; }
}

async function reloadDesigner() {
  if (!viewActive || viewDestroyed || route.fullPath !== detailRouteKey || loading.value) return;
  if (!auth.can('papers:read')) { designerError.value = '当前账号没有试卷查看权限。'; return; }
  const context = viewContext;
  loading.value = true; designerError.value = '';
  try {
    const [data, categoryPage] = await Promise.all([
      http.get(`/admin/papers/${paperId}`) as Promise<TrainingPaperDetail>,
      http.get('/admin/papers/category-options', { params: { page: 1, page_size: 100 } }) as Promise<Page<{ id: Id; name: string }>>,
    ]);
    if (context !== viewContext || !viewActive || viewDestroyed) return;
    paper.value = data; categories.value = categoryPage.items;
    await openDesigner();
  } catch (failure) { if (context === viewContext) designerError.value = failure instanceof Error ? failure.message : '试卷加载失败，请重试'; }
  finally { if (context === viewContext) loading.value = false; }
}
function deactivate() { viewActive = false; viewContext += 1; loading.value = false; designerLoading.value = false; releaseDesigner(); }
onActivated(() => { const wasInactive = !viewActive; viewActive = true; if (wasInactive) void reloadDesigner(); });
onDeactivated(deactivate);
onBeforeUnmount(() => { viewDestroyed = true; deactivate(); });
onMounted(reloadDesigner);
</script>

<style scoped>
.paper-designer-status__actions { display:flex; gap:8px; margin-top:16px; }
:global(.paper-designer-dialog.el-dialog) { padding:0; }
:global(.paper-designer-dialog .el-dialog__header) { display:none; }
:global(.paper-designer-dialog .el-dialog__body) { padding:0; height:100%; display:flex; flex-direction:column; }
:global(.paper-designer-dialog .paper-designer) { flex:1; }
</style>
