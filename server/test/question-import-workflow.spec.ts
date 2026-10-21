import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api/http';
import { useQuestionImportWorkflow } from '../../web/src/utils/question-import-workflow';
import type { ImportPreview, ImportResult } from '../../web/src/api/training-types';

const PREVIEW_A: ImportPreview = { batch_id: '11', valid_rows: [2], errors: [], duplicates: [] };
const PREVIEW_B: ImportPreview = { batch_id: '12', valid_rows: [3], errors: [], duplicates: [] };
const RESULT_A: ImportResult = { batch_id: '11', created_ids: ['101'], committed_rows: [2] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixture(overrides: Partial<Parameters<typeof useQuestionImportWorkflow>[0]> = {}) {
  const committed: ImportResult[] = [];
  const warnings: string[] = [];
  const workflow = useQuestionImportWorkflow({
    commitBatch: async () => RESULT_A,
    readBatch: async () => PREVIEW_A,
    onCommitted: async (result) => { committed.push(result); },
    onWarning: (message) => { warnings.push(message); },
    ...overrides,
  });
  return { workflow, committed, warnings };
}

describe('question import page workflow', () => {
  it.each([0, 502, 504])('keeps batch A unresolved after transport or gateway error code %s', async (code) => {
    const { workflow, committed } = fixture({
      commitBatch: async () => { throw new ApiError(code, 'upstream response unavailable'); },
    });
    await workflow.loadPreview(async () => PREVIEW_A);

    await workflow.commitImport();

    expect(workflow.preview.value).toEqual(PREVIEW_A);
    expect(workflow.commitUnknown.value).toBe(true);
    expect(workflow.canReset.value).toBe(false);
    expect(committed).toEqual([]);
  });

  it('leaves an explicit business rejection retryable without marking the result unknown', async () => {
    const { workflow } = fixture({
      commitBatch: async () => { throw new ApiError(40911, '请重新预检查'); },
    });
    await workflow.loadPreview(async () => PREVIEW_A);

    await workflow.commitImport();

    expect(workflow.preview.value).toEqual(PREVIEW_A);
    expect(workflow.commitUnknown.value).toBe(false);
    expect(workflow.canReset.value).toBe(true);
  });

  it('treats a successful HTTP response without a verifiable ImportResult as unknown', async () => {
    const { workflow } = fixture({ commitBatch: async () => ({ ok: true }) });
    await workflow.loadPreview(async () => PREVIEW_A);

    await workflow.commitImport();

    expect(workflow.preview.value).toEqual(PREVIEW_A);
    expect(workflow.commitUnknown.value).toBe(true);
  });

  it('does not let a delayed status preview for batch A overwrite a newer batch B', async () => {
    const read = deferred<ImportPreview | ImportResult>();
    const { workflow } = fixture({
      commitBatch: async () => { throw new ApiError(0, 'timeout'); },
      readBatch: async () => read.promise,
    });
    await workflow.loadPreview(async () => PREVIEW_A);
    await workflow.commitImport();
    const pending = workflow.queryBatchStatus();

    workflow.discard();
    await workflow.loadPreview(async () => PREVIEW_B);
    read.resolve(PREVIEW_A);
    await pending;

    expect(workflow.preview.value).toEqual(PREVIEW_B);
    expect(workflow.commitUnknown.value).toBe(false);
  });

  it('does not navigate when a delayed committed status for batch A returns after batch B', async () => {
    const read = deferred<ImportPreview | ImportResult>();
    const onCommitted = vi.fn(async () => undefined);
    const { workflow } = fixture({
      commitBatch: async () => { throw new ApiError(0, 'timeout'); },
      readBatch: async () => read.promise,
      onCommitted,
    });
    await workflow.loadPreview(async () => PREVIEW_A);
    await workflow.commitImport();
    const pending = workflow.queryBatchStatus();

    workflow.discard();
    await workflow.loadPreview(async () => PREVIEW_B);
    read.resolve(RESULT_A);
    await pending;

    expect(workflow.preview.value).toEqual(PREVIEW_B);
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it('invalidates an in-flight commit when the page leaves before its response', async () => {
    const commit = deferred<unknown>();
    const onCommitted = vi.fn(async () => undefined);
    const { workflow } = fixture({ commitBatch: async () => commit.promise, onCommitted });
    await workflow.loadPreview(async () => PREVIEW_A);
    const pending = workflow.commitImport();

    workflow.deactivate();
    commit.resolve(RESULT_A);
    await pending;

    expect(onCommitted).not.toHaveBeenCalled();
  });
});
