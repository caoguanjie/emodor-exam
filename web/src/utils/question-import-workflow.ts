import { computed, ref } from 'vue';
import { ApiError } from '../api/http';
import type { ImportPreview, ImportResult } from '../api/training-types';

export interface QuestionImportWorkflowOptions {
  commitBatch: (batchId: string, rowNumbers: number[]) => Promise<unknown>;
  readBatch: (batchId: string) => Promise<unknown>;
  onCommitted: (result: ImportResult) => void | Promise<void>;
  onWarning: (message: string) => void;
}

interface RequestContext {
  generation: number;
  batchId?: string;
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

function isIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && /^\d+$/.test(item));
}

function isImportPreview(value: unknown): value is ImportPreview {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.batch_id === 'string'
    && /^\d+$/.test(record.batch_id)
    && isIntegerArray(record.valid_rows)
    && isIntegerArray(record.duplicates)
    && Array.isArray(record.errors)
    && record.errors.every((item) => (
      !!item && typeof item === 'object'
      && Number.isInteger((item as Record<string, unknown>).row)
      && typeof (item as Record<string, unknown>).message === 'string'
    ));
}

function isImportResult(value: unknown): value is ImportResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.batch_id === 'string'
    && /^\d+$/.test(record.batch_id)
    && isIdArray(record.created_ids)
    && isIntegerArray(record.committed_rows);
}

function isDefiniteBusinessRejection(error: unknown): boolean {
  return error instanceof ApiError
    && Number.isInteger(error.code)
    && error.code >= 40000
    && error.code < 50000;
}

/**
 * Owns the import page's async identity. Every continuation is tied to one
 * immutable request generation and (for commit/status) one batch id, so late
 * responses cannot replace newer UI state or navigate after unmount.
 */
export function useQuestionImportWorkflow(options: QuestionImportWorkflowOptions) {
  const preview = ref<ImportPreview | null>(null);
  const previewBusy = ref(false);
  const commitBusy = ref(false);
  const statusBusy = ref(false);
  const commitUnknown = ref(false);
  let generation = 0;
  let active = true;

  const dirty = computed(() => preview.value !== null);
  const interactionLocked = computed(() => (
    previewBusy.value || commitBusy.value || statusBusy.value || preview.value !== null
  ));
  const canReset = computed(() => (
    preview.value !== null
    && !commitUnknown.value
    && !previewBusy.value
    && !commitBusy.value
    && !statusBusy.value
  ));

  function begin(batchId?: string): RequestContext {
    return { generation: ++generation, batchId };
  }

  function generationIsCurrent(context: RequestContext): boolean {
    return active && context.generation === generation;
  }

  function requestIsCurrent(context: RequestContext): boolean {
    return generationIsCurrent(context)
      && (context.batchId === undefined || preview.value?.batch_id === context.batchId);
  }

  function discard(): void {
    generation += 1;
    preview.value = null;
    commitUnknown.value = false;
    previewBusy.value = false;
    commitBusy.value = false;
    statusBusy.value = false;
  }

  function deactivate(): void {
    active = false;
    generation += 1;
  }

  async function loadPreview(request: () => Promise<unknown>): Promise<void> {
    if (!active || interactionLocked.value) return;
    const context = begin();
    previewBusy.value = true;
    try {
      const response = await request();
      if (!generationIsCurrent(context)) return;
      if (!isImportPreview(response)) {
        options.onWarning('预览响应格式无法确认，请重新上传');
        return;
      }
      preview.value = response;
      commitUnknown.value = false;
    } catch {
      // The shared HTTP layer presents request errors. No batch exists until
      // a verifiable preview response supplies its server-generated id.
    } finally {
      if (generationIsCurrent(context)) previewBusy.value = false;
    }
  }

  async function commitImport(): Promise<void> {
    const current = preview.value;
    if (!active || !current || !current.valid_rows.length || commitBusy.value || statusBusy.value || commitUnknown.value) return;
    const batchId = current.batch_id;
    const rows = [...current.valid_rows];
    const context = begin(batchId);
    commitBusy.value = true;
    try {
      const response = await options.commitBatch(batchId, rows);
      if (!requestIsCurrent(context)) return;
      if (!isImportResult(response) || response.batch_id !== batchId) {
        commitUnknown.value = true;
        options.onWarning('提交响应无法验证，请先查询原批次状态；系统不会自动重建批次');
        return;
      }
      commitUnknown.value = false;
      preview.value = null;
      commitBusy.value = false;
      await options.onCommitted(response);
    } catch (error) {
      if (!requestIsCurrent(context)) return;
      if (!isDefiniteBusinessRejection(error)) {
        commitUnknown.value = true;
        options.onWarning('提交响应未确认，请先查询原批次状态；系统不会自动重建批次');
      }
    } finally {
      if (generationIsCurrent(context)) commitBusy.value = false;
    }
  }

  async function queryBatchStatus(): Promise<void> {
    const current = preview.value;
    if (!active || !current || !commitUnknown.value || statusBusy.value || commitBusy.value) return;
    const batchId = current.batch_id;
    const context = begin(batchId);
    statusBusy.value = true;
    try {
      const response = await options.readBatch(batchId);
      if (!requestIsCurrent(context)) return;
      if (isImportResult(response) && response.batch_id === batchId) {
        commitUnknown.value = false;
        preview.value = null;
        statusBusy.value = false;
        await options.onCommitted(response);
        return;
      }
      if (isImportPreview(response) && response.batch_id === batchId) {
        preview.value = response;
        commitUnknown.value = false;
        options.onWarning('服务器确认该批次尚未提交，请核对后再次明确确认');
        return;
      }
      options.onWarning('原批次状态响应无法验证；系统没有自动新建或重复提交批次');
    } catch {
      if (requestIsCurrent(context)) {
        options.onWarning('仍无法确认原批次状态；系统没有自动新建或重复提交批次');
      }
    } finally {
      if (generationIsCurrent(context)) statusBusy.value = false;
    }
  }

  return {
    preview,
    previewBusy,
    commitBusy,
    statusBusy,
    commitUnknown,
    dirty,
    interactionLocked,
    canReset,
    loadPreview,
    commitImport,
    queryBatchStatus,
    discard,
    deactivate,
  };
}
