import { Errors } from '../../common/errors';
import { parseQuestionContent } from '../questions/question-content-dispatch';

/** A rendering capability only; authentication and business authorization stay separate. */
export function readContentCapability(header: unknown): 2 | 3 {
  if (header === undefined || header === '2') return 2;
  if (header === '3') return 3;
  throw Errors.param('X-Question-Content-Version 只允许 2 或 3');
}

export function assertContentCapability(required: 2 | 3, available: 2 | 3): void {
  if (required > available) {
    throw Errors.notEligible('请更新学员端后再打开此试卷', {
      reason_code: 'CONTENT_VERSION_REQUIRED', required_content_version: 3,
    });
  }
}

export function requiredContentCapability(questions: readonly unknown[]): 2 | 3 {
  let required: 2 | 3 = 2;
  // Validate every item before the caller makes any persistent change.
  for (const question of questions) if (parseQuestionContent(question).schema === 3) required = 3;
  return required;
}
