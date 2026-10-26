<template>
  <div v-if="paper" class="page-card paper-detail" :class="{ 'paper-preview-open': previewVisible }">
    <div class="toolbar">
      <el-button text @click="router.push('/admin/papers')"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      <el-divider direction="vertical" />
      <div class="detail-head"><h2 class="detail-title">{{ paper.title }}</h2><el-tag v-if="paper.mode === 'random'" type="warning">随机组卷</el-tag><el-tag :type="statusType(paper.status)">{{ statusLabel(paper.status) }}</el-tag></div>
      <div style="flex:1" />
      <el-button v-if="canDesign" type="primary" :loading="designerLoading" @click="openDesigner">编辑试卷</el-button>
      <el-button @click="openPreview(false)">预览</el-button>
      <el-button v-if="canAnswerPreview" @click="openPreview(true)">答案版</el-button>
      <el-button v-if="paper.mode === 'fixed' && auth.can('papers:write')" :loading="copyingPaper" :disabled="copyingPaper" @click="copyPaper">复制</el-button>
      <el-button v-if="paper.status === 'draft' && auth.can('papers:publish')" type="success" :disabled="dirty || fixedQuestions.some((item) => item.enabled === false)" @click="publishPaper">发布</el-button>
    </div>

    <el-alert v-if="paper.status !== 'draft'" type="info" :closable="false" style="margin-bottom:14px" :title="paper.mode === 'fixed' ? '发布版本不可修改；题库后续修订不会改写本卷。需要新规则或新题池时请复制为新试卷。' : '发布版本不可修改；题库后续修订不会改写本卷。'" />
    <el-alert v-else-if="dirty" type="warning" :closable="false" style="margin-bottom:14px" title="存在未保存配置；发布前请分别保存考试配置与固定题单。" />
    <el-alert v-if="designerError" :title="designerError" type="error" :closable="false" style="margin-bottom:14px"><el-button v-if="canDesign" @click="openDesigner">重试设计器</el-button></el-alert>

    <el-card shadow="never" class="section-card">
      <template #header><div class="card-head"><span>考试配置</span><el-button v-if="editable" type="primary" :loading="savingConfig" @click="saveConfig">保存配置</el-button></div></template>
      <el-form label-width="180px" @submit.prevent>
        <el-form-item label="试卷名称" required><el-input v-model="form.title" maxlength="128" :disabled="!editable" /></el-form-item>
        <el-form-item label="考试时间（分钟）" required><el-input-number v-model="form.duration_minutes" :min="1" :max="1440" :precision="0" :disabled="!editable" /></el-form-item>
        <el-form-item label="培训类别" required><el-select v-model="form.category_id" filterable style="width:100%" :disabled="!editable" @change="onCategoryChange"><el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="试卷总分（分）" required><el-input-number v-model="form.total_score" :min="0.01" :max="999.99" :precision="2" :disabled="!editable" /></el-form-item>
        <el-form-item label="及格分数（分）" required><el-input-number v-model="form.pass_score" :min="0.01" :max="form.total_score" :precision="2" :disabled="!editable" /></el-form-item>
        <el-form-item label="考前学习要求"><el-switch v-model="form.requires_learning" :disabled="!editable" /></el-form-item>
        <template v-if="form.requires_learning">
          <el-form-item label="关联课程" required><el-select v-model="form.course_ids" multiple filterable clearable style="width:100%" :disabled="!editable"><el-option v-for="item in courseOptions" :key="item.id" :label="item.title" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="累计学习时长（分钟）" required><el-input-number v-model="form.required_learning_minutes" :min="1" :max="2147483647" :precision="0" :disabled="!editable" /><div class="hint">所选课程的累计有效学习时长达到要求后，学员才可开考。</div></el-form-item>
        </template>
        <el-form-item label="最多考试次数"><el-input-number v-model="form.max_attempts" :min="1" :max="100" :disabled="!editable" /></el-form-item>
        <el-form-item label="漏选得分比例"><el-input-number v-model="form.partial_credit_ratio" :min="0" :max="1" :step="0.1" :disabled="!editable" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="3" :maxlength="1000" show-word-limit placeholder="选填" :disabled="!editable" /></el-form-item>
        <el-form-item v-if="form.mode === 'random'" label="题型规则">
          <div class="rules"><div v-for="(rule, index) in form.rules" :key="rule.type" class="rule-row"><span>{{ typeLabel(rule.type) }}</span><el-input-number v-model="rule.count" :min="1" :disabled="!editable" /><el-input-number v-model="rule.score_cents" :min="1" :max="Math.round(form.total_score * 100)" :disabled="!editable" /><span>整数分</span><el-button v-if="editable" text type="danger" @click="form.rules.splice(index, 1)">移除</el-button></div><el-button v-if="editable" size="small" @click="addRule">添加题型规则</el-button><div :class="['hint', ruleTotal === Math.round(form.total_score * 100) ? 'ok' : 'danger']">规则总分 {{ ruleTotal / 100 }} / {{ form.total_score }}；发布同时验证简单和困难题池容量。</div></div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="form.mode === 'fixed'" shadow="never" class="section-card">
      <template #header><div class="card-head"><span>固定题单（{{ fixedQuestions.length }} 题，{{ fixedTotal / 100 }} / {{ form.total_score }} 分）</span><div><el-button v-if="editable" @click="openCandidatePicker">选题</el-button><el-button v-if="editable" type="primary" :loading="savingQuestions" @click="saveFixedQuestions">保存固定题单</el-button></div></div></template>
      <el-table :data="fixedQuestions">
        <el-table-column prop="sort" label="顺序" width="70" /><el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip />
        <el-table-column label="题型 / 难度" width="130"><template #default="{ row }">{{ typeLabel(row.type) }} · {{ difficultyLabel(row.difficulty) }}</template></el-table-column>
        <el-table-column label="启用状态" width="100"><template #default="{ row }"><el-tag :type="row.enabled === false ? 'danger' : 'success'">{{ row.enabled === false ? '已停用' : '启用' }}</el-tag></template></el-table-column>
        <el-table-column label="来源" width="120"><template #default="{ row }">{{ row.regulation_id ? `资料 ${row.regulation_id}` : '无资料来源' }}</template></el-table-column>
        <el-table-column label="分值" width="180"><template #default="{ row }"><el-input-number v-model="row.score_cents" :min="0" :max="Math.round(form.total_score * 100)" :disabled="!editable" /><span class="hint inline">整数分</span></template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ row }"><FitsTableActions><FitsTableAction v-if="editable" type="danger" @click="removeFixed(row)">移除</FitsTableAction></FitsTableActions></template></el-table-column>
      </el-table>
    </el-card>

    <el-card v-else shadow="never" class="section-card">
      <template #header>随机组卷说明</template>
      <el-descriptions :column="2" border><el-descriptions-item label="本机构学员">简单题池</el-descriptions-item><el-descriptions-item label="外来学员">困难题池</el-descriptions-item><el-descriptions-item label="课程关联">用于考前学习要求，不过滤题池</el-descriptions-item></el-descriptions>
    </el-card>

    <el-dialog v-model="candidateVisible" title="选择当前启用的题目版本" width="900px">
      <div class="toolbar"><el-select v-model="candidateQuery.type" placeholder="题型" clearable style="width:140px" @change="changeCandidateFilter"><el-option v-for="item in questionTypes" :key="item" :label="typeLabel(item)" :value="item" /></el-select><el-select v-model="candidateQuery.difficulty" placeholder="难度" clearable style="width:140px" @change="changeCandidateFilter"><el-option v-for="item in authoringOptions.difficultyOptions.value" :key="item.value" :label="item.label" :value="item.value" /></el-select></div>
      <el-table :key="candidateSession" :data="candidates" row-key="question_version_id" @selection-change="updateCandidateSelection"><el-table-column type="selection" width="50" :reserve-selection="true" /><el-table-column prop="question_version_id" label="版本 ID" width="100" /><el-table-column prop="stem" label="题干" min-width="280" show-overflow-tooltip /><el-table-column label="题型/难度" width="120"><template #default="{ row }">{{ typeLabel(row.type) }} · {{ difficultyLabel(row.difficulty) }}</template></el-table-column></el-table>
      <div class="candidate-pagination"><span class="hint inline">已选 {{ pickedCandidates.length }} 题</span><el-pagination :current-page="candidatePage.page" :page-size="candidatePage.page_size" :total="candidatePage.total" layout="total, prev, pager, next" @current-change="changeCandidatePage" /></div>
      <template #footer><el-button @click="candidateVisible = false">取消</el-button><el-button type="primary" @click="addCandidates">加入题单</el-button></template>
    </el-dialog>

    <el-dialog v-model="previewVisible" :title="previewAnswers ? '答案版预览' : '试卷预览'" width="900px" class="paper-preview-dialog" modal-class="paper-preview-overlay" @closed="closePreview">
      <template v-if="preview">
        <el-alert :type="preview.mode === 'random' ? 'warning' : 'info'" :closable="false" :title="preview.note" style="margin-bottom:14px" />
        <el-alert v-if="previewResourcesFailed" type="error" :closable="false" title="部分题图加载或解码失败，已阻止打印。请重试题图后再打印。" style="margin-bottom:14px"><el-button size="small" @click="retryPreviewMedia">重试题图</el-button></el-alert>
        <div v-if="preview.mode === 'random'" class="toolbar preview-difficulty"><span>样例难度</span><el-radio-group v-model="previewDifficulty" @change="reloadPreview"><el-radio-button value="easy">初级</el-radio-button><el-radio-button value="hard">高级</el-radio-button></el-radio-group><span class="preview-difficulty-print">{{ difficultyLabel(previewDifficulty) }}</span></div>
        <el-table v-if="preview.capacities.length" :data="preview.capacities" size="small" style="margin-bottom:16px"><el-table-column label="难度" width="90"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column><el-table-column label="题型"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column><el-table-column prop="required" label="需要考点数" /><el-table-column prop="available" label="可用考点数" /></el-table>
        <div v-for="(question, index) in preview.questions" :key="`${previewSession?.operation}:${previewRenderAttempt}:${question.question_version_id}`" class="preview-question">
          <div class="preview-title">{{ index + 1 }}.</div>
          <QuestionPreview :question="question" :reveal-answer="previewAnswers" :show-score="true" @ready="markPreviewQuestionReady(previewSession?.operation || 0, previewRenderAttempt, question.question_version_id, $event)" />
        </div>
      </template>
      <template #footer><el-button :loading="previewLoading" :disabled="!previewResourcesReady" @click="printPreview">打印</el-button><el-button :disabled="!preview || previewLoading" @click="exportPreview">导出 JSON</el-button><el-button type="primary" @click="closePreview">关闭</el-button></template>
    </el-dialog>
    <el-dialog :model-value="designerVisible" fullscreen :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false" class="paper-designer-dialog" destroy-on-close>
      <el-alert v-if="designerError" :title="designerError" type="error" :closable="false" />
      <el-alert v-if="designerHistoricalDifficulties" type="warning" :closable="false" title="当前草稿保留中级或已停用难度题目；请明确重新分类后再保存或发布。" />
      <PaperDesigner v-if="designerValue && designerHost && designerVisible" :model-value="designerValue" mode="edit"
        :save-draft="saveDesignerDraft" :categories="categories" :regulations="designerRegulations" :courses="designerCourses"
        :question-library-source="designerHost.questionLibrarySource" :paper-library-source="designerHost.paperLibrarySource"
        :difficulty-options="authoringOptions.difficultyOptions.value"
        :media-resolver="designerMediaResolver" :media-adapter="designerMediaAdapter"
        @update:model-value="designerValue = $event" @dirty-change="designerDirty = $event" @close="closeDesigner" />
    </el-dialog>
  </div>
</template>

<script lang="ts">
// Full-path tabs own separate component instances; refresh the ordinary detail
// when a designer instance has persisted or closed this draft.
const designerDetailRefresh = new Set<string>();
</script>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type {
  Difficulty,
  Id,
  Page,
  PaperMode,
  PaperPreview,
  PaperRuleInput,
  QuestionType,
  TrainingPaperDetail,
  TrainingPaperCandidate,
  TrainingPaperQuestion,
  TrainingPaperStatus,
} from '../../api/training-types';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { resolvePaperSaveCompletion } from '../../utils/paper-editor-state';
import { useAuthStore } from '../../stores/auth';
import PaperDesigner from '../../components/question-designers/PaperDesigner.vue';
import type { PaperDesignerValue, SaveContext } from '../../components/question-designers/contracts';
import { createPaperDesignerHost } from '../../composables/paper-designer-host';
import { useAuthoringOptions } from '../../composables/useAuthoringOptions';
import { uploadMedia } from '../../api/media';
import { resolvePcMediaSource } from '../../services/media-content';

interface Draft {
  title: string;
  mode: PaperMode;
  category_id: Id;
  regulation_ids: Id[];
  course_ids: Id[];
  requires_learning: boolean;
  required_learning_minutes: number | null;
  remark: string;
  total_score: number;
  pass_score: number;
  duration_minutes: number;
  max_attempts: number;
  partial_credit_ratio: number;
  rules: PaperRuleInput[];
}
interface NamedOption { id: Id; name?: string; title?: string }
interface PreviewSession {
  data: PaperPreview;
  withAnswers: boolean;
  difficulty: 'easy' | 'hard';
  paperId: string;
  operation: number;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const paperId = String(route.params.id);
const detailRouteKey = route.fullPath;

const paper = ref<TrainingPaperDetail | null>(null);
const categories = ref<Array<{ id: Id; name: string }>>([]);
const courseOptions = ref<NamedOption[]>([]);
const form = reactive<Draft>({ title: '', mode: 'fixed', category_id: '', regulation_ids: [], course_ids: [], requires_learning: false, required_learning_minutes: null, remark: '', total_score: 100, pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5, rules: [] });
const fixedQuestions = ref<TrainingPaperQuestion[]>([]);
const dirty = ref(false);
const savingConfig = ref(false);
const savingQuestions = ref(false);
const copyingPaper = ref(false);
const candidateVisible = ref(false);
const candidates = ref<TrainingPaperCandidate[]>([]);
const pickedCandidates = ref<TrainingPaperCandidate[]>([]);
const candidateQuery = reactive<{ type: QuestionType | ''; difficulty: Difficulty | '' }>({ type: '', difficulty: '' });
const candidatePage = reactive({ page: 1, page_size: 50, total: 0 });
const candidateSession = ref(0);
const previewVisible = ref(false);
const previewSession = ref<PreviewSession | null>(null);
const preview = computed(() => previewSession.value?.data || null);
const previewAnswers = computed(() => previewSession.value?.withAnswers || false);
const previewDifficulty = ref<'easy' | 'hard'>('easy');
const previewLoading = ref(false);
const previewRenderAttempt = ref(0);
const previewQuestionReady = ref<Record<string, boolean>>({});
const questionTypes: QuestionType[] = ['single', 'multiple', 'judgment'];
const previewResourcesReady = computed(() => {
  if (previewLoading.value || !previewSession.value) return false;
  return previewSession.value.data.questions.every((question) => previewQuestionReady.value[question.question_version_id] === true);
});
const previewResourcesFailed = computed(() => Object.values(previewQuestionReady.value).some((ok) => ok === false));

let formBaseline: Draft = clone(form);
let questionBaseline: TrainingPaperQuestion[] = [];
let viewContext = 0;
let trainingLoadOperation = 0;
let trainingOptionsOperation = 0;
let configOperation = 0;
let configApplied = 0;
let questionOperation = 0;
let questionApplied = 0;
let publicationOperation = 0;
let copyOperation = 0;
let previewOperation = 0;
let candidateOperation = 0;
let relationToken = 0;
let viewActive = true;
let viewDestroyed = false;
let completedCopyNotice = false;
let categoryOptionsLoaded = false;
let relationOptionsCategory: Id | null = null;
let applyingDraft = false;

const unsaved = useUnsavedChanges(dirty, { onDiscard: restoreDraft });
const editable = computed(() => paper.value?.status === 'draft' && auth.can('papers:write'));
const canDesign = computed(() => editable.value && paper.value?.mode === 'fixed' && auth.can('questions:read'));
const designerVisible = ref(false);
const designerLoading = ref(false);
const designerError = ref('');
const designerDirty = ref(false);
const designerValue = ref<PaperDesignerValue | null>(null);
const designerHost = shallowRef<ReturnType<typeof createPaperDesignerHost> | null>(null);
const authoringOptions = useAuthoringOptions();
let designerOperation = 0;
let designerRelationOperation = 0;
const designerRelationOptions = ref<{ category: Id; courses: NamedOption[] }>({ category: '', courses: [] });
const designerHistoricalDifficulties = computed(() => Object.values(designerValue.value?.document.questions || {}).some((meta) => !authoringOptions.difficultyOptions.value.some((option) => option.value === meta.difficulty)));
const designerRegulations = computed(() => (designerValue.value?.paper.regulation_ids || []).map((id) => ({ id, title: `资料 ${id}`, category_id: designerValue.value?.paper.category_id || '' })));
const designerCourses = computed(() => designerRelationOptions.value.courses.map((item) => ({ id: item.id, title: item.title || item.name || String(item.id), category_id: designerRelationOptions.value.category })));
const designerMediaResolver = (id: string) => { if (!auth.can('media:read')) return Promise.reject(new Error('无图片读取权限')); return resolvePcMediaSource(id); };
const designerMediaAdapter = computed(() => auth.can('media:write') && auth.can('questions:write') ? { upload: (file: File) => uploadMedia(file, 'question') } : undefined);
const designerGuardDirty = computed(() => designerVisible.value && (designerDirty.value || !!designerHost.value?.busy.value || !!designerHost.value?.pending.value));
useUnsavedChanges(designerGuardDirty, { canDiscard: () => designerHost.value?.canDiscard() !== false,
  onBlocked: () => { designerError.value = '保存结果尚未确认，请继续保存查询原请求'; }, onDiscard: releaseDesigner });

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
  if (!await unsaved.confirmDiscard()) return;
  if (!viewActive || route.fullPath !== detailRouteKey) return;
  if (route.query.designer !== '1') {
    await router.replace({ path: route.path, query: { ...route.query, designer: '1' } });
    return;
  }
  const operation = ++designerOperation; const context = viewContext; designerLoading.value = true; designerError.value = '';
  const host = createPaperDesignerHost({ api: http, paperId, access: { read: auth.can('papers:read'), write: auth.can('papers:write'), questionsRead: auth.can('questions:read'), questionsWrite: auth.can('questions:write') } });
  try {
    await authoringOptions.load();
    if (authoringOptions.error.value || !authoringOptions.difficultyOptions.value.length) throw new Error(authoringOptions.error.value || '没有启用的难度，请重试设计器');
    const value = await host.load();
    if (operation !== designerOperation || context !== viewContext || !viewActive || !canDesign.value) { host.dispose(); return; }
    designerRelationOptions.value = { category: form.requires_learning && relationOptionsCategory === form.category_id ? form.category_id : '', courses: clone(courseOptions.value) };
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
  if (outcome.status === 'saved') designerDetailRefresh.add(paperId);
  return outcome;
}
async function closeDesigner() {
  if (designerHost.value?.canDiscard() === false) { designerError.value = '保存结果尚未确认，请继续保存查询原请求'; return; }
  designerDetailRefresh.add(paperId);
  releaseDesigner();
  const query = { ...route.query }; delete query.designer;
  await router.replace({ path: route.path, query });
}
watch(() => route.query.designer, (flag) => { if (flag === '1' && canDesign.value && !designerVisible.value) void openDesigner(); });
const canAnswerPreview = computed(() => auth.can('papers:export') || auth.can('questions:read') || auth.can('questions:export'));
const fixedTotal = computed(() => fixedQuestions.value.reduce((sum, item) => sum + Number(item.score_cents || 0), 0));
const ruleTotal = computed(() => form.rules.reduce((sum, item) => sum + item.count * item.score_cents, 0));

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function snapshotForm(): Draft { return clone(form); }
function snapshotQuestions(): TrainingPaperQuestion[] { return clone(fixedQuestions.value); }
function same(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function syncDirty() { dirty.value = !same(snapshotForm(), formBaseline) || !same(snapshotQuestions(), questionBaseline); }
async function restoreDraft() { applyingDraft = true; Object.assign(form, clone(formBaseline)); applyingDraft = false; fixedQuestions.value = clone(questionBaseline); syncDirty(); await loadRelations(form.category_id, true); }
watch(form, syncDirty, { deep: true });
watch(() => form.requires_learning, (enabled) => {
  if (applyingDraft) return;
  relationToken += 1; relationOptionsCategory = null; courseOptions.value = [];
  if (!enabled) { form.course_ids = []; form.required_learning_minutes = null; }
  if (categoryOptionsLoaded) void loadRelations(form.category_id, true);
}, { flush: 'sync' });
watch(fixedQuestions, syncDirty, { deep: true });
watch(previewVisible, (visible) => { if (!visible) invalidatePreview(); }, { flush: 'sync' });

function typeLabel(type: QuestionType | string) { return ({ single: '单选', multiple: '多选', judgment: '判断' } as Record<string, string>)[type] || type; }
function difficultyLabel(value: Difficulty | string) { return ({ easy: '初级', medium: '中级', hard: '高级' } as Record<string, string>)[value] || value; }
function statusLabel(status: TrainingPaperStatus | string) { return ({ draft: '草稿', published: '已发布', withdrawn: '已撤回', archived: '已归档' } as Record<string, string>)[status] || status; }
function statusType(status: TrainingPaperStatus | string) { return status === 'published' ? 'success' : status === 'draft' ? 'info' : 'warning'; }

function applyTrainingDraft(data: TrainingPaperDetail) {
  if (form.category_id !== data.category_id || form.requires_learning !== data.requires_learning) {
    relationToken += 1; relationOptionsCategory = null; courseOptions.value = [];
  }
  applyingDraft = true;
  Object.assign(form, draftFromDetail(data));
  applyingDraft = false;
  fixedQuestions.value = clone(data.questions);
  formBaseline = snapshotForm();
  questionBaseline = snapshotQuestions();
  unsaved.markClean();
}

function draftFromDetail(data: TrainingPaperDetail): Draft {
  return {
    title: data.title,
    mode: data.mode,
    category_id: data.category_id,
    regulation_ids: [...data.regulation_ids],
    course_ids: [...data.course_ids],
    requires_learning: data.requires_learning,
    required_learning_minutes: data.required_learning_minutes ?? null,
    remark: data.remark ?? '',
    total_score: data.total_score ?? 100,
    pass_score: data.pass_score,
    duration_minutes: data.duration_minutes,
    max_attempts: data.max_attempts,
    partial_credit_ratio: data.partial_credit_ratio,
    rules: clone(data.rules),
  };
}

async function loadTraining(resetDraft = true, expected?: { form: Draft; questions: TrainingPaperQuestion[] }) {
  const context = viewContext;
  const operation = ++trainingLoadOperation;
  const expectedForm = clone(expected?.form ?? snapshotForm());
  const expectedQuestions = clone(expected?.questions ?? snapshotQuestions());
  const data = await http.get(`/admin/papers/${paperId}`) as TrainingPaperDetail;
  if (context !== viewContext || operation !== trainingLoadOperation) return;
  paper.value = data;
  if (resetDraft && same(snapshotForm(), expectedForm) && same(snapshotQuestions(), expectedQuestions)) applyTrainingDraft(data);
  else syncDirty();
}

async function loadTrainingOptions() {
  if (!auth.can('papers:read')) return;
  const context = viewContext;
  const operation = ++trainingOptionsOperation;
  const page = await http.get('/admin/papers/category-options', { params: { page: 1, page_size: 100 } }) as Page<{ id: Id; name: string }>;
  if (context !== viewContext || operation !== trainingOptionsOperation) return;
  categories.value = page.items;
  categoryOptionsLoaded = true;
  await loadRelations(form.category_id, true);
}

async function loadRelations(categoryId: Id, preserve: boolean) {
  const context = viewContext;
  const token = ++relationToken;
  if (!preserve) {
    form.course_ids = [];
    courseOptions.value = [];
    relationOptionsCategory = null;
  }
  if (!categoryId || !form.requires_learning || !auth.can('papers:read')) {
    if (context !== viewContext || token !== relationToken) return;
    courseOptions.value = [];
    relationOptionsCategory = categoryId;
    return;
  }
  const courses = await http.get('/admin/papers/course-options', { params: { category_id: categoryId, page: 1, page_size: 100 } }) as Page<NamedOption>;
  if (context !== viewContext || token !== relationToken || form.category_id !== categoryId || !form.requires_learning) return;
  courseOptions.value = courses.items;
  relationOptionsCategory = categoryId;
}

async function ensureTrainingOptions() {
  if (!categoryOptionsLoaded) {
    await loadTrainingOptions();
    return;
  }
  if (relationOptionsCategory !== form.category_id) await loadRelations(form.category_id, true);
}

function onCategoryChange(value: Id) { void loadRelations(value, false); }
function configPayload(submitted: Draft): Omit<Draft, 'rules' | 'remark'> & { rules?: PaperRuleInput[]; remark: string | null } {
  const payload: Omit<Draft, 'rules' | 'remark'> & { rules?: PaperRuleInput[]; remark: string | null } = clone(submitted);
  payload.course_ids = submitted.requires_learning ? [...submitted.course_ids] : [];
  payload.required_learning_minutes = submitted.requires_learning ? submitted.required_learning_minutes : null;
  payload.remark = submitted.remark.trim() || null;
  payload.mode = paper.value?.mode ?? formBaseline.mode;
  if (payload.mode === 'fixed') delete payload.rules;
  return payload;
}

async function confirmLegacyPaperConversion(): Promise<boolean> {
  try {
    await ElMessageBox.confirm('当前草稿保留旧版选题范围限制。转换会解除该限制，保留现有题目来源和历史发布版本。是否转换并继续保存？', '转换为当前试卷配置', {
      type: 'warning', confirmButtonText: '转换并保存', cancelButtonText: '取消',
    });
    return true;
  } catch { return false; }
}

function validPoints(value: number) { return Number.isFinite(value) && value > 0 && value <= 999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7; }
async function saveConfig() {
  if (savingConfig.value) return;
  if (!form.title.trim() || !form.category_id) { ElMessage.warning('请填写试卷名称并选择培训类别'); return; }
  if (form.requires_learning && !form.course_ids.length) { ElMessage.warning('请至少选择一门关联课程'); return; }
  const minutes = form.required_learning_minutes;
  if (form.requires_learning && (minutes === null || !Number.isInteger(minutes) || minutes < 1 || minutes > 2147483647)) { ElMessage.warning('累计学习时长须为 1–2147483647 的整数分钟'); return; }
  if (Array.from(form.remark).length > 1000) { ElMessage.warning('备注最多 1000 个字符'); return; }
  const persistedMode = paper.value?.mode ?? formBaseline.mode;
  if (!validPoints(form.total_score)) { ElMessage.warning('试卷总分须为 0.01～999.99 分，最多两位小数'); return; }
  if (!validPoints(form.pass_score) || form.pass_score > form.total_score) { ElMessage.warning('及格分数须大于 0，且不能超过试卷总分，最多两位小数'); return; }
  const context = viewContext;
  const operation = ++configOperation;
  savingConfig.value = true;
  try {
    if (editable.value && form.regulation_ids.length) {
      if (!await confirmLegacyPaperConversion()) return;
      if (context !== viewContext || operation !== configOperation || !editable.value || !viewActive) return;
      form.regulation_ids = [];
    }
    if (form.mode !== persistedMode) form.mode = persistedMode;
    const submitted = snapshotForm();
    submitted.mode = persistedMode;
    const submittedQuestions = snapshotQuestions();
    const previousBaseline = clone(formBaseline);
    const invalidatesFixedList = submitted.category_id !== previousBaseline.category_id;
    const response = await http.put(`/admin/papers/${paperId}`, configPayload(submitted)) as TrainingPaperDetail;
    if (context !== viewContext) return;
    const applies = operation > configApplied;
    const persisted = draftFromDetail(response);
    if (applies && same(snapshotForm(), submitted)) Object.assign(form, clone(persisted));
    const resolution = resolvePaperSaveCompletion({ current: snapshotForm(), previousBaseline: formBaseline, previousAppliedOperation: configApplied, submitted: persisted, operation });
    formBaseline = resolution.baseline;
    configApplied = resolution.appliedOperation;
    if (!applies) return;
    if (paper.value) Object.assign(paper.value, response);
    if (invalidatesFixedList) {
      questionBaseline = [];
      if (form.category_id === submitted.category_id) fixedQuestions.value = [];
    }
    syncDirty();
    ElMessage.success('考试配置已保存');
    const expectedQuestions = invalidatesFixedList ? [] : submittedQuestions;
    if (!resolution.dirty && same(snapshotQuestions(), questionBaseline)) await loadTraining(true, { form: persisted, questions: expectedQuestions });
    else await loadTraining(false);
  } finally {
    if (context === viewContext && operation === configOperation) savingConfig.value = false;
  }
}

function addRule() { const used = new Set(form.rules.map((item) => item.type)); const next = questionTypes.find((item) => !used.has(item)); if (next) form.rules.push({ type: next, count: 1, score_cents: 1000 }); }
async function openCandidatePicker() {
  if (!editable.value || !auth.can('questions:read') || authoringOptions.loading.value) return;
  const context = viewContext;
  await authoringOptions.load();
  if (context !== viewContext || !viewActive) return;
  if (authoringOptions.error.value || !authoringOptions.difficultyOptions.value.length) { ElMessage.error(authoringOptions.error.value || '没有启用的难度，请重试'); return; }
  if (candidateQuery.difficulty && !authoringOptions.difficultyOptions.value.some((item) => item.value === candidateQuery.difficulty)) candidateQuery.difficulty = '';
  candidatePage.page = 1;
  candidatePage.total = 0;
  pickedCandidates.value = [];
  candidateSession.value += 1;
  candidateVisible.value = true;
  await loadCandidates();
}
async function loadCandidates() {
  const context = viewContext;
  const operation = ++candidateOperation;
  const params = { page: candidatePage.page, page_size: candidatePage.page_size, ...(candidateQuery.type ? { type: candidateQuery.type } : {}), ...(candidateQuery.difficulty ? { difficulty: candidateQuery.difficulty } : {}) };
  const page = await http.get(`/admin/papers/${paperId}/candidates`, { params }) as Page<TrainingPaperCandidate>;
  if (context !== viewContext || operation !== candidateOperation || !candidateVisible.value) return;
  candidates.value = page.items;
  candidatePage.page = page.page;
  candidatePage.page_size = page.page_size;
  candidatePage.total = page.total;
}
async function changeCandidatePage(page: number) { candidatePage.page = page; await loadCandidates(); }
async function changeCandidateFilter() { candidatePage.page = 1; await loadCandidates(); }
function updateCandidateSelection(rows: TrainingPaperCandidate[]) {
  const selected = new Map(pickedCandidates.value.map((item) => [String(item.question_version_id), item]));
  for (const item of candidates.value) selected.delete(String(item.question_version_id));
  for (const item of rows) selected.set(String(item.question_version_id), item);
  pickedCandidates.value = [...selected.values()];
}
function addCandidates() { const versionIds = new Set(fixedQuestions.value.map((item) => item.question_version_id)); const questionIds = new Set(fixedQuestions.value.map((item) => item.question_id)); for (const item of pickedCandidates.value) { const key = item.question_id; if (versionIds.has(item.question_version_id) || questionIds.has(key)) continue; versionIds.add(item.question_version_id); questionIds.add(key); fixedQuestions.value.push({ ...clone(item), score_cents: 500, sort: fixedQuestions.value.length }); } candidateVisible.value = false; }
function removeFixed(row: TrainingPaperQuestion) { fixedQuestions.value = fixedQuestions.value.filter((item) => item.question_version_id !== row.question_version_id); fixedQuestions.value.forEach((item, index) => { item.sort = index; }); }

async function saveFixedQuestions() {
  const context = viewContext;
  const operation = ++questionOperation;
  const submitted = snapshotQuestions();
  savingQuestions.value = true;
  try {
    await http.put(`/admin/papers/${paperId}/questions`, { items: submitted.map((item) => ({ question_version_id: item.question_version_id, score_cents: item.score_cents })) });
    if (context !== viewContext) return;
    const resolution = resolvePaperSaveCompletion({ current: snapshotQuestions(), previousBaseline: questionBaseline, previousAppliedOperation: questionApplied, submitted, operation });
    const applies = operation > questionApplied;
    questionBaseline = resolution.baseline;
    questionApplied = resolution.appliedOperation;
    if (!applies) return;
    syncDirty();
    ElMessage.success('固定题单已保存');
    await loadTraining(false);
  } finally {
    if (context === viewContext && operation === questionOperation) savingQuestions.value = false;
  }
}

async function publishPaper() {
  if (dirty.value) { ElMessage.warning('请先保存全部草稿'); return; }
  const context = viewContext;
  await ElMessageBox.confirm('发布将冻结规则及当前审核题目版本。确认发布？', '发布试卷', { type: 'warning' });
  if (context !== viewContext) return;
  if (dirty.value) { ElMessage.warning('确认期间草稿已变化，请先保存全部草稿'); return; }
  const operation = ++publicationOperation;
  const submittedForm = snapshotForm();
  const submittedQuestions = snapshotQuestions();
  await http.post(`/admin/papers/${paperId}/publish`);
  if (context !== viewContext || operation !== publicationOperation) return;
  ElMessage.success('已发布不可变版本');
  await loadTraining(true, { form: submittedForm, questions: submittedQuestions });
}

async function copyPaper() {
  if (paper.value?.mode !== 'fixed') {
    if (paper.value?.mode === 'random') ElMessage.warning('现有随机试卷仅保留原配置，不支持复制新建');
    return;
  }
  if (copyingPaper.value) return;
  const context = viewContext;
  const operation = ++copyOperation;
  copyingPaper.value = true;
  try {
    const copied = await http.post(`/admin/papers/${paperId}/copy`) as { id: Id };
    if (context !== viewContext || operation !== copyOperation) { recordCompletedCopy(); return; }
    ElMessage.success('已复制为新草稿');
    await router.push({ path: `/admin/papers/${copied.id}`, query: { scope: 'training' } });
  } finally {
    if (operation === copyOperation) copyingPaper.value = false;
  }
}

function invalidatePreview() {
  previewOperation += 1;
  previewLoading.value = false;
  previewSession.value = null;
  previewQuestionReady.value = {};
  previewRenderAttempt.value = 0;
}

async function openPreview(withAnswers: boolean) {
  const context = viewContext;
  const operation = ++previewOperation;
  const difficulty = previewDifficulty.value;
  previewLoading.value = true;
  previewSession.value = null;
  previewQuestionReady.value = {};
  previewRenderAttempt.value = 0;
  try {
    const data = await http.get(`/admin/papers/${paperId}/preview${withAnswers ? '/answers' : ''}`, { params: { difficulty } }) as PaperPreview;
    if (context !== viewContext || operation !== previewOperation) return;
    previewSession.value = { data, withAnswers, difficulty, paperId, operation };
    previewVisible.value = true;
  } finally {
    if (context === viewContext && operation === previewOperation) previewLoading.value = false;
  }
}

async function reloadPreview() { await openPreview(previewSession.value?.withAnswers || false); }
function closePreview() { if (previewVisible.value) previewVisible.value = false; else invalidatePreview(); }
function retryPreviewMedia() { if (!previewSession.value) return; previewQuestionReady.value = {}; previewRenderAttempt.value += 1; }
function markPreviewQuestionReady(operation: number, attempt: number, questionVersionId: Id, result: { ok: boolean }) {
  if (previewSession.value?.operation !== operation || previewRenderAttempt.value !== attempt) return;
  previewQuestionReady.value = { ...previewQuestionReady.value, [questionVersionId]: result.ok };
}
function printPreview() {
  if (!previewResourcesReady.value) { ElMessage.warning(previewResourcesFailed.value ? '题图加载失败，当前不能打印' : '题图仍在加载，请稍后打印'); return; }
  window.print();
}

function ordinaryPreviewExport(data: PaperPreview) {
  return {
    paper_id: data.paper_id,
    release_id: data.release_id,
    mode: data.mode,
    sample_kind: data.sample_kind,
    note: data.note,
    difficulty: data.difficulty,
    rule: {
      total_cents: data.rule.total_cents,
      pass_cents: data.rule.pass_cents,
      duration_minutes: data.rule.duration_minutes,
      max_attempts: data.rule.max_attempts,
      partial_credit_ratio: data.rule.partial_credit_ratio,
      rules: data.rule.rules.map((rule) => ({ type: rule.type, count: rule.count, score_cents: rule.score_cents })),
    },
    capacities: data.capacities.map((item) => ({ difficulty: item.difficulty, type: item.type, required: item.required, available: item.available })),
    questions: data.questions.map((question) => ({
      question_id: question.question_id,
      question_version_id: question.question_version_id,
      type: question.type,
      difficulty: question.difficulty,
      regulation_id: question.regulation_id,
      stem: question.stem,
      options: question.options.map((option) => ({ key: option.key, text: option.text })),
      score: question.score,
      ...((question.content_schema_version === 2 || question.content_schema_version === 3)
        && question.content_json && typeof question.content_json === 'object'
        ? {
            content_schema_version: question.content_schema_version,
            content_json: {
              stem: clone(question.content_json.stem),
              options: clone(question.content_json.options),
            },
          }
        : {}),
    })),
  };
}

function exportPreview() {
  const session = previewSession.value;
  if (!session) return;
  const exported = session.withAnswers ? clone(session.data) : ordinaryPreviewExport(session.data);
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${paper.value?.title || '试卷'}-${session.data.mode === 'random' ? '规则与样例' : session.withAnswers ? '答案版' : '固定卷'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function flushCompletedCopyNotice() {
  if (viewDestroyed || !viewActive || !completedCopyNotice) return;
  completedCopyNotice = false;
  ElMessage.info('先前的复制请求已完成，可在试卷列表中查看；系统未自动重发。');
}
function recordCompletedCopy() { if (viewDestroyed) return; completedCopyNotice = true; flushCompletedCopyNotice(); }

function invalidateView() {
  viewContext += 1;
  designerOperation += 1;
  designerLoading.value = false;
  trainingLoadOperation += 1;
  trainingOptionsOperation += 1;
  relationToken += 1;
  candidateOperation += 1;
  savingConfig.value = false;
  savingQuestions.value = false;
  candidateVisible.value = false;
  if (previewVisible.value) previewVisible.value = false;
  else invalidatePreview();
}
async function reloadMissingTrainingDependencies() {
  if (route.fullPath !== detailRouteKey) return;
  if (route.query.designer !== '1' && !dirty.value && designerDetailRefresh.delete(paperId)) await loadTraining(true);
  else if (!paper.value) await loadTraining(true);
  if (viewDestroyed || !viewActive || !paper.value) return;
  await ensureTrainingOptions();
  if (route.query.designer === '1' && !designerVisible.value) await openDesigner();
}
function reloadMissingDetail() {
  if (viewDestroyed || !viewActive) return;
  void reloadMissingTrainingDependencies();
}
onActivated(() => {
  const wasInactive = !viewActive;
  viewActive = true;
  flushCompletedCopyNotice();
  if (wasInactive) reloadMissingDetail();
});
onDeactivated(() => { viewActive = false; invalidateView(); });
onBeforeUnmount(() => { releaseDesigner(); viewDestroyed = true; viewActive = false; invalidateView(); });
onMounted(async () => { if (route.query.designer !== '1') designerDetailRefresh.delete(paperId); await loadTraining(true); await loadTrainingOptions(); if (route.query.designer === '1') await openDesigner(); });
</script>

<style scoped>
.detail-head,.card-head { display:flex; align-items:center; gap:10px; }
.card-head { justify-content:space-between; width:100%; }
.detail-title { font-size:18px; font-weight:600; margin:0; max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.section-card { margin-bottom:16px; }
.hint { color:var(--el-text-color-secondary); font-size:12px; line-height:1.5; margin-top:4px; width:100%; }
.hint.inline { margin-left:8px; width:auto; }.hint.ok { color:var(--el-color-success); }.hint.danger { color:var(--el-color-danger); }
.rules { width:100%; }.rule-row { display:grid; grid-template-columns:90px 120px 140px 60px 60px; align-items:center; gap:8px; margin-bottom:8px; }
.candidate-pagination { display:flex; justify-content:space-between; align-items:center; margin-top:12px; }
.preview-difficulty-print { display:none; }
.preview-question { padding:14px 0; border-bottom:1px solid var(--el-border-color-lighter); }.preview-title { font-weight:600; }.answer { margin-top:8px; padding:10px; background:var(--el-fill-color-light); color:var(--el-color-success); }
:deep(.el-card) { border-radius:var(--re-radius); border:1px solid var(--re-border); box-shadow:var(--re-shadow-card); }
:global(.paper-designer-dialog.el-dialog) { padding:0; }
:global(.paper-designer-dialog .el-dialog__header) { display:none; }
:global(.paper-designer-dialog .el-dialog__body) { padding:0; height:100%; display:flex; flex-direction:column; }
:global(.paper-designer-dialog .paper-designer) { flex:1; }
</style>
