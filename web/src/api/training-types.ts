/** HTTP mirror of server/src/common/training-contracts.ts (snake_case). */
export type Id = string;
export type LearnerSource = 'institution' | 'external';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ExamDifficulty = Difficulty | 'mixed' | 'unknown';
export type QuestionType = 'single' | 'multiple' | 'judgment' | 'image';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface PoolRule {
  type: QuestionType;
  count: number;
  scoreCents: number;
}

export interface RuleSnapshot {
  totalCents: 10000;
  passCents: number;
  durationMinutes: number;
  maxAttempts: number;
  partialCreditRatio: number;
  rules: PoolRule[];
}

export interface AnswerInput {
  item_id: Id;
  selected?: number[];
  asset_ids?: Id[];
}

export interface DraftInput {
  revision: number;
  answers: AnswerInput[];
}

export interface DraftAck {
  revision: number;
  saved_at: string;
  answered_count: number;
}

export type GradeState = 'not_submitted' | 'pending_manual' | 'finalized';
export type SubmissionMethod = 'manual' | 'timeout';

export interface TrainingCategory {
  id: Id;
  name: string;
  description: string | null;
  status: number;
  created_by: Id;
  created_at: string;
  updated_at: string;
}

export interface ImportPreview {
  batch_id: Id;
  valid_rows: number[];
  errors: Array<{ row: number; message: string }>;
  duplicates: number[];
}

export interface ImportResult {
  batch_id: Id;
  created_ids: Id[];
  committed_rows: number[];
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface AttemptQuestion {
  item_id: Id;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  score: number;
}

export interface AttemptView {
  record_id: Id;
  paper_id: Id;
  release_id: Id | null;
  source: LearnerSource | null;
  category_id: Id | null;
  difficulty: ExamDifficulty;
  deadline_at: string;
  server_now: string;
  draft_revision: number;
  questions: AttemptQuestion[];
  answers: AnswerInput[];
}

export interface FinalResultItem extends AttemptQuestion {
  answer: AnswerInput | null;
  gained_score: number | null;
  comment: string | null;
  grading_version: number;
}

export interface FinalResult {
  record_id: Id;
  grading_state: GradeState;
  grading_revision: number;
  submission_method: SubmissionMethod;
  submitted_at: string;
  graded_at: string | null;
  score: number | null;
  passed: boolean | null;
  correct_rate: number | null;
  items: FinalResultItem[];
}
