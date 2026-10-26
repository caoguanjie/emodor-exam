import sanitizeHtml from 'sanitize-html';
import { Errors } from '../../common/errors';
import { assertActiveDifficulty } from '../../common/question-difficulty';
import type { Difficulty, QuestionContentV2, QuestionOption, QuestionType } from '../../common/training-contracts';
import type { QuestionContentV3 } from '../../common/question-content-v3';
import { docHtml, questionContent } from './question-content';
import { collectContentAssetIds, parseQuestionContent } from './question-content-dispatch';
import { richCompatibilityHtml } from './question-authoring-codec';

export type QuestionSource = 'ai' | 'manual' | 'import';

export interface QuestionDraftInput {
  categoryId: string;
  difficulty: Difficulty;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: number[];
  analysis: string | null;
  conceptId?: string;
  regulationId?: string;
  regulationVersionId?: string;
  sourcePageGroup?: number;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  source: QuestionSource;
  contentSchemaVersion?: number;
  contentJson?: QuestionContentV2 | QuestionContentV3 | null;
}

export interface ValidatedQuestionDraft extends QuestionDraftInput {
  mediaAssetIds: string[];
}

const TYPES: readonly QuestionType[] = ['single', 'multiple', 'judgment'];
const SOURCES: readonly QuestionSource[] = ['ai', 'manual', 'import'];

function decimalId(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw Errors.param(`${field} 必填`);
    return undefined;
  }
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) throw Errors.param(`${field} 非法`);
  return normalized;
}

function assertControlledImages(html: string): void {
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\bsrc\s*=/i.test(tag) || !/\bdata-media-id\s*=\s*(["'])\d+\1/i.test(tag)) {
      throw Errors.param('图片只能引用受控媒体');
    }
  }
}

export function sanitizeQuestionRichTextForDisplay(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const cleaned = sanitizeHtml(String(value), {
    allowedTags: [
      'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'br',
      'blockquote', 'span', 'a', 'img', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    ],
    allowedAttributes: {
      a: ['href'],
      img: ['data-media-id', 'alt'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https'],
    transformTags: {
      a: (_tagName, attributes) => {
        const attribs: Record<string, string> = {};
        if (/^https?:\/\//i.test(attributes.href || '')) {
          attribs.href = attributes.href;
          attribs.rel = 'noopener noreferrer';
        }
        return { tagName: 'a', attribs };
      },
      img: (_tagName, attributes) => ({
        tagName: /^\d+$/.test(attributes['data-media-id'] || '') ? 'img' : 'span',
        attribs: /^\d+$/.test(attributes['data-media-id'] || '') ? {
          'data-media-id': String(attributes['data-media-id']),
          ...(attributes.alt ? { alt: attributes.alt } : {}),
        } : {},
      }),
    },
  }).trim();
  return cleaned || null;
}

function cleanRichText(value: unknown, field: string, required: boolean): string | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw Errors.param(`${field}不能为空`);
    return null;
  }
  const html = String(value);
  assertControlledImages(html);
  const cleaned = sanitizeQuestionRichTextForDisplay(html) || '';
  const visibleText = sanitizeHtml(cleaned, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .trim();
  const hasControlledImage = /<img\b[^>]*\bdata-media-id=/i.test(cleaned);
  if (required && !visibleText && !hasControlledImage) throw Errors.param(`${field}不能为空`);
  return cleaned || null;
}

function normalizeOptions(options: unknown, type: QuestionType): QuestionOption[] {
  if (!Array.isArray(options)) throw Errors.param('选项非法');
  if (type === 'judgment') {
    if (options.length !== 2) throw Errors.param('判断题必须使用正确/错误两个固定选项');
    const labels = options.map((option) => sanitizeHtml(String(option?.text || ''), { allowedTags: [], allowedAttributes: {} }).trim());
    if (labels[0] !== '正确' || labels[1] !== '错误') throw Errors.param('判断题必须使用正确/错误两个固定选项');
    return [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
  }
  if (options.length < 2 || options.length > 26) throw Errors.param('选项非法：须有 2–26 个选项');
  return options.map((option, index) => ({
    key: typeof option?.key === 'string' && option.key ? option.key : String.fromCharCode(65 + index),
    text: cleanRichText(option?.text, `选项 ${index + 1}`, true)!,
  }));
}

function normalizeAnswer(answer: unknown, type: QuestionType, optionCount: number): number[] {
  if (!Array.isArray(answer)) throw Errors.param('答案不能为空');
  const normalized = [...new Set(answer.map(Number))].sort((a, b) => a - b);
  if (normalized.some((item) => !Number.isInteger(item) || item < 0 || item >= optionCount)) {
    throw Errors.param('答案下标越界');
  }
  if ((type === 'single' || type === 'judgment') && normalized.length !== 1) {
    throw Errors.param(type === 'single' ? '单选题答案必须唯一' : '判断题答案必须唯一');
  }
  if (type === 'multiple' && normalized.length < 2) throw Errors.param('多选题答案至少 2 个');
  return normalized;
}

export function controlledQuestionMediaIds(values: Array<string | null | undefined>): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(/<img\b[^>]*\bdata-media-id="(\d+)"[^>]*>/gi)) ids.add(match[1]);
  }
  return [...ids].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
}

export function validateAndSanitizeQuestionDraft(
  input: QuestionDraftInput,
  validationOptions: { allowReferenceAi?: boolean } = {},
): ValidatedQuestionDraft {
  // Old adapters may still provide a score; it is never a question fact.
  const { scoreCents: _ignoredScore, ...scoreFree } = (input ?? {}) as QuestionDraftInput & { scoreCents?: unknown };
  input = scoreFree;
  const type = input?.type;
  if (input?.contentJson != null && input.contentSchemaVersion !== 2 && input.contentSchemaVersion !== 3) throw Errors.param('内容必须声明 content_schema_version=2 或 3');
  if (!TYPES.includes(type)) throw Errors.param('题型非法（single / multiple / judgment）');
  assertActiveDifficulty(input.difficulty);
  if (!SOURCES.includes(input.source)) throw Errors.param('题目来源非法（ai / manual / import）');

  const categoryId = decimalId(input.categoryId, 'category_id', true)!;
  if (input.conceptId !== undefined && input.conceptId !== null) throw Errors.param('考点组已取消，请移除 concept_id');
  const regulationId = decimalId(input.regulationId, 'regulation_id');
  const regulationVersionId = decimalId(input.regulationVersionId, 'regulation_version_id');
  if (regulationVersionId && !regulationId) throw Errors.param('regulation_version_id 必须同时提供 regulation_id');
  const unboundReference = validationOptions.allowReferenceAi && !regulationId && !regulationVersionId;
  if (input.source === 'ai' && !unboundReference && (!regulationId || !regulationVersionId)) {
    throw Errors.param('AI 题必须记录实际制度及来源版本');
  }
  const provenance = [input.sourcePageGroup, input.sourcePageStart, input.sourcePageEnd];
  if (provenance.some((value) => value !== undefined)) {
    if (!provenance.every((value) => Number.isInteger(value) && Number(value) >= 0)) {
      throw Errors.param('PDF 页组来源非法');
    }
    if (Number(input.sourcePageStart) < 1 || Number(input.sourcePageEnd) < Number(input.sourcePageStart)) {
      throw Errors.param('PDF 页码来源非法');
    }
  }

  if (input.contentSchemaVersion === 3) {
    const parsed = parseQuestionContent(input);
    if (parsed.schema !== 3) throw Errors.param('题目内容版本不一致');
    const { schema, ...contentJson } = parsed;
    return {
      ...input, categoryId, regulationId, regulationVersionId,
      stem: richCompatibilityHtml(parsed.stem),
      options: parsed.options.map((option) => ({ key: option.id, text: richCompatibilityHtml(option.content) })),
      answer: parsed.answer_option_ids.map((id) => parsed.options.findIndex((option) => option.id === id)).sort((a, b) => a - b),
      analysis: parsed.analysis ? richCompatibilityHtml(parsed.analysis) : null,
      contentSchemaVersion: schema, contentJson, mediaAssetIds: collectContentAssetIds(parsed),
    };
  }
  const v2 = input.contentSchemaVersion === 2 ? questionContent(input) : null;
  const stem = v2 ? docHtml(v2.stem) : cleanRichText(input.stem, '题干', true)!;
  const options = v2 ? v2.options.map((option) => ({ key: option.id, text: docHtml(option.content) })) : normalizeOptions(input.options, type);
  const answer = v2 ? v2.answer_option_ids.map((id) => v2.options.findIndex((option) => option.id === id)).sort((a, b) => a - b) : normalizeAnswer(input.answer, type, options.length);
  const analysis = v2 ? v2.analysis && docHtml(v2.analysis) : cleanRichText(input.analysis, '解析', false);
  const contentJson = v2 || questionContent({ type, stem, options, answer, analysis });
  return {
    categoryId,
    difficulty: input.difficulty,
    type,
    stem,
    options,
    answer,
    analysis,
    contentSchemaVersion: 2,
    contentJson,
    regulationId,
    regulationVersionId,
    source: input.source,
    sourcePageGroup: input.sourcePageGroup,
    sourcePageStart: input.sourcePageStart,
    sourcePageEnd: input.sourcePageEnd,
    mediaAssetIds: controlledQuestionMediaIds([stem, analysis, ...options.map((option) => option.text)]),
  };
}
