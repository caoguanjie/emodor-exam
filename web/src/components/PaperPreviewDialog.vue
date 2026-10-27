<template>
    <el-dialog v-model="previewVisible" :title="previewAnswers ? '答案版预览' : '试卷预览'" width="min(960px, calc(100vw - 32px))" align-center class="re-form-dialog paper-preview-dialog" modal-class="paper-preview-overlay" @closed="onPreviewClosed">
      <div v-if="previewLoading" v-loading="true" class="preview-loading" aria-label="正在加载试卷预览" />
      <template v-if="preview">
        <div class="preview-controls">
        <el-alert v-if="preview.mode === 'random'" type="warning" :closable="false" :title="preview.note" style="margin-bottom:14px" />
        <el-alert v-if="previewResourcesFailed" type="error" :closable="false" title="部分题图加载或解码失败，已阻止打印。请重试题图后再打印。" style="margin-bottom:14px"><el-button size="small" @click="retryPreviewMedia">重试题图</el-button></el-alert>
        <div v-if="preview.mode === 'random'" class="toolbar preview-difficulty"><span>样例难度</span><el-radio-group v-model="previewDifficulty" @change="reloadPreview"><el-radio-button value="easy">简单</el-radio-button><el-radio-button value="hard">困难</el-radio-button></el-radio-group><span class="preview-difficulty-print">{{ difficultyLabel(previewDifficulty) }}</span></div>
        <el-table v-if="preview.capacities.length" :data="preview.capacities" size="small" style="margin-bottom:16px"><el-table-column label="难度" width="90"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column><el-table-column label="题型"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column><el-table-column prop="required" label="需要考点数" /><el-table-column prop="available" label="可用考点数" /></el-table>
        </div>
        <article class="paper-print-sheet" aria-label="试卷正文">
        <h1 class="preview-paper-title">{{ previewSession?.title }}</h1>
        <p v-if="preview.mode === 'random'" class="preview-sample-note">随机试卷样例，仅用于排版预览，不代表每位学员的实际题单。</p>
        <div v-for="(question, index) in preview.questions" :key="`${previewSession?.operation}:${previewRenderAttempt}:${question.question_version_id}`" class="preview-question">
          <QuestionPreview :question="question" variant="paper" :question-number="index + 1" :reveal-answer="previewAnswers" :show-score="false" @ready="markPreviewQuestionReady(previewSession?.operation || 0, previewRenderAttempt, question.question_version_id, $event)" />
        </div>
        </article>
      </template>
      <template #footer><span class="paper-print-settings-hint">打印设置：A4、缩放 100%，取消勾选“页眉和页脚”</span><el-button @click="closePreview">关闭</el-button><el-button type="primary" :loading="previewLoading" :disabled="!previewResourcesReady" @click="printPreview">打印</el-button></template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api/http';
import type { Id, PaperPreview, QuestionType } from '../api/training-types';
import QuestionPreview from './QuestionPreview.vue';
import { useAuthStore } from '../stores/auth';

interface PreviewSession { data: PaperPreview; withAnswers: boolean; difficulty: 'easy' | 'hard'; paperId: string; title: string; operation: number }
const auth = useAuthStore();
const emit = defineEmits<{ 'visibility-change': [visible: boolean] }>();
const previewVisible = ref(false);
const previewSession = ref<PreviewSession | null>(null);
const preview = computed(() => previewSession.value?.data || null);
const previewAnswers = computed(() => previewSession.value?.withAnswers || requestedAnswers.value);
const requestedAnswers = ref(false);
const previewDifficulty = ref<'easy' | 'hard'>('easy');
const previewLoading = ref(false);
const previewRenderAttempt = ref(0);
const previewQuestionReady = ref<Record<string, boolean>>({});
const previewResourcesReady = computed(() => !previewLoading.value && !!previewSession.value && previewSession.value.data.questions.every(question => previewQuestionReady.value[question.question_version_id] === true));
const previewResourcesFailed = computed(() => Object.values(previewQuestionReady.value).some(ok => ok === false));
let previewOperation = 0;
let destroyed = false;
function typeLabel(type: QuestionType | string) { return ({ single:'单选', multiple:'多选', judgment:'判断' } as Record<string,string>)[type] || type; }
function difficultyLabel(value: string) { return ({ easy:'简单', medium:'中级', hard:'困难' } as Record<string,string>)[value] || value; }
function canAnswerPreview() { return auth.can('papers:export') || auth.can('questions:read') || auth.can('questions:export'); }
function invalidatePreview() { previewOperation += 1; previewLoading.value = false; previewSession.value = null; previewQuestionReady.value = {}; previewRenderAttempt.value = 0; }
async function open(row: {id: Id; title: string}, withAnswers = false) {
  if (destroyed || !auth.can('papers:read') || withAnswers && !canAnswerPreview()) return;
  const operation = ++previewOperation;
  const difficulty = previewDifficulty.value;
  requestedAnswers.value = withAnswers;
  previewLoading.value = true; previewSession.value = null; previewQuestionReady.value = {}; previewRenderAttempt.value = 0; previewVisible.value = true;
  try {
    const data = await http.get(`/admin/papers/${row.id}/preview${withAnswers ? '/answers' : ''}`, { params: {difficulty} }) as PaperPreview;
    if (destroyed || operation !== previewOperation || !previewVisible.value) return;
    if (!auth.can('papers:read') || withAnswers && !canAnswerPreview()) { closePreview(); return; }
    previewSession.value = {data, withAnswers, difficulty, paperId: String(row.id), title: row.title, operation};
  } catch {
    if (operation === previewOperation) closePreview();
  } finally { if (operation === previewOperation) previewLoading.value = false; }
}
async function reloadPreview() { const session = previewSession.value; if (session) await open({id: session.paperId, title: session.title}, session.withAnswers); }
function closePreview() { previewVisible.value = false; invalidatePreview(); }
function onPreviewClosed() { if (!previewVisible.value) invalidatePreview(); }
function retryPreviewMedia() { if (!previewSession.value) return; previewQuestionReady.value = {}; previewRenderAttempt.value += 1; }
function markPreviewQuestionReady(operation: number, attempt: number, questionVersionId: Id, result: {ok: boolean}) {
  if (previewSession.value?.operation !== operation || previewRenderAttempt.value !== attempt) return;
  previewQuestionReady.value = {...previewQuestionReady.value, [questionVersionId]:result.ok};
}
function printPreview() {
  if (!previewResourcesReady.value) { ElMessage.warning(previewResourcesFailed.value ? '题图加载失败，当前不能打印' : '题图仍在加载，请稍后打印'); return; }
  window.print();
}
watch(previewVisible, visible => { emit('visibility-change', visible); if (!visible) invalidatePreview(); }, {flush:'sync'});
onDeactivated(closePreview);
onBeforeUnmount(() => {destroyed = true; invalidatePreview();});
defineExpose({open, close:closePreview});

</script>

<style scoped>
.preview-loading { min-height:160px; }
.paper-print-sheet { box-sizing:border-box; width:210mm; min-height:297mm; margin:0 auto; padding:15mm; background:#fff; color:#000; font-family:SimSun,"Songti SC",serif; font-size:11pt; line-height:1.8; box-shadow:0 2px 10px rgb(0 0 0 / 8%); }
.preview-paper-title { margin:0 0 12mm; text-align:center; font-size:18pt; line-height:1.5; overflow-wrap:anywhere; }
.preview-sample-note { margin:0 0 6mm; font-size:10pt; }
.preview-difficulty { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
.preview-difficulty-print { display:none; }
.preview-question { margin:0 0 8mm; }
.paper-print-settings-hint { flex:1 1 280px; margin-right:auto; color:var(--el-text-color-secondary); font-size:12px; text-align:left; }
</style>

<style>
@media screen {
  .paper-preview-overlay .el-overlay-dialog {
    position:absolute;
    inset:0;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:16px;
    box-sizing:border-box;
    overflow:hidden;
  }
  .el-dialog.re-form-dialog.paper-preview-dialog {
    display:flex;
    flex-direction:column;
    height:100%;
    max-height:100%;
    max-width:100%;
    margin:0;
    padding:0;
    box-sizing:border-box;
    overflow:hidden;
  }
  .el-dialog.re-form-dialog.paper-preview-dialog > .el-dialog__header { flex:0 0 auto; background:#fff; }
  .paper-preview-dialog > .el-dialog__body { flex:1 1 0; min-height:0; padding:24px; overflow:auto; box-sizing:border-box; background:#f1f3f5; }
  .paper-preview-dialog > .el-dialog__footer { display:flex; flex-wrap:wrap; align-items:center; gap:12px; flex:0 0 auto; padding:16px 24px; box-sizing:border-box; }
}
@page ruleexam-paper {
  size:A4 portrait;
  margin:15mm;
  @top-right { content:"海珠区安全教育培训中心"; font-family:SimSun,"Songti SC",serif; font-size:9pt; text-align:right; vertical-align:middle; }
  @bottom-right { content:"第 " counter(page) " 页 / 共 " counter(pages) " 页"; font-family:SimSun,"Songti SC",serif; font-size:9pt; text-align:right; vertical-align:middle; }
}
@media print {
  /* Keep the application ancestors on the same named page as the dialog:
     returning to an unnamed page after the dialog can create a trailing blank page. */
  html:has(.paper-preview-open),
  body:has(.paper-preview-open),
  body:has(.paper-preview-open) #app { page:ruleexam-paper; }
  body:has(.paper-preview-open) .page-enter { flex:none !important; }
  body:has(.paper-preview-open) .content-dialog-host { display:none !important; }
  .paper-preview-overlay .el-overlay-dialog { padding:0 !important; }
  .paper-preview-dialog { page:ruleexam-paper; padding:0 !important; border:0 !important; border-radius:0 !important; }
  .paper-preview-dialog .el-dialog__body { display:block !important; flex:none !important; }
  .paper-preview-dialog > .el-dialog__body { padding:0 !important; background:#fff !important; }
  .paper-preview-dialog .preview-controls { display:none !important; }
  .paper-preview-dialog .paper-print-sheet { width:auto !important; min-height:0 !important; margin:0 !important; padding:0 !important; box-shadow:none !important; }
  .paper-preview-dialog .preview-paper-title { break-after:avoid; }
}
</style>
