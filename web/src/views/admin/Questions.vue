<template>
  <div class="page-card question-page">
    <div class="question-stat-strip">
      <div class="question-stat"><span>题库题目</span><strong>{{ total }}</strong><em>条</em><small>当前筛选结果</small></div>
      <div class="question-stat"><span>培训类别</span><strong>{{ categories.length }}</strong><em>个</em><small>可用出题范围</small></div>
    </div>

    <div class="notice-stack">
      <el-alert v-if="!categories.length" type="warning" show-icon :closable="false" title="暂无启用的培训类别，请先创建类别。" />
      <el-alert v-if="catalogError" type="warning" show-icon :closable="false" :title="catalogError" />
      <el-button v-if="catalogError" link :loading="catalogLoading" @click="loadAuthoringOptions">重试加载难度</el-button>
    </div>
    <FitsTable>
      <template #search>
        <div class="filter-panel__heading">
          <span class="filter-panel__icon"><el-icon><Filter /></el-icon></span>
          <div><strong>筛选题目</strong><span>按范围、难度、题型和审核状态缩小结果</span></div>
        </div>
        <FitsListSearch @submit.prevent>
          <el-form-item label="培训类别">
            <el-select v-model="query.category_id" placeholder="培训类别" clearable filterable @change="onFilterScopeChange">
              <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="难度">
            <el-select v-model="query.difficulty" placeholder="难度" clearable @change="load">
              <el-option v-for="item in difficultyCatalog" :key="item.code" :label="item.label" :value="item.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="题型">
            <el-select v-model="query.type" placeholder="题型" clearable @change="onFilterScopeChange">
              <el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="考点组">
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
          </el-form-item>
          <el-form-item label="审核状态">
            <el-select v-model="query.status" placeholder="审核状态" clearable @change="load">
              <el-option label="待审核" value="pending" /><el-option label="已通过" value="approved" /><el-option label="已驳回" value="rejected" />
            </el-select>
          </el-form-item>
          <el-form-item label="题干"><el-input v-model="query.keyword" clearable placeholder="搜索题干" @keyup.enter="load" /></el-form-item>
        </FitsListSearch>
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
      </template>
      <template v-if="auth.can('questions:write')" #actions>
        <el-button plain @click="openCreate">人工录题</el-button>
      </template>

      <section class="table-section">
        <div class="table-section__head">
          <div><span class="section-kicker">QUESTION INDEX</span><strong>题目清单</strong></div>
          <span class="table-total">共 {{ total }} 条结果</span>
        </div>
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

          <el-table-column label="版本" width="90"><template #default="{ row }">{{ row.revision ? `v${row.revision}` : '旧题' }}</template></el-table-column>
          <el-table-column label="来源" width="80"><template #default="{ row }"><span class="source-text">{{ sourceLabel(row.source) }}</span></template></el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="260" fixed="right">
            <template #default="{ row }">
              <FitsTableActions>
                <FitsTableAction type="primary" @click="openView(row)">预览</FitsTableAction>
                <FitsTableAction v-if="row.status === 'pending' && auth.can('questions:review')" type="success" @click="reviewQuestion(row, 'approved')">通过</FitsTableAction>
                <FitsTableAction v-if="row.status !== 'rejected' && auth.can('questions:review')" type="warning" @click="reviewQuestion(row, 'rejected')">驳回</FitsTableAction>
                <FitsTableAction v-if="auth.can('questions:write')" @click="openEdit(row)">修订</FitsTableAction>
                <FitsTableAction v-if="row.source === 'ai' && row.regulation_id && row.regulation_version_id && ['single', 'multiple'].includes(row.type) && auth.can('questions:write')" @click="regenerate(row)">重生成</FitsTableAction>
              </FitsTableActions>
            </template>
          </el-table-column>
        </el-table>
      </section>
      <template #pagination>
        <el-pagination layout="total, prev, pager, next" :total="total" :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />
      </template>
    </FitsTable>

    <el-dialog v-model="editorVisible" :title="editorMode === 'create' ? '新增试题' : '修订试题'" width="760px" class="re-form-dialog manual-question-dialog" append-to-body destroy-on-close :before-close="beforeEditorClose">
      <p v-if="editorMode === 'edit'" class="editor-hint">保存会生成待审核新版本；旧版本保持不变。</p>
      <el-alert
        v-if="editorMode === 'edit' && !hasEditorDifficulty"
        type="warning"
        show-icon
        :closable="false"
        title="该旧题难度当前不可用于新版本，请明确选择简单或困难后再保存；原难度不会自动改写。"
        style="margin-bottom:12px"
      />
      <ManualQuestionEditor
        ref="manualEditor"
        :key="editorGeneration"
        v-model="editorForm"
        :categories="categories"
        :can-upload-media="auth.can('media:write')"
        :difficulty-options="difficultyOptions"
        :disabled="saving"
        @upload-state-change="editorUploading = $event.pending"
        @uncommitted-change="editorHasUncommittedContent = $event"
        @error="editorContentError = $event"
        @save="saveQuestion()"
      />
      <el-alert v-if="editorContentError" type="warning" show-icon :closable="false" :title="editorContentError" />
      <template #footer>
        <div class="editor-summary" aria-live="polite">
          <strong>正确答案：{{ editorAnswerSummary }}</strong>
          <span>{{ editorDirty ? '有未保存修改' : '暂无未保存修改' }}</span>
        </div>
        <el-button @click="closeEditor">取消</el-button>
        <el-button v-if="editorMode === 'create'" :disabled="saveDisabled" @click="saveQuestion('new')">保存并新增</el-button>
        <el-button type="primary" :loading="saving" :disabled="saveDisabled" @click="saveQuestion()">保存</el-button>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthoringOptions } from '../../composables/useAuthoringOptions';
import type { AuthoringOptions } from '../../api/question-authoring';
import { formatDateTime } from '../../utils/format';
import ManualQuestionEditor from '../../components/ManualQuestionEditor.vue';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { Filter } from '@element-plus/icons-vue';
import {
  questionDraftFromView,
  questionDraftWithContent,
  questionRichTextToPlainText,
  type Id, type Page, type QuestionConcept, type QuestionDraftPayload, type QuestionType, type QuestionView,
} from '../../api/training-types';

type CategoryOption = { id: Id; name: string };
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
const { catalog: difficultyCatalog, difficultyOptions, difficultyLabel: catalogDifficultyLabel, load: loadAuthoringOptions,
  loading: catalogLoading, error: catalogError } = useAuthoringOptions(() => http.get('/admin/questions/authoring-options') as Promise<AuthoringOptions>);
const list = ref<QuestionView[]>([]);
const total = ref(0);
const loading = ref(false);
const categories = ref<CategoryOption[]>([]);
const filterConcepts = ref<QuestionConcept[]>([]);

const filterConceptPage = reactive(pageState());

const filterConceptLoading = ref(false);

let filterConceptRequest = 0;

const query = reactive({ page: 1, page_size: 20, category_id: '', concept_id: '', status: '', type: '', difficulty: '', keyword: '' });

const editorVisible = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editingId = ref<Id | null>(null);
const editingExpectedVersionId = ref<Id | null>(null);
const editorForm = ref<QuestionDraftPayload>(emptyDraft());
const editorGeneration = ref(0);
const editorUploading = ref(false);
const editorHasUncommittedContent = ref(false);
const manualEditor = ref<InstanceType<typeof ManualQuestionEditor> | null>(null);
const editorDirty = ref(false);
const editorBaseline = ref<EditorBaseline | null>(null);
let editorContext: symbol | null = null;
const saving = ref(false);
const previewVisible = ref(false);
const selectedQuestion = ref<QuestionView | null>(null);
const versionHistory = ref<QuestionVersionHistory[]>([]);
const versionHistoryPage = reactive(pageState());

const hasEditorDifficulty = computed(() => difficultyOptions.value.some((item) => item.value === editorForm.value.difficulty));
const saveDisabled = computed(() => saving.value || editorUploading.value || catalogLoading.value || !!catalogError.value || !hasEditorDifficulty.value);
const editorAnswerSummary = computed(() => {
  const form = editorForm.value;
  if (form.type === 'judgment') return form.answer[0] === 0 ? '正确' : form.answer[0] === 1 ? '错误' : '未选择';
  return form.answer.filter((index) => index >= 0 && index < form.options.length)
    .map((index) => String.fromCharCode(65 + index)).join('、') || '未选择';
});
const editorContentError = ref('');


function emptyDraft(): QuestionDraftPayload {
  return {
    category_id: categories.value[0]?.id || '', difficulty: 'easy', type: 'single', stem: '',
    options: [{ key: 'A', text: '' }, { key: 'B', text: '' }], answer: [0], analysis: '',
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
  editorHasUncommittedContent.value = false;
  editorDirty.value = false;
}

const editorUnsaved = useUnsavedChanges(editorDirty, { onDiscard: discardEditorDraft });
watch(
  () => [editorVisible.value, JSON.stringify(editorSnapshot()), JSON.stringify(editorBaseline.value), editorHasUncommittedContent.value] as const,
  ([visible, current, baseline, uncommitted]) => {
    editorDirty.value = !!visible && (uncommitted || !!editorBaseline.value && current !== baseline);
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
function difficultyLabel(value: string | null) { return value ? catalogDifficultyLabel(value) : '未知'; }
function sourceLabel(value: string) { return ({ ai: 'AI', manual: '人工', import: '导入' } as Record<string, string>)[value] || value; }
function statusLabel(value: string) { return ({ approved: '已通过', pending: '待审核', rejected: '已驳回' } as Record<string, string>)[value] || value; }
function statusTag(value: string) { return (value === 'approved' ? 'success' : value === 'rejected' ? 'danger' : 'info') as any; }
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


function toDraft(row: QuestionView): QuestionDraftPayload {
  return questionDraftFromView(row);
}

async function openCreate() {
  const context = Symbol('question-editor-context');
  editorContext = context;
  editorGeneration.value += 1;
  editorUploading.value = false;
  editorHasUncommittedContent.value = false;
  editorContentError.value = '';
  editorMode.value = 'create'; editingId.value = null; editingExpectedVersionId.value = null; editorForm.value = emptyDraft();
  captureEditorBaseline();

  if (editorContext !== context) return;
  editorVisible.value = true;
}

async function openEdit(row: QuestionView) {
  const context = Symbol('question-editor-context');
  editorContext = context;
  editorContentError.value = '';
  let draft: QuestionDraftPayload;
  try { draft = toDraft(row); }
  catch (error) { ElMessage.warning(error instanceof Error ? error.message : '该版本内容暂不可编辑'); return; }
  editorGeneration.value += 1;
  editorUploading.value = false;
  editorHasUncommittedContent.value = false;
  editorMode.value = 'edit'; editingId.value = row.question_id; editingExpectedVersionId.value = expectedVersionId(row.current_version_id); editorForm.value = draft;
  captureEditorBaseline();

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
  // Hidden historical associations stay server-owned; omission preserves them on revision.
  const { concept_id: _concept, ...draft } = questionDraftWithContent(value);
  return Object.fromEntries(Object.entries({
    ...draft,
    analysis: value.analysis ?? null,
  }).filter(([, item]) => item !== undefined && item !== ''));
}

async function saveQuestion(afterSave: 'close' | 'new' = 'close') {
  if (saving.value || editorUploading.value) return;
  const editError = manualEditor.value?.validate?.();
  if (editError) { editorContentError.value = editError; ElMessage.warning(editError); return; }
  if (catalogLoading.value || catalogError.value || !hasEditorDifficulty.value) {
    ElMessage.warning(catalogError.value || '请选择当前启用的题目难度后再保存');
    return;
  }
  const requestContext = editorContext;
  if (!requestContext || !editorVisible.value) return;
  let submitted: EditorBaseline;
  let body: ReturnType<typeof payload>;
  editorContentError.value = '';
  try {
    // Hydration intentionally stays clean; saving still uses the editor's canonical JSON.
    const canonical = manualEditor.value?.getDraft?.();
    if (canonical) editorForm.value = canonical;
    submitted = editorSnapshot();
    body = payload(submitted.form);
  } catch (error) {
    editorContentError.value = error instanceof Error ? error.message : '题目内容格式不正确，请检查后重试';
    ElMessage.warning(editorContentError.value);
    return;
  }
  saving.value = true;
  try {
    let saved: any;
    if (submitted.mode === 'create') {
      saved = await http.post('/ai/questions', body);
    } else {
      saved = await http.put(`/ai/questions/${submitted.id}`, {
        ...body, expected_version_id: submitted.expectedVersionId,
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
        if (afterSave === 'new' && submitted.mode === 'create') {
          editorContext = Symbol('question-editor-context');
          editorMode.value = 'create'; editingId.value = null; editingExpectedVersionId.value = null;
          editorForm.value = { ...emptyDraft(), category_id: submitted.form.category_id,
            difficulty: submitted.form.difficulty, type: submitted.form.type };
          if (submitted.form.type === 'judgment') editorForm.value.options = [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
          editorGeneration.value += 1;
          editorContentError.value = '';
          captureEditorBaseline();
        } else {
          editorContext = null;
          editorVisible.value = false;
        }
      }
    }
    await load();
  } finally { saving.value = false; }
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

onMounted(async () => {
  if (auth.can('questions:read') || auth.can('questions:write')) await loadAuthoringOptions();
  await loadCategories();
  await load();
});
</script>

<style scoped>
.question-page { padding: 30px; }
.question-stat-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
.question-stat { display: grid; grid-template-columns: auto auto auto; align-items: baseline; column-gap: 7px; row-gap: 2px; padding: 14px 16px; border: 1px solid var(--re-border); border-radius: 12px; background: #fbfcff; }
.question-stat span, .question-stat small { color: var(--re-text-3); font-size: 12px; }
.question-stat strong { color: var(--re-text); font-size: 24px; letter-spacing: -.7px; }
.question-stat em { color: var(--re-text-2); font-size: 12px; font-style: normal; }
.question-stat small { grid-column: 1 / -1; }
.notice-stack { display: grid; gap: 8px; margin-bottom: 18px; }
.notice-stack :deep(.el-alert) { margin: 0; border-radius: 10px; }
.filter-panel__heading { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.filter-panel__heading > div { display: flex; flex-direction: column; gap: 3px; }
.filter-panel__heading strong { color: var(--re-text); font-size: 13px; }
.filter-panel__heading span { color: var(--re-text-3); font-size: 11px; white-space: nowrap; }
.filter-panel__icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; background: var(--el-color-primary-light-9); color: var(--re-primary); }
.concept-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin: 10px 0; color: #909399; font-size: 13px; }
.table-section__head { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 10px; }
.table-section__head > div { display: flex; align-items: baseline; gap: 10px; }
.section-kicker { color: var(--re-text-3); font-size: 10px; font-weight: 700; letter-spacing: 1.8px; }
.table-section__head strong { color: var(--re-text); font-size: 15px; }
.table-total { color: var(--re-text-3); font-size: 12px; }
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
.editor-hint { color: #909399; font-size: 13px; }
.editor-summary { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; text-align: left; }
.editor-summary strong { color: var(--re-text-2); font-size: 13px; overflow-wrap: anywhere; }
.editor-summary span { color: var(--re-text-3); font-size: 12px; }
.version-history { margin-top: 24px; border-top: 1px solid #ebeef5; padding-top: 18px; }
@media (max-width: 680px) {
  .question-page { padding: 20px; }
  .question-stat-strip { grid-template-columns: 1fr; }
}
</style>
