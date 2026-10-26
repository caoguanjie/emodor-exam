import type { JSONContent } from '@tiptap/core';
import type { Difficulty, Id, QuestionType } from './training-types';

export type { JSONContent } from '@tiptap/core';

export interface DocumentIssue { path: string; code: string; message: string }
export interface QuestionMeta {
  type: QuestionType;
  category_id: Id;
  /** Legacy medium remains readable until the author explicitly chooses an enabled value. */
  difficulty: Difficulty;
  /** Historical JSON only; new authoring submissions omit this property. */
  concept_id?: Id | null;
  regulation_id: Id | null;
  regulation_version_id: Id | null;
  analysis: JSONContent;
  score_cents: number;
  /** Compatibility metadata is readable; write tokens live in bundle.identities. */
  question_id?: Id;
  base_revision?: number | null;
}
export interface QuestionAuthoringDocument {
  schema_version: 1;
  content: JSONContent;
  questions: Record<string, QuestionMeta>;
}
export interface DesignerLayoutV1 {
  schema_version: 1;
  settings: {
    templateName: string;
    pageSize: 'A4' | 'A5';
    pageOrientation: 1 | 2;
    pageSizeReduce: { top: number; bottom: number; left: number; right: number };
  };
}
export type StableOptionIds = Record<string, Record<string, string>>;
export type VersionTokens = Record<string, { question_id: Id; expected_version_id: Id | null; expected_enabled: boolean }>;
export interface AuthoringBundle {
  document: QuestionAuthoringDocument;
  option_ids: StableOptionIds;
  identities: VersionTokens;
  layouts: Record<string, DesignerLayoutV1>;
}
export type DesignerState = AuthoringBundle;
export type DesignerSession = Pick<AuthoringBundle, 'option_ids' | 'identities' | 'layouts'>;
export interface AssembleInput { version_ids: Id[] }
export interface AuthoringCommitRequest { request_id: string; bundle: AuthoringBundle }
export interface AuthoringReceipt {
  request_id: string;
  bundle: AuthoringBundle;
  items: Array<{ client_id: string; question_id: Id; saved_version_id: Id; revision: number }>;
}
/** Internal source-state adapter only. HTTP uses AuthoringReceipt with saved_version_id. */
export interface CommitResult {
  request_id: string;
  items: Array<{ client_id: string; question_id: Id; version_id: Id; revision: number }>;
}
export interface ConceptSummary {
  id: Id;
  category_id: Id;
  type: QuestionType;
  name: string;
  description: string;
  easy_count: number;
  hard_count: number;
}
export interface ReviewOptionState { option_id: string; selected: boolean; correct: boolean; missed: boolean }

/** JSON type mirror of server common/question-content-v3.ts; schema 2 stays unchanged. */
import type { QuestionContentV2, ReadonlyTiptapDoc } from './training-types';

export type ContentSchema = 1 | 2 | 3;
export type RichFontFamilyV3 = 'SimSun' | 'SimHei' | 'Microsoft YaHei' | 'FangSong' | 'KaiTi';
export type RichLineHeightV3 = '1' | '1.2' | '1.5' | '1.75' | '2' | '2.5' | '3';
export type RichTextAlignV3 = 'left' | 'center' | 'right' | 'justify';
export interface RichBlockAttrsV3 {
  textAlign?: RichTextAlignV3 | null;
  indent?: number;
  lineHeight?: RichLineHeightV3 | null | 0;
}
export interface RichListItemAttrsV3 extends Omit<RichBlockAttrsV3, 'textAlign'> {}
export type ReadonlyRichMarkV3 =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'superscript' | 'subscript'; attrs?: Record<string, never> }
  | { type: 'textStyle'; attrs: { fontFamily?: RichFontFamilyV3 | null; fontSize?: string | null; color?: string | null } }
  | { type: 'highlight'; attrs: { color: string } };
export type ReadonlyRichInlineV3 =
  | { type: 'text'; text: string; marks?: ReadonlyRichMarkV3[] }
  | { type: 'hardBreak'; marks?: ReadonlyRichMarkV3[] }
  | { type: 'image'; attrs: { asset_id: string } };
export interface RichTableCellAttrsV3 {
  colspan: number;
  rowspan: number;
  colwidth: number[] | null;
  align: Exclude<RichTextAlignV3, 'justify'> | null;
}
export interface ReadonlyRichTableCellV3 {
  type: 'tableCell' | 'tableHeader';
  attrs: RichTableCellAttrsV3;
  content: ReadonlyRichBlockV3[];
}
export interface ReadonlyRichTableRowV3 { type: 'tableRow'; content: ReadonlyRichTableCellV3[] }
export interface ReadonlyRichTableV3 { type: 'table'; content: ReadonlyRichTableRowV3[] }
export interface ReadonlyRichListItemV3 {
  type: 'listItem';
  attrs?: RichListItemAttrsV3;
  content: ReadonlyRichBlockV3[];
}
export type ReadonlyRichBlockV3 =
  | { type: 'paragraph'; attrs?: RichBlockAttrsV3; content?: ReadonlyRichInlineV3[] }
  | { type: 'heading'; attrs: RichBlockAttrsV3 & { level: 1 | 2 | 3 | 4 }; content?: ReadonlyRichInlineV3[] }
  | { type: 'blockquote'; content: ReadonlyRichBlockV3[] }
  | { type: 'bulletList'; attrs?: Record<string, never>; content: ReadonlyRichListItemV3[] }
  | { type: 'orderedList'; attrs?: { start?: number; type?: '1' | 'a' | 'A' | 'i' | 'I' | null }; content: ReadonlyRichListItemV3[] }
  | { type: 'codeBlock'; attrs?: { language?: null }; content?: Array<{ type: 'text'; text: string }> }
  | { type: 'horizontalRule' }
  | ReadonlyRichTableV3;
export interface ReadonlyRichDocV3 { type: 'doc'; content: ReadonlyRichBlockV3[] }
export type ReadonlyRichNodeV3 = ReadonlyRichDocV3 | ReadonlyRichBlockV3 | ReadonlyRichInlineV3 | ReadonlyRichListItemV3 | ReadonlyRichTableRowV3 | ReadonlyRichTableCellV3;

export interface QuestionContentV3 {
  stem: ReadonlyRichDocV3;
  options: Array<{ id: string; content: ReadonlyRichDocV3 }>;
  analysis: ReadonlyRichDocV3 | null;
  answer_option_ids: string[];
}
/** Schema 2 remains the original strict contract; new formats belong only to 3. */
export type CanonicalQuestionContent = ({ schema: 2 } & QuestionContentV2) | ({ schema: 3 } & QuestionContentV3);
/** The response's content_schema_version marker is added by its HTTP consumer. */
export type StudentQuestionContent =
  | { stem: ReadonlyTiptapDoc; options: QuestionContentV2['options'] }
  | { stem: ReadonlyRichDocV3; options: QuestionContentV3['options'] };
