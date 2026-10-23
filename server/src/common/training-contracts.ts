/**
 * Cross-module training/exam contracts (A1 baseline).
 * HTTP fields remain snake_case; services may adapt them to camelCase at the
 * boundary. IDs stay strings so BIGINT values never pass through Number.
 */
import type { ReadonlyRichDocV3 } from './question-content-v3';

export type Id = string;
export type LearnerSource = 'institution' | 'external';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ExamDifficulty = Difficulty | 'mixed' | 'unknown';
export type QuestionType = 'single' | 'multiple' | 'judgment';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type CourseStatus = 'draft' | 'published' | 'offline';

export interface CourseSummary {
  id: Id;
  title: string;
  category_id: Id;
  cover_asset_id: Id | null;
  status: CourseStatus;
  required_lesson_count: number;
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

export type GradeState = 'not_submitted' | 'finalized';
export type SubmissionMethod = 'manual' | 'timeout';

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

export interface ReadonlyTiptapNode {
  type: 'doc' | 'paragraph' | 'text' | 'hardBreak' | 'image';
  text?: string;
  content?: ReadonlyTiptapNode[];
  attrs?: { asset_id: string };
}
export interface ReadonlyTiptapDoc extends ReadonlyTiptapNode { type: 'doc'; content: ReadonlyTiptapNode[] }
export interface QuestionContentV2 {
  stem: ReadonlyTiptapDoc;
  options: Array<{ id: string; content: ReadonlyTiptapDoc }>;
  analysis: ReadonlyTiptapDoc | null;
  answer_option_ids: string[];
}
export interface SubmitAttemptRequest { record_id: string; answers: Array<{ item_id: string; option_ids: string[] }> }

export interface AttemptQuestion<Capability extends 2 | 3 = 2> {
  /** Present only for clients advertising content capability 3. */
  content_schema_version?: 2 | 3;
  item_id: Id;
  type: QuestionType;
  stem: Capability extends 2 ? ReadonlyTiptapDoc : ReadonlyTiptapDoc | ReadonlyRichDocV3;
  options: Array<{ id: string; content: Capability extends 2 ? ReadonlyTiptapDoc : ReadonlyTiptapDoc | ReadonlyRichDocV3 }>;
  score: number;
}

export interface AttemptView<Capability extends 2 | 3 = 2> {
  status: 'in_progress' | 'submitted' | 'passed' | 'failed' | 'timeout';
  record_id: Id;
  paper_id: Id;
  release_id: Id | null;
  deadline_at: string;
  server_now: string;
  questions: AttemptQuestion<Capability>[];
}

export interface FinalResultItem extends AttemptQuestion<2 | 3> {
  selected_option_ids: string[];
  correct_option_ids: string[];
  analysis: ReadonlyTiptapDoc | ReadonlyRichDocV3 | null;
  gained_score: number;
}

export interface FinalResult {
  status: 'submitted' | 'passed' | 'failed' | 'timeout';
  record_id: Id;
  grading_state: GradeState;
  submission_method: SubmissionMethod | null;
  legacy: boolean;
  submitted_at: string | null;
  graded_at: string | null;
  score: number | null;
  passed: boolean | null;
  correct_rate: number | null;
  items: FinalResultItem[];
}

export interface ExamHistoryItem {
  record_id: Id;
  paper_id: Id;
  paper_title: string | null;
  attempt_no: number;
  status: string;
  grading_state: GradeState;
  submission_method: SubmissionMethod | null;
  legacy: boolean;
  source: LearnerSource | null;
  difficulty: ExamDifficulty;
  score: number | null;
  started_at: string;
  submitted_at: string | null;
  graded_at: string | null;
}

export interface WrongItem extends FinalResultItem {
  legacy: boolean;
  record_id: Id;
  submitted_at: string;
}

export interface StatsFilter {
  paperId: Id;
  categoryId?: Id;
  source?: LearnerSource;
  difficulty?: ExamDifficulty;
  page: number;
  pageSize: number;
}

export interface ScoreDistributionBucket {
  lower: number;
  upper: number;
  count: number;
}

export interface ScoreGroup {
  difficulty: ExamDifficulty;
  finalized_users: number;
  average_score: number | null;
  pass_rate: number | null;
  distribution: ScoreDistributionBucket[];
}

export interface TrainingCourseCompletion {
  eligible_users: number;
  required_lessons: number;
  completed_users: number;
  completion_rate: number | null;
}

export type TrainingUncompletedReason = 'learning_incomplete' | 'not_started' | 'not_passed';

export interface TrainingExamSummary {
  release_id: Id | null;
  eligible_count: number;
  eligible_started_count: number;
  historical_started_count: number;
  historical_only_started_count: number;
  submitted_attempts: number;
  submitted_users: number;
  finalized_users: number;
  participation_rate: number | null;
  score_groups: ScoreGroup[];
  difficulty_composition: Array<{ difficulty: ExamDifficulty; users: number }>;
  course_completion: TrainingCourseCompletion;
  uncompleted_reasons: Array<{ reason: TrainingUncompletedReason; users: number }>;
  as_of: string;
}

export interface RankRow {
  rank: number;
  user_id: Id;
  name: string;
  source: LearnerSource | null;
  difficulty: ExamDifficulty;
  score: number;
  duration_seconds: number;
  record_id: Id;
}

export interface TrainingStatisticsOptions {
  papers: Array<{ id: Id; title: string; category_id: Id | null; status: string }>;
  categories: Array<{ id: Id; name: string }>;
}

export interface AdminDashboard {
  as_of: string;
  timezone: 'Asia/Shanghai';
  metrics: {
    learner_count?: number;
    question_count?: number;
    paper_count?: number;
  };
  exam_trend?: Array<{ date: string; count: number }>;
}

export const TRAINING_DEFAULTS = Object.freeze({
  totalCents: 10000,
  passCents: 6000,
  durationMinutes: 30,
  maxAttempts: 3,
  partialCreditRatio: 0.5,
  pageSize: 20,
  maxPageSize: 100,
  videoHeartbeatSeconds: 30,
  videoHeartbeatCapSeconds: 45,
  videoPositionToleranceSeconds: 2,
  videoCompletionPercent: 95,
});
