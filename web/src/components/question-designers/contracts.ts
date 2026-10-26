import type {
  JSONContent,
  QuestionAuthoringDocument,
  DesignerSession,
  DesignerLayoutV1,
} from '../../api/question-document-types';
import type {
  ActiveDifficulty,
  Id,
  QuestionType,
  TrainingPaperSummary,
} from '../../api/training-types';

export type DesignerMode = 'create' | 'edit' | 'readonly';

export interface SaveContext {
  request_id: string;
}

export type SaveOutcome<T> =
  | { status: 'saved'; value: T }
  | { status: 'incomplete'; value: T; message: string; can_abandon: boolean };

export type PaperQuestionBinding =
  | { kind: 'new' }
  | {
    kind: 'bound';
    question_id: Id;
    question_version_id: Id;
    revision: number;
    baseline_fingerprint: string;
    enabled?: boolean;
  };

/** Only existing fixed-paper settings; identity always belongs to the current draft. */
export type DesignerPaper = Pick<TrainingPaperSummary, 'id' | 'title'> & Partial<Pick<
  TrainingPaperSummary,
  | 'category_id' | 'mode' | 'requires_learning' | 'regulation_ids' | 'course_ids'
  | 'required_learning_minutes' | 'remark' | 'sort_order'
  | 'created_by_name' | 'updated_by_name' | 'created_at' | 'updated_at'
  | 'rules' | 'total_score' | 'pass_score' | 'duration_minutes' | 'max_attempts' | 'partial_credit_ratio'
>>;

export interface PaperQuestionSet {
  document: QuestionAuthoringDocument;
  bindings: Record<string, PaperQuestionBinding>;
  session?: DesignerSession;
}

export interface PaperDesignerValue extends PaperQuestionSet {
  paper: DesignerPaper;
  paper_layout?: DesignerLayoutV1;
}

export type SavePaperDraft = (
  value: PaperDesignerValue,
  context: SaveContext & { intent: 'save' },
) => Promise<SaveOutcome<PaperDesignerValue>>;

export interface LibraryPage<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface QuestionLibrarySummary {
  id: Id;
  stem: string;
  type: QuestionType;
  difficulty: ActiveDifficulty;
  category_id: Id;
}

export interface PaperLibrarySummary {
  id: Id;
  title: string;
  category_id: Id;
  question_count: number;
}

export interface QuestionLibrarySource {
  list(input: {
    category_id: Id;
    keyword?: string;
    type?: QuestionType;
    difficulty?: ActiveDifficulty;
    page: number;
    page_size: number;
  }): Promise<LibraryPage<QuestionLibrarySummary>>;
  get(id: Id): Promise<{
    document: QuestionAuthoringDocument;
    binding: Extract<PaperQuestionBinding, { kind: 'bound' }>;
    session?: DesignerSession;
  }>;
}

export interface PaperLibrarySource {
  list(input: { keyword?: string; page: number; page_size: number }): Promise<LibraryPage<PaperLibrarySummary>>;
  get(id: Id): Promise<PaperDesignerValue>;
}

export interface DesignerMediaAdapter {
  upload(file: File): Promise<{ asset_id: Id }>;
}

export interface DesignerOption {
  value: string;
  label: string;
}

export interface PaperCourseOption {
  id: Id | number;
  title: string;
  category_id?: Id | null;
}

export interface DesignerIssue {
  code: string;
  message: string;
  client_id?: string;
}

export interface PaperSavePlan {
  order: string[];
  reuse: Array<{
    client_id: string;
    question_id: Id;
    question_version_id: Id;
    revision: number;
    score_cents: number;
  }>;
  submit: QuestionAuthoringDocument;
}

export interface PaperSaveState {
  value: PaperDesignerValue;
  dirty: boolean;
  phase: 'editing' | 'saving' | 'incomplete';
  context: SaveContext | null;
  message: string;
  has_partial_receipt: boolean;
  can_abandon: boolean;
}

export type QuestionBlock = JSONContent;
