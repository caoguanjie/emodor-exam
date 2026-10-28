import type { PaperRuleInput } from '../api/training-types';

export function defaultRandomRules(): PaperRuleInput[] {
  return [
    { type: 'single', count: 100, score_cents: 100 },
    { type: 'multiple', count: 0, score_cents: 100 },
    { type: 'judgment', count: 0, score_cents: 100 },
  ];
}

export function selectedRandomRules(rules: PaperRuleInput[]): PaperRuleInput[] {
  return rules.filter(rule => rule.count > 0).map(rule => ({ ...rule }));
}

export function summarizeRandomRules(rules: PaperRuleInput[]): { count: number; scoreCents: number } {
  return rules.reduce((sum, rule) => ({
    count: sum.count + (Number.isFinite(rule.count) ? rule.count : 0),
    scoreCents: sum.scoreCents + (Number.isFinite(rule.count * rule.score_cents) ? rule.count * rule.score_cents : 0),
  }), { count: 0, scoreCents: 0 });
}

export function validateRandomRules(rules: PaperRuleInput[], totalScore: number): string | null {
  if (!Number.isFinite(totalScore) || totalScore <= 0 || totalScore > 999.99
    || Math.abs(totalScore * 100 - Math.round(totalScore * 100)) > 1e-7) {
    return '试卷总分须为 0.01～999.99 分，最多两位小数';
  }
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!['single', 'multiple', 'judgment'].includes(rule.type) || seen.has(rule.type)) return '题型仅支持单选、多选和判断，且不可重复';
    seen.add(rule.type);
    if (!Number.isInteger(rule.count) || rule.count < 0 || rule.count > 500) return '每种题型题数须为 0–500 的整数，0 表示不选';
    if (rule.count > 0 && (!Number.isInteger(rule.score_cents) || rule.score_cents < 1 || rule.score_cents > 99999)) return '每题分数须为 0.01～999.99 分，最多两位小数';
  }
  const summary = summarizeRandomRules(rules);
  if (summary.count <= 0) return '请至少配置一道题';
  if (summary.scoreCents !== Math.round(totalScore * 100)) return '题型分值合计必须等于试卷总分';
  return null;
}
