/** Read-only comparison of saved answers; never recalculates awarded points. */
export function answerFeedback(selectedIds: readonly string[], correctIds: readonly string[]) {
  const selected = new Set(selectedIds);
  const correct = new Set(correctIds);
  const status = !selected.size ? '未作答' : !correct.size ? '答案缺失'
    : [...selected].some(id => !correct.has(id)) ? '答错'
    : [...correct].some(id => !selected.has(id)) ? '漏选' : '答对';
  return {
    status,
    option(id: string): 'correct' | 'wrong' | 'missed' | '' {
      if (!selected.size || !correct.size) return '';
      if (selected.has(id) && !correct.has(id)) return 'wrong';
      if (correct.has(id)) return status === '漏选' && !selected.has(id) ? 'missed' : 'correct';
      return '';
    },
  };
}
