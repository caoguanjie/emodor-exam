import type { Difficulty, Id, QuestionType } from './training-contracts';

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export interface JSONMark { type: string; attrs?: Record<string, JSONValue> }
/** Browser-free authoring JSON. A source codec must validate every node/attr. */
export interface JSONContent {
  type?: string;
  attrs?: Record<string, JSONValue>;
  content?: JSONContent[];
  marks?: JSONMark[];
  text?: string;
}
export interface QuestionMeta {
  type: QuestionType;
  category_id: Id;
  /** Historical medium may be assembled; this type does not permit new writes. */
  difficulty: Difficulty;
  /** Read-only compatibility for stored historical authoring. New output omits it. */
  concept_id?: Id | null;
  regulation_id: Id | null;
  regulation_version_id: Id | null;
  analysis: JSONContent;
  /** Optional paper-context value; never persisted in a question authoring draft. */
  score_cents?: number;
  question_id?: Id;
  base_revision?: number | null;
}
export interface QuestionAuthoringDocument {
  schema_version: 1;
  content: JSONContent;
  questions: Record<string, QuestionMeta>;
}
export type StableOptionIds = Record<string, Record<string, string>>;
export type VersionTokens = Record<string, { question_id: string; expected_version_id: string | null; expected_enabled: boolean }>;
export interface DesignerLayoutV1 {
  schema_version: 1;
  settings: {
    templateName: string;
    pageSize: 'A4' | 'A5';
    pageOrientation: 1 | 2;
    pageSizeReduce: { top: number; bottom: number; left: number; right: number };
  };
}
export interface AuthoringBundle {
  document: QuestionAuthoringDocument;
  option_ids: StableOptionIds;
  identities: VersionTokens;
  layouts: Record<string, DesignerLayoutV1>;
}
export interface AuthoringCommitRequest { request_id: string; bundle: AuthoringBundle }
export interface AuthoringReceipt {
  request_id: string;
  bundle: AuthoringBundle;
  items: Array<{ client_id: string; question_id: string; saved_version_id: string; revision: number }>;
}
export type DesignerState = AuthoringBundle;
export type DesignerSession = Pick<AuthoringBundle, 'option_ids' | 'identities' | 'layouts'>;
