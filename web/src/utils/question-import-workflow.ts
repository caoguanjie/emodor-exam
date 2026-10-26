import { computed, ref } from 'vue';
import { ApiError } from '../api/http';
import type { AiQuestionImportPreview, AiQuestionImportRow, AiQuestionImportTask, ImportPreview, ImportResult } from '../api/training-types';

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
    if (commitBusy.value && preview.value) commitUnknown.value = true;
    active = false;
    generation += 1;
    previewBusy.value = false;
    commitBusy.value = false;
    statusBusy.value = false;
  }

  function activate(): void {
    active = true;
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

  async function commitImport(rowNumbers?: number[]): Promise<void> {
    const current = preview.value;
    if (!active || !current || !current.valid_rows.length || commitBusy.value || statusBusy.value || commitUnknown.value) return;
    const batchId = current.batch_id;
    const rows = rowNumbers === undefined ? [...current.valid_rows]
      : [...new Set(rowNumbers)].filter((row) => current.valid_rows.includes(row));
    if (!rows.length) return;
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
    activate,
  };
}

interface AiQuestionImportWorkflowOptions extends QuestionImportWorkflowOptions {
  readTask: (taskId: string) => Promise<unknown>;
  enabledDifficulties: () => readonly string[];
}

function isAiTask(value: unknown): value is AiQuestionImportTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  return typeof task.task_id === 'string' && task.task_id.length > 0
    && ['queued', 'running', 'completed', 'failed'].includes(String(task.status))
    && ['total_count', 'completed_count', 'generated_count', 'failed_count'].every((key) => (
      typeof task[key] === 'number' && Number.isInteger(task[key]) && Number(task[key]) >= 0
    ))
    && (task.batch_id === undefined || (typeof task.batch_id === 'string' && /^\d+$/.test(task.batch_id)));
}

function isAiPreview(value: unknown, enabledDifficulties: readonly string[]): value is AiQuestionImportPreview {
  if (!isImportPreview(value)) return false;
  const rows = (value as AiQuestionImportPreview).rows;
  return Array.isArray(rows) && rows.every((row) => (
    Number.isInteger(row.row_number) && row.row_number > 0
    && enabledDifficulties.includes(row.difficulty)
    && ['single', 'multiple', 'judgment'].includes(row.type)
    && typeof row.category === 'string'
    && typeof row.stem === 'string' && typeof row.analysis === 'string'
    && Array.isArray(row.options) && row.options.every((option) => (
      !!option && typeof option.key === 'string' && typeof option.text === 'string'
    ))
    && isIntegerArray(row.answer) && Array.isArray(row.errors) && row.errors.every((error) => typeof error === 'string')
  )) && new Set(rows.map((row) => row.row_number)).size === rows.length;
}

/** Polls task metadata only, then hands generated rows to the ordinary commit safety protocol. */
export function useAiQuestionImportWorkflow(options: AiQuestionImportWorkflowOptions) {
  const task = ref<AiQuestionImportTask | null>(null);
  const taskBusy = ref(false);
  const rowBusy = ref(false);
  const pollPaused = ref(false);
  const selectedRows = ref<number[]>([]);
  const difficulty = ref<string>('all');
  let active = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const base = useQuestionImportWorkflow({
    ...options,
    readBatch: async (id) => {
      const response = await options.readBatch(id);
      if (!isImportResult(response) && !isAiPreview(response, options.enabledDifficulties())) throw new Error('invalid AI batch');
      return response;
    },
  });
  const preview = computed(() => base.preview.value as AiQuestionImportPreview | null);
  const generating = computed(() => !!task.value && ['queued', 'running'].includes(task.value.status));
  const dirty = computed(() => base.dirty.value || generating.value);
  const interactionLocked = computed(() => base.interactionLocked.value || generating.value || taskBusy.value || rowBusy.value);
  const canReset = computed(() => dirty.value && !taskBusy.value && !rowBusy.value
    && !base.commitBusy.value && !base.statusBusy.value && !base.commitUnknown.value);
  const visibleRows = computed(() => (preview.value?.rows || []).filter((row) => (
    difficulty.value === 'all' || row.difficulty === difficulty.value
  )));

  function clearPoll() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function current(token: number) { return active && token === generation; }

  function selectable(row: AiQuestionImportRow) {
    return options.enabledDifficulties().includes(row.difficulty) && !!preview.value?.valid_rows.includes(row.row_number)
      && !preview.value.duplicates.includes(row.row_number) && row.errors.length === 0;
  }

  function selectValidRows(preserve = false) {
    const valid = (preview.value?.rows || []).filter(selectable).map((row) => row.row_number);
    selectedRows.value = preserve ? selectedRows.value.filter((row) => valid.includes(row)) : valid;
  }

  function setSelected(rowNumber: number, checked: unknown) {
    if (rowBusy.value || base.commitBusy.value || base.statusBusy.value || base.commitUnknown.value) return;
    const row = preview.value?.rows.find((item) => item.row_number === rowNumber);
    if (!row || !selectable(row)) return;
    selectedRows.value = checked
      ? [...new Set([...selectedRows.value, rowNumber])].sort((left, right) => left - right)
      : selectedRows.value.filter((item) => item !== rowNumber);
  }

  function schedulePoll(token: number) {
    clearPoll();
    if (current(token) && generating.value) timer = setTimeout(() => { void queryTaskStatus(); }, 1000);
  }

  async function acceptTask(response: unknown, token: number) {
    if (!current(token)) return;
    if (!isAiTask(response) || (task.value && response.task_id !== task.value.task_id)) {
      pollPaused.value = true;
      options.onWarning('生成任务响应无法验证，请查询任务状态');
      return;
    }
    task.value = response;
    pollPaused.value = false;
    if (response.status === 'completed') {
      if (!response.batch_id) {
        options.onWarning('生成任务未返回预览批次，请重新上传参考文件');
        return;
      }
      await base.loadPreview(async () => {
        const batch = await options.readBatch(response.batch_id!);
        if (!isAiPreview(batch, options.enabledDifficulties()) || batch.batch_id !== response.batch_id) throw new Error('invalid AI preview');
        return batch;
      });
      if (current(token)) selectValidRows();
    } else if (response.status === 'failed') {
      options.onWarning(response.message || '生成失败，请重新上传参考文件');
    } else {
      schedulePoll(token);
    }
  }

  async function startTask(request: () => Promise<unknown>) {
    if (!active || interactionLocked.value) return;
    clearPoll();
    const token = ++generation;
    task.value = null;
    selectedRows.value = [];
    difficulty.value = 'all';
    taskBusy.value = true;
    try { await acceptTask(await request(), token); }
    catch { /* HTTP layer presents upload errors; no reference file is retained. */ }
    finally { if (current(token)) taskBusy.value = false; }
  }

  async function queryTaskStatus() {
    const id = task.value?.task_id;
    if (!active || !id || taskBusy.value || preview.value) return;
    clearPoll();
    const token = generation;
    taskBusy.value = true;
    try { await acceptTask(await options.readTask(id), token); }
    catch (error) {
      if (!current(token)) return;
      pollPaused.value = true;
      if (isDefiniteBusinessRejection(error)) task.value = { ...task.value!, status: 'failed', message: '任务不可用，请重新上传参考文件' };
      options.onWarning('暂时无法确认生成任务，请查询任务状态或重新上传');
    } finally { if (current(token)) taskBusy.value = false; }
  }

  async function updateRow(rowNumber: number, request: () => Promise<unknown>): Promise<boolean> {
    if (!active || !preview.value || rowBusy.value || base.commitBusy.value || base.statusBusy.value || base.commitUnknown.value) return false;
    if (!preview.value.rows.some((row) => row.row_number === rowNumber)) return false;
    const token = generation;
    const id = preview.value.batch_id;
    rowBusy.value = true;
    try {
      const response = await request();
      if (!current(token) || preview.value?.batch_id !== id) return false;
      if (!isAiPreview(response, options.enabledDifficulties()) || response.batch_id !== id) {
        base.commitUnknown.value = true;
        options.onWarning('生成题响应无法验证，请重新查询批次');
        return false;
      }
      base.preview.value = response;
      selectValidRows(true);
      return true;
    } catch (error) {
      if (current(token) && preview.value?.batch_id === id && !isDefiniteBusinessRejection(error)) {
        base.commitUnknown.value = true;
        options.onWarning('生成题修改结果未确认，请先查询原批次状态；系统不会重复修改或确认导入');
      }
      return false;
    }
    finally { if (current(token)) rowBusy.value = false; }
  }

  async function commitImport() {
    if (rowBusy.value || !preview.value || !options.enabledDifficulties().length
      || !isAiPreview(preview.value, options.enabledDifficulties())) return;
    selectValidRows(true);
    await base.commitImport([...selectedRows.value]);
  }

  async function queryBatchStatus() {
    await base.queryBatchStatus();
    selectValidRows(true);
  }

  function discard() {
    clearPoll();
    generation += 1;
    task.value = null;
    taskBusy.value = false;
    rowBusy.value = false;
    pollPaused.value = false;
    selectedRows.value = [];
    base.discard();
  }

  function deactivate() {
    clearPoll();
    if (rowBusy.value && preview.value) base.commitUnknown.value = true;
    active = false;
    generation += 1;
    taskBusy.value = false;
    rowBusy.value = false;
    base.deactivate();
  }

  function activate() {
    active = true;
    base.activate();
    if (generating.value) schedulePoll(generation);
  }

  return {
    ...base, preview, task, taskBusy, rowBusy, pollPaused, selectedRows, difficulty, visibleRows,
    generating, dirty, interactionLocked, canReset, selectable, setSelected, startTask, queryTaskStatus,
    updateRow, commitImport, queryBatchStatus, discard, deactivate, activate,
  };
}
