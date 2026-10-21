import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Errors } from '../../common/errors';
import type { Difficulty, PoolRule, QuestionType } from '../../common/training-contracts';
import type { QuestionVersionSnapshot } from '../questions/question-version.service';

export interface RandomSource {
  nextInt(maxExclusive: number): number;
}

export type SelectedQuestion = QuestionVersionSnapshot & { scoreCents: number };

export class CryptoRandomSource implements RandomSource {
  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw Errors.param('随机数上界必须是正整数');
    }
    return randomInt(maxExclusive);
  }
}

function poolKey(item: QuestionVersionSnapshot): string {
  return item.conceptId ? `concept:${item.conceptId}` : `question:${item.questionId}`;
}

function cloneSelected(item: QuestionVersionSnapshot, scoreCents: number): SelectedQuestion {
  return {
    ...item,
    options: item.options.map((option) => ({ ...option })),
    answer: [...item.answer],
    scoreCents,
  };
}

@Injectable()
export class SamplingService {
  validatePool(
    pool: QuestionVersionSnapshot[],
    rules: PoolRule[],
    difficulty: Difficulty,
  ): { ok: boolean; deficits: { type: QuestionType; required: number; available: number }[] } {
    const requiredByType = new Map<QuestionType, number>();
    for (const rule of rules) {
      requiredByType.set(rule.type, (requiredByType.get(rule.type) || 0) + rule.count);
    }
    const deficits: { type: QuestionType; required: number; available: number }[] = [];
    for (const [type, required] of requiredByType) {
      const available = new Set(
        pool
          .filter((item) => item.type === type && item.difficulty === difficulty)
          .map(poolKey),
      ).size;
      if (available < required) deficits.push({ type, required, available });
    }
    return { ok: deficits.length === 0, deficits };
  }

  draw(
    pool: QuestionVersionSnapshot[],
    rules: PoolRule[],
    difficulty: Difficulty,
    rng: RandomSource = new CryptoRandomSource(),
  ): SelectedQuestion[] {
    const totalCents = rules.reduce((total, rule) => total + rule.count * rule.scoreCents, 0);
    if (totalCents !== 10000) throw Errors.paperRuleInvalid(`题型规则总分必须为 10000 分，当前为 ${totalCents}`);
    const validation = this.validatePool(pool, rules, difficulty);
    if (!validation.ok) throw Errors.paperPoolInsufficient(validation.deficits);

    const selected: SelectedQuestion[] = [];
    const used = new Set<string>();
    for (const rule of rules) {
      const grouped = new Map<string, QuestionVersionSnapshot[]>();
      for (const item of pool) {
        if (item.type !== rule.type || item.difficulty !== difficulty) continue;
        const key = poolKey(item);
        if (used.has(key)) continue;
        const variants = grouped.get(key) || [];
        variants.push(item);
        grouped.set(key, variants);
      }
      const groups = [...grouped.entries()];
      for (let index = groups.length - 1; index > 0; index -= 1) {
        const swapWith = rng.nextInt(index + 1);
        [groups[index], groups[swapWith]] = [groups[swapWith], groups[index]];
      }
      for (const [key, variants] of groups.slice(0, rule.count)) {
        const variant = variants[rng.nextInt(variants.length)];
        used.add(key);
        selected.push(cloneSelected(variant, rule.scoreCents));
      }
    }
    return selected;
  }
}
