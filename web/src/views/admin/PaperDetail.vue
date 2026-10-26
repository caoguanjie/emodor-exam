<template>
  <div v-if="legacyPaper" class="page-card">
    <div class="toolbar">
      <el-button text @click="router.push('/admin/papers')"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      <el-divider direction="vertical" />
      <div class="detail-head"><h2 class="detail-title">{{ legacyPaper.title }}</h2><el-tag :type="statusType(legacyPaper.status)">{{ statusLabel(legacyPaper.status) }}</el-tag><el-tag :type="legacySum === 100 ? 'success' : 'danger'">{{ legacySum }} / 100 分</el-tag></div>
      <div style="flex:1" />
      <el-button v-if="legacyPaper.rules_locked && auth.can('papers:write')" :loading="legacyCopying" :disabled="legacyCopying" @click="copyLegacyPaper">复制为新草稿</el-button>
      <el-button v-if="legacyPaper.status === 'draft' && auth.can('papers:publish')" type="success" :disabled="legacySum !== 100 || legacySum !== legacyPersistedSum" @click="publishLegacy">发布</el-button>
      <el-button v-if="legacyPaper.status === 'published' && auth.can('papers:write')" type="warning" plain @click="archiveLegacy">归档</el-button>
    </div>
    <el-alert :type="legacyPaper.rules_locked ? 'success' : 'info'" :closable="false" :title="legacyReleaseMessage" style="margin-bottom:14px" />
    <el-card shadow="never" class="section-card">
      <template #header>制度考试策略</template>
      <el-form inline label-width="110px">
        <el-form-item label="及格线"><el-input-number v-model="legacyStrategy.pass_score" :min="1" :max="100" :disabled="legacyStrategyLocked || !auth.can('papers:write')" /></el-form-item>
        <el-form-item label="限时"><el-input-number v-model="legacyStrategy.duration_minutes" :min="1" :max="300" :disabled="legacyStrategyLocked || !auth.can('papers:write')" /></el-form-item>
        <el-form-item label="最大次数"><el-input-number v-model="legacyStrategy.max_attempts" :min="1" :max="10" :disabled="legacyStrategyLocked || !auth.can('papers:write')" /></el-form-item>
        <el-form-item label="漏选比例"><el-input-number v-model="legacyStrategy.partial_credit_ratio" :min="0" :max="1" :step="0.1" :disabled="legacyStrategyLocked || !auth.can('papers:write')" /></el-form-item>
        <el-form-item><el-button v-if="auth.can('papers:write')" type="primary" :disabled="legacyStrategyLocked" @click="saveLegacyStrategy">保存策略</el-button></el-form-item>
      </el-form>
    </el-card>
    <el-card shadow="never" class="section-card">
      <template #header><div class="card-head"><span>制度固定题单</span><el-button v-if="legacyPaper.status === 'draft' && !legacyStrategyLocked && auth.can('papers:write')" type="primary" size="small" @click="legacyPickVisible = true">选题</el-button></div></template>
      <el-table :data="legacyPaper.questions || []">
        <el-table-column prop="sort" label="顺序" width="70" /><el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip />
        <el-table-column label="题型" width="90"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column>
        <el-table-column label="分值" width="170"><template #default="{ row }"><el-input-number v-model="row.score" :min="0.5" :max="100" :step="0.5" size="small" :disabled="legacyPaper.status !== 'draft' || legacyStrategyLocked || !auth.can('papers:write')" @change="legacyDirty = true" /></template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ row }"><FitsTableActions><FitsTableAction v-if="legacyPaper.status === 'draft' && !legacyStrategyLocked && auth.can('papers:write')" type="danger" @click="removeLegacy(row)">移除</FitsTableAction></FitsTableActions></template></el-table-column>
      </el-table>
      <el-button v-if="legacyPaper.status === 'draft' && !legacyStrategyLocked && auth.can('papers:write') && (legacyDirty || legacySum !== legacyPersistedSum)" type="primary" style="margin-top:14px" @click="saveLegacyQuestions">保存题单</el-button>
    </el-card>
    <el-dialog v-model="legacyPickVisible" title="选题入卷（制度范围）" width="760px">
      <el-table :data="legacyCandidates" @selection-change="(rows: any[]) => (legacyPicked = rows)"><el-table-column type="selection" width="50" /><el-table-column prop="id" label="ID" width="70" /><el-table-column prop="stem" label="题干" min-width="280" /></el-table>
      <template #footer><el-button @click="legacyPickVisible = false">取消</el-button><el-button type="primary" @click="addLegacyPicked">加入试卷</el-button></template>
    </el-dialog>
  </div>

  <div v-else-if="paper" class="page-card paper-detail" :class="{ 'paper-preview-open': previewVisible }">
    <div class="toolbar">
      <el-button text @click="router.push('/admin/papers')"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      <el-divider direction="vertical" />
      <div class="detail-head"><h2 class="detail-title">{{ paper.title }}</h2><el-tag>{{ paper.mode === 'fixed' ? '固定组卷' : '随机组卷' }}</el-tag><el-tag :type="statusType(paper.status)">{{ statusLabel(paper.status) }}</el-tag></div>
      <div style="flex:1" />
      <el-button v-if="canDesign" type="primary" :loading="designerLoading" @click="openDesigner">编辑试卷</el-button>
      <el-button @click="openPreview(false)">预览</el-button>
      <el-button v-if="canAnswerPreview" @click="openPreview(true)">答案版</el-button>
      <el-button v-if="auth.can('papers:write')" :loading="copyingPaper" :disabled="copyingPaper" @click="copyPaper">复制</el-button>
      <el-button v-if="paper.status === 'draft' && auth.can('papers:publish')" type="success" :disabled="dirty" @click="publishPaper">发布</el-button>
      <el-button v-if="paper.status === 'published' && auth.can('papers:publish')" type="warning" plain @click="withdrawPaper">撤回</el-button>
      <el-button v-if="['published', 'withdrawn'].includes(paper.status) && auth.can('papers:publish')" type="danger" plain @click="archivePaper">归档</el-button>
    </div>

    <el-alert v-if="paper.status !== 'draft'" type="info" :closable="false" style="margin-bottom:14px" title="发布版本不可修改；题库后续修订不会改写本卷。需要新规则或新题池时请复制为新试卷。" />
    <el-alert v-else-if="dirty" type="warning" :closable="false" style="margin-bottom:14px" title="存在未保存配置；发布前请分别保存考试配置与固定题单。" />
    <el-alert v-if="designerError" :title="designerError" type="error" :closable="false" style="margin-bottom:14px"><el-button v-if="canDesign" @click="openDesigner">重试设计器</el-button></el-alert>

    <el-card shadow="never" class="section-card">
      <template #header><div class="card-head"><span>考试配置</span><el-button v-if="editable" type="primary" :loading="savingConfig" @click="saveConfig">保存配置</el-button></div></template>
      <el-form label-width="120px">
        <el-form-item label="试卷标题"><el-input v-model="form.title" maxlength="128" :disabled="!editable" /></el-form-item>
        <el-form-item label="组卷模式"><el-radio-group v-model="form.mode" :disabled="!editable"><el-radio-button value="fixed">固定组卷</el-radio-button><el-radio-button value="random">随机组卷</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="培训类别"><el-select v-model="form.category_id" filterable style="width:100%" :disabled="!editable" @change="onCategoryChange"><el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="资料来源筛选"><el-select v-model="form.regulation_ids" multiple filterable clearable style="width:100%" :disabled="!editable"><el-option v-for="item in regulationOptions" :key="item.id" :label="item.title" :value="item.id" /></el-select><div class="hint">留空时同类别无资料来源的人工/导入题也可用；选择后只保留指定资料来源题。</div></el-form-item>
        <el-form-item label="关联课程"><el-select v-model="form.course_ids" multiple filterable clearable style="width:100%" :disabled="!editable"><el-option v-for="item in courseOptions" :key="item.id" :label="item.title" :value="item.id" /></el-select><div class="hint">只作覆盖范围说明，不参与题池交并，也不强制学完。</div></el-form-item>
        <el-form-item label="学习门槛"><el-switch v-model="form.requires_learning" :disabled="!editable" /><span class="hint inline">培训默认关闭；历史固定卷仍沿用原学习门槛。</span></el-form-item>
        <el-form-item label="及格线 / 限时"><el-input-number v-model="form.pass_score" :min="1" :max="100" :disabled="!editable" /><el-input-number v-model="form.duration_minutes" :min="1" :max="1440" :disabled="!editable" style="margin-left:12px" /></el-form-item>
        <el-form-item label="次数 / 漏选比例"><el-input-number v-model="form.max_attempts" :min="1" :max="100" :disabled="!editable" /><el-input-number v-model="form.partial_credit_ratio" :min="0" :max="1" :step="0.1" :disabled="!editable" style="margin-left:12px" /></el-form-item>
        <el-form-item v-if="form.mode === 'random'" label="题型规则">
          <div class="rules"><div v-for="(rule, index) in form.rules" :key="rule.type" class="rule-row"><span>{{ typeLabel(rule.type) }}</span><el-input-number v-model="rule.count" :min="1" :disabled="!editable" /><el-input-number v-model="rule.score_cents" :min="1" :max="10000" :disabled="!editable" /><span>整数分</span><el-button v-if="editable" text type="danger" @click="form.rules.splice(index, 1)">移除</el-button></div><el-button v-if="editable" size="small" @click="addRule">添加题型规则</el-button><div :class="['hint', ruleTotal === 10000 ? 'ok' : 'danger']">规则总分 {{ ruleTotal / 100 }} / 100；发布同时验证初级和高级考点容量。</div></div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="form.mode === 'fixed'" shadow="never" class="section-card">
      <template #header><div class="card-head"><span>固定题单（{{ fixedQuestions.length }} 题，{{ fixedTotal / 100 }} / 100 分）</span><div><el-button v-if="editable" @click="openCandidatePicker">选题</el-button><el-button v-if="editable" type="primary" :loading="savingQuestions" :disabled="fixedTotal !== 10000" @click="saveFixedQuestions">保存固定题单</el-button></div></div></template>
      <el-table :data="fixedQuestions">
        <el-table-column prop="sort" label="顺序" width="70" /><el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip />
        <el-table-column label="题型 / 难度" width="130"><template #default="{ row }">{{ typeLabel(row.type) }} · {{ difficultyLabel(row.difficulty) }}</template></el-table-column>
        <el-table-column label="来源" width="120"><template #default="{ row }">{{ row.regulation_id ? `资料 ${row.regulation_id}` : '无资料来源' }}</template></el-table-column>
        <el-table-column label="分值" width="180"><template #default="{ row }"><el-input-number v-model="row.score_cents" :min="1" :max="10000" :disabled="!editable" /><span class="hint inline">整数分</span></template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ row }"><FitsTableActions><FitsTableAction v-if="editable" type="danger" @click="removeFixed(row)">移除</FitsTableAction></FitsTableActions></template></el-table-column>
      </el-table>
    </el-card>

    <el-card v-else shadow="never" class="section-card">
      <template #header>随机组卷说明</template>
      <el-descriptions :column="2" border><el-descriptions-item label="本机构学员">简单题池</el-descriptions-item><el-descriptions-item label="外来学员">困难题池</el-descriptions-item><el-descriptions-item label="课程关联">仅说明，不过滤题池</el-descriptions-item></el-descriptions>
    </el-card>

    <el-dialog v-model="candidateVisible" title="选择当前审核通过的题目版本" width="900px">
      <div class="toolbar"><el-select v-model="candidateQuery.type" placeholder="题型" clearable style="width:140px" @change="changeCandidateFilter"><el-option v-for="item in questionTypes" :key="item" :label="typeLabel(item)" :value="item" /></el-select><el-select v-model="candidateQuery.difficulty" placeholder="难度" clearable style="width:140px" @change="changeCandidateFilter"><el-option v-for="item in authoringOptions.difficultyOptions.value" :key="item.value" :label="item.label" :value="item.value" /></el-select></div>
      <el-table :key="candidateSession" :data="candidates" row-key="question_version_id" @selection-change="updateCandidateSelection"><el-table-column type="selection" width="50" :reserve-selection="true" /><el-table-column prop="question_version_id" label="版本 ID" width="100" /><el-table-column prop="stem" label="题干" min-width="280" show-overflow-tooltip /><el-table-column label="题型/难度" width="120"><template #default="{ row }">{{ typeLabel(row.type) }} · {{ difficultyLabel(row.difficulty) }}</template></el-table-column><el-table-column label="考点" width="110"><template #default="{ row }">{{ row.concept_id || '独立题' }}</template></el-table-column></el-table>
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
        :difficulty-options="authoringOptions.difficultyOptions.value" :concept-options-api="designerConceptOptions"
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
  LegacyPaperDetailView,
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
import { listQuestionConceptOptions } from '../../api/question-authoring';
import { getMediaImageContent, uploadMedia } from '../../api/media';

interface Draft {
  title: string;
  mode: PaperMode;
  category_id: Id;
  regulation_ids: Id[];
  course_ids: Id[];
  requires_learning: boolean;
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
const legacyMode = route.query.scope === 'regulation';
const detailRouteKey = route.fullPath;

const legacyPaper = ref<LegacyPaperDetailView | null>(null);
const legacyStrategy = reactive({ pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5 });
const legacyDirty = ref(false);
const legacyPersistedSum = ref(0);
const legacyPickVisible = ref(false);
const legacyCandidates = ref<any[]>([]);
const legacyPicked = ref<any[]>([]);
const legacyCopying = ref(false);
const legacySum = computed(() => Math.round((legacyPaper.value?.questions || []).reduce((sum, item) => sum + Number(item.score || 0), 0) * 100) / 100);
const legacyStrategyLocked = computed(() => !legacyPaper.value
  || legacyPaper.value.status === 'archived'
  || Boolean(legacyPaper.value.release_id)
  || legacyPaper.value.rules_locked);
const legacyReleaseMessage = computed(() => {
  if (legacyPaper.value?.rules_locked && legacyPaper.value.release_id) return '此制度卷已生成不可变发布快照；题目内容、实际分值和规则均已冻结。需要修改时请复制为新草稿。';
  if (legacyPaper.value?.status === 'published') return '此卷是升级前已发布且没有 release 的旧卷；保留原开考兼容，不补造历史发布快照。';
  return '制度专项固定卷保留原数字 ID、单/多选流程与制度学习门槛；本次发布后会冻结题目内容、实际分值和规则。';
});

const paper = ref<TrainingPaperDetail | null>(null);
const categories = ref<Array<{ id: Id; name: string }>>([]);
const regulationOptions = ref<NamedOption[]>([]);
const courseOptions = ref<NamedOption[]>([]);
const form = reactive<Draft>({ title: '', mode: 'fixed', category_id: '', regulation_ids: [], course_ids: [], requires_learning: false, pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5, rules: [] });
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
let legacyLoadOperation = 0;
let configOperation = 0;
let configApplied = 0;
let questionOperation = 0;
let questionApplied = 0;
let publicationOperation = 0;
let copyOperation = 0;
let legacyMutationOperation = 0;
let previewOperation = 0;
let candidateOperation = 0;
let relationToken = 0;
let viewActive = true;
let viewDestroyed = false;
let completedCopyNotice = false;
let categoryOptionsLoaded = false;
let relationOptionsCategory: Id | null = null;

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
const designerRelationOptions = ref<{ category: Id; regulations: NamedOption[]; courses: NamedOption[] }>({ category: '', regulations: [], courses: [] });
const designerHistoricalDifficulties = computed(() => Object.values(designerValue.value?.document.questions || {}).some((meta) => !authoringOptions.difficultyOptions.value.some((option) => option.value === meta.difficulty)));
const designerRegulations = computed(() => designerRelationOptions.value.regulations.map((item) => ({ id: item.id, title: item.title || item.name || String(item.id), category_id: designerRelationOptions.value.category })));
const designerCourses = computed(() => designerRelationOptions.value.courses.map((item) => ({ id: item.id, title: item.title || item.name || String(item.id), category_id: designerRelationOptions.value.category })));
const designerConceptOptions = listQuestionConceptOptions;
const designerMediaResolver = (id: string) => { if (!auth.can('media:read')) return Promise.reject(new Error('无图片读取权限')); return getMediaImageContent(id); };
const designerMediaAdapter = computed(() => auth.can('media:write') && auth.can('questions:write') ? { upload: (file: File) => uploadMedia(file, 'question') } : undefined);
const designerGuardDirty = computed(() => designerVisible.value && (designerDirty.value || !!designerHost.value?.busy.value || !!designerHost.value?.pending.value));
useUnsavedChanges(designerGuardDirty, { canDiscard: () => designerHost.value?.canDiscard() !== false,
  onBlocked: () => { designerError.value = '保存结果尚未确认，请继续保存查询原请求'; }, onDiscard: releaseDesigner });

function releaseDesigner() { designerOperation += 1; designerRelationOperation += 1; designerVisible.value = false; designerDirty.value = false; designerHost.value?.dispose(); designerHost.value = null; designerValue.value = null; }
watch(() => designerValue.value?.paper.category_id, async (category) => {
  const operation = ++designerRelationOperation;
  if (!category || category === designerRelationOptions.value.category) return;
  designerRelationOptions.value = { category, regulations: [], courses: [] };
  try {
    const [regulations, courses] = await Promise.all([
      http.get('/admin/papers/regulation-options', { params: { category_id: category, page: 1, page_size: 100 } }) as Promise<Page<NamedOption>>,
      http.get('/admin/papers/course-options', { params: { category_id: category, page: 1, page_size: 100 } }) as Promise<Page<NamedOption>>,
    ]);
    if (operation === designerRelationOperation && designerValue.value?.paper.category_id === category) designerRelationOptions.value = { category, regulations: regulations.items, courses: courses.items };
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
    designerRelationOptions.value = { category: form.category_id, regulations: clone(regulationOptions.value), courses: clone(courseOptions.value) };
    designerHost.value?.dispose(); designerHost.value = host; designerValue.value = value; designerDirty.value = false; designerVisible.value = true;
  } catch (failure) { host.dispose(); if (operation === designerOperation && context === viewContext) designerError.value = failure instanceof Error ? failure.message : '设计器载入失败'; }
  finally { if (operation === designerOperation) designerLoading.value = false; }
}
async function saveDesignerDraft(value: PaperDesignerValue, context: SaveContext) {
  if (!canDesign.value || !designerHost.value || authoringOptions.error.value || !authoringOptions.difficultyOptions.value.length) throw new Error('当前无试卷编辑权限或难度目录不可用');
  if (Object.values(value.document.questions).some((meta) => !authoringOptions.difficultyOptions.value.some((option) => option.value === meta.difficulty))) throw new Error('请将停用难度题目明确重新分类后再保存');
  const outcome = await designerHost.value.saveDraft(value, context);
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
async function restoreDraft() { Object.assign(form, clone(formBaseline)); fixedQuestions.value = clone(questionBaseline); syncDirty(); await loadRelations(form.category_id, true); }
watch(form, syncDirty, { deep: true });
watch(fixedQuestions, syncDirty, { deep: true });
watch(previewVisible, (visible) => { if (!visible) invalidatePreview(); }, { flush: 'sync' });

function typeLabel(type: QuestionType | string) { return ({ single: '单选', multiple: '多选', judgment: '判断' } as Record<string, string>)[type] || type; }
function difficultyLabel(value: Difficulty | string) { return ({ easy: '初级', medium: '中级', hard: '高级' } as Record<string, string>)[value] || value; }
function statusLabel(status: TrainingPaperStatus | string) { return ({ draft: '草稿', published: '已发布', withdrawn: '已撤回', archived: '已归档' } as Record<string, string>)[status] || status; }
function statusType(status: TrainingPaperStatus | string) { return status === 'published' ? 'success' : status === 'draft' ? 'info' : 'warning'; }

function applyTrainingDraft(data: TrainingPaperDetail) {
  Object.assign(form, draftFromDetail(data));
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
    form.regulation_ids = [];
    form.course_ids = [];
    regulationOptions.value = [];
    courseOptions.value = [];
    relationOptionsCategory = null;
  }
  if (!categoryId || !auth.can('papers:read')) {
    if (context !== viewContext || token !== relationToken) return;
    regulationOptions.value = [];
    courseOptions.value = [];
    relationOptionsCategory = categoryId;
    return;
  }
  const [regs, courses] = await Promise.all([
    http.get('/admin/papers/regulation-options', { params: { category_id: categoryId, page: 1, page_size: 100 } }) as Promise<Page<NamedOption>>,
    http.get('/admin/papers/course-options', { params: { category_id: categoryId, page: 1, page_size: 100 } }) as Promise<Page<NamedOption>>,
  ]);
  if (context !== viewContext || token !== relationToken || form.category_id !== categoryId) return;
  regulationOptions.value = regs.items;
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
function configPayload(submitted: Draft): Omit<Draft, 'rules'> & { rules?: PaperRuleInput[] } {
  const payload: Omit<Draft, 'rules'> & { rules?: PaperRuleInput[] } = clone(submitted);
  if (submitted.mode === 'fixed') delete payload.rules;
  return payload;
}

async function saveConfig() {
  if (form.mode === 'random' && ruleTotal.value !== 10000) { ElMessage.warning('随机规则总分必须等于 100 分'); return; }
  const context = viewContext;
  const operation = ++configOperation;
  const submitted = snapshotForm();
  const submittedQuestions = snapshotQuestions();
  const previousBaseline = clone(formBaseline);
  const invalidatesFixedList = submitted.mode !== previousBaseline.mode || submitted.category_id !== previousBaseline.category_id;
  savingConfig.value = true;
  try {
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
      if (form.mode === submitted.mode && form.category_id === submitted.category_id) fixedQuestions.value = [];
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
function addCandidates() { const versionIds = new Set(fixedQuestions.value.map((item) => item.question_version_id)); const concepts = new Set(fixedQuestions.value.map((item) => item.concept_id ? `concept:${item.concept_id}` : `question:${item.question_id}`)); for (const item of pickedCandidates.value) { const key = item.concept_id ? `concept:${item.concept_id}` : `question:${item.question_id}`; if (versionIds.has(item.question_version_id) || concepts.has(key)) continue; versionIds.add(item.question_version_id); concepts.add(key); fixedQuestions.value.push({ ...clone(item), score_cents: 500, sort: fixedQuestions.value.length }); } candidateVisible.value = false; }
function removeFixed(row: TrainingPaperQuestion) { fixedQuestions.value = fixedQuestions.value.filter((item) => item.question_version_id !== row.question_version_id); fixedQuestions.value.forEach((item, index) => { item.sort = index; }); }

async function saveFixedQuestions() {
  if (fixedTotal.value !== 10000) { ElMessage.warning('固定题单总分必须等于 100 分'); return; }
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

async function withdrawPaper() {
  const context = viewContext;
  await ElMessageBox.confirm('撤回只阻止新开考；在考与历史题单继续保留。确认撤回？', '撤回试卷', { type: 'warning' });
  if (context !== viewContext) return;
  const operation = ++publicationOperation;
  await http.post(`/admin/papers/${paperId}/withdraw`);
  if (context !== viewContext || operation !== publicationOperation) return;
  await loadTraining(false);
}

async function archivePaper() {
  const context = viewContext;
  await ElMessageBox.confirm('归档只阻止新开考，历史发布快照保留。确认归档？', '归档试卷', { type: 'warning' });
  if (context !== viewContext) return;
  const operation = ++publicationOperation;
  await http.post(`/admin/papers/${paperId}/archive`);
  if (context !== viewContext || operation !== publicationOperation) return;
  await loadTraining(false);
}

async function copyPaper() {
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
      total_cents: 10000,
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
      concept_id: question.concept_id,
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

async function loadLegacy() {
  const context = viewContext;
  const operation = ++legacyLoadOperation;
  const data = await http.get(`/ai/papers/${paperId}`) as LegacyPaperDetailView;
  if (context !== viewContext || operation !== legacyLoadOperation) return;
  legacyPaper.value = data;
  Object.assign(legacyStrategy, { pass_score: data.pass_score, duration_minutes: data.duration_minutes, max_attempts: data.max_attempts, partial_credit_ratio: data.partial_credit_ratio });
  legacyPersistedSum.value = legacySum.value;
  legacyDirty.value = false;
  if (data.status !== 'draft' || data.rules_locked) { legacyCandidates.value = []; return; }
  const candidatesPage = await http.get('/ai/questions', { params: { regulation_id: data.regulation_id, status: 'approved', page_size: 100 } }) as { list: any[] };
  if (context !== viewContext || operation !== legacyLoadOperation) return;
  legacyCandidates.value = candidatesPage.list;
}

async function saveLegacyStrategy() {
  const context = viewContext;
  const operation = ++legacyMutationOperation;
  await http.put(`/ai/papers/${paperId}`, clone(legacyStrategy));
  if (context !== viewContext || operation !== legacyMutationOperation) return;
  ElMessage.success('策略已保存');
  await loadLegacy();
}
function removeLegacy(row: any) { if (!legacyPaper.value) return; legacyPaper.value.questions = legacyPaper.value.questions.filter((item) => item.question_id !== row.question_id); legacyDirty.value = true; }
async function addLegacyPicked() {
  if (!legacyPaper.value) return;
  const context = viewContext;
  const operation = ++legacyMutationOperation;
  const items = [...legacyPaper.value.questions.map((item) => ({ question_id: item.question_id, score: Number(item.score) })), ...legacyPicked.value.map((item: any) => ({ question_id: item.id, score: 5 }))];
  await http.put(`/ai/papers/${paperId}/questions`, { items });
  if (context !== viewContext || operation !== legacyMutationOperation) return;
  legacyPickVisible.value = false;
  await loadLegacy();
}
async function saveLegacyQuestions() {
  if (!legacyPaper.value) return;
  const context = viewContext;
  const operation = ++legacyMutationOperation;
  await http.put(`/ai/papers/${paperId}/questions`, { items: legacyPaper.value.questions.map((item) => ({ question_id: item.question_id, score: Number(item.score) })) });
  if (context !== viewContext || operation !== legacyMutationOperation) return;
  ElMessage.success('题单已保存');
  await loadLegacy();
}
async function publishLegacy() {
  const context = viewContext;
  await ElMessageBox.confirm('发布将冻结制度卷题目内容、实际分值和规则。确认发布？', '发布', { type: 'warning' });
  if (context !== viewContext) return;
  const operation = ++legacyMutationOperation;
  await http.post(`/ai/papers/${paperId}/publish`);
  if (context !== viewContext || operation !== legacyMutationOperation) return;
  await loadLegacy();
}
async function archiveLegacy() {
  const context = viewContext;
  await ElMessageBox.confirm('归档后不再允许新开考。确认？', '归档', { type: 'warning' });
  if (context !== viewContext) return;
  const operation = ++legacyMutationOperation;
  await http.post(`/ai/papers/${paperId}/archive`);
  if (context !== viewContext || operation !== legacyMutationOperation) return;
  await loadLegacy();
}
async function copyLegacyPaper() {
  if (legacyCopying.value) return;
  const context = viewContext;
  const operation = ++copyOperation;
  legacyCopying.value = true;
  try {
    const copied = await http.post(`/ai/papers/${paperId}/copy`, {}) as LegacyPaperDetailView;
    if (context !== viewContext || operation !== copyOperation) { recordCompletedCopy(); return; }
    ElMessage.success('已复制为可编辑的新草稿');
    await router.push({ path: `/admin/papers/${copied.id}`, query: { scope: 'regulation' } });
  } finally {
    if (operation === copyOperation) legacyCopying.value = false;
  }
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
  legacyLoadOperation += 1;
  relationToken += 1;
  candidateOperation += 1;
  savingConfig.value = false;
  savingQuestions.value = false;
  candidateVisible.value = false;
  legacyPickVisible.value = false;
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
  if (legacyMode) {
    if (!legacyPaper.value) void loadLegacy();
    return;
  }
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
onMounted(async () => { if (legacyMode) await loadLegacy(); else { if (route.query.designer !== '1') designerDetailRefresh.delete(paperId); await loadTraining(true); await loadTrainingOptions(); if (route.query.designer === '1') await openDesigner(); } });
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
