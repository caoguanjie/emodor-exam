import { createUuid } from '../../utils/uuid';
import type { CommitResult, JSONContent, QuestionAuthoringDocument, QuestionMeta } from '../../api/question-document-types';
import type { AuthoringBundle, AuthoringReceipt, DesignerLayoutV1, DesignerSession, DesignerState } from '../../api/question-document-types';
import type {
  DesignerIssue, PaperDesignerValue, PaperQuestionBinding, PaperQuestionSet, PaperSavePlan,
  PaperSaveState, SaveOutcome,
} from './contracts';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function withoutWriteIdentity(meta: QuestionMeta): QuestionMeta {
  const result = clone(meta) as QuestionMeta & Record<string, unknown>;
  for (const key of ['question_id', 'base_revision', 'generation_ref', 'rubric', 'concept_id']) delete result[key];
  return result;
}

export function copyQuestionsForPaper(
  source: PaperQuestionSet,
  createId: () => string = () => createUuid(),
  reservedIds: Iterable<string> = [],
): PaperQuestionSet {
  const issues = validatePaperStructure(source);
  if (issues.length) throw new Error(issues[0].message);
  const content = clone(source.document.content);
  const questions: Record<string, QuestionMeta> = {};
  const bindings: Record<string, PaperQuestionBinding> = {};
  const session: DesignerSession = { option_ids: {}, identities: {}, layouts: {} };
  let oldClient = ''; let newClient = '';
  const used = new Set([...reservedIds, ...Object.keys(source.document.questions)]);
  const reserve = (node: JSONContent): void => {
    for (const key of ['client_id', 'option_id']) {
      if (typeof node.attrs?.[key] === 'string') used.add(node.attrs[key]);
    }
    node.content?.forEach(reserve);
  };
  reserve(content);
  const fresh = (): string => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = createId();
      if (typeof id === 'string' && id && !used.has(id)) { used.add(id); return id; }
    }
    throw new Error('无法生成唯一的题目身份');
  };
  const remap = (node: JSONContent): void => {
    if (node.type === 'questionBlock') {
      const old = String(node.attrs?.client_id);
      const id = fresh();
      oldClient = old; newClient = id;
      session.option_ids[id] = {};
      if (source.session?.layouts[old]) session.layouts[id] = clone(source.session.layouts[old]);
      node.attrs = { ...node.attrs, client_id: id };
      questions[id] = withoutWriteIdentity(source.document.questions[old]);
      bindings[id] = clone(source.bindings[old]);
    } else if (node.type === 'questionOption') {
      const oldOption = String(node.attrs?.option_id);
      const newOption = fresh();
      session.option_ids[newClient]![newOption] = source.session?.option_ids[oldClient]?.[oldOption] ?? oldOption;
      node.attrs = { ...node.attrs, option_id: newOption };
    }
    node.content?.forEach(remap);
  };
  remap(content);
  return { document: { schema_version: 1, content, questions }, bindings, ...(source.session ? { session } : {}) };
}

function canonical(value: unknown): string {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry !== null && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)]));
    }
    return entry;
  };
  return JSON.stringify(sort(value));
}

/** A canonical serialization, not a security hash; semantic IDs such as asset/concept IDs remain. */
export function questionFingerprint(document: QuestionAuthoringDocument, clientId: string): string {
  const blocks = (document.content.content || []).filter((node) => node.type === 'questionBlock' && node.attrs?.client_id === clientId);
  if (blocks.length !== 1 || !Object.hasOwn(document.questions, clientId)) throw new Error('题目身份与正文不一致');
  const ignored = new Set(['client_id', 'option_id', 'question_id', 'question_version_id', 'base_revision', 'generation_ref', 'revision', 'id']);
  // Mirrors createExtensions('question') defaults without loading an editor into this pure model.
  const defaults: Record<string, Record<string, unknown>> = {
    paragraph: { indent: 0, lineHeight: 0, textAlign: null },
    heading: { indent: 0, lineHeight: 0, textAlign: null, level: 1 },
    listItem: { indent: 0, lineHeight: 0 }, orderedList: { start: 1, type: null },
    tableCell: { colspan: 1, rowspan: 1, colwidth: null, align: null },
    tableHeader: { colspan: 1, rowspan: 1, colwidth: null, align: null },
    codeBlock: { language: null }, mediaImage: { alt: null },
    textStyle: { fontSize: null, fontFamily: null, color: null },
    link: { href: null, target: null, rel: 'noopener noreferrer', class: null, title: null },
    highlight: { color: null },
  };
  const attributes = (type: string | undefined, attrs: Record<string, unknown>) => Object.fromEntries(Object.entries(attrs)
    .filter(([key, entry]) => !ignored.has(key) && !(type === 'questionOption' && key === 'checked')
      && !(Object.hasOwn(defaults[type || ''] || {}, key) && defaults[type || '']![key] === entry)));
  const normalize = (node: JSONContent): JSONContent => {
    const result = clone(node);
    if (result.attrs) {
      result.attrs = attributes(result.type, result.attrs);
      if (!Object.keys(result.attrs).length) delete result.attrs;
    }
    if (result.marks) result.marks = result.marks.map((mark) => {
      const normalized = { ...mark };
      if (normalized.attrs) {
        normalized.attrs = attributes(normalized.type, normalized.attrs);
        if (!Object.keys(normalized.attrs).length) delete normalized.attrs;
      }
      return normalized;
    }).sort((left, right) => canonical(left).localeCompare(canonical(right)));
    if (result.content) result.content = result.content.map(normalize);
    return result;
  };
  const { category_id: _category, score_cents: _paperScore, ...meta } = withoutWriteIdentity(document.questions[clientId]);
  meta.analysis = normalize(meta.analysis);
  const block = blocks[0];
  const answer = (block.content || []).filter((node) => node.type === 'questionOption').map((node) => node.attrs?.checked === true);
  return canonical({ block: normalize(block), meta, answer });
}

function issue(code: string, message: string, client_id?: string): DesignerIssue {
  return client_id ? { code, message, client_id } : { code, message };
}

/** Validate the three identity sets before accepting any controlled editor update. */
export function validatePaperStructure(value: PaperQuestionSet): DesignerIssue[] {
  const root = value.document.content;
  const blocks = root.content || [];
  const ids = blocks.map((node) => node.attrs?.client_id);
  const unique = new Set(ids);
  const same = (keys: string[]): boolean => keys.length === ids.length && keys.every((id) => unique.has(id));
  const nestedBlock = (node: JSONContent): boolean => Boolean(node.content?.some((child) => child.type === 'questionBlock' || nestedBlock(child)));
  if (value.document.schema_version !== 1 || root.type !== 'doc'
    || blocks.some((node) => node.type !== 'questionBlock' || nestedBlock(node))
    || ids.some((id) => typeof id !== 'string' || !id)
    || unique.size !== ids.length || !same(Object.keys(value.document.questions)) || !same(Object.keys(value.bindings))) {
    return [issue('client-id-mismatch', '正文、题目属性和来源绑定的题目身份必须一致')];
  }
  return Object.entries(value.bindings).flatMap(([id, binding]) => {
    if (binding?.kind === 'new') return [];
    if (binding?.kind === 'bound' && /^[1-9]\d*$/.test(binding.question_id)
      && /^[1-9]\d*$/.test(binding.question_version_id) && Number.isInteger(binding.revision)
      && binding.revision > 0 && typeof binding.baseline_fingerprint === 'string' && binding.baseline_fingerprint) return [];
    return [issue('invalid-binding', '来源版本绑定不完整，请重新载入题目', id)];
  });
}

function questionSetIssues(sets: PaperQuestionSet[], categoryId?: string): DesignerIssue[] {
  const issues = sets.flatMap(validatePaperStructure);
  if (issues.length) return issues;
  const ids = sets.flatMap((set) => Object.keys(set.document.questions));
  if (ids.length > 100) issues.push(issue('question-limit', '每份试卷最多 100 题'));
  const questions = new Set<string>();
  for (const set of sets) {
    for (const [id, meta] of Object.entries(set.document.questions)) {
      if (meta.category_id !== categoryId) issues.push(issue('category-mismatch', '题目培训类别必须与试卷一致', id));
      const binding = set.bindings[id];
      if (binding.kind === 'bound') {
        if (questions.has(binding.question_id)) issues.push(issue('duplicate-question', '同一道题不能重复加入试卷', id));
        questions.add(binding.question_id);
        if (binding.enabled === false) issues.push(issue('disabled-question', '题单包含已停用题目，请移除或替换', id));
      }
    }
  }
  return issues;
}

function hasContent(node: JSONContent): boolean {
  return Boolean(node.text?.trim() || node.type === 'mediaImage' && /^[1-9]\d*$/.test(node.attrs?.asset_id)
    || node.content?.some(hasContent));
}

function invalidQuestion(block: JSONContent, meta: QuestionMeta): boolean {
  const children = block.content || [];
  const options = children.slice(1);
  const checked = options.filter((node) => node.attrs?.checked === true).length;
  return !['single', 'multiple', 'judgment'].includes(meta.type)
    || !['easy', 'hard'].includes(meta.difficulty)
    || !/^[1-9]\d*$/.test(meta.category_id)
    || children[0]?.type !== 'questionStem' || !hasContent(children[0])
    || options.length < 2 || options.length > 26
    || options.some((node) => node.type !== 'questionOption' || !hasContent(node) || typeof node.attrs?.checked !== 'boolean')
    || new Set(options.map((node) => node.attrs?.option_id)).size !== options.length
    || options.some((node) => typeof node.attrs?.option_id !== 'string' || !node.attrs.option_id)
    || ((meta.type === 'single' || meta.type === 'judgment') && checked !== 1)
    || (meta.type === 'multiple' && checked < 2)
    || (meta.type === 'judgment' && (options.length !== 2
      || !isPlainJudgmentLabel(options[0]!, '正确') || !isPlainJudgmentLabel(options[1]!, '错误')));
}

function textContent(node: JSONContent): string {
  return node.text || node.content?.map(textContent).join('') || '';
}

function isPlainJudgmentLabel(node: JSONContent, expected: string): boolean {
  if (textContent(node).trim() !== expected) return false;
  const content = node.content || [];
  if (content.length !== 1 || content[0]?.type !== 'paragraph') return false;
  const paragraph = content[0]; const attrs = paragraph.attrs;
  if (attrs && (
    attrs.textAlign !== undefined && attrs.textAlign !== null
    || attrs.indent !== undefined && attrs.indent !== 0
    || attrs.lineHeight !== undefined && attrs.lineHeight !== 0 && attrs.lineHeight !== null
  )) return false;
  const inline = paragraph.content || [];
  return inline.length === 1 && inline[0]?.type === 'text' && inline[0].text === expected
    && (!inline[0].marks || inline[0].marks.length === 0);
}

/** Draft saves retain unfinished allocation; publication validates positive scores and their total. */
export function preflightPaper(value: PaperDesignerValue): DesignerIssue[] {
  const issues = questionSetIssues([value], value.paper.category_id);
  if (!value.paper.title.trim()) issues.push(issue('title-required', '请填写试卷标题'));
  if (!value.paper.category_id) issues.push(issue('category-required', '请先选择培训类别'));
  const blocks = value.document.content.content || [];
  if (!blocks.length) issues.push(issue('questions-required', '试卷至少需要一道题'));
  if (validatePaperStructure(value).length) return issues;
  for (const [index, block] of blocks.entries()) {
    const id = String(block.attrs?.client_id);
    const meta = value.document.questions[id]!;
    if (!Number.isInteger(meta.score_cents) || meta.score_cents < 0 || meta.score_cents > 99999) {
      issues.push(issue('question-score', `第 ${index + 1} 题本卷分值无效，请填写 0～999.99 分，最多两位小数`, id));
    }
    if (invalidQuestion(block, meta)) issues.push(issue('invalid-question', `第 ${index + 1} 题：请补全题干、选项、答案及题目属性`, id));
  }
  const total = value.paper.total_score === undefined ? 100 : value.paper.total_score;
  const pass = value.paper.pass_score === undefined ? 60 : value.paper.pass_score;
  const validPoints = (points: number) => Number.isFinite(points) && points > 0 && points <= 999.99 && Math.abs(points * 100 - Math.round(points * 100)) < 1e-7;
  if (!validPoints(total)) issues.push(issue('paper-score', '试卷总分须为 0.01～999.99 分，最多两位小数'));
  if (!validPoints(pass) || pass > total) issues.push(issue('paper-score', '及格分数须大于 0，且不能超过试卷总分，最多两位小数'));
  return issues;
}

export function paperLoadAction(
  current: PaperDesignerValue,
): 'load' | 'choose-append-or-replace' {
  return current.document.content.content?.some((node) => node.type === 'questionBlock') ? 'choose-append-or-replace' : 'load';
}

export function insertPaper(
  current: PaperDesignerValue,
  source: PaperDesignerValue,
  mode: 'append' | 'replace',
  createId: () => string = () => createUuid(),
): { ok: true; value: PaperDesignerValue } | { ok: false; issues: DesignerIssue[] } {
  const categoryId = mode === 'replace' ? source.paper.category_id : current.paper.category_id;
  const issues = questionSetIssues(mode === 'replace' ? [source] : [current, source], categoryId);
  if (!categoryId) issues.push(issue('category-required', '请先选择培训类别'));
  if (!Object.keys(source.document.questions).length) issues.push(issue('questions-required', '来源试卷必须有完整题单'));
  if (mode === 'append' && source.paper.category_id !== current.paper.category_id) issues.push(issue('category-mismatch', '不能追加其他培训类别的试卷'));
  if (issues.length) return { ok: false, issues };
  const reserved = new Set<string>();
  const reserve = (node: JSONContent): void => {
    if (typeof node.attrs?.client_id === 'string') reserved.add(node.attrs.client_id);
    if (typeof node.attrs?.option_id === 'string') reserved.add(node.attrs.option_id);
    node.content?.forEach(reserve);
  };
  reserve(current.document.content);
  const copied = copyQuestionsForPaper(source, createId, reserved);
  const next: PaperDesignerValue = mode === 'replace'
    ? { ...copied, paper: { ...clone(source.paper), id: current.paper.id }, ...(source.paper_layout ? { paper_layout: clone(source.paper_layout) } : {}) }
    : {
      paper: clone(current.paper),
      document: {
        schema_version: 1,
        content: { type: 'doc', content: [...clone(current.document.content.content || []), ...copied.document.content.content || []] },
        questions: { ...clone(current.document.questions), ...copied.document.questions },
      },
      bindings: { ...clone(current.bindings), ...copied.bindings },
      ...(current.paper_layout ? { paper_layout: clone(current.paper_layout) } : {}),
      ...(current.session || copied.session ? { session: {
        option_ids: { ...clone(current.session?.option_ids || {}), ...copied.session?.option_ids },
        identities: { ...clone(current.session?.identities || {}), ...copied.session?.identities },
        layouts: { ...clone(current.session?.layouts || {}), ...copied.session?.layouts },
      } } : {}),
    };
  for (const key of ['created_by_name', 'updated_by_name', 'created_at', 'updated_at'] as const) {
    if (current.paper[key] === undefined) delete next.paper[key];
    else Object.assign(next.paper, { [key]: current.paper[key] });
  }
  return { ok: true, value: next };
}

/** Call preflightPaper before any network writes; this function only partitions the controlled value. */
export function planPaperSave(value: PaperDesignerValue): PaperSavePlan {
  const issues = validatePaperStructure(value);
  if (issues.length) throw new Error(issues[0].message);
  const plan: PaperSavePlan = {
    order: [], reuse: [],
    submit: { schema_version: 1, content: { type: 'doc', content: [] }, questions: {} },
  };
  for (const block of value.document.content.content || []) {
    const id = String(block.attrs?.client_id);
    const meta = value.document.questions[id];
    const binding = value.bindings[id];
    plan.order.push(id);
    if (binding.kind === 'bound' && questionFingerprint(value.document, id) === binding.baseline_fingerprint) {
      plan.reuse.push({ client_id: id, question_id: binding.question_id, question_version_id: binding.question_version_id, revision: binding.revision, score_cents: meta.score_cents });
    } else {
      plan.submit.content.content!.push(clone(block));
      // Paper-local edits create independent manual questions. Source metadata
      // belongs to the reused source version, never to an identity-free copy.
      plan.submit.questions[id] = { ...withoutWriteIdentity(meta), regulation_id: null, regulation_version_id: null };
    }
  }
  return plan;
}

export function createPaperSaveState(value: PaperDesignerValue, dirty = false): PaperSaveState {
  return { value: clone(value), dirty, phase: 'editing', context: null, message: '', has_partial_receipt: false, can_abandon: false };
}

export function beginPaperSave(state: PaperSaveState, requestId: string): PaperSaveState {
  if (!requestId && !state.context) throw new Error('保存请求缺少 request_id');
  return { ...state, phase: 'saving', context: clone(state.context || { request_id: requestId }), message: '' };
}

export function applyPaperSaveOutcome(state: PaperSaveState, outcome: SaveOutcome<PaperDesignerValue>): PaperSaveState {
  if (!state.context || state.phase !== 'saving') throw new Error('没有进行中的保存请求');
  const issues = validatePaperStructure(outcome.value);
  if (issues.length) throw new Error(issues[0].message);
  const ids = Object.keys(state.value.document.questions).sort();
  if (outcome.value.paper.id !== state.value.paper.id
    || canonical(Object.keys(outcome.value.document.questions).sort()) !== canonical(ids)) throw new Error('保存回执与当前试卷不一致');
  if ((outcome.status === 'saved' || outcome.can_abandon) && Object.entries(outcome.value.bindings).some(([id, binding]) => binding.kind !== 'bound'
    || binding.baseline_fingerprint !== questionFingerprint(outcome.value.document, id))) throw new Error('保存回执缺少当前题目版本');
  return outcome.status === 'saved'
    ? { value: clone(outcome.value), dirty: false, phase: 'editing', context: null, message: '', has_partial_receipt: false, can_abandon: false }
    : { value: clone(outcome.value), dirty: true, phase: 'incomplete', context: clone(state.context), message: outcome.message, has_partial_receipt: true, can_abandon: outcome.can_abandon === true };
}

export function abandonPaperSave(state: PaperSaveState): PaperSaveState {
  if (state.phase !== 'incomplete' || !state.can_abandon) return state;
  return { ...state, phase: 'editing', context: null, message: '', has_partial_receipt: false, can_abandon: false };
}

export function applyQuestionCommitResult(
  value: PaperDesignerValue,
  result: CommitResult,
  expected: { request_id: string; client_ids: readonly string[] },
): PaperDesignerValue {
  const ids = new Set(expected.client_ids);
  if (validatePaperStructure(value).length || !expected.request_id || result.request_id !== expected.request_id
    || ids.size !== expected.client_ids.length || result.items.length !== ids.size
    || [...ids].some((id) => !Object.hasOwn(value.document.questions, id))
    || new Set(result.items.map((item) => item.client_id)).size !== ids.size
    || result.items.some((item) => !ids.has(item.client_id)
      || typeof item.question_id !== 'string' || !/^[1-9]\d*$/.test(item.question_id)
      || typeof item.version_id !== 'string' || !/^[1-9]\d*$/.test(item.version_id)
      || !Number.isInteger(item.revision) || item.revision < 1)) throw new Error('题目提交回执不完整或不匹配，请查询本次保存结果');
  const updated = clone(value);
  for (const item of result.items) {
    updated.document.questions[item.client_id] = withoutWriteIdentity(updated.document.questions[item.client_id]);
    updated.bindings[item.client_id] = {
      kind: 'bound', question_id: item.question_id, question_version_id: item.version_id, revision: item.revision,
      baseline_fingerprint: questionFingerprint(updated.document, item.client_id),
    };
  }
  return updated;
}

/** A partial receipt freezes all authoring until the save is resumed or explicitly abandoned. */
export function changePaperValue(state: PaperSaveState, next: PaperDesignerValue): PaperSaveState {
  if (state.phase !== 'editing' || canonical(state.value) === canonical(next)) return state;
  const issues = validatePaperStructure(next);
  if (issues.length) throw new Error(issues[0].message);
  return { ...state, value: clone(next), dirty: true, context: null, message: '', has_partial_receipt: false, can_abandon: false };
}

export function failPaperSave(state: PaperSaveState, message: string): PaperSaveState {
  return { ...state, phase: state.has_partial_receipt ? 'incomplete' : 'editing', message };
}

function exactObject(input: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(input, key))) throw new Error(`${path} 格式不合法`);
  return input as Record<string, unknown>;
}

export function validateDesignerLayout(input: unknown): DesignerLayoutV1 {
  const layout = exactObject(input, ['schema_version', 'settings'], '布局');
  const settings = exactObject(layout.settings, ['templateName', 'pageSize', 'pageOrientation', 'pageSizeReduce'], '布局设置');
  const margins = exactObject(settings.pageSizeReduce, ['top', 'bottom', 'left', 'right'], '页边距');
  if (layout.schema_version !== 1 || typeof settings.templateName !== 'string' || !settings.templateName.trim() || Array.from(settings.templateName).length > 128
    || settings.pageSize !== 'A4' && settings.pageSize !== 'A5' || ![1, 2].includes(settings.pageOrientation as number)
    || Object.values(margins).some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 99)) {
    throw new Error('纸张布局或页边距不合法');
  }
  return clone(input as DesignerLayoutV1);
}

/** Rebuild only local lookup keys; stable identities never depend on display position or ID length. */
export function toAuthoringBundle(value: QuestionAuthoringDocument, session: DesignerSession): AuthoringBundle {
  const result: AuthoringBundle = { document: clone(value), option_ids: {}, identities: {}, layouts: {} };
  const seen = new Set<string>();
  for (const block of value.content.content || []) {
    const id = block.attrs?.client_id;
    if (block.type !== 'questionBlock' || typeof id !== 'string' || !id || seen.has(id) || !value.questions[id]) throw new Error('题目原稿身份不一致');
    seen.add(id);
    if (!['single', 'multiple', 'judgment'].includes(value.questions[id]!.type)) throw new Error('只支持单选、多选、判断题');
    const options: Record<string, string> = {};
    const used = new Set<string>();
    for (const node of block.content || []) {
      if (node.type !== 'questionOption') continue;
      const localId = node.attrs?.option_id;
      if (typeof localId !== 'string' || !localId || Object.hasOwn(options, localId)) throw new Error('选项身份不一致');
      const stableId = session.option_ids[id]?.[localId] ?? localId;
      if (typeof stableId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stableId) || used.has(stableId)) throw new Error('选项稳定身份不合法');
      used.add(stableId); options[localId] = stableId;
    }
    result.option_ids[id] = options;
    if (session.identities[id]) {
      if (typeof session.identities[id].expected_enabled !== 'boolean') throw new Error('既有题目缺少编辑时的启用状态，请重新加载');
      result.identities[id] = clone(session.identities[id]);
    }
    if (session.layouts[id]) result.layouts[id] = validateDesignerLayout(session.layouts[id]);
    result.document.questions[id] = withoutWriteIdentity(result.document.questions[id]!);
    delete (result.document.questions[id] as Partial<QuestionMeta>).score_cents;
  }
  if (Object.keys(value.questions).length !== seen.size) throw new Error('题目原稿身份不一致');
  return result;
}

export function applyAuthoringReceipt(value: DesignerState, receipt: AuthoringReceipt): DesignerState {
  const ids = Object.keys(value.document.questions);
  if (!receipt.request_id || receipt.items.length !== ids.length
    || new Set(receipt.items.map((item) => item.client_id)).size !== ids.length
    || Object.keys(receipt.bundle.document.questions).length !== ids.length
    || receipt.items.some((item) => !ids.includes(item.client_id) || !receipt.bundle.document.questions[item.client_id]
      || !/^[1-9]\d*$/.test(item.question_id) || !/^[1-9]\d*$/.test(item.saved_version_id)
      || !Number.isInteger(item.revision) || item.revision < 1)) throw new Error('题目提交回执不完整或不匹配');
  const next = toAuthoringBundle(receipt.bundle.document, receipt.bundle);
  for (const id of ids) {
    if (canonical(value.option_ids[id]) !== canonical(next.option_ids[id])) throw new Error('提交回执改变了选项稳定身份');
  }
  for (const item of receipt.items) {
    next.identities[item.client_id] = { question_id: item.question_id, expected_version_id: item.saved_version_id, expected_enabled: true };
  }
  return next;
}
