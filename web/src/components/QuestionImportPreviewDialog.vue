<template>
  <el-dialog
    :model-value="modelValue"
    title="试题导入预览"
    width="min(1120px, calc(100vw - 32px))"
    top="4vh"
    class="re-form-dialog question-import-preview-dialog"
    append-to-body
    :close-on-click-modal="!dismissBlocked"
    :close-on-press-escape="!dismissBlocked"
    :show-close="!dismissBlocked"
    :before-close="beforeClose"
    @update:model-value="requestVisibility"
  >
    <template v-if="preview">
      <div class="question-import-preview__summary">
        <el-tag type="success">可导入 {{ preview.valid_rows.length }} 行</el-tag>
        <el-tag v-if="preview.errors.length" type="danger">错误 {{ preview.errors.length }} 行</el-tag>
        <el-tag v-if="preview.duplicates.length" type="warning">重复 {{ preview.duplicates.length }} 行</el-tag>
        <span class="question-import-preview__batch">批次 {{ preview.batch_id }}</span>
      </div>

      <el-alert
        v-for="warning in uniqueWarnings"
        :key="warning"
        type="warning"
        :closable="false"
        :title="warning"
      />
      <el-alert
        v-if="commitUnknown"
        type="warning"
        :closable="false"
        title="本批次的提交结果尚未确认，请先查询原批次状态。"
      />

      <el-table
        v-if="rows.length"
        class="question-import-preview__table"
        :data="rows"
        row-key="row_number"
        max-height="46vh"
      >
        <el-table-column label="选择" width="64">
          <template #default="{ row }">
            <el-checkbox
              :model-value="selectedRows.includes(row.row_number)"
              :disabled="!preview.valid_rows.includes(row.row_number) || dismissBlocked"
              :aria-label="`选择第 ${row.row_number} 行`"
              @update:model-value="(checked: unknown) => emit('select-row', row.row_number, checked)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="row_number" label="行号" width="76" />
        <el-table-column label="题干" min-width="320" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="preview-stem-summary">{{ questionRichTextToPlainText(row.stem) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="题型" width="104" align="center" header-align="center">
          <template #default="{ row }">
            <el-tag type="info" effect="plain">{{ typeLabels[row.type as QuestionType] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="难度" width="96" align="center" header-align="center">
          <template #default="{ row }">
            <el-tag :type="difficultyTagType(row.difficulty)" effect="plain">{{ difficultyLabel(row.difficulty) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" header-align="center" fixed="right">
          <template #default="{ row }">
            <FitsTableAction :disabled="dismissBlocked" @click="openRowPreview(row)">预览</FitsTableAction>
          </template>
        </el-table-column>
      </el-table>

      <el-alert
        v-if="preview.duplicates.length"
        class="question-import-preview__duplicates"
        type="warning"
        :closable="false"
        :title="`重复行默认不导入：${preview.duplicates.join('、')}`"
      />
      <el-table v-if="preview.errors.length" :data="preview.errors" size="small" max-height="180">
        <el-table-column prop="row" label="行号" width="90" />
        <el-table-column prop="message" label="错误原因" min-width="320" />
      </el-table>
      <el-empty v-if="!preview.valid_rows.length" description="没有可确认的行，请修正文件后重新上传" :image-size="80" />
    </template>

    <template #footer>
      <el-button :disabled="dismissBlocked" @click="requestVisibility(false)">关闭</el-button>
      <el-button :disabled="!canReset" @click="emit('reset')">修正后重新上传</el-button>
      <el-button v-if="commitUnknown" :loading="statusBusy" @click="emit('query-status')">查询原批次状态</el-button>
      <el-button
        type="primary"
        :loading="commitBusy"
        :disabled="!catalogReady || !selectedRows.length || dismissBlocked"
        @click="emit('commit')"
      >
        确认导入并启用 {{ selectedRows.length }} 行
      </el-button>
    </template>

  </el-dialog>

  <el-dialog
    v-model="rowPreviewVisible"
    title="试题预览"
    width="min(760px, calc(100vw - 32px))"
    top="6vh"
    class="question-import-row-preview-dialog"
    append-to-body
    destroy-on-close
  >
    <QuestionPreview v-if="rowPreview" :question="rowPreview" :reveal-answer="true" />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onDeactivated, ref, watch } from 'vue';
import {
  questionRichTextToPlainText,
  type AiQuestionImportRow,
  type ImportPreview,
  type QuestionType,
} from '../api/training-types';
import QuestionPreview from './QuestionPreview.vue';
import { FitsTableAction } from './FitsTable';

const props = defineProps<{
  modelValue: boolean;
  preview: ImportPreview | null;
  selectedRows: number[];
  typeLabels: Record<QuestionType, string>;
  difficultyLabel: (difficulty: string) => string;
  catalogReady: boolean;
  canReset: boolean;
  commitBusy: boolean;
  statusBusy: boolean;
  commitUnknown: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'select-row': [rowNumber: number, checked: unknown];
  reset: [];
  'query-status': [];
  commit: [];
}>();

const dismissBlocked = computed(() => props.commitBusy || props.statusBusy || props.commitUnknown);
const rows = computed(() => props.preview?.rows || []);
const uniqueWarnings = computed(() => [...new Set(props.preview?.warnings || [])]);
const rowPreviewVisible = ref(false);
const rowPreview = ref<AiQuestionImportRow | null>(null);

function requestVisibility(value: boolean) {
  if (!value && dismissBlocked.value) return;
  if (!value) closeRowPreview();
  emit('update:modelValue', value);
}

function beforeClose(done: () => void) {
  if (!dismissBlocked.value) done();
}

function openRowPreview(row: AiQuestionImportRow) {
  if (dismissBlocked.value) return;
  rowPreview.value = JSON.parse(JSON.stringify(row));
  rowPreviewVisible.value = true;
}

function closeRowPreview() {
  rowPreviewVisible.value = false;
  rowPreview.value = null;
}

function difficultyTagType(difficulty: string): 'success' | 'warning' | 'danger' | 'info' {
  if (difficulty === 'easy') return 'success';
  if (difficulty === 'medium') return 'warning';
  if (difficulty === 'hard') return 'danger';
  return 'info';
}

watch(() => props.preview?.batch_id, closeRowPreview);
watch(() => props.modelValue, (visible) => { if (!visible) closeRowPreview(); });
onDeactivated(closeRowPreview);
</script>

<style scoped>
.question-import-preview__summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.question-import-preview__batch { color: var(--el-text-color-secondary); font-size: 13px; }
.question-import-preview__summary + :deep(.el-alert),
:deep(.el-alert + .el-alert) { margin-top: 10px; }
.question-import-preview__table { width: 100%; margin-top: 14px; }
.preview-stem-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.question-import-preview__duplicates { margin: 14px 0 12px; }
:global(.question-import-preview-dialog .el-dialog__body) { overflow-x: hidden; }
:global(.question-import-preview-dialog .el-dialog__footer) { flex-wrap: wrap; }
:global(.question-import-preview-dialog .el-dialog__footer .el-button) { flex-shrink: 0; }
@media (max-width: 640px) {
  :global(.question-import-preview-dialog .el-dialog__footer .el-button--primary) {
    flex: 1 0 100%;
    width: 100%;
  }
}
</style>
