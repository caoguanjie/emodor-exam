import { Errors } from './errors';
import type { Difficulty, LearnerSource } from './training-contracts';

export type ActiveDifficulty = 'easy' | 'hard';
export interface DifficultyOption {
  readonly code: Difficulty;
  readonly label: string;
  readonly enabled: boolean;
  readonly sort: number;
}

/** Build every decision from one catalog; historical readers do not use this policy. */
export function createDifficultyPolicy<Active extends Difficulty>(options: readonly DifficultyOption[]) {
  const catalog = Object.freeze(options.map((option) => Object.freeze({ ...option })).sort((a, b) => a.sort - b.sort));
  function difficultyCatalog(): readonly DifficultyOption[] { return catalog; }
  function activeDifficulties(): Active[] { return catalog.filter((option) => option.enabled).map((option) => option.code as Active); }
  function assertActiveDifficulty(value: unknown): asserts value is Active {
    if (!catalog.some((option) => option.enabled && option.code === value)) {
      throw Errors.param(`难度 ${String(value ?? 'unknown')} 未启用，请选择${catalog.filter((option) => option.enabled).map((option) => `${option.label}（${option.code}）`).join(' / ')}`);
    }
  }
  function difficultyForSource(source: LearnerSource | null): Active {
    if (source !== 'institution' && source !== 'external') throw Errors.param('学员来源未配置，不能开考');
    const value = source === 'institution' ? 'easy' : 'hard';
    assertActiveDifficulty(value);
    return value;
  }
  return { difficultyCatalog, activeDifficulties, assertActiveDifficulty, difficultyForSource };
}

const policy = createDifficultyPolicy<ActiveDifficulty>([
  { code: 'easy', label: '简单', enabled: true, sort: 10 },
  { code: 'medium', label: '中级', enabled: false, sort: 20 },
  { code: 'hard', label: '困难', enabled: true, sort: 30 },
]);

export const difficultyCatalog = policy.difficultyCatalog;
export const activeDifficulties = policy.activeDifficulties;
export const assertActiveDifficulty: (value: unknown) => asserts value is ActiveDifficulty = policy.assertActiveDifficulty;
export const difficultyForSource = policy.difficultyForSource;
