import { describe, expect, it } from 'vitest';
import { resolvePaperSaveCompletion } from '../../web/src/utils/paper-editor-state';

describe('paper editor save state', () => {
  it('commits the submitted snapshot without overwriting edits made while the request was in flight', () => {
    const submitted = { title: '提交时标题', rules: [{ type: 'single', count: 1, score_cents: 10000 }] };
    const current = { title: '请求期间的新标题', rules: [{ type: 'single', count: 1, score_cents: 10000 }] };

    const result = resolvePaperSaveCompletion({
      current,
      previousBaseline: { title: '旧标题', rules: [] },
      previousAppliedOperation: 0,
      submitted,
      operation: 1,
    });

    expect(result.baseline).toEqual(submitted);
    expect(result.current).toEqual(current);
    expect(result.dirty).toBe(true);
    expect(result.appliedOperation).toBe(1);
  });

  it('ignores an older response after a newer save response already advanced the baseline', () => {
    const current = { title: '最新草稿', rules: [] };
    const previousBaseline = { title: '较新已保存', rules: [] };

    const result = resolvePaperSaveCompletion({
      current,
      previousBaseline,
      previousAppliedOperation: 3,
      submitted: { title: '过时提交', rules: [] },
      operation: 2,
    });

    expect(result.baseline).toEqual(previousBaseline);
    expect(result.current).toEqual(current);
    expect(result.dirty).toBe(true);
    expect(result.appliedOperation).toBe(3);
  });
});
