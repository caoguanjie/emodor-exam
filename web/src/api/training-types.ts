/** HTTP mirror of server/src/common/training-contracts.ts (snake_case). */
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

export interface LessonVersionView {
  version_id: Id;
  asset_id: Id;
  duration_ms: number;
}

export interface CourseLessonView {
  id: Id;
  title: string;
  lesson_type: 'video';
  required: boolean;
  sort_order: number;
  current_version: LessonVersionView | null;
}

export interface CourseChapterView {
  id: Id;
  title: string;
  sort_order: number;
  lessons: CourseLessonView[];
}

export interface CourseDetail extends CourseSummary {
  description: string | null;
  chapters: CourseChapterView[];
  regulation_ids?: Id[];
  is_recommended?: boolean;
  sort_order?: number;
  missing_required_lesson_ids?: Id[];
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
export type ExamRecordStatus = 'in_progress' | 'submitted' | 'passed' | 'failed' | 'timeout';

export interface ExamRecordSummary {
  record_id: Id;
  paper_id: Id;
  paper_title: string;
  user_id: Id;
  username: string;
  name: string;
  source: LearnerSource | null;
  category_id: Id | null;
  difficulty: ExamDifficulty | null;
  release_id: Id | null;
  attempt_no: number;
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  answered_count: number;
  total_count: number;
  status: ExamRecordStatus;
  grading_state: GradeState;
  submission_method: SubmissionMethod | null;
  score: number | null;
}

export type ExamRecordDetail = ExamRecordSummary;

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

export interface AiQuestionImportTask {
  task_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total_count: number;
  completed_count: number;
  generated_count: number;
  failed_count: number;
  batch_id?: Id;
  message?: string;
}

/** Only generated questions are exposed here; reference rows never enter this view. */
export interface AiQuestionImportRow {
  row_number: number;
  category: Id;
  type: QuestionType;
  difficulty: 'easy' | 'hard';
  concept: Id | '';
  stem: string;
  options: QuestionOption[];
  answer: number[];
  analysis: string;
  score: string;
  errors: string[];
}

export interface AiQuestionImportPreview extends ImportPreview {
  rows: AiQuestionImportRow[];
}

export type AiQuestionImportEdit = Pick<AiQuestionImportRow, 'stem' | 'options' | 'answer' | 'analysis'>;

export interface QuestionOption {
  key: string;
  text: string;
}

export type QuestionSource = 'ai' | 'manual' | 'import';

export interface QuestionDraftPayload {
  category_id: Id;
  difficulty: Difficulty | '';
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: number[];
  analysis: string | null;
  score: number;
  concept_id?: Id | null;
}

export interface QuestionView extends Omit<QuestionDraftPayload, 'category_id' | 'difficulty'> {
  id: number;
  question_id: Id;
  category_id: Id | null;
  difficulty: Difficulty | null;
  current_version_id: Id | null;
  revision: number | null;
  status: 'pending' | 'approved' | 'rejected';
  source: QuestionSource;
  approved_by: Id | null;
  approved_at: string | null;
  reviewed_by: Id | null;
  reviewed_at: string | null;
  review_reason: string | null;
  legacy_captured_at: string | null;
  regulation_id?: Id | null;
  regulation_version_id?: Id | null;
}

export function questionDraftFromView(row: Pick<QuestionView,
  'category_id' | 'difficulty' | 'type' | 'stem' | 'options' | 'answer' | 'analysis' | 'score' | 'concept_id'>): QuestionDraftPayload {
  return {
    category_id: row.category_id || '',
    difficulty: row.difficulty || '',
    type: row.type,
    stem: row.stem,
    options: JSON.parse(JSON.stringify(row.options || [])),
    answer: [...(row.answer || [])],
    analysis: row.analysis ?? null,
    score: Number(row.score),
    concept_id: row.concept_id || undefined,
  };
}

const QUESTION_RICH_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'br',
  'blockquote', 'span', 'a', 'img', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);
const DROP_CONTENT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math']);
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

function escapeQuestionText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function inertQuestionFragment(html: string): DocumentFragment | null {
  if (typeof document === 'undefined') return null;
  // HTMLTemplateElement parses into a detached template document. Scripts do
  // not execute and remote img/iframe resources are not attached or fetched.
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function safeQuestionLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function appendSanitizedQuestionNode(source: ChildNode, target: Node): void {
  if (source.nodeType === 3) {
    target.appendChild(document.createTextNode(source.nodeValue || ''));
    return;
  }
  if (source.nodeType !== 1) return;

  const element = source as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (element.namespaceURI && element.namespaceURI !== HTML_NAMESPACE) return;
  if (DROP_CONTENT_TAGS.has(tag)) return;
  if (!QUESTION_RICH_TAGS.has(tag)) {
    for (const child of Array.from(element.childNodes)) appendSanitizedQuestionNode(child, target);
    return;
  }

  if (tag === 'img') {
    const mediaId = element.getAttribute('data-media-id') || '';
    if (!/^[1-9]\d*$/.test(mediaId)) return;
    const cleanImage = document.createElement('img');
    cleanImage.setAttribute('data-media-id', mediaId);
    const alt = element.getAttribute('alt');
    if (alt) cleanImage.setAttribute('alt', alt);
    target.appendChild(cleanImage);
    return;
  }

  const cleanElement = document.createElement(tag);
  if (tag === 'a') {
    const href = safeQuestionLink(element.getAttribute('href'));
    if (href) {
      cleanElement.setAttribute('href', href);
      cleanElement.setAttribute('rel', 'noopener noreferrer');
    }
  } else if (tag === 'td' || tag === 'th') {
    for (const attribute of ['colspan', 'rowspan']) {
      const value = element.getAttribute(attribute) || '';
      if (/^[1-9]\d*$/.test(value)) cleanElement.setAttribute(attribute, value);
    }
  }
  for (const child of Array.from(element.childNodes)) appendSanitizedQuestionNode(child, cleanElement);
  target.appendChild(cleanElement);
}

/** Browser-side display boundary for legacy rows and unsaved preview content. */
export function sanitizeQuestionHtmlForPreview(value: string | null | undefined): string {
  const html = String(value || '');
  if (!html) return '';
  const source = inertQuestionFragment(html);
  if (!source) return escapeQuestionText(html);

  const output = document.createElement('template');
  for (const child of Array.from(source.childNodes)) appendSanitizedQuestionNode(child, output.content);
  return output.innerHTML;
}

/** Plain-text list summary; parses inertly and never assigns untrusted HTML to a live element. */
export function questionRichTextToPlainText(value: string | null | undefined): string {
  const html = String(value || '');
  if (!html) return '';
  const source = inertQuestionFragment(html);
  if (!source) return html;

  const parts: string[] = [];
  const visit = (node: ChildNode) => {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue || '');
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if ((element.namespaceURI && element.namespaceURI !== HTML_NAMESPACE) || DROP_CONTENT_TAGS.has(tag)) return;
    if (tag === 'img') {
      const mediaId = element.getAttribute('data-media-id') || '';
      if (/^[1-9]\d*$/.test(mediaId)) parts.push(element.getAttribute('alt') || '[图片]');
      return;
    }
    if (tag === 'br') parts.push(' ');
    for (const child of Array.from(element.childNodes)) visit(child);
    if (['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote', 'tr'].includes(tag)) parts.push(' ');
  };
  for (const child of Array.from(source.childNodes)) visit(child);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export interface QuestionConcept {
  id: Id;
  category_id: Id;
  type: QuestionType;
  name: string;
}

export type PaperMode = 'fixed' | 'random';
export type TrainingPaperStatus = 'draft' | 'published' | 'withdrawn' | 'archived';

export interface PaperRuleInput {
  type: QuestionType;
  count: number;
  score_cents: number;
}

export interface TrainingPaperSummary {
  id: Id;
  title: string;
  business_scope: 'training';
  mode: PaperMode;
  category_id: Id;
  requires_learning: boolean;
  regulation_ids: Id[];
  course_ids: Id[];
  rules: PaperRuleInput[];
  total_score: number;
  pass_score: number;
  duration_minutes: number;
  max_attempts: number;
  partial_credit_ratio: number;
  status: TrainingPaperStatus;
  created_at?: string;
  updated_at?: string;
}

export interface TrainingPaperQuestion {
  paper_question_id?: Id;
  question_id: Id;
  question_version_id: Id;
  sort: number;
  score_cents: number;
  type: QuestionType;
  difficulty: Difficulty;
  concept_id: Id | null;
  regulation_id: Id | null;
  stem: string;
  options: QuestionOption[];
  status?: string;
  source?: QuestionSource;
}

export interface TrainingPaperDetail extends TrainingPaperSummary {
  latest_release_id: Id | null;
  sum_score_cents: number;
  questions: TrainingPaperQuestion[];
}

export interface PaperPreviewQuestion {
  question_id: Id;
  question_version_id: Id;
  type: QuestionType;
  difficulty: Difficulty;
  concept_id: Id | null;
  regulation_id: Id | null;
  stem: string;
  options: QuestionOption[];
  score: number;
  answer?: number[];
  analysis?: string | null;
}

export interface PaperPreview {
  paper_id: Id;
  release_id: Id | null;
  mode: PaperMode;
  sample_kind: 'fixed_paper' | 'random_example';
  note: string;
  difficulty: Difficulty | null;
  rule: {
    total_cents: 10000;
    pass_cents: number;
    duration_minutes: number;
    max_attempts: number;
    partial_credit_ratio: number;
    rules: PaperRuleInput[];
  };
  capacities: Array<{ difficulty: 'easy' | 'hard'; type: QuestionType; required: number; available: number }>;
  questions: PaperPreviewQuestion[];
}

export interface LegacyPaperDetailView {
  id: number;
  regulation_id: string | number;
  title: string;
  status: 'draft' | 'published' | 'archived';
  pass_score: number;
  duration_minutes: number;
  max_attempts: number;
  partial_credit_ratio: number;
  release_id: string | null;
  rules_locked: boolean;
  questions: Array<{
    question_id: string | number;
    type: string;
    stem: string;
    score: number;
    sort: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
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
  correct_answer: number[] | null;
  analysis: string | null;
  gained_score: number | null;
}

export interface FinalResult {
  record_id: Id;
  grading_state: GradeState;
  submission_method: SubmissionMethod | null;
  legacy: boolean;
  submitted_at: string;
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
  record_id: Id;
  submitted_at: string;
}
