<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>统一题库与 AI 出题</h2>
      <p class="desc">四题型按类别、难度和版本管理；核心内容修改后回到待审核，不覆盖旧版本。</p>
    </div>

    <el-alert v-if="missingAiPermissions" type="info" show-icon :closable="false" :title="missingAiPermissions" style="margin-bottom:16px" />
    <el-alert v-if="!categories.length" type="warning" show-icon :closable="false" title="暂无启用的培训类别，请先创建类别。" style="margin-bottom:16px" />
    <div class="toolbar question-toolbar">
      <el-select v-model="query.category_id" placeholder="培训类别" clearable filterable @change="onFilterScopeChange">
        <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-select v-model="query.difficulty" placeholder="难度" clearable @change="load">
        <el-option label="初级" value="easy" /><el-option label="中级" value="medium" /><el-option label="高级" value="hard" />
      </el-select>
      <el-select v-model="query.type" placeholder="题型" clearable @change="onFilterScopeChange">
        <el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-select v-model="query.concept_id" placeholder="考点组" clearable filterable @change="load">
        <el-option v-for="item in filterConcepts" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-select v-model="query.status" placeholder="审核状态" clearable @change="load">
        <el-option label="待审核" value="pending" /><el-option label="已通过" value="approved" /><el-option label="已驳回" value="rejected" />
      </el-select>
      <el-input v-model="query.keyword" clearable placeholder="搜索题干" @keyup.enter="load" />
      <div class="question-toolbar__actions">
        <el-button v-if="auth.can('questions:write')" @click="openCreate">人工录题</el-button>
        <el-button v-if="canGenerate" type="primary" :disabled="!categories.length || !regulations.length" @click="openGenerate">AI 出题</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="list">
      <template #empty><el-empty description="暂无符合条件的题目" :image-size="96" /></template>
      <el-table-column prop="question_id" label="ID" width="70" />
      <el-table-column label="题干" min-width="300">
        <template #default="{ row }"><div class="stem-summary">{{ plainText(row.stem) }}</div></template>
      </el-table-column>
      <el-table-column label="题型" width="100"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column>
      <el-table-column label="难度" width="80"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column>
      <el-table-column prop="score" label="建议分" width="80" />
      <el-table-column label="版本" width="90"><template #default="{ row }">{{ row.revision ? `v${row.revision}` : '旧题' }}</template></el-table-column>
      <el-table-column label="来源" width="80"><template #default="{ row }">{{ sourceLabel(row.source) }}</template></el-table-column>
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
    <el-pagination class="question-pagination" layout="total, prev, pager, next" :total="total" :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <el-dialog v-model="editorVisible" :title="editorMode === 'create' ? '人工录入题目' : '修订题目'" width="860px" destroy-on-close>
      <div class="editor-tools">
        <el-button v-if="auth.can('questions:write') && editorForm.category_id" size="small" @click="createConcept">新建当前题型考点组</el-button>
        <span v-if="editorMode === 'edit'" class="editor-hint">保存会生成待审核新版本；旧版本保持不变。</span>
      </div>
      <QuestionEditor v-model="editorForm" :categories="categories" :concepts="editorConcepts" :regulations="regulations" :can-upload-media="auth.can('media:write')" @scope-change="loadEditorConcepts" />
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveQuestion">{{ editorMode === 'create' ? '保存并确认可用' : '保存为待审核版本' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="题目预览" width="760px" destroy-on-close>
      <QuestionPreview v-if="selectedQuestion" :question="selectedQuestion" />
      <el-timeline v-if="versionHistory.length" class="version-history">
        <el-timeline-item v-for="item in versionHistory" :key="item.id" :timestamp="formatDateTime(item.created_at)" placement="top">
          v{{ item.revision }} · {{ statusLabel(item.status) }}
          <span v-if="item.legacy_captured_at">（升级时捕获，非历史还原）</span>
        </el-timeline-item>
      </el-timeline>
    </el-dialog>

    <el-dialog v-model="genVisible" title="发起 AI 出题" width="600px">
      <el-form label-width="140px">
        <el-form-item label="目标制度" required>
          <el-select v-model="genForm.regulation_id" filterable style="width:100%" @change="onGenerationRegulation">
            <el-option v-for="item in regulations" :key="item.id" :label="item.title" :value="String(item.id)" />
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
      <template #footer><el-button @click="genVisible = false">取消</el-button><el-button type="primary" :disabled="sumScore !== 100 || !genForm.regulation_id || !genForm.category_id" @click="startGenerate">发起</el-button></template>
    </el-dialog>

    <el-dialog v-model="taskVisible" title="AI 出题任务" width="640px" :close-on-click-modal="false">
      <el-result :icon="taskStatus === 'completed' ? 'success' : taskStatus === 'failed' ? 'error' : 'info'" :title="taskTitle">
        <template #sub-title>
          <div v-if="taskStatus === 'completed'">生成 {{ taskData?.question_ids?.length || 0 }} 道待审核题目</div>
          <div v-else-if="taskStatus === 'failed'" class="task-error">{{ taskData?.error }}</div>
          <div v-else>正在解析制度内容并生成题目，请勿重复提交。</div>
        </template>
      </el-result>
      <template #footer><el-button @click="taskVisible = false">关闭</el-button><el-button v-if="taskStatus === 'completed'" type="primary" @click="taskVisible = false; load()">查看题库</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { formatDateTime } from '../../utils/format';
import QuestionEditor from '../../components/QuestionEditor.vue';
import QuestionPreview from '../../components/QuestionPreview.vue';
import type { Difficulty, Id, QuestionConcept, QuestionDraftPayload, QuestionType, QuestionView } from '../../api/training-types';

type CategoryOption = { id: Id; name: string };
type RegulationOption = { id: Id | number; title: string; current_version_id?: Id | number | null; category_id?: Id | null };

const typeOptions: Array<{ value: QuestionType; label: string }> = [
  { value: 'single', label: '单选题' }, { value: 'multiple', label: '多选题' },
  { value: 'judgment', label: '判断题' }, { value: 'image', label: '图片作答题' },
];
const auth = useAuthStore();
const list = ref<QuestionView[]>([]);
const total = ref(0);
const loading = ref(false);
const categories = ref<CategoryOption[]>([]);
const regulations = ref<RegulationOption[]>([]);
const filterConcepts = ref<QuestionConcept[]>([]);
const editorConcepts = ref<QuestionConcept[]>([]);
const query = reactive({ page: 1, page_size: 20, regulation_id: '', category_id: '', concept_id: '', status: '', type: '', difficulty: '', keyword: '' });

const editorVisible = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editingId = ref<Id | null>(null);
const editorForm = ref<QuestionDraftPayload>(emptyDraft());
const saving = ref(false);
const previewVisible = ref(false);
const selectedQuestion = ref<QuestionView | null>(null);
const versionHistory = ref<any[]>([]);

const genVisible = ref(false);
const genForm = reactive({ regulation_id: '', category_id: '', difficulty: 'easy' as Difficulty, question_count_single: 20, score_single: 3, question_count_multiple: 5, score_multiple: 8 });
const taskVisible = ref(false);
const taskStatus = ref('');
const taskData = ref<any>(null);
let pollTimer: number | null = null;

const sumScore = computed(() => Math.round((genForm.question_count_single * genForm.score_single + genForm.question_count_multiple * genForm.score_multiple) * 100) / 100);
const taskTitle = computed(() => ({ completed: '生成完成', failed: '生成失败', running: '生成中…', queued: '排队中…' } as Record<string, string>)[taskStatus.value] || taskStatus.value);
const canGenerate = computed(() => auth.can('ai:write') && auth.can('ai:read') && auth.can('regulations:read'));
const missingAiPermissions = computed(() => {
  if (!auth.can('ai:write')) return '';
  const missing = [
    !auth.can('ai:read') ? 'AI 任务查看' : '',
    !auth.can('regulations:read') ? '制度读取' : '',
  ].filter(Boolean);
  return missing.length ? `AI 出题入口已隐藏：还需${missing.join('、')}权限。人工录题不受影响。` : '';
});

function emptyDraft(): QuestionDraftPayload {
  return {
    category_id: categories.value[0]?.id || '', difficulty: 'easy', type: 'single', stem: '',
    options: [{ key: 'A', text: '' }, { key: 'B', text: '' }], answer: [0], analysis: '', rubric: null, score: 5,
  };
}

function cleanParams(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== undefined && item !== null));
}

function plainText(html: string) {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '');
  const node = document.createElement('div'); node.innerHTML = html; return node.textContent || '';
}
function typeLabel(value: string) { return typeOptions.find((item) => item.value === value)?.label || value; }
function difficultyLabel(value: string | null) { return ({ easy: '初级', medium: '中级', hard: '高级' } as Record<string, string>)[value || ''] || '未知'; }
function sourceLabel(value: string) { return ({ ai: 'AI', manual: '人工', import: '导入' } as Record<string, string>)[value] || value; }
function statusLabel(value: string) { return ({ approved: '已通过', pending: '待审核', rejected: '已驳回' } as Record<string, string>)[value] || value; }
function statusTag(value: string) { return (value === 'approved' ? 'success' : value === 'rejected' ? 'danger' : 'info') as any; }

async function loadCategories() {
  const endpoint = auth.can('questions:write')
    ? '/ai/question-category-options'
    : auth.can('questions:read') ? '/ai/question-category-filters' : '/ai/generation-category-options';
  const result: any = await http.get(endpoint, { params: { page: 1, page_size: 100 } });
  categories.value = result.items || [];
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

async function loadConcepts(categoryId: string, type: QuestionType | undefined, purpose: 'filter' | 'editor') {
  if (!categoryId) return [];
  if (purpose === 'filter') {
    if (!auth.can('questions:read')) return [];
    return await http.get('/ai/question-concepts', { params: cleanParams({ category_id: categoryId, type }) }) as QuestionConcept[];
  }
  if (!auth.can('questions:write')) return [];
  const result: any = await http.get('/ai/question-concept-options', {
    params: cleanParams({ category_id: categoryId, type, page: 1, page_size: 100 }),
  });
  return result.items || [];
}

async function onFilterScopeChange() {
  query.concept_id = '';
  filterConcepts.value = await loadConcepts(query.category_id, (query.type || undefined) as QuestionType | undefined, 'filter');
  await load();
}

async function loadEditorConcepts(scope: { category_id: Id; type: QuestionType }) {
  editorConcepts.value = await loadConcepts(scope.category_id, scope.type, 'editor');
}

function toDraft(row: QuestionView): QuestionDraftPayload {
  return {
    category_id: row.category_id || '', difficulty: row.difficulty || 'easy', type: row.type,
    stem: row.stem, options: JSON.parse(JSON.stringify(row.options || [])), answer: [...(row.answer || [])],
    analysis: row.analysis ?? null, rubric: row.rubric ?? null, score: Number(row.score),
    concept_id: row.concept_id || undefined,
    regulation_id: row.regulation_id === null || row.regulation_id === undefined ? undefined : String(row.regulation_id),
    regulation_version_id: row.regulation_version_id || undefined,
  };
}

async function openCreate() {
  editorMode.value = 'create'; editingId.value = null; editorForm.value = emptyDraft();
  await loadEditorConcepts({ category_id: editorForm.value.category_id, type: editorForm.value.type });
  editorVisible.value = true;
}

async function openEdit(row: QuestionView) {
  editorMode.value = 'edit'; editingId.value = row.question_id; editorForm.value = toDraft(row);
  await loadEditorConcepts({ category_id: editorForm.value.category_id, type: editorForm.value.type });
  editorVisible.value = true;
}

async function openView(row: QuestionView) {
  selectedQuestion.value = row;
  versionHistory.value = await http.get(`/ai/questions/${row.question_id}/versions`) as any[];
  previewVisible.value = true;
}

function payload(value: QuestionDraftPayload) {
  return Object.fromEntries(Object.entries({
    ...value,
    concept_id: value.concept_id || null,
    regulation_id: value.regulation_id || null,
    regulation_version_id: value.regulation_id ? value.regulation_version_id || null : null,
    analysis: value.analysis ?? null,
    rubric: value.rubric ?? null,
  }).filter(([, item]) => item !== undefined && item !== ''));
}

async function saveQuestion() {
  saving.value = true;
  try {
    if (editorMode.value === 'create') {
      await http.post('/ai/questions', payload(editorForm.value));
      ElMessage.success('人工题已保存，并记录当前管理员确认信息');
    } else {
      await http.put(`/ai/questions/${editingId.value}`, payload(editorForm.value));
      ElMessage.success('已生成待审核新版本，旧版本保持不变');
    }
    editorVisible.value = false;
    await load();
  } finally { saving.value = false; }
}

async function createConcept() {
  const answer = await ElMessageBox.prompt('输入考点组名称', '新建考点组', { inputPattern: /\S/, inputErrorMessage: '名称不能为空' }).catch(() => null);
  if (!answer) return;
  const created: any = await http.post('/ai/question-concepts', { category_id: editorForm.value.category_id, type: editorForm.value.type, name: answer.value.trim() });
  await loadEditorConcepts({ category_id: editorForm.value.category_id, type: editorForm.value.type });
  editorForm.value.concept_id = String(created.id);
}

async function reviewQuestion(row: QuestionView, status: 'approved' | 'rejected') {
  let reason: string | undefined;
  if (status === 'rejected') {
    const answer = await ElMessageBox.prompt('填写驳回意见（可选）', '驳回题目', { inputPlaceholder: '驳回原因' }).catch(() => null);
    if (!answer) return;
    reason = answer.value;
  }
  await http.put(`/ai/questions/${row.question_id}/review`, { status, reason });
  ElMessage.success(status === 'approved' ? '已通过并记录审核人/时间' : '已驳回');
  await load();
}

async function regenerate(row: QuestionView) {
  await ElMessageBox.confirm('重新生成会保留旧版本，新内容固定沿用当前类别、难度和来源制度版本。继续？', '重新生成', { type: 'warning' });
  await http.post(`/ai/questions/${row.question_id}/regenerate`);
  ElMessage.success('已生成待审核新版本');
  await load();
}

function openGenerate() {
  genForm.category_id ||= categories.value[0]?.id || '';
  genForm.regulation_id ||= regulations.value[0] ? String(regulations.value[0].id) : '';
  onGenerationRegulation(genForm.regulation_id);
  genVisible.value = true;
}

function onGenerationRegulation(value: string) {
  const regulation = regulations.value.find((item) => String(item.id) === String(value));
  if (regulation?.category_id && categories.value.some((item) => item.id === regulation.category_id)) {
    genForm.category_id = regulation.category_id;
  }
}

async function startGenerate() {
  const started: any = await http.post('/ai/generate-questions', { ...genForm, regulation_id: String(genForm.regulation_id), category_id: String(genForm.category_id) });
  genVisible.value = false; taskVisible.value = true; taskStatus.value = started.status || 'running'; taskData.value = null;
  if (pollTimer) window.clearInterval(pollTimer);
  const timerId = window.setInterval(async () => {
    try {
      const status: any = await http.get(`/ai/generate-status/${started.task_id}`);
      taskStatus.value = status.status; taskData.value = status;
      if (status.status === 'completed' || status.status === 'failed') {
        if (pollTimer === timerId) window.clearInterval(timerId);
        if (pollTimer === timerId) pollTimer = null;
      }
    } catch { /* transient status failure: preserve the same task and retry */ }
  }, 3000);
  pollTimer = timerId;
}

onMounted(async () => {
  await loadCategories();
  if (auth.can('regulations:read')) {
    const regulationPage: any = await http.get('/regulations', { params: { page_size: 100 } });
    regulations.value = regulationPage.list || regulationPage.items || [];
  }
  await load();
});

onBeforeUnmount(() => { if (pollTimer) window.clearInterval(pollTimer); pollTimer = null; });
</script>

<style scoped>
.question-toolbar { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)) minmax(160px, 1.4fr); gap: 10px; align-items: center; }
.question-toolbar__actions { display: flex; justify-content: flex-end; gap: 8px; grid-column: 1 / -1; }
.question-pagination { margin-top: 16px; justify-content: flex-end; }
.stem-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor-tools { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.editor-hint { color: #909399; font-size: 13px; }
.version-history { margin-top: 24px; border-top: 1px solid #ebeef5; padding-top: 18px; }
.task-error { color: #f56c6c; }
@media (max-width: 1100px) { .question-toolbar { grid-template-columns: repeat(3, minmax(140px, 1fr)); } }
</style>
