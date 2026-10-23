import { Errors } from '../../common/errors';
import type {
  CanonicalQuestionContent, ReadonlyRichNodeV3, StudentQuestionContent,
} from '../../common/question-content-v3';
import { questionContent } from './question-content';
import { parseRichDocV3 } from './question-content-v3';

type RecordValue = Record<string, any>;
const object = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const fields = ['stem', 'options', 'analysis', 'answer_option_ids'];
function fail(path: string, message: string): never { throw Errors.param(`${path}: ${message}`, { path }); }
function keys(value: RecordValue, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, '不支持的题目字段');
}
function typeAnswers(type: unknown, answer: unknown[], options: unknown[]): void {
  if (type === undefined) return;
  if (type !== 'single' && type !== 'multiple' && type !== 'judgment') fail('$.type', '只支持三种客观题');
  if (type === 'multiple' ? answer.length < 2 : answer.length !== 1) fail('$.answer_option_ids', '题型与答案数量不符');
  if (type === 'judgment' && options.length !== 2) fail('$.options', '判断题必须有两个选项');
}

/** Accept existing entity/DTO envelopes as well as the canonical discriminant. */
export function parseQuestionContent(input: unknown): CanonicalQuestionContent {
  if (!object(input)) return fail('$', '题目内容必须是对象');
  const canonical = Object.prototype.hasOwnProperty.call(input, 'schema');
  const schema = canonical ? input.schema : input.contentSchemaVersion ?? input.content_schema_version ?? 1;
  if (canonical) keys(input, ['schema', 'type', ...fields], '$');
  if (schema !== 1 && schema !== 2 && schema !== 3) return fail('$.schema', '题目内容版本不支持');
  if (schema === 1) {
    if (canonical) return fail('$.schema', 'canonical 内容只允许 schema 2 或 3');
    return { schema: 2, ...questionContent(input) };
  }
  const content = canonical ? input : input.contentJson ?? input.content_json;
  if (!object(content)) return fail('$', '题目内容缺失');
  if (!canonical) keys(content, fields, '$');
  if (schema === 2) {
    // The old implementation remains authoritative, including its marks ban.
    const type = input.type ?? (Array.isArray(content.answer_option_ids) && content.answer_option_ids.length > 1 ? 'multiple' : 'single');
    const value = Object.fromEntries(fields.map((key) => [key, content[key]]));
    return { schema: 2, ...questionContent({ type, contentSchemaVersion: 2, contentJson: value }) };
  }
  if (!Array.isArray(content.options) || content.options.length < 2 || content.options.length > 26) return fail('$.options', '题目选项须为 2–26 个');
  const ids = new Set<string>();
  const options = content.options.map((option: unknown, index: number) => {
    const path = `$.options[${index}]`;
    if (!object(option)) return fail(path, '选项必须是对象');
    keys(option, ['id', 'content'], path);
    if (typeof option.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(option.id) || ids.has(option.id)) return fail(`${path}.id`, '选项 ID 缺失、重复或非法');
    ids.add(option.id);
    return { id: option.id, content: parseRichDocV3(option.content) };
  });
  const answer = content.answer_option_ids;
  if (!Array.isArray(answer) || !answer.length || new Set(answer).size !== answer.length || answer.some((id) => !ids.has(id))) return fail('$.answer_option_ids', '答案 ID 为空、重复或不属于选项');
  typeAnswers(input.type, answer, options);
  const stem = parseRichDocV3(content.stem);
  const visible = (node: ReadonlyRichNodeV3): boolean => node.type === 'image'
    || (node.type === 'text' && Boolean(node.text.trim()))
    || ('content' in node && Boolean(node.content?.some((child) => visible(child))));
  if (!visible(stem) || options.some((option) => !visible(option.content))) return fail('$', '题干和选项不能为空');
  return {
    schema: 3, stem, options,
    analysis: content.analysis == null ? null : parseRichDocV3(content.analysis),
    answer_option_ids: [...answer],
  };
}

/** Revalidate at the trust boundary, then deliberately return only visible data. */
export function projectStudentContent(content: CanonicalQuestionContent): StudentQuestionContent {
  const parsed = parseQuestionContent(content);
  return { stem: parsed.stem, options: parsed.options } as StudentQuestionContent;
}

/** Includes analysis assets for authoring/review; consumers choose authorization scope. */
export function collectContentAssetIds(content: CanonicalQuestionContent): string[] {
  const parsed = parseQuestionContent(content);
  const ids = new Set<string>();
  const visit = (node: { type: string; attrs?: any; content?: any[] }) => {
    if (node.type === 'image') ids.add(node.attrs.asset_id);
    node.content?.forEach(visit);
  };
  visit(parsed.stem);
  parsed.options.forEach((option) => visit(option.content));
  if (parsed.analysis) visit(parsed.analysis);
  return [...ids];
}
