import type { Difficulty } from '../../common/training-contracts';

const DIFFICULTY_RULES: Record<Difficulty, string> = {
  easy: '初级（easy）：只考制度中直接、明确的一条规则，题干不得设置复合情境。',
  medium: '中级（medium）：要求在单一工作情境中直接应用制度规则，仍应有清晰唯一结论。',
  hard: '高级（hard）：要求结合多条规则综合应用后作答，但必须严格有据、结论明确且无歧义。',
};

export function questionDifficultyContract(difficulty: Difficulty): string {
  return `目标难度：${DIFFICULTY_RULES[difficulty]} 难度由请求固定，输出中不得自行改写或降级。`;
}

export function questionJsonContract(type: 'batch' | 'single' | 'multiple' = 'batch'): string {
  const typeRule = type === 'single'
    ? 'type 必须为 single，answer 必须恰好含 1 个下标。'
    : type === 'multiple'
      ? 'type 必须为 multiple，answer 必须含 2~3 个升序且不重复下标。'
      : 'type 只能为 single 或 multiple；single 的 answer 恰好 1 个下标，multiple 的 answer 含 2~3 个升序且不重复下标。';
  return `仅输出一个 JSON 数组，不要 markdown 或解释。数组每项必须完整符合：\n`
    + `{"type":"${type === 'batch' ? 'single 或 multiple' : type}","stem":"非空题干","options":[{"key":"A","text":"选项A"},{"key":"B","text":"选项B"},{"key":"C","text":"选项C"},{"key":"D","text":"选项D"}],"answer":[0],"analysis":"非空解析"}\n`
    + `每题 options 恰好 4 个选项，answer 只能使用 0~3 下标。${typeRule}`;
}
