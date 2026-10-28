import type { AttemptLimitKind, ExamPurpose } from '../../common/training-contracts';

/** Old rows/fixtures predate the purpose column and retain formal behavior. */
export function examPurposeOf(purpose: string | null | undefined): ExamPurpose {
  return purpose === 'practice' ? 'practice' : 'formal';
}

export function resolveAttemptLimit(purpose: ExamPurpose, maxAttempts: number | null | undefined):
{ kind: AttemptLimitKind; maxAttempts: number | null } {
  if (purpose === 'practice') return { kind: 'unlimited', maxAttempts: null };
  if (typeof maxAttempts === 'number' && Number.isSafeInteger(maxAttempts) && maxAttempts > 0) {
    return { kind: 'limited', maxAttempts };
  }
  return { kind: 'unknown', maxAttempts: null };
}
