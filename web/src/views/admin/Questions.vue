<template>
  <div class="page-card question-page">
    <div class="notice-stack">
      <el-alert v-if="!categories.length" type="warning" show-icon :closable="false" title="暂无启用的培训类别，请先创建类别。" />
      <el-alert v-if="catalogError" type="warning" show-icon :closable="false" :title="catalogError" />
      <el-button v-if="catalogError" link :loading="catalogLoading" @click="loadAuthoringOptions">重试加载难度</el-button>
    </div>
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent="submitFilters">
          <el-form-item label="培训类别">
            <el-select v-model="query.category_id" placeholder="培训类别" clearable filterable @change="submitFilters">
              <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="题干"><el-input v-model="query.keyword" clearable placeholder="搜索题干" @keyup.enter="submitFilters" @clear="submitFilters" /></el-form-item>
          <el-form-item label="题型"><el-select v-model="query.type" clearable placeholder="题型" @change="submitFilters"><el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-form-item label="难度"><el-select v-model="query.difficulty" clearable placeholder="难度" @change="submitFilters"><el-option v-for="item in difficultyOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-form-item label="启用状态"><el-select v-model="query.enabled" placeholder="启用状态" @change="submitFilters"><el-option label="全部" value="" /><el-option label="启用" :value="true" /><el-option label="停用" :value="false" /></el-select></el-form-item>
          <template #actions>
            <el-button type="primary" @click="submitFilters">查询</el-button>
            <el-button @click="resetFilters">重置</el-button>
          </template>
        </FitsListSearch>
      </template>
      <template v-if="auth.can('questions:write')" #actions>
        <el-button type="primary" @click="openCreate">新增试题</el-button>
        <el-button @click="router.push('/admin/questions/import')">试题导入</el-button>
      </template>

      <section class="table-section">
        <el-empty v-if="!auth.can('questions:read')" description="当前账号无题库查看权限，可新增试题" />
        <el-table v-if="auth.can('questions:read')" class="question-table" v-loading="loading" :data="list">
          <template #empty>
            <el-empty v-if="!loading" description="暂无试题" />
          </template>
          <el-table-column label="题干" min-width="300">
            <template #default="{ row }"><div class="stem-summary">{{ plainText(row.stem) }}</div></template>
          </el-table-column>
          <el-table-column label="培训类别" width="140"><template #default="{ row }">{{ categories.find((item) => item.id === row.category_id)?.name || row.category_name || '—' }}</template></el-table-column>
          <el-table-column label="题型" width="84" align="center" header-align="center">
            <template #default="{ row }"><el-tag class="question-meta-tag" :class="`question-type-tag--${row.type}`" :type="row.type === 'single' ? 'primary' : 'info'" effect="light" :round="false">{{ typeLabel(row.type) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="难度" width="80" align="center" header-align="center">
            <template #default="{ row }"><el-tag class="question-meta-tag" :type="difficultyTagType(row.difficulty)" effect="light" :round="false">{{ difficultyLabel(row.difficulty) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-switch
                class="question-quick-switch"
                size="large"
                :model-value="row.enabled"
                :active-value="true"
                :inactive-value="false"
                active-text="启用"
                inactive-text="停用"
                inline-prompt
                :width="68"
                :aria-label="`题目 ${row.question_id} 的启用状态`"
                :loading="!!questionRowBusy[row.question_id]"
                :disabled="!auth.can('questions:write') || !!questionRowBusy[row.question_id] || !!questionStateUnknown[row.question_id]"
                @change="setQuestionEnabled(row, $event)"
              />
              <el-button v-if="questionStateUnknown[row.question_id]" link :loading="!!questionRowBusy[row.question_id]" @click="reconcileQuestionState(row)">查询状态</el-button>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="175"><template #default="{ row }">{{ formatDateTime(row.updated_at) }}</template></el-table-column>
          <el-table-column label="操作" width="180" align="center" header-align="center" fixed="right">
            <template #default="{ row }">
              <FitsTableActions class="question-row-actions">
                <FitsTableAction type="primary" @click="openView(row)">预览</FitsTableAction>
                <FitsTableAction v-if="auth.can('questions:write')" :disabled="!!questionRowBusy[row.question_id] || !!questionStateUnknown[row.question_id]" @click="openEdit(row)">修改</FitsTableAction>
                <FitsTableAction v-if="auth.can('questions:write')" type="danger" :loading="questionRowBusy[row.question_id] === 'delete'" :disabled="!!questionRowBusy[row.question_id] || !!questionStateUnknown[row.question_id]" @click="deleteQuestion(row)">删除</FitsTableAction>
              </FitsTableActions>
            </template>
          </el-table-column>
        </el-table>
      </section>
      <template #pagination>
        <el-pagination layout="total, prev, pager, next" :total="total" :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />
      </template>
    </FitsTable>

    <QuestionBusinessDialog
      v-model="questionDialogVisible"
      :mode="dialogMode"
      :append-to="questionDialogAppendTarget"
      :before-close="beforeQuestionDialogClose"
      :preserve-editor="previewReturnsToEditor"
      @closed="onQuestionDialogClosed"
    >
      <template #preview>
        <QuestionPreview v-if="selectedQuestion" :question="selectedQuestion" variant="library" />
      </template>

      <template v-if="dialogMode === 'edit'" #title-extra>
        <span class="editor-hint">保存会生成新版本并启用；旧版本保持不变。</span>
      </template>

      <template #editor>
        <el-alert v-if="editorMode === 'edit' && editingExpectedEnabled === false" type="warning" :closable="false" show-icon title="该题当前已停用，保存本次修订后将启用。" />
        <el-alert
          v-if="editorMode === 'edit' && !hasEditorDifficulty"
          type="warning"
          show-icon
          :closable="false"
          title="该旧题难度当前不可用于新版本，请明确选择简单或困难后再保存；原难度不会自动改写。"
          style="margin-bottom:12px"
        />
        <el-alert v-if="editorStateConflict" type="warning" :closable="false" title="题目版本或启用状态已变化，输入已保留。请刷新状态，再明确保存。"><el-button link @click="refreshEditorState">刷新题目状态</el-button></el-alert>
        <el-alert v-if="editorSaveUnknown" type="warning" :closable="false" title="保存结果尚未确认，已锁定重复提交并保留输入。请核对服务器当前题目；关闭后重新打开确定的版本再继续。"><el-button v-if="editingId" link @click="inspectUnknownSave">查询当前题目</el-button><el-button v-else link @click="load">刷新题库核对</el-button></el-alert>
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
      </template>

      <template #preview-footer>
        <el-button @click="closePreview">{{ previewReturnsToEditor ? '返回编辑' : '关闭' }}</el-button>
        <el-button
          v-if="!previewReturnsToEditor && canEditSelectedQuestion"
          type="primary"
          :disabled="selectedQuestionEditBlocked"
          @click="editPreviewedQuestion"
        >编辑题目</el-button>
      </template>

      <template #editor-footer>
        <div class="editor-summary" aria-live="polite">
          <span class="editor-summary__answers" :aria-label="`正确答案：${editorAnswerSummary}`">
            <span>正确答案</span>
            <span v-if="editorAnswerSummary === '未选择'">未选择</span>
            <template v-else>
              <span v-for="answer in editorAnswerSummary.split('、')" :key="answer" class="editor-summary__answer">{{ answer }}</span>
            </template>
          </span>
          <span class="editor-summary__separator" aria-hidden="true">·</span>
          <span class="editor-summary__status">{{ editorDirty ? '有未保存修改' : '暂无未保存修改' }}</span>
        </div>
        <el-button @click="closeEditor">取消</el-button>
        <el-button v-if="editorMode === 'create'" :disabled="saveDisabled" @click="saveQuestion('new')">保存并新增</el-button>
        <el-button type="primary" :loading="saving" :disabled="saveDisabled" @click="saveQuestion()">{{ editorMode === 'edit' && !editingExpectedEnabled ? '保存并启用' : '保存' }}</el-button>
      </template>
    </QuestionBusinessDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, watch, type Ref } from 'vue';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthoringOptions } from '../../composables/useAuthoringOptions';
import type { AuthoringOptions } from '../../api/question-authoring';
import { formatDateTime } from '../../utils/format';
import ManualQuestionEditor from '../../components/ManualQuestionEditor.vue';
import { manualContentFromDraft } from '../../components/manual-question-content';
import QuestionBusinessDialog, { type QuestionDialogMode } from '../../components/QuestionBusinessDialog.vue';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { useRouter } from 'vue-router';
import {
  questionDraftFromView,
  questionDraftWithContent,
  questionRichTextToPlainText,
  type Id, type QuestionDraftPayload, type QuestionType, type QuestionView,
} from '../../api/training-types';

type CategoryOption = { id: Id; name: string };
type EditorBaseline = {
  form: QuestionDraftPayload;
  mode: 'create' | 'edit';
  id: Id | null;
  expectedVersionId: Id | null;
  expectedEnabled: boolean | null;
};

const typeOptions: Array<{ value: QuestionType; label: string }> = [
  { value: 'single', label: '单选题' }, { value: 'multiple', label: '多选题' },
  { value: 'judgment', label: '判断题' },
];
const auth = useAuthStore();
const router = useRouter();
const contentDialogTarget = inject<Ref<HTMLElement | undefined>>('contentDialogTarget', ref<HTMLElement>());
const questionDialogAppendTarget = computed<string | HTMLElement>(() => contentDialogTarget.value || 'body');
const { difficultyOptions, difficultyLabel: catalogDifficultyLabel, load: loadAuthoringOptions,
  loading: catalogLoading, error: catalogError } = useAuthoringOptions(() => http.get('/admin/questions/authoring-options') as Promise<AuthoringOptions>);
const list = ref<QuestionView[]>([]);
const total = ref(0);
const loading = ref(false);
let listRequest = 0;
const categories = ref<CategoryOption[]>([]);
const questionRowBusy = reactive<Record<string, 'enabled' | 'reconcile' | 'delete' | 'save'>>({});
const questionStateUnknown = reactive<Record<string, boolean>>({});
const query = reactive<{ page: number; page_size: number; category_id: string; enabled: boolean | ''; type: string; difficulty: string; keyword: string }>({ page: 1, page_size: 20, category_id: '', enabled: true, type: '', difficulty: '', keyword: '' });

const questionDialogVisible = ref(false);
const dialogMode = ref<QuestionDialogMode>('preview');
const previewReturnsToEditor = ref(false);
const editorVisible = computed(() => questionDialogVisible.value && dialogMode.value !== 'preview');
const editorSessionActive = computed(() => editorVisible.value || (questionDialogVisible.value && previewReturnsToEditor.value));
const editorMode = ref<'create' | 'edit'>('create');
const editingId = ref<Id | null>(null);
const editingExpectedVersionId = ref<Id | null>(null);
const editingExpectedEnabled = ref<boolean | null>(null);
const editorStateConflict = ref(false);
const editorSaveUnknown = ref(false);
const editorForm = ref<QuestionDraftPayload>(emptyDraft());
const editorGeneration = ref(0);
const editorUploading = ref(false);
const editorHasUncommittedContent = ref(false);
const manualEditor = ref<InstanceType<typeof ManualQuestionEditor> | null>(null);
const editorDirty = ref(false);
const editorBaseline = ref<EditorBaseline | null>(null);
let editorContext: symbol | null = null;
const saving = ref(false);
const selectedQuestion = ref<QuestionView | null>(null);

const hasEditorDifficulty = computed(() => difficultyOptions.value.some((item) => item.value === editorForm.value.difficulty));
const saveDisabled = computed(() => saving.value || editorUploading.value || editorStateConflict.value || editorSaveUnknown.value
  || questionWriteBlocked(editingId.value) || catalogLoading.value || !!catalogError.value || !hasEditorDifficulty.value);
const editorAnswerSummary = computed(() => {
  const form = editorForm.value;
  if (form.type === 'judgment') return form.answer[0] === 0 ? '正确' : form.answer[0] === 1 ? '错误' : '未选择';
  return form.answer.filter((index) => index >= 0 && index < form.options.length)
    .map((index) => String.fromCharCode(65 + index)).join('、') || '未选择';
});
const canEditSelectedQuestion = computed(() => !!selectedQuestion.value && auth.can('questions:write'));
const selectedQuestionEditBlocked = computed(() => questionWriteBlocked(selectedQuestion.value?.question_id));
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
    expectedEnabled: editingExpectedEnabled.value,
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
    editingExpectedEnabled.value = baseline.expectedEnabled;
    editorForm.value = cloneEditorForm(baseline.form);
  }
  editorContext = null;
  editorHasUncommittedContent.value = false;
  editorDirty.value = false;
}

const editorUnsaved = useUnsavedChanges(editorDirty, { onDiscard: discardEditorDraft });
watch(
  () => [editorSessionActive.value, JSON.stringify(editorSnapshot()), JSON.stringify(editorBaseline.value), editorHasUncommittedContent.value] as const,
  ([visible, current, baseline, uncommitted]) => {
    editorDirty.value = !!visible && (uncommitted || !!editorBaseline.value && current !== baseline);
  },
  { flush: 'sync' },
);

async function closeEditor() {
  if (!await editorUnsaved.confirmDiscard()) return;
  editorContext = null;
  questionDialogVisible.value = false;
}

async function beforeEditorClose(done: () => void) {
  if (!await editorUnsaved.confirmDiscard()) return;
  editorContext = null;
  done();
}

function plainText(html: string) { return questionRichTextToPlainText(html); }
function typeLabel(value: string) { return typeOptions.find((item) => item.value === value)?.label || value; }
function difficultyLabel(value: string | null) { return value ? catalogDifficultyLabel(value) : '未知'; }
function difficultyTagType(value: string | null): 'success' | 'warning' | 'danger' | 'info' {
  return value === 'easy' ? 'success' : value === 'medium' ? 'warning' : value === 'hard' ? 'danger' : 'info';
}
function expectedVersionId(value: Id | null | undefined): Id | null { return value ?? null; }
function questionWriteBlocked(id: Id | null | undefined) {
  return !!id && (!!questionRowBusy[id] || !!questionStateUnknown[id]);
}
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
  const request = ++listRequest;
  if (!auth.can('questions:read')) {
    list.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const result: any = await http.get('/ai/questions', { params: cleanParams(query) });
    if (request !== listRequest) return;
    list.value = result.list || [];
    total.value = result.total || 0;
  } finally { if (request === listRequest) loading.value = false; }
}

async function submitFilters() { query.page = 1; await load(); }
async function resetFilters() {
  Object.assign(query, { page: 1, category_id: '', enabled: true, type: '', difficulty: '', keyword: '' });
  await load();
}

function toDraft(row: QuestionView): QuestionDraftPayload {
  const draft = questionDraftFromView(row);
  manualContentFromDraft(draft);
  return draft;
}

async function openCreate() {
  const context = Symbol('question-editor-context');
  editorContext = context;
  editorGeneration.value += 1;
  editorUploading.value = false;
  editorHasUncommittedContent.value = false;
  editorContentError.value = '';
  editorMode.value = 'create'; editingId.value = null; editingExpectedVersionId.value = null; editingExpectedEnabled.value = null; editorForm.value = emptyDraft();
  editorStateConflict.value = false; editorSaveUnknown.value = false;
  captureEditorBaseline();
  if (editorContext !== context) return;
  previewReturnsToEditor.value = false;
  dialogMode.value = 'create';
  questionDialogVisible.value = true;
}

async function openEdit(row: QuestionView) {
  if (!auth.can('questions:write') || questionWriteBlocked(row.question_id)) return;
  const context = Symbol('question-editor-context');
  editorContext = context;
  editorContentError.value = '';
  let draft: QuestionDraftPayload;
  try { draft = toDraft(row); }
  catch (error) {
    if (editorContext === context) editorContext = null;
    ElMessage.warning(error instanceof Error ? error.message : '该版本内容暂不可编辑');
    return;
  }
  editorGeneration.value += 1;
  editorUploading.value = false;
  editorHasUncommittedContent.value = false;
  editorMode.value = 'edit'; editingId.value = row.question_id; editingExpectedVersionId.value = expectedVersionId(row.current_version_id); editingExpectedEnabled.value = row.enabled; editorForm.value = draft;
  editorStateConflict.value = false; editorSaveUnknown.value = false;
  captureEditorBaseline();
  if (editorContext !== context) return;
  previewReturnsToEditor.value = false;
  dialogMode.value = 'edit';
  questionDialogVisible.value = true;
}

async function openView(row: QuestionView) {
  selectedQuestion.value = row;
  previewReturnsToEditor.value = false;
  dialogMode.value = 'preview';
  questionDialogVisible.value = true;
}

function closePreview() {
  if (previewReturnsToEditor.value) {
    returnToEditor();
    return;
  }
  questionDialogVisible.value = false;
}

async function editPreviewedQuestion() {
  if (!selectedQuestion.value) return;
  await openEdit(selectedQuestion.value);
}

function returnToEditor() {
  dialogMode.value = editorMode.value;
  previewReturnsToEditor.value = false;
}

async function beforeQuestionDialogClose(done: () => void) {
  if (previewReturnsToEditor.value) {
    returnToEditor();
    return;
  }
  if (editorVisible.value) {
    await beforeEditorClose(done);
    return;
  }
  done();
}

function onQuestionDialogClosed() {
  selectedQuestion.value = null;
  previewReturnsToEditor.value = false;
}

async function refreshEditorState() {
  if (!editingId.value || saving.value) return;
  const context = editorContext;
  const current = await http.get(`/ai/questions/${editingId.value}`) as QuestionView;
  if (context !== editorContext || !editorVisible.value) return;
  editingExpectedVersionId.value = expectedVersionId(current.current_version_id);
  editingExpectedEnabled.value = current.enabled;
  editorStateConflict.value = false;
  ElMessage.warning('当前题目状态已刷新，编辑内容已保留；请核对后明确保存');
}

async function inspectUnknownSave() {
  if (!editingId.value || !editorSaveUnknown.value) return;
  const context = editorContext;
  const current = await http.get(`/ai/questions/${editingId.value}`) as QuestionView;
  if (context !== editorContext) return;
  selectedQuestion.value = current;
  previewReturnsToEditor.value = true;
  dialogMode.value = 'preview';
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
  if (!auth.can('questions:write') || saving.value || editorUploading.value || editorStateConflict.value || editorSaveUnknown.value
    || questionWriteBlocked(editingId.value)) return;
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
  const submittedId = submitted.mode === 'edit' ? submitted.id : null;
  if (submittedId && questionWriteBlocked(submittedId)) return;
  if (submittedId) questionRowBusy[submittedId] = 'save';
  saving.value = true;
  try {
    let saved: any;
    if (submitted.mode === 'create') {
      saved = await http.post('/ai/questions', body);
    } else {
      saved = await http.put(`/ai/questions/${submitted.id}`, {
        ...body, expected_version_id: submitted.expectedVersionId, expected_enabled: submitted.expectedEnabled,
      });
    }
    const receipt = savedVersionReceipt(saved?.saved_version_id);
    if (!receipt) {
      if (submittedId) questionStateUnknown[submittedId] = true;
      if (editorContext === requestContext) editorSaveUnknown.value = true;
      ElMessage.warning('保存响应缺少本次写入版本凭据，已保留当前草稿，请核对题库后再编辑');
    } else {
      ElMessage.success(submitted.mode === 'create' ? '人工题已保存并启用' : '新版本已保存并启用，旧版本保持不变');
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
        expectedEnabled: true,
      };
      editorMode.value = persisted.mode;
      editingId.value = persisted.id;
      editingExpectedVersionId.value = persisted.expectedVersionId;
      editingExpectedEnabled.value = persisted.expectedEnabled;
      captureEditorBaseline(persisted);
      editorDirty.value = JSON.stringify(editorSnapshot()) !== JSON.stringify(editorBaseline.value);
      if (!editorDirty.value) {
        editorUnsaved.markClean();
        if (afterSave === 'new' && submitted.mode === 'create') {
          editorContext = Symbol('question-editor-context');
          editorMode.value = 'create'; editingId.value = null; editingExpectedVersionId.value = null; editingExpectedEnabled.value = null;
          editorForm.value = { ...emptyDraft(), category_id: submitted.form.category_id,
            difficulty: submitted.form.difficulty, type: submitted.form.type };
          if (submitted.form.type === 'judgment') editorForm.value.options = [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
          editorGeneration.value += 1;
          editorContentError.value = '';
          captureEditorBaseline();
        } else {
          editorContext = null;
          questionDialogVisible.value = false;
        }
      }
    }
    await load();
  } catch (error) {
    if ((error as { code?: number })?.code === 40940) {
      if (editorContext === requestContext) editorStateConflict.value = true;
      ElMessage.warning('题目版本或启用状态已变化，草稿已保留，请刷新题目状态');
      return;
    }
    const code = (error as { code?: number })?.code;
    if (!(typeof code === 'number' && code >= 40000 && code < 50000)) {
      if (submittedId) questionStateUnknown[submittedId] = true;
      if (editorContext === requestContext) {
        editorSaveUnknown.value = true;
        ElMessage.warning('保存结果尚未确认，草稿已保留，请核对题库当前详情后再编辑');
      } else if (submittedId) {
        ElMessage.warning('保存结果尚未确认，原题已锁定，请查询题目状态后再操作');
      }
    }
    throw error;
  } finally {
    saving.value = false;
    if (submittedId && questionRowBusy[submittedId] === 'save') delete questionRowBusy[submittedId];
  }
}

function isQuestionState(value: unknown, id: Id): value is QuestionView {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<QuestionView>;
  return state.question_id === id && typeof state.enabled === 'boolean'
    && (state.current_version_id === null || typeof state.current_version_id === 'string');
}

async function applyQuestionState(row: QuestionView, state: QuestionView) {
  // A list read started before this confirmation must not restore its older state.
  const hadPendingList = loading.value;
  listRequest += 1;
  loading.value = false;
  Object.assign(row, state);
  const current = list.value.find((item) => item.question_id === row.question_id);
  if (current && current !== row) Object.assign(current, state);
  delete questionStateUnknown[row.question_id];
  if (hadPendingList || (query.enabled !== '' && state.enabled !== query.enabled)) await load();
}

async function readQuestionState(row: QuestionView) {
  let state: unknown;
  try { state = await http.get(`/ai/questions/${row.question_id}`); }
  catch (error) {
    if ((error as { code?: number })?.code !== 40401) throw error;
    await removeQuestionFromList(row.question_id);
    return 'removed';
  }
  if (!isQuestionState(state, row.question_id)) throw new Error('题目状态响应不完整');
  await applyQuestionState(row, state);
  return 'present';
}

async function removeQuestionFromList(id: Id) {
  const currentPageContainsQuestion = list.value.some((item) => item.question_id === id);
  if (currentPageContainsQuestion && list.value.length === 1 && query.page > 1) query.page -= 1;
  list.value = list.value.filter((item) => item.question_id !== id);
  if (currentPageContainsQuestion) total.value = Math.max(0, total.value - 1);
  delete questionStateUnknown[id];
  await load();
}

async function reconcileQuestionState(row: QuestionView) {
  if (questionRowBusy[row.question_id]) return;
  questionRowBusy[row.question_id] = 'reconcile';
  try { await readQuestionState(row); }
  catch {
    questionStateUnknown[row.question_id] = true;
    ElMessage.warning('题目状态尚未确认，请查询状态后再操作');
  } finally { delete questionRowBusy[row.question_id]; }
}

async function setQuestionEnabled(row: QuestionView, enabled: unknown) {
  if (!auth.can('questions:write') || typeof enabled !== 'boolean' || enabled === row.enabled
    || questionWriteBlocked(row.question_id)) return;
  questionRowBusy[row.question_id] = 'enabled';
  try {
    let state: unknown;
    try {
      state = await http.put(`/ai/questions/${row.question_id}/enabled`, { enabled, expected_version_id: expectedVersionId(row.current_version_id) });
      if (!isQuestionState(state, row.question_id)) throw new Error('题目状态响应不完整');
    } catch {
      questionStateUnknown[row.question_id] = true;
      try { await readQuestionState(row); }
      catch { ElMessage.warning('启停结果尚未确认，请查询状态后再操作'); }
      return;
    }
    await applyQuestionState(row, state as QuestionView);
    ElMessage.success(enabled ? '题目已启用' : '题目已停用');
  } finally { delete questionRowBusy[row.question_id]; }
}

async function deleteQuestion(row: QuestionView) {
  if (!auth.can('questions:write') || questionWriteBlocked(row.question_id)) return;
  questionRowBusy[row.question_id] = 'delete';
  try {
    try {
      await ElMessageBox.confirm('删除后将从题库移除，保留历史版本、已发布试卷和考试记录。确定删除这道题目？', '删除题目', { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' });
    } catch { return; }
    try {
      const receipt = await http.delete(`/ai/questions/${row.question_id}`, { data: {
        expected_version_id: expectedVersionId(row.current_version_id), expected_enabled: row.enabled,
      } }) as { question_id?: string; deleted?: boolean; deleted_at?: string } | null;
      if (receipt?.question_id !== row.question_id || receipt.deleted !== true
        || typeof receipt.deleted_at !== 'string' || !Number.isFinite(Date.parse(receipt.deleted_at))) throw new Error('删除响应不完整');
    } catch {
      questionStateUnknown[row.question_id] = true;
      try {
        const state = await readQuestionState(row);
        ElMessage.warning(state === 'removed' ? '该题已不在当前题库，列表已刷新' : '未确认删除成功，已刷新题目状态；未重复发送删除请求');
      } catch { ElMessage.warning('删除结果尚未确认，请查询状态后再操作'); }
      return;
    }
    await removeQuestionFromList(row.question_id);
    ElMessage.success('题目已从题库移除，历史记录保留');
  } finally { delete questionRowBusy[row.question_id]; }
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
/* 只恢复题库元信息的轻量 Tag 外观，不改全站的胶囊标签。 */
.question-meta-tag {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--el-tag-border-color);
  border-radius: 4px;
  background: var(--el-tag-bg-color);
  color: var(--el-tag-text-color);
  font-weight: 400;
  cursor: default;
}
.question-meta-tag.el-tag--primary { --el-tag-text-color: var(--re-primary-deep); }
.question-meta-tag.el-tag--success { --el-tag-text-color: #1d7a52; }
.question-meta-tag.el-tag--danger { --el-tag-text-color: #b42318; }
.question-meta-tag.el-tag--info { --el-tag-text-color: var(--re-text-2); }
.question-meta-tag.question-type-tag--multiple {
  --el-tag-text-color: #7e22ce;
  --el-tag-bg-color: #faf5ff;
  --el-tag-border-color: #e9d5ff;
}
.question-meta-tag.question-type-tag--judgment {
  --el-tag-text-color: #0e7490;
  --el-tag-bg-color: #ecfeff;
  --el-tag-border-color: #a5f3fc;
}
.difficulty-text { font-size: 13px; font-weight: 600; }
.difficulty-text--easy { color: var(--re-success); }
.difficulty-text--medium { color: var(--re-warning); }
.difficulty-text--hard { color: var(--re-danger); }
.difficulty-text--unknown { color: var(--re-text-3); }
.source-text { color: var(--re-text-2); font-size: 13px; }
.stem-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.question-row-actions { justify-content: center; }
:deep(.question-quick-switch) { --el-switch-off-color: #e5e7eb; }
:deep(.question-quick-switch .el-switch__core) { height: 28px; border-radius: 14px; }
:deep(.question-quick-switch .el-switch__action) { width: 24px; height: 24px; }
:deep(.question-quick-switch.is-checked .el-switch__action) { left: calc(100% - 25px); }
:deep(.question-quick-switch .el-switch__inner) { height: 24px; padding: 0 6px 0 28px; }
:deep(.question-quick-switch.is-checked .el-switch__inner) { padding: 0 28px 0 6px; }
:deep(.question-quick-switch .el-switch__inner-wrapper) { font-size: 13px; font-weight: 600; }
:deep(.question-quick-switch:not(.is-checked) .el-switch__inner-wrapper) { color: var(--re-text-2, #51565f); }
.editor-hint { margin: 0; color: #909399; font-size: 13px; font-weight: 400; line-height: 1.5; }
.editor-summary { display: flex; flex: 1; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; color: var(--el-text-color-secondary, #909399); font-size: 12px; line-height: 22px; text-align: left; }
.editor-summary__answers { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.editor-summary__answer { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; color: #fff; background: var(--el-color-primary, #3056d3); font-size: 12px; font-weight: 600; line-height: 1; }
.editor-summary__status { white-space: nowrap; }
@media (max-width: 680px) {
  .question-page { padding: 20px; }
  .question-stat-strip { grid-template-columns: 1fr; }
}
</style>
