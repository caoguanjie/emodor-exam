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
      <el-steps class="import-steps" :active="preview ? 2 : previewBusy ? 1 : 0" finish-status="success" align-center>
        <el-step title="下载并填写模板" description="已有文件可跳过" />
        <el-step title="上传并预览" description="检查试题与错误提示" />
        <el-step title="确认导入" description="确认后导入所选试题" />
      </el-steps>

      <section class="import-guide-section">
        <h3 class="import-section-title"><span class="import-step-number" aria-hidden="true">1</span>下载模板</h3>
        <div class="import-section-body">
          <p class="import-section-description">首次使用请下载模板，按示例填写试题并保存。已有填写好的文件，可直接进行第 2 步。</p>
          <div class="file-actions">
            <el-button :disabled="previewBusy || commitBusy || statusBusy" @click="downloadTemplate('xlsx')">下载 Excel 模板（推荐）</el-button>
            <el-button :disabled="previewBusy || commitBusy || statusBusy" @click="downloadTemplate('txt')">下载 TXT 模板</el-button>
          </div>
          <el-collapse class="import-help">
            <el-collapse-item title="查看填写说明" name="instructions">
              <p>请保留模板首行的列名与顺序，按示例填写培训类别、题型、难度、题干、选项、答案和解析。</p>
              <p>标准模板为 7 列：<code>category/type/difficulty/stem/options/answer/analysis</code>。</p>
              <p>TXT 文件请使用 UTF-8 编码，以制表符分列。选项与答案须填写 JSON 数组，请参照模板中的示例。</p>
            </el-collapse-item>
          </el-collapse>
        </div>
      </section>

      <section class="import-guide-section">
        <h3 class="import-section-title"><span class="import-step-number" aria-hidden="true">2</span>上传试题文件</h3>
        <div class="import-section-body">
          <p class="import-section-description">上传已填写的模板，预览并检查结果后，再确认导入。</p>
          <el-upload
            :key="uploadKey"
            :show-file-list="false"
            accept=".xlsx,.txt,text/plain"
            :auto-upload="false"
            :disabled="interactionLocked"
            :on-change="previewFile"
          >
            <el-button type="primary" :loading="previewBusy" :disabled="interactionLocked">选择文件并预览</el-button>
          </el-upload>
          <p class="import-file-tip">支持 Excel（.xlsx）和 TXT（.txt），文件不超过 5MB。系统自动识别文件格式。</p>
          <el-collapse class="import-help">
            <el-collapse-item title="可选设置：默认类别、默认难度" name="defaults">
              <p class="import-default-tip">仅补充文件中未填写的类别和难度，已填写的内容不会被覆盖。</p>
              <el-form label-width="90px" class="import-form">
                <el-form-item label="默认类别">
                  <el-select v-model="defaults.category_id" clearable filterable placeholder="文件未填写培训类别时使用" class="import-default-select" :disabled="interactionLocked">
                    <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="默认难度">
                  <el-select v-model="defaults.difficulty" clearable placeholder="文件未填写难度时使用" class="import-default-select" :disabled="interactionLocked || !catalogReady">
                    <el-option v-for="item in difficultyOptions" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
              </el-form>
            </el-collapse-item>
          </el-collapse>
        </div>
      </section>

    <section v-if="preview" class="preview-panel import-guide-section">
      <h3 class="import-section-title"><span class="import-step-number" aria-hidden="true">3</span>检查并确认</h3>
      <div class="import-section-body">
      <p class="import-section-description">核对可导入行和错误提示，确认后所选试题将导入并启用。</p>
      <div class="preview-summary">
        <el-tag type="success">可导入 {{ preview.valid_rows.length }} 行</el-tag>
        <el-tag v-if="preview.errors.length" type="danger">错误 {{ preview.errors.length }} 行</el-tag>
        <el-tag v-if="preview.duplicates.length" type="warning">重复 {{ preview.duplicates.length }} 行</el-tag>
        <span class="batch-id">批次 {{ preview.batch_id }}</span>
      </div>

      <el-alert v-for="warning in [...new Set(preview.warnings || [])]" :key="warning" type="warning" :closable="false" :title="warning" />
      <el-table v-if="preview.rows?.length" :data="preview.rows" row-key="row_number" max-height="420">
        <el-table-column label="选择" width="64"><template #default="{ row }"><el-checkbox :model-value="fileSelectedRows.includes(row.row_number)" :disabled="!preview.valid_rows.includes(row.row_number) || commitBusy || statusBusy || commitUnknown" :aria-label="`选择第 ${row.row_number} 行`" @update:model-value="(checked: unknown) => selectFileRow(row.row_number, checked)" /></template></el-table-column>
        <el-table-column prop="row_number" label="行号" width="80" />
        <el-table-column prop="stem" label="题干" min-width="280" show-overflow-tooltip />
        <el-table-column label="题型/难度" width="140"><template #default="{ row }">{{ typeLabel[row.type as QuestionType] }} · {{ difficultyLabel(row.difficulty) }}</template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ row }"><FitsTableAction :disabled="commitUnknown || statusBusy" @click="previewFileRow(row)">预览</FitsTableAction></template></el-table-column>
      </el-table>
      <el-alert
        v-if="preview.duplicates.length"
        type="warning"
        :closable="false"
        :title="`重复行默认不导入：${preview.duplicates.join('、')}`"
        style="margin-bottom:12px"
      />
      <el-table v-if="preview.errors.length" :data="preview.errors" size="small" max-height="260">
        <el-table-column prop="row" label="行号" width="90" />
        <el-table-column prop="message" label="错误原因" min-width="320" />
      </el-table>
      <el-empty v-if="!preview.valid_rows.length" description="没有可确认的行，请修正文件后重新上传" :image-size="80" />

      <div class="preview-actions">
        <el-button :disabled="!canReset" @click="resetPreview">修正后重新上传</el-button>
        <el-button v-if="commitUnknown" :loading="statusBusy" @click="queryBatchStatus">查询原批次状态</el-button>
        <el-button
          type="primary"
          :loading="commitBusy"
          :disabled="!catalogReady || !fileSelectedRows.length || commitBusy || statusBusy || commitUnknown"
          @click="commitImport"
        >
          确认导入并启用 {{ fileSelectedRows.length }} 行
        </el-button>
      </div>
      </div>
    </section>
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
          <el-table-column prop="stem" label="生成题题干" min-width="260" show-overflow-tooltip />
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
import type { AiQuestionImportEdit, AiQuestionImportRow, Difficulty, Id, ImportResult, Page, QuestionType } from '../../api/training-types';
import { useAuthStore } from '../../stores/auth';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAiQuestionImportWorkflow, useQuestionImportWorkflow } from '../../utils/question-import-workflow';
import { useAuthoringOptions } from '../../composables/useAuthoringOptions';
import type { AuthoringOptions } from '../../api/question-authoring';

type CategoryOption = { id: Id; name: string };

const router = useRouter();
const auth = useAuthStore();
const { difficultyOptions, difficultyLabel, load: loadAuthoringOptions, loading: catalogLoading, error: catalogError } = useAuthoringOptions(
  () => http.get('/admin/questions/authoring-options') as Promise<AuthoringOptions>,
);
const catalogReady = computed(() => !catalogLoading.value && !catalogError.value && difficultyOptions.value.length > 0);
const mode = ref<'file' | 'ai'>('file');
const categories = ref<CategoryOption[]>([]);
const defaults = reactive<{ category_id: Id | ''; difficulty: Difficulty | '' }>({ category_id: '', difficulty: '' });
const uploadKey = ref(0);
const fileSelectedRows = ref<number[]>([]);
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
    editVisible.value = false;
    generatedPreviewVisible.value = false;
    editingRow.value = null;
    generatedPreview.value = null;
    uploadKey.value += 1;
    aiUploadKey.value += 1;
  },
});

watch(() => preview.value?.batch_id, () => { fileSelectedRows.value = [...(preview.value?.valid_rows || [])]; }, { flush: 'sync' });
function selectFileRow(row: number, checked: unknown) {
  if (!preview.value?.valid_rows.includes(row) || commitBusy.value || statusBusy.value || commitUnknown.value) return;
  fileSelectedRows.value = checked ? [...new Set([...fileSelectedRows.value, row])] : fileSelectedRows.value.filter((id) => id !== row);
}
function previewFileRow(row: AiQuestionImportRow) {
  if (commitUnknown.value || statusBusy.value) return;
  generatedPreview.value = JSON.parse(JSON.stringify(row));
  generatedPreviewVisible.value = true;
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
  void download('/admin/questions/import-template', `AI参考题模板.${aiFormat.value}`, { format: aiFormat.value });
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
  const result = await http.get('/ai/question-category-options', { params: { page: 1, page_size: 100 } }) as Page<CategoryOption>;
  categories.value = result.items || [];
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
    const fields = Object.fromEntries(Object.entries({
      format: fileFormat,
      category_id: defaults.category_id,
      difficulty: defaults.difficulty,
    }).filter(([, item]) => item !== '')) as Record<string, string>;
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
onActivated(() => { workflow.activate(); ai.activate(); });
onDeactivated(() => { workflow.deactivate(); ai.deactivate(); });
onBeforeUnmount(() => { workflow.deactivate(); ai.deactivate(); });
</script>

<style scoped>
.import-form { max-width: 720px; }
.import-steps { max-width: 840px; margin: 12px 0 30px; }
.import-guide-section + .import-guide-section { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--el-border-color-lighter); }
.import-section-title { display: flex; align-items: center; gap: 12px; margin: 0; color: var(--el-text-color-primary); font-size: 18px; font-weight: 600; }
.import-step-number { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 28px; height: 28px; border-radius: 50%; background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-size: 15px; }
.import-section-body { margin-left: 40px; }
.import-section-description { margin: 10px 0 16px; color: var(--el-text-color-regular); line-height: 1.7; }
.import-help { max-width: 720px; margin-top: 16px; border-top: 0; }
.import-help :deep(.el-collapse-item__header) { height: auto; min-height: 40px; font-weight: 400; }
.import-help :deep(.el-collapse-item__content) { color: var(--el-text-color-regular); line-height: 1.8; }
.import-help p { margin: 8px 0; overflow-wrap: anywhere; }
.import-file-tip, .import-default-tip { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.import-file-tip { margin: 10px 0 0; }
.import-default-select { width: 100%; max-width: 320px; }
.file-actions, .preview-summary, .preview-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.preview-panel { margin-top: 22px; border-top: 1px solid #ebeef5; padding-top: 20px; }
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
  .import-section-body { margin-left: 0; }
  .import-steps :deep(.el-step__title) { font-size: 13px; }
  .import-steps :deep(.el-step__description) { padding-right: 6px; padding-left: 6px; }
}
</style>
