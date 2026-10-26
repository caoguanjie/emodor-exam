import { describe, expect, it, vi } from 'vitest';
import { useAiQuestionImportWorkflow } from '../question-import-workflow';

describe('AI import without question scores', () => {
  it('loads, edits and commits scoreless generated rows by server row number', async () => {
    const batch = { batch_id: '301', valid_rows: [2], errors: [], duplicates: [], rows: [{ row_number: 2,
      category: '7', type: 'single', difficulty: 'easy', concept: '', stem: '生成题',
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0], analysis: '', errors: [] }] };
    const commitBatch = vi.fn().mockResolvedValue({ batch_id: '301', created_ids: ['40'], committed_rows: [2] });
    const onCommitted = vi.fn();
    const workflow = useAiQuestionImportWorkflow({ readBatch: async () => batch, readTask: vi.fn(), commitBatch,
      enabledDifficulties: () => ['easy', 'hard'], onCommitted, onWarning: vi.fn() });
    try {
      await workflow.loadPreview(async () => batch);
      await workflow.queryBatchStatus();
      expect(workflow.preview.value?.rows[0]?.stem).toBe('生成题');
      const edited = { ...batch, rows: [{ ...batch.rows[0]!, stem: '已校对生成题' }] };
      expect(await workflow.updateRow(2, async () => edited)).toBe(true);
      expect(workflow.visibleRows.value[0]?.stem).toBe('已校对生成题');
      workflow.setSelected(2, true);
      await workflow.commitImport();
      expect(commitBatch).toHaveBeenCalledWith('301', [2]);
      expect(onCommitted).toHaveBeenCalledWith({ batch_id: '301', created_ids: ['40'], committed_rows: [2] });
    } finally { workflow.discard(); }
  });
});
