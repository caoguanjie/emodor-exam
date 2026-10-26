import { Errors } from '../../common/errors';

/** DECIMAL(5,2) in exam_paper and paper_question; internal units are integer hundredths. */
export const MAX_PAPER_SCORE_CENTS = 99999;

export function paperScoreCents(value: string | number | undefined, label: string, fallback?: number): number {
  const score = value === undefined ? fallback : Number(value);
  const raw = Number(score) * 100;
  const cents = Math.round(raw);
  if (!Number.isFinite(raw) || Math.abs(raw - cents) > 0.000001 || cents < 1 || cents > MAX_PAPER_SCORE_CENTS) {
    throw Errors.paperRuleInvalid(`${label}须为 0.01～999.99 分，最多两位小数`);
  }
  return cents;
}

export function paperScoreRule(totalScore?: string | number, passScore?: string | number) {
  const totalCents = paperScoreCents(totalScore, '试卷总分', 100);
  const passCents = paperScoreCents(passScore, '及格分数', 60);
  if (passCents > totalCents) throw Errors.paperRuleInvalid('及格分数不能超过试卷总分');
  return { totalCents, passCents };
}
