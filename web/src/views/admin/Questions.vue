<template>
  <div class="page-card question-page">
    <div class="page-head page-head--hero">
      <div class="page-head__main">
        <div class="eyebrow">内容生产 · ADMIN</div>
        <h2>统一题库与 AI 出题</h2>
        <p class="desc">三类客观题按类别、难度和版本管理；核心内容修改后回到待审核，不覆盖旧版本。</p>
      </div>
      <div class="page-head__actions">
        <span class="head-note"><i />题目版本、来源与审核状态全程留痕</span>
        <span class="head-badge">QUESTION WORKSPACE</span>
      </div>
    </div>

    <div class="question-stat-strip">
      <div class="question-stat"><span>题库题目</span><strong>{{ total }}</strong><em>条</em><small>当前筛选结果</small></div>
      <div class="question-stat"><span>培训类别</span><strong>{{ categories.length }}</strong><em>个</em><small>可用出题范围</small></div>
      <div class="question-stat"><span>出题资料</span><strong>{{ materials.length }}</strong><em>份</em><small>已收进题库工作区</small></div>
    </div>

    <div class="notice-stack">
      <el-alert v-if="missingAiPermissions" type="info" show-icon :closable="false" :title="missingAiPermissions" />
      <el-alert v-if="!categories.length" type="warning" show-icon :closable="false" title="暂无启用的培训类别，请先创建类别。" />
    </div>
    <section class="filter-panel question-filter-panel">
      <div class="filter-panel__heading">
        <span class="filter-panel__icon"><el-icon><Filter /></el-icon></span>
        <div><strong>筛选题目</strong><span>按范围、难度、题型和审核状态缩小结果</span></div>
      </div>
      <div class="question-filter-grid">
      <el-select v-model="query.category_id" placeholder="培训类别" clearable filterable @change="onFilterScopeChange">
        <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-select v-model="query.difficulty" placeholder="难度" clearable @change="load">
        <el-option label="初级" value="easy" /><el-option label="中级" value="medium" /><el-option label="高级" value="hard" />
      </el-select>
      <el-select v-model="query.type" placeholder="题型" clearable @change="onFilterScopeChange">
        <el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-select
        v-model="query.concept_id"
        placeholder="考点组"
        clearable
        filterable
        remote
        reserve-keyword
        :loading="filterConceptLoading"
        :remote-method="searchFilterConcepts"
        @change="load"
      >
        <el-option v-for="item in filterConcepts" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-select v-model="query.status" placeholder="审核状态" clearable @change="load">
        <el-option label="待审核" value="pending" /><el-option label="已通过" value="approved" /><el-option label="已驳回" value="rejected" />
      </el-select>
      <el-input v-model="query.keyword" clearable placeholder="搜索题干" @keyup.enter="load" />
      <div class="question-toolbar__actions">
        <el-button v-if="auth.can('questions:write')" plain @click="router.push('/admin/questions/import')">Excel / TXT 导题</el-button>
        <el-button v-if="auth.can('questions:write')" plain @click="openCreate">人工录题</el-button>
        <el-button v-if="canGenerate" type="primary" :disabled="!categories.length" @click="openGenerate">AI 出题</el-button>
      </div>
      </div>
    </section>
    <div v-if="filterConceptPage.total > filterConceptPage.page_size" class="concept-pagination">
      <span>考点筛选</span>
      <el-pagination
        small
        layout="total, prev, pager, next"
        :total="filterConceptPage.total"
        :page-size="filterConceptPage.page_size"
        v-model:current-page="filterConceptPage.page"
        @current-change="loadFilterConceptPage"
      />
    </div>

    <section class="table-section">
      <div class="table-section__head">
        <div><span class="section-kicker">QUESTION INDEX</span><strong>题目清单</strong></div>
        <span class="table-total">共 {{ total }} 条结果</span>
      </div>
      <div class="table-shell">
        <el-table class="question-table" v-loading="loading" :data="list">
          <template #empty>
            <div class="question-empty"><span class="empty-glyph">Q</span><strong>暂无符合条件的题目</strong><small>调整筛选条件，或使用上方入口创建第一道题目</small></div>
          </template>
      <el-table-column prop="question_id" label="ID" width="70" />
      <el-table-column label="题干" min-width="300">
        <template #default="{ row }"><div class="stem-summary">{{ plainText(row.stem) }}</div></template>
      </el-table-column>
      <el-table-column label="题型" width="100"><template #default="{ row }"><el-tag size="small" effect="plain">{{ typeLabel(row.type) }}</el-tag></template></el-table-column>
      <el-table-column label="难度" width="80"><template #default="{ row }"><span class="difficulty-text" :class="`difficulty-text--${row.difficulty || 'unknown'}`">{{ difficultyLabel(row.difficulty) }}</span></template></el-table-column>
      <el-table-column prop="score" label="建议分" width="80" />
      <el-table-column label="版本" width="90"><template #default="{ row }">{{ row.revision ? `v${row.revision}` : '旧题' }}</template></el-table-column>
      <el-table-column label="来源" width="80"><template #default="{ row }"><span class="source-text">{{ sourceLabel(row.source) }}</span></template></el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" type="primary" @click="openView(row)">预览</el-button>
          <el-button v-if="row.status === 'pending' && auth.can('questions:review')" text size="small" type="success" @click="reviewQuestion(row, 'approved')">通过</el-button>
          <el-button v-if="row.status !== 'rejected' && auth.can('questions:review')" text size="small" type="warning" @click="reviewQuestion(row, 'rejected')">驳回</el-button>
          <el-button v-if="auth.can('questions:write')" text size="small" @click="openEdit(row)">修订</el-button>
          <el-button v-if="row.source === 'ai' && ['single', 'multiple'].includes(row.type) && auth.can('questions:write')" text size="small" @click="regenerate(row)">重生成</el-button>
        </template>
      </el-table-column>
        </el-table>
      </div>
    </section>
    <el-pagination class="question-pagination" layout="total, prev, pager, next" :total="total" :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <el-dialog v-model="editorVisible" :title="editorMode === 'create' ? '人工录入题目' : '修订题目'" width="860px" append-to-body destroy-on-close :before-close="beforeEditorClose">
      <div class="editor-tools">
        <el-button v-if="auth.can('questions:write') && editorForm.category_id" size="small" @click="createConcept">新建当前题型考点组</el-button>
        <span v-if="editorMode === 'edit'" class="editor-hint">保存会生成待审核新版本；旧版本保持不变。</span>
      </div>
      <el-alert
        v-if="editorMode === 'edit' && !hasEditorDifficulty"
        type="warning"
        show-icon
        :closable="false"
        title="该旧题难度未知，请明确选择初级、中级或高级后再保存。"
        style="margin-bottom:12px"
      />
      <QuestionEditor
        v-model="editorForm"
        :categories="categories"
        :concepts="editorConcepts"
        :concept-loading="editorConceptLoading"
        :can-upload-media="auth.can('media:write')"
        @scope-change="loadEditorConcepts"
        @concept-search="searchEditorConcepts"
      />
      <el-pagination
        v-if="editorConceptPage.total > editorConceptPage.page_size"
        class="concept-pagination"
        small
        layout="total, prev, pager, next"
        :total="editorConceptPage.total"
        :page-size="editorConceptPage.page_size"
        v-model:current-page="editorConceptPage.page"
        @current-change="loadEditorConceptPage"
      />
      <el-divider content-position="left">未保存内容预览</el-divider>
      <QuestionPreview :question="editorForm" />
      <template #footer>
        <el-button @click="closeEditor">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving || !hasEditorDifficulty" @click="saveQuestion">{{ editorMode === 'create' ? '保存并确认可用' : '保存为待审核版本' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="题目预览" width="760px" append-to-body destroy-on-close>
      <QuestionPreview v-if="selectedQuestion" :question="selectedQuestion" />
      <el-timeline v-if="versionHistory.length" class="version-history">
        <el-timeline-item v-for="item in versionHistory" :key="item.id" :timestamp="formatDateTime(item.created_at)" placement="top">
          v{{ item.revision }} · {{ statusLabel(item.status) }}
          <span v-if="item.legacy_captured_at">（升级时捕获，非历史还原）</span>
        </el-timeline-item>
      </el-timeline>
      <el-pagination
        v-if="versionHistoryPage.total > versionHistoryPage.page_size"
        class="question-pagination"
        small
        layout="total, prev, pager, next"
        :total="versionHistoryPage.total"
        :page-size="versionHistoryPage.page_size"
        v-model:current-page="versionHistoryPage.page"
        @current-change="loadHistoryPage"
      />
    </el-dialog>

    <el-dialog v-model="genVisible" title="发起 AI 出题" width="600px" append-to-body>
      <el-form label-width="140px">
        <el-form-item label="出题资料" required>
          <div class="material-source-row">
            <el-select v-model="genForm.material_id" filterable placeholder="选择出题资料" style="width:100%" @change="onGenerationMaterial">
              <el-option v-for="item in materials" :key="item.id" :label="item.title" :value="item.id" />
            </el-select>
            <el-button v-if="auth.can('ai:write')" @click="openMaterialManager">管理资料</el-button>
          </div>
        </el-form-item>
        <el-form-item label="资料版本" required>
          <el-select v-model="genForm.material_version_id" placeholder="选择已解析版本" style="width:100%">
            <el-option
              v-for="version in materialVersions"
              :key="version.id"
              :label="versionLabel(version)"
              :value="version.id"
              :disabled="version.parse_status !== 'parsed'"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="培训类别" required>
          <el-select v-model="genForm.category_id" filterable style="width:100%">
            <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标难度" required>
          <el-select v-model="genForm.difficulty" style="width:100%"><el-option label="初级" value="easy" /><el-option label="中级" value="medium" /><el-option label="高级" value="hard" /></el-select>
        </el-form-item>
        <el-form-item label="单选题量"><el-input-number v-model="genForm.question_count_single" :min="1" :max="40" /></el-form-item>
        <el-form-item label="单选每题分值"><el-input-number v-model="genForm.score_single" :min="0.01" :max="100" :step="0.5" /></el-form-item>
        <el-form-item label="多选题量"><el-input-number v-model="genForm.question_count_multiple" :min="0" :max="20" /></el-form-item>
        <el-form-item label="多选每题分值"><el-input-number v-model="genForm.score_multiple" :min="0.01" :max="100" :step="0.5" /></el-form-item>
        <el-form-item label="分值合计"><el-tag :type="sumScore === 100 ? 'success' : 'danger'">{{ sumScore }} / 100 分</el-tag></el-form-item>
        <el-alert type="info" :closable="false" title="类别和难度由本次请求固定，模型输出不会覆盖；AI 仍只生成单选/多选。" />
      </el-form>
      <template #footer><el-button @click="genVisible = false">取消</el-button><el-button type="primary" :disabled="sumScore !== 100 || !genForm.material_id || !genForm.material_version_id || !genForm.category_id" @click="startGenerate">发起</el-button></template>
    </el-dialog>

    <el-dialog v-model="materialVisible" title="出题资料管理" width="780px" append-to-body @closed="onMaterialManagerClosed">
      <div class="material-create">
        <el-input v-model="materialForm.title" maxlength="128" placeholder="资料标题" />
        <el-input v-model="materialForm.description" maxlength="512" placeholder="资料说明（可选）" />
        <el-button type="primary" :loading="materialSaving" :disabled="materialSaving" @click="createMaterial">创建资料</el-button>
      </div>
      <div class="material-source-row">
        <el-select v-model="genForm.material_id" filterable placeholder="选择要维护的资料" style="width:100%" @change="onGenerationMaterial">
          <el-option v-for="item in materials" :key="item.id" :label="item.title" :value="item.id" />
        </el-select>
        <el-upload
          :show-file-list="false"
          accept=".pdf,.docx"
          :auto-upload="false"
          :disabled="!genForm.material_id || materialUploading"
          :on-change="onMaterialUpload"
        >
          <el-button type="success" :loading="materialUploading" :disabled="!genForm.material_id || materialUploading">上传新版本</el-button>
        </el-upload>
      </div>
      <el-table :data="materialVersions" style="margin-top:14px">
        <el-table-column prop="version_no" label="版本" width="90"><template #default="{ row }">v{{ row.version_no }}</template></el-table-column>
        <el-table-column prop="file_type" label="类型" width="90" />
        <el-table-column label="解析状态" width="120"><template #default="{ row }"><el-tag :type="parseStatusType(row.parse_status)">{{ parseStatusLabel(row.parse_status) }}</el-tag></template></el-table-column>
        <el-table-column prop="failure_reason" label="失败说明" min-width="220"><template #default="{ row }">{{ row.failure_reason || '—' }}</template></el-table-column>
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button v-if="row.parse_status === 'failed'" text type="warning" @click="retryMaterialVersion(row)">重新解析</el-button></template></el-table-column>
      </el-table>
      <template #footer><el-button @click="closeMaterialManager">返回 AI 出题</el-button></template>
    </el-dialog>

    <el-dialog v-model="taskVisible" title="AI 出题任务" width="640px" append-to-body :close-on-click-modal="false">
      <el-result :icon="taskStatus === 'completed' ? 'success' : taskStatus === 'failed' ? 'error' : 'info'" :title="taskTitle">
        <template #sub-title>
          <div v-if="taskStatus === 'completed'">生成 {{ taskData?.question_ids?.length || 0 }} 道待审核题目</div>
          <div v-else-if="taskStatus === 'failed'" class="task-error">{{ taskData?.error }}</div>
          <div v-else>正在根据已解析的出题资料生成题目，请勿重复提交。</div>
        </template>
      </el-result>
      <template #footer><el-button @click="taskVisible = false">关闭</el-button><el-button v-if="taskStatus === 'completed'" type="primary" @click="showQuestionList">查看题库</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadFile } from 'element-plus';
import http, { upload } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { formatDateTime } from '../../utils/format';
import QuestionEditor from '../../components/QuestionEditor.vue';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { Filter } from '@element-plus/icons-vue';
import {
  questionDraftFromView,
  questionRichTextToPlainText,
  type Difficulty, type Id, type Page, type QuestionConcept, type QuestionDraftPayload, type QuestionType, type QuestionView,
} from '../../api/training-types';

type CategoryOption = { id: Id; name: string };
type ConceptOption = { id: Id; name: string };
type MaterialParseStatus = 'pending' | 'parsed' | 'failed';
type QuestionMaterial = { id: Id; title: string; description: string | null };
type QuestionMaterialVersion = {
  id: Id;
  version_no: number;
  file_type: string;
  parse_status: MaterialParseStatus;
  failure_reason: string | null;
};
type QuestionMaterialDetail = QuestionMaterial & { versions: QuestionMaterialVersion[] };
type QuestionVersionHistory = {
  id: Id;
  revision: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  legacy_captured_at?: string | null;
};
type PageState = { page: number; page_size: number; total: number; keyword: string };
type EditorBaseline = {
  form: QuestionDraftPayload;
  mode: 'create' | 'edit';
  id: Id | null;
  expectedVersionId: Id | null;
};

function pageState(): PageState {
  return { page: 1, page_size: 20, total: 0, keyword: '' };
}

const typeOptions: Array<{ value: QuestionType; label: string }> = [
  { value: 'single', label: '单选题' }, { value: 'multiple', label: '多选题' },
  { value: 'judgment', label: '判断题' },
];
const auth = useAuthStore();
const router = useRouter();
const list = ref<QuestionView[]>([]);
const total = ref(0);
const loading = ref(false);
const categories = ref<CategoryOption[]>([]);
const materials = ref<QuestionMaterial[]>([]);
const materialVersions = ref<QuestionMaterialVersion[]>([]);
const filterConcepts = ref<QuestionConcept[]>([]);
const editorConcepts = ref<ConceptOption[]>([]);
const filterConceptPage = reactive(pageState());
const editorConceptPage = reactive(pageState());
const filterConceptLoading = ref(false);
const editorConceptLoading = ref(false);
const editorConceptScope = reactive<{ category_id: Id; type: QuestionType }>({ category_id: '', type: 'single' });
let filterConceptRequest = 0;
let editorConceptRequest = 0;
const query = reactive({ page: 1, page_size: 20, category_id: '', concept_id: '', status: '', type: '', difficulty: '', keyword: '' });

const editorVisible = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editingId = ref<Id | null>(null);
const editingExpectedVersionId = ref<Id | null>(null);
const editorForm = ref<QuestionDraftPayload>(emptyDraft());
const editorDirty = ref(false);
const editorBaseline = ref<EditorBaseline | null>(null);
let editorContext: symbol | null = null;
const saving = ref(false);
const previewVisible = ref(false);
const selectedQuestion = ref<QuestionView | null>(null);
const versionHistory = ref<QuestionVersionHistory[]>([]);
const versionHistoryPage = reactive(pageState());

const genVisible = ref(false);
const genForm = reactive({ material_id: '', material_version_id: '', category_id: '', difficulty: 'easy' as Difficulty, question_count_single: 20, score_single: 3, question_count_multiple: 5, score_multiple: 8 });
const materialVisible = ref(false);
const materialSaving = ref(false);
const materialUploading = ref(false);
const materialForm = reactive({ title: '', description: '' });
const taskVisible = ref(false);
const taskStatus = ref('');
const taskData = ref<any>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let materialPollTimer: ReturnType<typeof setInterval> | null = null;
let reopenGenerationAfterMaterial = false;

const sumScore = computed(() => Math.round((genForm.question_count_single * genForm.score_single + genForm.question_count_multiple * genForm.score_multiple) * 100) / 100);
const taskTitle = computed(() => ({ completed: '生成完成', failed: '生成失败', running: '生成中…', queued: '排队中…' } as Record<string, string>)[taskStatus.value] || taskStatus.value);
const canGenerate = computed(() => auth.can('ai:write') && auth.can('ai:read'));
const hasEditorDifficulty = computed(() => ['easy', 'medium', 'hard'].includes(editorForm.value.difficulty));
const missingAiPermissions = computed(() => {
  if (!auth.can('ai:write')) return '';
  const missing = [!auth.can('ai:read') ? 'AI 任务查看与出题资料读取' : ''].filter(Boolean);
  return missing.length ? `AI 出题入口已隐藏：还需${missing.join('、')}权限。人工录题不受影响。` : '';
});

function emptyDraft(): QuestionDraftPayload {
  return {
    category_id: categories.value[0]?.id || '', difficulty: 'easy', type: 'single', stem: '',
    options: [{ key: 'A', text: '' }, { key: 'B', text: '' }], answer: [0], analysis: '', score: 5,
  };
}

function cleanParams(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== undefined && item !== null));
}

function cloneEditorForm(value: QuestionDraftPayload): QuestionDraftPayload {
  return JSON.parse(JSON.stringify(value));
}

function editorSnapshot(): EditorBaseline {
  return {
    form: cloneEditorForm(editorForm.value),
    mode: editorMode.value,
    id: editingId.value,
    expectedVersionId: editingExpectedVersionId.value,
  };
}

function cloneEditorBaseline(value: EditorBaseline): EditorBaseline {
  return { ...value, form: cloneEditorForm(value.form) };
}

function captureEditorBaseline(value = editorSnapshot()) {
  editorBaseline.value = cloneEditorBaseline(value);
  editorDirty.value = false;
}

function discardEditorDraft() {
  const baseline = editorBaseline.value;
  if (baseline) {
    editorMode.value = baseline.mode;
    editingId.value = baseline.id;
    editingExpectedVersionId.value = baseline.expectedVersionId;
    editorForm.value = cloneEditorForm(baseline.form);
  }
  editorContext = null;
  editorDirty.value = false;
}

const editorUnsaved = useUnsavedChanges(editorDirty, { onDiscard: discardEditorDraft });
watch(
  () => [editorVisible.value, JSON.stringify(editorSnapshot()), JSON.stringify(editorBaseline.value)] as const,
  ([visible, current, baseline]) => {
    editorDirty.value = !!visible && !!editorBaseline.value && current !== baseline;
  },
  { flush: 'sync' },
);

async function closeEditor() {
  if (!await editorUnsaved.confirmDiscard()) return;
  editorContext = null;
  editorVisible.value = false;
}

async function beforeEditorClose(done: () => void) {
  if (!await editorUnsaved.confirmDiscard()) return;
  editorContext = null;
  done();
}

function plainText(html: string) { return questionRichTextToPlainText(html); }
function typeLabel(value: string) { return typeOptions.find((item) => item.value === value)?.label || value; }
function difficultyLabel(value: string | null) { return ({ easy: '初级', medium: '中级', hard: '高级' } as Record<string, string>)[value || ''] || '未知'; }
function sourceLabel(value: string) { return ({ ai: 'AI', manual: '人工', import: '导入' } as Record<string, string>)[value] || value; }
function statusLabel(value: string) { return ({ approved: '已通过', pending: '待审核', rejected: '已驳回' } as Record<string, string>)[value] || value; }
function statusTag(value: string) { return (value === 'approved' ? 'success' : value === 'rejected' ? 'danger' : 'info') as any; }
function parseStatusLabel(value: MaterialParseStatus) { return ({ pending: '解析中', parsed: '已解析', failed: '解析失败' } as const)[value]; }
function parseStatusType(value: MaterialParseStatus) { return value === 'parsed' ? 'success' : value === 'failed' ? 'danger' : 'info'; }
function versionLabel(value: QuestionMaterialVersion) { return 'v' + value.version_no + ' · ' + parseStatusLabel(value.parse_status); }
function expectedVersionId(value: Id | null | undefined): Id | null { return value ?? null; }
function savedVersionReceipt(value: unknown): Id | null {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
}

async function loadCategories() {
  const endpoint = auth.can('questions:write')
    ? '/ai/question-category-options'
    : auth.can('questions:read') ? '/ai/question-category-filters' : '/ai/generation-category-options';
  const result: any = await http.get(endpoint, { params: { page: 1, page_size: 100 } });
  categories.value = result.items || [];
}

async function loadMaterials() {
  if (!auth.can('ai:read')) {
    materials.value = [];
    return;
  }
  const result = await http.get('/admin/question-materials', { params: { page: 1, page_size: 100 } }) as Page<QuestionMaterial>;
  materials.value = Array.isArray(result.items) ? result.items : [];
}

let materialDetailRequest = 0;
async function onGenerationMaterial(value: string) {
  const request = ++materialDetailRequest;
  genForm.material_version_id = '';
  materialVersions.value = [];
  if (!value) return;
  const detail = await http.get('/admin/question-materials/' + encodeURIComponent(value)) as QuestionMaterialDetail;
  if (request !== materialDetailRequest || genForm.material_id !== value) return;
  materialVersions.value = Array.isArray(detail.versions) ? detail.versions : [];
}

function openMaterialManager() {
  reopenGenerationAfterMaterial = true;
  genVisible.value = false;
  materialVisible.value = true;
}

function closeMaterialManager() {
  materialVisible.value = false;
}

function onMaterialManagerClosed() {
  if (reopenGenerationAfterMaterial && !taskVisible.value) genVisible.value = true;
  reopenGenerationAfterMaterial = false;
}

async function createMaterial() {
  const title = materialForm.title.trim();
  if (!title) {
    ElMessage.warning('请填写资料标题');
    return;
  }
  materialSaving.value = true;
  try {
    const created = await http.post('/admin/question-materials', {
      title,
      description: materialForm.description.trim() || undefined,
    }) as QuestionMaterial;
    await loadMaterials();
    genForm.material_id = String(created.id);
    materialForm.title = '';
    materialForm.description = '';
    await onGenerationMaterial(genForm.material_id);
    ElMessage.success('出题资料已创建，可继续上传 PDF 或 DOCX 版本');
  } finally {
    materialSaving.value = false;
  }
}

function clearMaterialPoll() {
  if (materialPollTimer) globalThis.clearInterval(materialPollTimer);
  materialPollTimer = null;
}

function replaceMaterialVersion(next: QuestionMaterialVersion) {
  const index = materialVersions.value.findIndex((item) => item.id === next.id);
  if (index >= 0) materialVersions.value.splice(index, 1, next);
  else materialVersions.value.unshift(next);
}

async function pollMaterialVersion(materialId: string, versionId: string) {
  clearMaterialPoll();
  const check = async () => {
    try {
      const version = await http.get(
        '/admin/question-materials/' + encodeURIComponent(materialId) + '/versions/' + encodeURIComponent(versionId) + '/status',
      ) as QuestionMaterialVersion;
      if (genForm.material_id === materialId) replaceMaterialVersion(version);
      if (version.parse_status === 'parsed' || version.parse_status === 'failed') {
        clearMaterialPoll();
        if (version.parse_status === 'parsed') ElMessage.success('资料解析完成');
        else ElMessage.error(version.failure_reason || '资料解析失败');
      }
      return version.parse_status;
    } catch {
      return 'pending' as const;
    }
  };
  if (await check() !== 'pending') return;
  materialPollTimer = globalThis.setInterval(() => { void check(); }, 2000);
}

async function onMaterialUpload(file: UploadFile) {
  if (!file.raw || !genForm.material_id) return false;
  const materialId = genForm.material_id;
  materialUploading.value = true;
  try {
    const created = await upload('/admin/question-materials/' + encodeURIComponent(materialId) + '/versions', file.raw, 'file') as any;
    await onGenerationMaterial(materialId);
    ElMessage.success('版本已上传，正在解析');
    void pollMaterialVersion(materialId, String(created.version_id || created.id));
  } finally {
    materialUploading.value = false;
  }
  return false;
}

async function retryMaterialVersion(version: QuestionMaterialVersion) {
  if (!genForm.material_id) return;
  const materialId = genForm.material_id;
  await http.post(
    '/admin/question-materials/' + encodeURIComponent(materialId) + '/versions/' + encodeURIComponent(version.id) + '/retry',
  );
  replaceMaterialVersion({ ...version, parse_status: 'pending', failure_reason: null });
  ElMessage.success('已重新提交解析');
  void pollMaterialVersion(materialId, version.id);
}

async function load() {
  if (!auth.can('questions:read')) {
    list.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const result: any = await http.get('/ai/questions', { params: cleanParams(query) });
    list.value = result.list || [];
    total.value = result.total || 0;
  } finally { loading.value = false; }
}

function applyPage<T>(target: { value: T[] }, state: PageState, result: Page<T>) {
  target.value = Array.isArray(result.items) ? result.items : [];
  state.total = Number(result.total || 0);
  state.page = Number(result.page || 1);
  state.page_size = Number(result.page_size || 20);
}

async function loadFilterConcepts(page = filterConceptPage.page, keyword = filterConceptPage.keyword) {
  if (!query.category_id || !auth.can('questions:read')) {
    filterConceptRequest += 1;
    filterConcepts.value = [];
    Object.assign(filterConceptPage, pageState());
    return;
  }
  const request = ++filterConceptRequest;
  filterConceptLoading.value = true;
  try {
    const result = await http.get('/ai/question-concepts', {
      params: cleanParams({
        category_id: query.category_id,
        type: (query.type || undefined) as QuestionType | undefined,
        keyword,
        page,
        page_size: filterConceptPage.page_size,
      }),
    }) as Page<QuestionConcept>;
    if (request !== filterConceptRequest) return;
    filterConceptPage.keyword = keyword;
    applyPage(filterConcepts, filterConceptPage, result);
  } finally {
    if (request === filterConceptRequest) filterConceptLoading.value = false;
  }
}

async function onFilterScopeChange() {
  query.concept_id = '';
  query.page = 1;
  Object.assign(filterConceptPage, pageState());
  await loadFilterConcepts(1, '');
  await load();
}

async function loadFilterConceptPage(page: number) {
  await loadFilterConcepts(page, filterConceptPage.keyword);
}

function searchFilterConcepts(keyword: string) {
  filterConceptPage.keyword = keyword;
  void loadFilterConcepts(1, keyword);
}

async function requestEditorConcepts(page = editorConceptPage.page, keyword = editorConceptPage.keyword) {
  if (!editorConceptScope.category_id || !auth.can('questions:write')) {
    editorConceptRequest += 1;
    editorConcepts.value = [];
    Object.assign(editorConceptPage, pageState());
    return;
  }
  const request = ++editorConceptRequest;
  editorConceptLoading.value = true;
  try {
    const result = await http.get('/ai/question-concept-options', {
      params: cleanParams({
        category_id: editorConceptScope.category_id,
        type: editorConceptScope.type,
        keyword,
        page,
        page_size: editorConceptPage.page_size,
      }),
    }) as Page<ConceptOption>;
    if (request !== editorConceptRequest) return;
    editorConceptPage.keyword = keyword;
    applyPage(editorConcepts, editorConceptPage, result);
  } finally {
    if (request === editorConceptRequest) editorConceptLoading.value = false;
  }
}

async function loadEditorConcepts(scope: { category_id: Id; type: QuestionType }) {
  Object.assign(editorConceptScope, scope);
  Object.assign(editorConceptPage, pageState());
  await requestEditorConcepts(1, '');
}

async function loadEditorConceptPage(page: number) {
  await requestEditorConcepts(page, editorConceptPage.keyword);
}

function searchEditorConcepts(keyword: string) {
  editorConceptPage.keyword = keyword;
  void requestEditorConcepts(1, keyword);
}

function toDraft(row: QuestionView): QuestionDraftPayload {
  return questionDraftFromView(row);
}

async function openCreate() {
  const context = Symbol('question-editor-context');
  editorContext = context;
  editorMode.value = 'create'; editingId.value = null; editingExpectedVersionId.value = null; editorForm.value = emptyDraft();
  captureEditorBaseline();
  await loadEditorConcepts({ category_id: editorForm.value.category_id, type: editorForm.value.type });
  if (editorContext !== context) return;
  editorVisible.value = true;
}

async function openEdit(row: QuestionView) {
  const context = Symbol('question-editor-context');
  editorContext = context;
  editorMode.value = 'edit'; editingId.value = row.question_id; editingExpectedVersionId.value = expectedVersionId(row.current_version_id); editorForm.value = toDraft(row);
  captureEditorBaseline();
  await loadEditorConcepts({ category_id: editorForm.value.category_id, type: editorForm.value.type });
  if (editorContext !== context) return;
  editorVisible.value = true;
}

async function openView(row: QuestionView) {
  selectedQuestion.value = row;
  Object.assign(versionHistoryPage, pageState());
  await loadHistoryPage(1);
  previewVisible.value = true;
}

async function loadHistoryPage(page: number) {
  if (!selectedQuestion.value) return;
  const history = await http.get(`/ai/questions/${selectedQuestion.value.question_id}/history`, {
    params: { page, page_size: versionHistoryPage.page_size },
  }) as Page<QuestionVersionHistory>;
  applyPage(versionHistory, versionHistoryPage, history);
}

function payload(value: QuestionDraftPayload) {
  return Object.fromEntries(Object.entries({
    ...value,
    concept_id: value.concept_id || null,
    analysis: value.analysis ?? null,
  }).filter(([, item]) => item !== undefined && item !== ''));
}

async function saveQuestion() {
  if (saving.value) return;
  if (!hasEditorDifficulty.value) {
    ElMessage.warning('请选择题目难度后再保存');
    return;
  }
  const requestContext = editorContext;
  if (!requestContext || !editorVisible.value) return;
  const submitted = editorSnapshot();
  saving.value = true;
  try {
    let saved: any;
    if (submitted.mode === 'create') {
      saved = await http.post('/ai/questions', payload(submitted.form));
    } else {
      saved = await http.put(`/ai/questions/${submitted.id}`, {
        ...payload(submitted.form), expected_version_id: submitted.expectedVersionId,
      });
    }
    const receipt = savedVersionReceipt(saved?.saved_version_id);
    if (!receipt) {
      ElMessage.warning('保存响应缺少本次写入版本凭据，已保留当前草稿，请刷新确认后再编辑');
    } else {
      ElMessage.success(submitted.mode === 'create' ? '人工题已保存，并记录当前管理员确认信息' : '已生成待审核新版本，旧版本保持不变');
    }
    if (receipt && editorContext === requestContext && editorVisible.value) {
      const savedId = saved?.question_id === undefined || saved?.question_id === null
        ? submitted.id
        : String(saved.question_id);
      const persisted: EditorBaseline = {
        form: cloneEditorForm(submitted.form),
        mode: submitted.mode === 'create' && savedId ? 'edit' : submitted.mode,
        id: savedId,
        expectedVersionId: receipt,
      };
      editorMode.value = persisted.mode;
      editingId.value = persisted.id;
      editingExpectedVersionId.value = persisted.expectedVersionId;
      captureEditorBaseline(persisted);
      editorDirty.value = JSON.stringify(editorSnapshot()) !== JSON.stringify(editorBaseline.value);
      if (!editorDirty.value) {
        editorUnsaved.markClean();
        editorContext = null;
        editorVisible.value = false;
      }
    }
    await load();
  } finally { saving.value = false; }
}

async function createConcept() {
  const answer = await ElMessageBox.prompt('输入考点组名称', '新建考点组', { inputPattern: /\S/, inputErrorMessage: '名称不能为空' }).catch(() => null);
  if (!answer) return;
  const created: any = await http.post('/ai/question-concepts', { category_id: editorForm.value.category_id, type: editorForm.value.type, name: answer.value.trim() });
  Object.assign(editorConceptPage, pageState());
  await requestEditorConcepts(1, '');
  editorForm.value.concept_id = String(created.id);
}

async function reviewQuestion(row: QuestionView, status: 'approved' | 'rejected') {
  let reason: string | undefined;
  if (status === 'rejected') {
    const answer = await ElMessageBox.prompt('填写驳回意见（可选）', '驳回题目', { inputPlaceholder: '驳回原因' }).catch(() => null);
    if (!answer) return;
    reason = answer.value;
  }
  await http.put(`/ai/questions/${row.question_id}/review`, {
    expected_version_id: expectedVersionId(row.current_version_id), status, reason,
  });
  ElMessage.success(status === 'approved' ? '已通过并记录审核人/时间' : '已驳回');
  await load();
}

async function regenerate(row: QuestionView) {
  await ElMessageBox.confirm('重新生成会保留旧版本，新内容固定沿用当前类别、难度和来源资料版本。继续？', '重新生成', { type: 'warning' });
  await http.post(`/ai/questions/${row.question_id}/regenerate`, { expected_version_id: expectedVersionId(row.current_version_id) });
  ElMessage.success('已生成待审核新版本');
  await load();
}

function openGenerate() {
  genForm.category_id ||= categories.value[0]?.id || '';
  if (!genForm.material_id && materials.value[0]) {
    genForm.material_id = String(materials.value[0].id);
    void onGenerationMaterial(genForm.material_id);
  }
  genVisible.value = true;
}

async function startGenerate() {
  if (!genForm.material_id || !genForm.material_version_id || !genForm.category_id) return;
  const started: any = await http.post('/ai/generate-questions', {
    ...genForm,
    material_id: String(genForm.material_id),
    material_version_id: String(genForm.material_version_id),
    category_id: String(genForm.category_id),
  });
  reopenGenerationAfterMaterial = false;
  materialVisible.value = false;
  genVisible.value = false; taskVisible.value = true; taskStatus.value = started.status || 'running'; taskData.value = null;
  if (pollTimer) globalThis.clearInterval(pollTimer);
  const timerId = globalThis.setInterval(async () => {
    try {
      const status: any = await http.get(`/ai/generate-status/${started.task_id}`);
      taskStatus.value = status.status; taskData.value = status;
      if (status.status === 'completed' || status.status === 'failed') {
        if (pollTimer === timerId) globalThis.clearInterval(timerId);
        if (pollTimer === timerId) pollTimer = null;
      }
    } catch { /* transient status failure: preserve the same task and retry */ }
  }, 3000);
  pollTimer = timerId;
}

function showQuestionList() {
  reopenGenerationAfterMaterial = false;
  materialVisible.value = false;
  genVisible.value = false;
  taskVisible.value = false;
  void load();
}

onMounted(async () => {
  await loadCategories();
  await loadMaterials();
  await load();
});

onBeforeUnmount(() => {
  if (pollTimer) globalThis.clearInterval(pollTimer);
  pollTimer = null;
  clearMaterialPoll();
});
</script>

<style scoped>
.question-page { padding: 30px; }
.page-head--hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.page-head__main { min-width: 0; }
.page-head__actions { display: flex; align-items: flex-end; flex-direction: column; gap: 12px; flex: none; }
.head-note { color: var(--re-text-3); font-size: 12px; white-space: nowrap; }
.head-note i { display: inline-block; width: 6px; height: 6px; margin-right: 7px; vertical-align: 1px; border-radius: 50%; background: var(--re-primary); box-shadow: 0 0 0 4px rgba(48,86,211,.1); }
.head-badge { padding: 5px 9px; border: 1px solid #dfe5f4; border-radius: 6px; color: var(--re-primary-deep); background: #f4f6fd; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; }
.question-stat-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
.question-stat { display: grid; grid-template-columns: auto auto auto; align-items: baseline; column-gap: 7px; row-gap: 2px; padding: 14px 16px; border: 1px solid var(--re-border); border-radius: 12px; background: #fbfcff; }
.question-stat span, .question-stat small { color: var(--re-text-3); font-size: 12px; }
.question-stat strong { color: var(--re-text); font-size: 24px; letter-spacing: -.7px; }
.question-stat em { color: var(--re-text-2); font-size: 12px; font-style: normal; }
.question-stat small { grid-column: 1 / -1; }
.notice-stack { display: grid; gap: 8px; margin-bottom: 18px; }
.notice-stack :deep(.el-alert) { margin: 0; border-radius: 10px; }
.filter-panel { display: flex; align-items: flex-start; gap: 22px; margin-bottom: 24px; padding: 14px 16px 16px; border: 1px solid var(--re-border); border-radius: 12px; background: #f8faff; }
.filter-panel__heading { display: flex; align-items: center; gap: 10px; flex: none; padding-top: 7px; }
.filter-panel__heading > div { display: flex; flex-direction: column; gap: 3px; }
.filter-panel__heading strong { color: var(--re-text); font-size: 13px; }
.filter-panel__heading span { color: var(--re-text-3); font-size: 11px; white-space: nowrap; }
.filter-panel__icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; background: var(--el-color-primary-light-9); color: var(--re-primary); }
.question-filter-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; flex: 1; min-width: 0; }
.question-filter-grid > .el-input { grid-column: span 2; }
.question-filter-grid :deep(.el-select), .question-filter-grid :deep(.el-input) { width: 100%; }
.question-toolbar__actions { display: flex; justify-content: flex-end; gap: 8px; grid-column: 1 / -1; padding-top: 2px; }
.question-toolbar__actions .el-button { border-radius: 8px; }
.concept-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin: 10px 0; color: #909399; font-size: 13px; }
.table-section__head { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 10px; }
.table-section__head > div { display: flex; align-items: baseline; gap: 10px; }
.section-kicker { color: var(--re-text-3); font-size: 10px; font-weight: 700; letter-spacing: 1.8px; }
.table-section__head strong { color: var(--re-text); font-size: 15px; }
.table-total { color: var(--re-text-3); font-size: 12px; }
.table-shell { overflow: hidden; border: 1px solid var(--re-border); border-radius: 12px; }
.question-table { border: 0; }
.question-table :deep(.el-table__inner-wrapper::before) { display: none; }
.question-table :deep(.el-table__header-wrapper th) { height: 44px; background: #f7f9fc; }
.question-table :deep(.el-table__body-wrapper td) { height: 64px; }
.question-table :deep(.el-table__empty-text) { width: 100%; }
.question-empty { display: flex; align-items: center; flex-direction: column; gap: 7px; padding: 46px 20px 50px; }
.empty-glyph { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 1px solid #dce4f8; border-radius: 14px; color: var(--re-primary); background: #f2f5ff; font-family: var(--re-mono); font-size: 17px; font-weight: 700; }
.question-empty strong { color: var(--re-text-2); font-size: 14px; }
.question-empty small { color: var(--re-text-3); font-size: 12px; }
.difficulty-text { font-size: 13px; font-weight: 600; }
.difficulty-text--easy { color: var(--re-success); }
.difficulty-text--medium { color: var(--re-warning); }
.difficulty-text--hard { color: var(--re-danger); }
.difficulty-text--unknown { color: var(--re-text-3); }
.source-text { color: var(--re-text-2); font-size: 13px; }
.question-pagination { margin-top: 16px; justify-content: flex-end; }
.stem-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor-tools { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.editor-hint { color: #909399; font-size: 13px; }
.material-source-row { display: flex; align-items: center; gap: 10px; width: 100%; }
.material-create { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(220px, 1.5fr) auto; gap: 10px; margin-bottom: 14px; }
.version-history { margin-top: 24px; border-top: 1px solid #ebeef5; padding-top: 18px; }
.task-error { color: #f56c6c; }
@media (max-width: 1100px) {
  .page-head--hero, .filter-panel { align-items: stretch; flex-direction: column; }
  .page-head__actions { align-items: flex-start; }
  .question-filter-grid { grid-template-columns: repeat(3, minmax(140px, 1fr)); }
  .question-filter-grid > .el-input { grid-column: span 2; }
}
@media (max-width: 680px) {
  .question-page { padding: 20px; }
  .question-stat-strip { grid-template-columns: 1fr; }
  .question-filter-grid { grid-template-columns: 1fr; }
  .question-filter-grid > .el-input { grid-column: auto; }
  .question-toolbar__actions { justify-content: flex-start; flex-wrap: wrap; }
}
</style>
