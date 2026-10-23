import type { QuestionContentV2, ReadonlyTiptapDoc } from './training-contracts';

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
