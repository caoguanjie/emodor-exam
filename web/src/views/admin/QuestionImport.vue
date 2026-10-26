<template>
  <div class="page-card">
    <el-tabs :model-value="mode" @update:model-value="changeMode">
      <el-tab-pane name="file" label="文件导入" />
      <el-tab-pane name="ai" label="AI 生成" />
    </el-tabs>

    <el-alert v-if="catalogError" type="error" :closable="false" :title="catalogError" show-icon>
      <el-button link :loading="catalogLoading" @click="loadAuthoringOptions">重试加载难度</el-button>
    </el-alert>

    <section v-if="mode === 'file'" class="file-import-panel">
      <header class="import-heading">
        <h2>批量导入试题</h2>
        <p>按模板填写并上传，预览确认后导入题库。</p>
      </header>

      <div class="import-workspace">
        <aside class="import-prep-panel">
          <p class="import-section-kicker">01 准备试题</p>
          <div class="import-prep-content">
            <h3>下载标准模板</h3>
            <p class="import-panel-description">首次导入请先下载模板，按照示例填写试题。</p>
            <div class="template-actions">
              <el-button :disabled="previewBusy || commitBusy || statusBusy" @click="downloadTemplate('xlsx')">下载 Excel 模板（推荐）</el-button>
              <el-button :disabled="previewBusy || commitBusy || statusBusy" @click="downloadTemplate('txt')">下载 TXT 模板</el-button>
            </div>
            <p class="import-existing-hint">已有填写好的文件，可跳过下载。</p>
          </div>
        </aside>

        <section class="import-upload-panel">
          <p class="import-section-kicker">02 上传与预览</p>
          <el-alert v-if="categoryError" class="category-load-error" type="error" :closable="false" :title="categoryError" show-icon>
            <el-button link :loading="categoryLoading" @click="loadCategories">重新加载培训类别</el-button>
          </el-alert>
          <el-form label-width="92px" class="import-category-form">
            <el-form-item label="培训类别" required>
              <div class="import-category-control">
                <el-select
                  v-model="selectedCategoryId"
                  filterable
                  placeholder="请选择培训类别"
                  class="import-category-select"
                  :loading="categoryLoading"
                  :disabled="interactionLocked || categoryLoading || !!categoryError"
                  no-data-text="暂无可用培训类别"
                >
                  <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
                <p>本次导入的试题将归入所选类别。</p>
              </div>
            </el-form-item>
          </el-form>

          <el-upload
            :key="uploadKey"
            class="question-file-upload"
            drag
            :show-file-list="false"
            accept=".xlsx,.txt,text/plain"
            :auto-upload="false"
            :disabled="!selectedCategoryId || interactionLocked || categoryLoading || !!categoryError"
            :on-change="previewFile"
          >
            <svg class="question-file-upload__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
            <p class="question-file-upload__title">拖入试题文件，或点击选择</p>
            <p class="question-file-upload__support">支持 .xlsx / .txt，单个文件不超过 5MB</p>
            <el-button type="primary" :loading="previewBusy" :disabled="!selectedCategoryId || interactionLocked || categoryLoading || !!categoryError">选择文件并预览</el-button>
          </el-upload>

          <section v-if="preview" class="preview-ready" aria-live="polite">
            <div>
              <el-tag type="success">导入预览已生成</el-tag>
              <span>批次 {{ preview.batch_id }}，已选 {{ fileSelectedRows.length }} / {{ preview.valid_rows.length }} 行</span>
            </div>
            <el-button type="primary" plain @click="filePreviewVisible = true">查看预览</el-button>
          </section>
        </section>
      </div>

      <footer class="import-footnote">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.1V12a8 8 0 1 1-4.75-7.32M20 5l-8.7 8.7L8 10.4" /></svg>
        <span>上传后可检查错误、排除重复题目，确认后再导入。</span>
      </footer>
    </section>

    <section v-else class="ai-import-panel">
      <el-alert type="info" :closable="false" show-icon title="上传标准 7 列 Excel / UTF-8 TSV 模板（最多 50 道参考题、5MB）。每题生成简单与困难两个版本；参考题不入库，文件不保留。" />
      <el-alert v-if="!auth.can('ai:read') || !auth.can('ai:write')" type="warning" :closable="false" title="发起并查看生成任务需要 AI 读取和编辑权限。" />
      <el-form label-width="110px" class="import-form ai-import-form">
        <el-form-item label="文件格式" required>
          <el-radio-group v-model="aiFormat" :disabled="ai.interactionLocked.value">
            <el-radio-button value="xlsx">Excel (.xlsx)</el-radio-button>
            <el-radio-button value="txt">TXT (.txt)</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="参考题文件" required>
          <div class="file-actions">
            <el-button :disabled="ai.taskBusy.value || ai.rowBusy.value" @click="downloadAiTemplate">下载 {{ aiFormat.toUpperCase() }} 模板</el-button>
            <el-upload :key="aiUploadKey" :show-file-list="false" :auto-upload="false"
              :accept="aiFormat === 'xlsx' ? '.xlsx' : '.txt,text/plain'"
              :disabled="!catalogReady || ai.interactionLocked.value || !auth.can('ai:write') || !auth.can('ai:read')"
              :on-change="generateFromFile">
              <el-button type="primary" :loading="ai.taskBusy.value || ai.generating.value"
                :disabled="!catalogReady || ai.interactionLocked.value || !auth.can('ai:write') || !auth.can('ai:read')">选择参考文件并生成</el-button>
            </el-upload>
          </div>
        </el-form-item>
      </el-form>

      <div v-if="ai.task.value" class="task-summary">
        <el-tag :type="ai.task.value.status === 'failed' ? 'danger' : ai.task.value.status === 'completed' ? 'success' : 'info'">
          {{ taskStatusLabel[ai.task.value.status] }}
        </el-tag>
        <span>已处理 {{ ai.task.value.completed_count }} / {{ ai.task.value.total_count }} 道参考题</span>
        <span>生成 {{ ai.task.value.generated_count }} 道，失败 {{ ai.task.value.failed_count }} 道</span>
        <el-button v-if="ai.pollPaused.value || (ai.task.value.status === 'completed' && !ai.preview.value)"
          :loading="ai.taskBusy.value" @click="ai.queryTaskStatus">查询任务状态</el-button>
      </div>
      <el-alert v-if="ai.task.value?.status === 'failed'" type="error" :closable="false"
        :title="ai.task.value.message || '任务失败或已过期，请重新上传参考文件。'" />
      <el-alert v-if="ai.task.value?.failed_count" type="warning" :closable="false"
        :title="`${ai.task.value.failed_count} 道生成失败，请核对本次有效结果；原始参考题不会导入。`" />

      <section v-if="ai.preview.value" class="preview-panel">
        <div class="preview-summary">
          <el-tag type="success">有效 {{ ai.preview.value.valid_rows.length }} 道</el-tag>
          <el-tag>已选 {{ ai.selectedRows.value.length }} 道</el-tag>
          <span class="batch-id">批次 {{ ai.preview.value.batch_id }}</span>
        </div>
        <el-alert v-for="warning in [...new Set(ai.preview.value.warnings || [])]" :key="warning" type="warning" :closable="false" :title="warning" />
        <el-alert type="info" :closable="false" title="生成题经确认后直接启用，可用于组卷。下载包含本批次全部有效生成题。" />
        <el-alert v-if="ai.commitUnknown.value" type="warning" :closable="false" title="本批次的操作结果尚未确认，请先查询原批次状态。核对服务器最新题目后才能继续操作。" />
        <div class="preview-toolbar">
          <el-radio-group v-model="ai.difficulty.value">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button v-for="item in difficultyOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
          </el-radio-group>
          <div class="file-actions">
            <el-button :disabled="ai.rowBusy.value || ai.commitBusy.value || ai.statusBusy.value || ai.commitUnknown.value" @click="downloadGenerated('xlsx')">下载 Excel</el-button>
            <el-button :disabled="ai.rowBusy.value || ai.commitBusy.value || ai.statusBusy.value || ai.commitUnknown.value" @click="downloadGenerated('txt')">下载 TXT</el-button>
          </div>
        </div>
        <el-table :data="ai.visibleRows.value" row-key="row_number" max-height="520" empty-text="当前难度没有生成题">
          <el-table-column label="选择" width="64">
            <template #default="{ row }">
              <el-checkbox :model-value="ai.selectedRows.value.includes(row.row_number)"
                :disabled="!ai.selectable(row) || ai.rowBusy.value || ai.commitBusy.value || ai.statusBusy.value || ai.commitUnknown.value"
                :aria-label="`选择第 ${row.row_number} 道生成题`" @update:model-value="(value: unknown) => ai.setSelected(row.row_number, value)" />
            </template>
          </el-table-column>
          <el-table-column prop="row_number" label="序号" width="70" />
          <el-table-column label="难度" width="80"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column>
          <el-table-column label="题型" width="90"><template #default="{ row }">{{ typeLabel[row.type as QuestionType] }}</template></el-table-column>
          <el-table-column label="生成题题干" min-width="260" show-overflow-tooltip>
            <template #default="{ row }"><div class="preview-stem-summary">{{ questionRichTextToPlainText(row.stem) }}</div></template>
          </el-table-column>
          <el-table-column label="校验" min-width="150"><template #default="{ row }">
            <el-tag v-if="ai.selectable(row)" type="success">有效</el-tag>
            <span v-else class="row-error">{{ row.errors.join('；') || '重复或未通过校验' }}</span>
          </template></el-table-column>
          <el-table-column label="操作" width="200" fixed="right"><template #default="{ row }">
            <FitsTableActions>
              <FitsTableAction :disabled="ai.commitUnknown.value || ai.statusBusy.value" @click="previewGenerated(row)">预览</FitsTableAction>
              <FitsTableAction :disabled="!canChangeRows" @click="editGenerated(row)">修改</FitsTableAction>
              <FitsTableAction :disabled="!canChangeRows" :loading="ai.rowBusy.value" @click="regenerateRow(row)">重新生成</FitsTableAction>
            </FitsTableActions>
          </template></el-table-column>
        </el-table>
        <div class="preview-actions">
          <el-button v-if="ai.commitUnknown.value" :loading="ai.statusBusy.value" @click="reconcileAiBatch">查询原批次状态</el-button>
          <el-button type="primary" :loading="ai.commitBusy.value"
            :disabled="!catalogReady || !auth.can('questions:write') || !ai.selectedRows.value.length || ai.rowBusy.value || ai.commitBusy.value || ai.statusBusy.value || ai.commitUnknown.value"
            @click="ai.commitImport">确认导入并启用 {{ ai.selectedRows.value.length }} 道题目</el-button>
        </div>
      </section>
      <div v-if="ai.canReset.value" class="preview-actions"><el-button @click="resetAi">放弃本次结果并重新上传</el-button></div>
    </section>

    <QuestionImportPreviewDialog
      v-if="dialogMounted"
      v-model="filePreviewVisible"
      :preview="preview"
      :selected-rows="fileSelectedRows"
      :type-labels="typeLabel"
      :difficulty-label="difficultyLabel"
      :catalog-ready="catalogReady"
      :can-reset="canReset"
      :commit-busy="commitBusy"
      :status-busy="statusBusy"
      :commit-unknown="commitUnknown"
      @select-row="selectFileRow"
      @reset="resetPreview"
      @query-status="queryBatchStatus"
      @commit="commitImport"
    />

    <el-dialog v-model="generatedPreviewVisible" title="生成题预览" width="760px" destroy-on-close>
      <QuestionPreview v-if="generatedPreview" :question="generatedPreview" :reveal-answer="true" />
    </el-dialog>
    <el-dialog v-model="editVisible" title="修改生成题" width="760px" class="re-form-dialog" :close-on-click-modal="false" :close-on-press-escape="!ai.rowBusy.value" :show-close="!ai.rowBusy.value">
      <el-alert type="info" :closable="false" title="培训类别、题型和难度沿用生成约定；可校对题干、选项、答案和解析。" />
      <el-alert v-if="ai.commitUnknown.value" type="warning" :closable="false" title="修改结果尚未确认。请查询原批次状态，核对服务器上的最新题目后再确认导入。" />
      <el-form label-width="90px" class="generated-edit-form">
        <el-form-item label="题干"><el-input v-model="editForm.stem" type="textarea" :rows="4" placeholder="修改生成题题干" :disabled="ai.rowBusy.value" /></el-form-item>
        <el-form-item v-for="(option, index) in editForm.options" :key="index" :label="`选项 ${option.key}`">
          <div class="generated-option"><el-input v-model="option.text" :disabled="ai.rowBusy.value" />
            <el-checkbox :model-value="editForm.answer.includes(index)" :disabled="ai.rowBusy.value" @update:model-value="(checked: unknown) => toggleEditAnswer(index, checked)">正确</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="解析"><el-input v-model="editForm.analysis" type="textarea" :rows="3" :disabled="ai.rowBusy.value" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="ai.rowBusy.value || ai.statusBusy.value" @click="editVisible = false">取消</el-button><el-button v-if="ai.commitUnknown.value" :loading="ai.statusBusy.value" @click="reconcileAiBatch">查询原批次状态</el-button><el-button type="primary" :disabled="!canChangeRows" :loading="ai.rowBusy.value" @click="saveGenerated">保存修改</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadFile } from 'element-plus';
import { useRouter } from 'vue-router';
import http, { download, upload } from '../../api/http';
import { questionRichTextToPlainText, type AiQuestionImportEdit, type AiQuestionImportRow, type Id, type ImportResult, type Page, type QuestionType } from '../../api/training-types';
import { useAuthStore } from '../../stores/auth';
import QuestionPreview from '../../components/QuestionPreview.vue';
import QuestionImportPreviewDialog from '../../components/QuestionImportPreviewDialog.vue';
import { FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAiQuestionImportWorkflow, useQuestionImportWorkflow } from '../../utils/question-import-workflow';
import { useAuthoringOptions } from '../../composables/useAuthoringOptions';
import type { AuthoringOptions } from '../../api/question-authoring';

type CategoryOption = { id: Id; name: string };
const CATEGORY_PAGE_SIZE = 100;

function isCategoryPage(value: unknown, expectedPage: number): value is Page<CategoryOption> {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<Page<unknown>>;
  return Array.isArray(page.items)
    && page.items.every((item) => !!item && typeof item === 'object'
      && typeof (item as CategoryOption).id === 'string' && /^\d+$/.test((item as CategoryOption).id)
      && typeof (item as CategoryOption).name === 'string' && (item as CategoryOption).name.trim().length > 0)
    && Number.isInteger(page.total) && Number(page.total) >= 0
    && page.page === expectedPage
    && Number.isInteger(page.page_size) && Number(page.page_size) >= 1 && Number(page.page_size) <= CATEGORY_PAGE_SIZE
    && page.items.length <= Number(page.page_size);
}

const router = useRouter();
const auth = useAuthStore();
const { difficultyOptions, difficultyLabel, load: loadAuthoringOptions, loading: catalogLoading, error: catalogError } = useAuthoringOptions(
  () => http.get('/admin/questions/authoring-options') as Promise<AuthoringOptions>,
);
const catalogReady = computed(() => !catalogLoading.value && !catalogError.value && difficultyOptions.value.length > 0);
const mode = ref<'file' | 'ai'>('file');
const categories = ref<CategoryOption[]>([]);
const selectedCategoryId = ref<Id | ''>('');
const categoryLoading = ref(false);
const categoryError = ref('');
const uploadKey = ref(0);
const fileSelectedRows = ref<number[]>([]);
const filePreviewVisible = ref(false);
const dialogMounted = ref(true);
const aiFormat = ref<'xlsx' | 'txt'>('xlsx');
const aiUploadKey = ref(0);
const taskStatusLabel = { queued: '等待生成', running: '正在生成', completed: '生成完成', failed: '生成失败' };
const typeLabel: Record<QuestionType, string> = { single: '单选题', multiple: '多选题', judgment: '判断题' };
const generatedPreviewVisible = ref(false);
const generatedPreview = ref<AiQuestionImportRow | null>(null);
const editVisible = ref(false);
const editingRow = ref<AiQuestionImportRow | null>(null);
const editForm = reactive<AiQuestionImportEdit>({ stem: '', options: [], answer: [], analysis: '' });

const workflow = useQuestionImportWorkflow({
  commitBatch: (batchId, rowNumbers) => http.post(
    `/admin/questions/import-batches/${batchId}/commit`,
    { row_numbers: rowNumbers },
  ),
  readBatch: (batchId) => http.get(`/admin/questions/import-batches/${batchId}`),
  onCommitted: finish,
  onWarning: (message) => { ElMessage.warning(message); },
});
const {
  preview, previewBusy, commitBusy, statusBusy, commitUnknown, interactionLocked, canReset,
} = workflow;
const ai = useAiQuestionImportWorkflow({
  enabledDifficulties: () => catalogReady.value ? difficultyOptions.value.map((item) => item.value) : [],
  readTask: (id) => http.get(`/admin/questions/ai-import-tasks/${encodeURIComponent(id)}`),
  readBatch: (id) => http.get(`/admin/questions/ai-import-batches/${id}`),
  commitBatch: (id, rows) => http.post(`/admin/questions/ai-import-batches/${id}/commit`, { row_numbers: rows }),
  onCommitted: (result) => finish(result, true),
  onWarning: (message) => { ElMessage.warning(message); },
});
const canChangeRows = computed(() => catalogReady.value && auth.can('ai:write') && !ai.rowBusy.value && !ai.commitBusy.value
  && !ai.statusBusy.value && !ai.commitUnknown.value);
const dirty = computed(() => workflow.dirty.value || ai.dirty.value || editVisible.value);
const unsaved = useUnsavedChanges(dirty, {
  onDiscard: () => {
    workflow.discard();
    ai.discard();
    filePreviewVisible.value = false;
    editVisible.value = false;
    generatedPreviewVisible.value = false;
    editingRow.value = null;
    generatedPreview.value = null;
    uploadKey.value += 1;
    aiUploadKey.value += 1;
  },
});

watch(() => preview.value?.batch_id, (batchId) => {
  fileSelectedRows.value = [...(preview.value?.valid_rows || [])];
  filePreviewVisible.value = !!batchId;
}, { flush: 'sync' });
function selectFileRow(row: number, checked: unknown) {
  if (!preview.value?.valid_rows.includes(row) || commitBusy.value || statusBusy.value || commitUnknown.value) return;
  fileSelectedRows.value = checked ? [...new Set([...fileSelectedRows.value, row])] : fileSelectedRows.value.filter((id) => id !== row);
}
watch(aiFormat, () => { aiUploadKey.value += 1; });

async function changeMode(value: string | number) {
  if (value !== 'file' && value !== 'ai') return;
  if (value === mode.value) return;
  if (previewBusy.value || commitBusy.value || statusBusy.value || commitUnknown.value || ai.taskBusy.value
    || ai.rowBusy.value || ai.commitBusy.value || ai.statusBusy.value || ai.commitUnknown.value) return;
  if (await unsaved.confirmDiscard()) mode.value = value;
}

function downloadAiTemplate() {
  void download('/admin/questions/import-template', `AI参考题模板.${aiFormat.value}`, { format: aiFormat.value, purpose: 'ai' });
}

async function generateFromFile(value: UploadFile) {
  const file = value.raw;
  if (!(file instanceof File) || !catalogReady.value || !auth.can('ai:write') || !auth.can('ai:read')) return;
  const expected = aiFormat.value === 'xlsx' ? /\.xlsx$/i : /\.txt$/i;
  if (!expected.test(file.name) || file.size > 5 * 1024 * 1024) {
    ElMessage.warning(!expected.test(file.name) ? `请选择 .${aiFormat.value} 文件` : '参考文件不能超过 5MB');
    aiUploadKey.value += 1;
    return;
  }
  try { await ai.startTask(() => upload('/admin/questions/ai-import-tasks', file, 'file', { format: aiFormat.value })); }
  finally { aiUploadKey.value += 1; }
}

async function resetAi() {
  if (ai.canReset.value) await unsaved.confirmDiscard();
}

function previewGenerated(row: AiQuestionImportRow) {
  if (ai.commitUnknown.value || ai.statusBusy.value) return;
  generatedPreview.value = JSON.parse(JSON.stringify(row));
  generatedPreviewVisible.value = true;
}

function editGenerated(row: AiQuestionImportRow) {
  if (!canChangeRows.value) return;
  editingRow.value = row;
  Object.assign(editForm, { stem: row.stem, options: row.options.map((option) => ({ ...option })), answer: [...row.answer], analysis: row.analysis });
  editVisible.value = true;
}

function toggleEditAnswer(index: number, checked: unknown) {
  if (editingRow.value?.type !== 'multiple') editForm.answer = checked ? [index] : [];
  else editForm.answer = checked ? [...new Set([...editForm.answer, index])].sort((left, right) => left - right) : editForm.answer.filter((answer) => answer !== index);
}

async function saveGenerated() {
  if (!editingRow.value || !ai.preview.value || !canChangeRows.value) return;
  const row = editingRow.value.row_number;
  const body: AiQuestionImportEdit = { stem: editForm.stem, options: editForm.options.map((option) => ({ ...option })), answer: [...editForm.answer], analysis: editForm.analysis };
  if (await ai.updateRow(row, () => http.patch(`/admin/questions/ai-import-batches/${ai.preview.value!.batch_id}/rows/${row}`, body))) editVisible.value = false;
}

async function regenerateRow(row: AiQuestionImportRow) {
  if (!canChangeRows.value || !ai.preview.value) return;
  await ai.updateRow(row.row_number, () => http.post(`/admin/questions/ai-import-batches/${ai.preview.value!.batch_id}/rows/${row.row_number}/regenerate`));
}

async function reconcileAiBatch() {
  await ai.queryBatchStatus();
  if (!ai.commitUnknown.value) {
    editVisible.value = false;
    editingRow.value = null;
    generatedPreviewVisible.value = false;
    generatedPreview.value = null;
  }
}

function downloadGenerated(fileFormat: 'xlsx' | 'txt') {
  if (!ai.preview.value || ai.rowBusy.value || ai.commitBusy.value || ai.statusBusy.value || ai.commitUnknown.value) return;
  void download(`/admin/questions/ai-import-batches/${ai.preview.value.batch_id}/download`, `AI生成题.${fileFormat}`, { format: fileFormat });
}

async function loadCategories() {
  if (categoryLoading.value) return;
  categoryLoading.value = true;
  categoryError.value = '';
  categories.value = [];
  selectedCategoryId.value = '';
  try {
    const firstResponse = await http.get('/ai/question-category-options', { params: { page: 1, page_size: CATEGORY_PAGE_SIZE } });
    if (!isCategoryPage(firstResponse, 1)) throw new Error('invalid category page');
    const expectedTotal = firstResponse.total;
    const pageSize = firstResponse.page_size;
    const all = [...firstResponse.items];
    const pageCount = Math.ceil(expectedTotal / pageSize);
    for (let page = 2; page <= pageCount; page += 1) {
      const response = await http.get('/ai/question-category-options', { params: { page, page_size: pageSize } });
      if (!isCategoryPage(response, page) || response.total !== expectedTotal || response.page_size !== pageSize) {
        throw new Error('inconsistent category page');
      }
      all.push(...response.items);
    }
    const unique = new Map(all.map((item) => [item.id, item]));
    if (unique.size !== expectedTotal) throw new Error('incomplete category options');
    categories.value = [...unique.values()];
  } catch {
    categories.value = [];
    selectedCategoryId.value = '';
    categoryError.value = '培训类别加载失败，请重试';
  } finally {
    categoryLoading.value = false;
  }
}

function downloadTemplate(fileFormat: 'xlsx' | 'txt') {
  void download(
    '/admin/questions/import-template',
    `题库导入模板.${fileFormat}`,
    { format: fileFormat },
  );
}

async function resetPreview() {
  if (!canReset.value) return;
  await unsaved.confirmDiscard();
}

async function previewFile(value: UploadFile) {
  const file = value.raw;
  if (!(file instanceof File)) return;
  if (!selectedCategoryId.value) {
    ElMessage.warning('请先选择培训类别');
    uploadKey.value += 1;
    return;
  }
  const fileFormat = /\.xlsx$/i.test(file.name) ? 'xlsx' : /\.txt$/i.test(file.name) ? 'txt' : null;
  if (!fileFormat) {
    ElMessage.warning('请选择 Excel (.xlsx) 或 TXT (.txt) 文件');
    uploadKey.value += 1;
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('导入文件不能超过 5MB');
    uploadKey.value += 1;
    return;
  }
  try {
    const fields = { format: fileFormat, category_id: selectedCategoryId.value };
    await workflow.loadPreview(() => upload('/admin/questions/import-preview', file, 'file', fields));
  } finally {
    uploadKey.value += 1;
  }
}

async function finish(result: ImportResult, generated = false) {
  ElMessage.success(result.enabled === true
    ? `成功导入 ${result.created_ids.length} 道题目，已启用`
    : `已确认原批次导入 ${result.created_ids.length} 道题目的结果`);
  await router.push('/admin/questions');
}

async function queryBatchStatus() {
  await workflow.queryBatchStatus();
}

async function commitImport() {
  if (!catalogReady.value) return;
  await workflow.commitImport(fileSelectedRows.value);
}

onMounted(loadCategories);
onMounted(loadAuthoringOptions);
onActivated(() => { dialogMounted.value = true; workflow.activate(); ai.activate(); });
onDeactivated(() => {
  dialogMounted.value = false;
  filePreviewVisible.value = false;
  workflow.deactivate();
  ai.deactivate();
});
onBeforeUnmount(() => { workflow.deactivate(); ai.deactivate(); });
</script>

<style scoped>
.import-form { max-width: 720px; }
.file-import-panel { min-width: 0; }
.import-heading { margin: 28px 0 24px; }
.import-heading h2 { margin: 0; color: var(--el-text-color-primary); font-size: 24px; line-height: 1.4; }
.import-heading p { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 14px; line-height: 1.7; }
.import-workspace { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px; min-width: 0; }
.import-prep-panel { box-sizing: border-box; flex: 1 1 304px; min-width: 0; }
.import-prep-content { padding: 24px; border-radius: 8px; background: var(--el-fill-color-light, #f5f7fa); }
.import-upload-panel { flex: 999 1 520px; min-width: 0; }
.import-section-kicker { margin: 0 0 16px; color: var(--el-color-primary); font-size: 13px; font-weight: 600; line-height: 20px; }
.import-prep-panel h3, .preview-title { margin: 0; color: var(--el-text-color-primary); font-size: 20px; line-height: 1.45; }
.import-panel-description { margin: 12px 0 16px; color: var(--el-text-color-regular); font-size: 14px; line-height: 1.7; }
.template-actions { display: grid; gap: 12px; }
.template-actions :deep(.el-button) { width: 100%; min-height: 50px; margin-left: 0; border-color: var(--el-border-color, #dcdfe6); background: #fff; }
.import-existing-hint { margin: 14px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.import-category-form { max-width: none; margin-top: 8px; }
.import-category-form :deep(.el-form-item) { margin-bottom: 16px; }
.import-category-form :deep(.el-form-item__label) { color: var(--el-text-color-primary); }
.import-category-control { width: 100%; min-width: 0; }
.import-category-select { width: 100%; }
.import-category-control p { margin: 5px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.question-file-upload { display: block; width: 100%; }
.question-file-upload :deep(.el-upload) { display: block; width: 100%; }
.question-file-upload :deep(.el-upload-dragger) { box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 240px; padding: 32px 24px; border: 1px solid var(--el-color-primary-light-7, #a0b4ef); border-radius: 8px; background: var(--el-color-primary-light-9, #edf0fc); }
.question-file-upload :deep(.el-upload-dragger:hover), .question-file-upload :deep(.el-upload-dragger.is-dragover) { border-color: var(--el-color-primary); background: var(--el-color-primary-light-8, #dfe6fb); }
.question-file-upload :deep(.el-upload.is-disabled .el-upload-dragger) { border-color: var(--el-border-color-lighter); background: var(--el-fill-color-lighter); cursor: not-allowed; }
.question-file-upload__icon { width: 34px; height: 34px; margin-bottom: 14px; fill: none; stroke: var(--el-color-primary); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.question-file-upload__title { margin: 0; color: var(--el-text-color-primary); font-size: 18px; font-weight: 600; line-height: 1.5; }
.question-file-upload__support { margin: 7px 0 18px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.question-file-upload :deep(.el-button) { min-width: 180px; }
.preview-ready { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 16px; padding: 14px 16px; border: 1px solid var(--el-color-success-light-7); border-radius: 8px; background: var(--el-color-success-light-9); }
.preview-ready > div { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-width: 0; color: var(--el-text-color-regular); font-size: 13px; }
.import-footnote { display: flex; align-items: center; gap: 10px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--el-border-color-lighter); color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.import-footnote svg { flex: 0 0 auto; width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.file-actions, .preview-summary, .preview-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.preview-panel { min-width: 0; margin-top: 24px; padding-top: 22px; border-top: 1px solid var(--el-border-color-lighter); }
.preview-summary { margin-bottom: 14px; }
.batch-id { color: #909399; font-size: 13px; }
.preview-actions { justify-content: flex-end; margin-top: 18px; }
.ai-import-panel > .el-alert + .el-alert { margin-top: 12px; }
.ai-import-form, .generated-edit-form { margin-top: 20px; }
.task-summary, .preview-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
.preview-toolbar { justify-content: space-between; }
.generated-option { display: flex; align-items: center; gap: 12px; width: 100%; }
.row-error { color: var(--el-color-danger); font-size: 13px; }
@media (max-width: 640px) {
  .import-heading { margin-top: 20px; }
  .import-prep-content { padding: 20px; }
  .import-category-form :deep(.el-form-item) { display: block; }
  .import-category-form :deep(.el-form-item__label) { display: block; width: auto !important; height: auto; margin-bottom: 8px; line-height: 22px; text-align: left; }
  .import-category-form :deep(.el-form-item__content) { margin-left: 0 !important; }
  .question-file-upload :deep(.el-upload-dragger) { min-height: 220px; padding: 28px 16px; }
  .preview-ready { align-items: stretch; flex-direction: column; }
}
</style>
