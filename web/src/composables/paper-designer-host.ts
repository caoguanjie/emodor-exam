import { ref } from 'vue';
import http from '../api/http';
import type { AuthoringBundle, AuthoringCommitRequest, AuthoringReceipt, DesignerLayoutV1, DesignerSession } from '../api/question-document-types';
import type { Page, QuestionView, TrainingPaperDetail, TrainingPaperSummary } from '../api/training-types';
import type { DesignerPaper, PaperDesignerValue, PaperLibrarySource, QuestionLibrarySource, SaveContext, SaveOutcome } from '../components/question-designers/contracts';
import { applyAuthoringReceipt, applyQuestionCommitResult, planPaperSave, preflightPaper, questionFingerprint, toAuthoringBundle, validateDesignerLayout } from '../components/question-designers/paper-designer-state';

export interface PaperDesignerHostApi {
  get(path: string, config?: { params?: Record<string, unknown> }): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  put(path: string, body: unknown): Promise<unknown>;
}
export interface PaperDesignerAccess { read: boolean; write: boolean; questionsRead: boolean; questionsWrite: boolean }
type MainPaperDetail = TrainingPaperDetail & { designer_layout?: DesignerLayoutV1 | null };
type SavePhase = 'unsubmitted' | 'question_receipt_known' | 'config_saved' | 'questions_saved';
interface SaveAttempt {
  phase: SavePhase;
  value: PaperDesignerValue;
  request: AuthoringCommitRequest | null;
  commitSent: boolean;
  unknown: 'commit' | 'config' | 'questions' | null;
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function session(bundle: AuthoringBundle): DesignerSession { return { option_ids: copy(bundle.option_ids), identities: {}, layouts: copy(bundle.layouts) }; }
function knownRejection(failure: unknown): boolean { const code = (failure as { code?: number })?.code; return typeof code === 'number' && code >= 40000 && code < 50000; }
function message(failure: unknown): string { return failure instanceof Error ? failure.message : '保存失败，请重试'; }
function operationInfo(data: unknown): Partial<DesignerPaper> {
  if (!data || typeof data !== 'object') return {};
  const source = data as Record<string, unknown>;
  return Object.fromEntries(['created_by_name', 'updated_by_name', 'created_at', 'updated_at']
    .filter(key => source[key] === null || typeof source[key] === 'string')
    .map(key => [key, source[key]]));
}
function config(value: PaperDesignerValue): Record<string, unknown> {
  const paper = value.paper;
  if (typeof paper.title !== 'string' || !paper.title.trim() || Array.from(paper.title).length > 128) throw new Error('试卷标题须为 1–128 个字符');
  if (paper.mode !== undefined && paper.mode !== 'fixed') throw new Error('设计器只支持固定试卷');
  if (typeof paper.category_id !== 'string' || !/^[1-9]\d*$/.test(paper.category_id)) throw new Error('培训类别 ID 不合法');
  // Mirror UpdateTrainingPaperDto and PaperService before committing questions.
  for (const [field, min, max, integer] of [
    ['sort_order', 0, 2147483647, true], ['duration_minutes', 1, 1440, true], ['max_attempts', 1, 100, true],
    ['total_score', 0.01, 999.99, false], ['pass_score', 0.01, 999.99, false], ['partial_credit_ratio', 0, 1, false],
  ] as const) {
    const input = paper[field];
    if (input !== undefined && (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max || integer && !Number.isInteger(input))) {
      throw new Error(`${field} 须为 ${min}–${max} ${integer ? '整数' : '数值'}`);
    }
  }
  const total = paper.total_score ?? 100;
  const pass = paper.pass_score ?? 60;
  for (const amount of [total, pass]) {
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) throw new Error('试卷总分和及格分数最多保留两位小数');
  }
  if (pass > total) throw new Error('及格分数不能超过试卷总分');
  if (paper.requires_learning !== undefined && typeof paper.requires_learning !== 'boolean') throw new Error('requires_learning 须为布尔值');
  if (paper.requires_learning && !paper.course_ids?.length) throw new Error('请至少选择一门关联课程');
  const minutes = paper.required_learning_minutes;
  if (paper.requires_learning && (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 2147483647)) throw new Error('累计学习时长须为 1–2147483647 的整数分钟');
  if (paper.remark != null && (typeof paper.remark !== 'string' || Array.from(paper.remark).length > 1000)) throw new Error('备注最多 1000 个字符');
  for (const field of ['regulation_ids', 'course_ids'] as const) {
    if (field === 'course_ids' && !paper.requires_learning) continue;
    const ids = paper[field];
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)))) throw new Error(`${field} 须为最多 100 个不重复的有效 ID`);
  }
  const keys: Array<keyof DesignerPaper> = ['title', 'sort_order', 'category_id', 'requires_learning', 'regulation_ids', 'course_ids', 'total_score', 'pass_score', 'duration_minutes', 'max_attempts', 'partial_credit_ratio'];
  return { ...Object.fromEntries(keys.flatMap((key) => value.paper[key] === undefined ? [] : [[key, copy(value.paper[key])]])), mode: 'fixed',
    total_score: total, requires_learning: !!paper.requires_learning,
    course_ids: paper.requires_learning ? copy(paper.course_ids) : [],
    required_learning_minutes: paper.requires_learning ? minutes : null,
    remark: paper.remark?.trim() || null,
    ...(value.paper_layout ? { designer_layout: validateDesignerLayout(value.paper_layout) } : {}) };
}
function links(value: PaperDesignerValue) {
  return { items: (value.document.content.content || []).map((block) => {
    const id = String(block.attrs?.client_id); const binding = value.bindings[id];
    if (binding.kind !== 'bound') throw new Error('题目版本回执尚未确认');
    return { question_version_id: binding.question_version_id, score_cents: value.document.questions[id]!.score_cents };
  }) };
}

/** Owns one draft session and its immutable, resumable save requests. No browser storage contains authoring drafts. */
export function createPaperDesignerHost(options: { api?: PaperDesignerHostApi; paperId: string; access: PaperDesignerAccess }) {
  const api = options.api || http;
  const attempts = new Map<string, SaveAttempt>();
  const busy = ref(false);
  const pending = ref(false);
  let disposed = false;
  let serial = 0;
  let active: SaveAttempt | null = null;
  const questionRows = new Map<string, QuestionView>();
  function requireAccess(permission: keyof PaperDesignerAccess) {
    if (disposed) throw new Error('试卷编辑会话已结束');
    if (!options.access[permission]) throw new Error('无试卷或题库操作权限');
  }
  function assertSession(ticket: number) { if (disposed || ticket !== serial) throw new Error('试卷编辑会话已失效'); }
  async function assemble(data: MainPaperDetail): Promise<PaperDesignerValue> {
    if (data.mode !== 'fixed') throw new Error('随机试卷请使用原配置页');
    const paper: DesignerPaper = { ...operationInfo(data), id: String(data.id), title: data.title, category_id: data.category_id, mode: 'fixed', requires_learning: data.requires_learning,
      sort_order: data.sort_order ?? 0, required_learning_minutes: data.required_learning_minutes ?? null, remark: data.remark ?? null,
      regulation_ids: copy(data.regulation_ids), course_ids: copy(data.course_ids), rules: copy(data.rules), total_score: data.total_score ?? 100, pass_score: data.pass_score,
      duration_minutes: data.duration_minutes, max_attempts: data.max_attempts, partial_credit_ratio: data.partial_credit_ratio };
    const layout = data.designer_layout == null ? undefined : validateDesignerLayout(data.designer_layout);
    const value: PaperDesignerValue = { paper, document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: {} }, bindings: {},
      session: { option_ids: {}, identities: {}, layouts: {} }, ...(layout ? { paper_layout: layout } : {}) };
    if (!data.questions.length) return value;
    requireAccess('questionsRead');
    const ticket = serial;
    const rows = [...data.questions].sort((left, right) => left.sort - right.sort);
    const bundle = await api.post('/admin/question-documents/assemble', { version_ids: rows.map((row) => row.question_version_id) }) as AuthoringBundle;
    assertSession(ticket);
    value.document = copy(bundle.document); value.session = session(bundle);
    const byVersion = new Map(Object.entries(bundle.identities).map(([id, token]) => [token.expected_version_id, id]));
    const blocks = new Map((value.document.content.content || []).map((block) => [String(block.attrs?.client_id), block]));
    value.document.content.content = rows.map((row) => {
      const id = byVersion.get(row.question_version_id); const meta = id && value.document.questions[id];
      if (!id || !meta || !blocks.has(id) || bundle.identities[id]!.question_id !== row.question_id || !Number.isInteger(meta.base_revision) || !meta.base_revision) throw new Error('试卷题目原稿与精确版本不一致');
      const revision = meta.base_revision;
      delete meta.question_id; delete meta.base_revision; delete meta.concept_id;
      meta.score_cents = row.score_cents;
      value.bindings[id] = { kind: 'bound', question_id: row.question_id, question_version_id: row.question_version_id, revision,
        baseline_fingerprint: questionFingerprint(value.document, id), enabled: row.enabled };
      return blocks.get(id)!;
    });
    if (Object.keys(value.document.questions).length !== rows.length) throw new Error('试卷原稿题数不一致');
    return value;
  }
  async function load(): Promise<PaperDesignerValue> {
    requireAccess('read'); requireAccess('questionsRead'); const ticket = ++serial;
    const data = await api.get(`/admin/papers/${options.paperId}`) as MainPaperDetail;
    assertSession(ticket); return assemble(data);
  }
  const questionLibrarySource: QuestionLibrarySource = {
    async list(input) {
      requireAccess('questionsRead'); const ticket = serial;
      const page = await api.get('/ai/questions', { params: { ...input, enabled: true } }) as { list: QuestionView[]; total: number };
      assertSession(ticket);
      const rows = page.list.filter((row) => row.enabled === true && row.category_id === input.category_id && row.current_version_id && row.difficulty !== 'medium');
      rows.forEach((row) => questionRows.set(String(row.question_id), copy(row)));
      return { items: rows.map((row) => ({ id: String(row.question_id), stem: row.stem, category_id: row.category_id!, type: row.type, difficulty: row.difficulty as 'easy' | 'hard' })), total: page.total, page: input.page, page_size: input.page_size };
    },
    async get(id) {
      requireAccess('questionsRead'); const row = questionRows.get(id); const ticket = serial;
      if (!row?.current_version_id || row.enabled !== true) throw new Error('请重新查询当前启用版本');
      const bundle = await api.post('/admin/question-documents/assemble', { version_ids: [row.current_version_id] }) as AuthoringBundle;
      assertSession(ticket);
      const ids = Object.keys(bundle.document.questions); const client = ids[0]!; const token = bundle.identities[client];
      if (ids.length !== 1 || token?.question_id !== id || token.expected_version_id !== row.current_version_id) throw new Error('题库原稿版本不一致');
      if (token.expected_enabled !== true) throw new Error('题目已停用或启用状态未确认，请刷新候选');
      const document = copy(bundle.document); const revision = document.questions[client]!.base_revision;
      if (!Number.isInteger(revision) || !revision) throw new Error('题库原稿缺少修订号');
      delete document.questions[client]!.question_id; delete document.questions[client]!.base_revision; delete document.questions[client]!.concept_id;
      // This adapter inserts a bank question into the current paper; its initial score belongs only to that paper.
      document.questions[client]!.score_cents = 0;
      return { document, binding: { kind: 'bound', question_id: id, question_version_id: row.current_version_id, revision, baseline_fingerprint: questionFingerprint(document, client) }, session: session(bundle) };
    },
  };
  const paperLibrarySource: PaperLibrarySource = {
    async list(input) {
      requireAccess('read'); const ticket = serial;
      const page = await api.get('/admin/papers', { params: { ...input, mode: 'fixed' } }) as Page<TrainingPaperSummary>;
      assertSession(ticket);
      return { ...page, items: page.items.map((row) => ({ id: row.id, title: row.title, category_id: row.category_id, question_count: row.rules.reduce((count, rule) => count + rule.count, 0) })) };
    },
    async get(id) { requireAccess('read'); requireAccess('questionsRead'); const ticket = serial;
      const detail = await api.get(`/admin/papers/${id}`) as MainPaperDetail; assertSession(ticket);
      if (detail.questions.some((row) => row.enabled !== true || row.difficulty === 'medium')) throw new Error('来源试卷包含已停用题或停用难度题，请先修订并重新选题');
      return assemble(detail);
    },
  };
  function incomplete(attempt: SaveAttempt, failure: unknown): SaveOutcome<PaperDesignerValue> {
    pending.value = true;
    return { status: 'incomplete', value: copy(attempt.value), message: `${attempt.unknown ? '保存结果尚未确认，请继续保存查询原请求。' : '题目版本已确认，试卷保存未完成。'}${message(failure)}`, can_abandon: attempt.phase !== 'unsubmitted' && !attempt.unknown };
  }
  async function receipt(attempt: SaveAttempt): Promise<void> {
    if (!attempt.request) { attempt.phase = 'question_receipt_known'; return; }
    let result: AuthoringReceipt;
    if (attempt.commitSent) {
      try { result = await api.get(`/admin/question-documents/commits/${encodeURIComponent(attempt.request.request_id)}`) as AuthoringReceipt; }
      catch (failure) { if ((failure as { code?: number }).code !== 40401) throw failure;
        result = await api.post('/admin/question-documents/commit', copy(attempt.request)) as AuthoringReceipt;
      }
    } else { attempt.commitSent = true; result = await api.post('/admin/question-documents/commit', copy(attempt.request)) as AuthoringReceipt; }
    if (result.request_id !== attempt.request.request_id) throw new Error('题目回执请求身份不匹配');
    const normalized = applyAuthoringReceipt(attempt.request.bundle, result);
    const submitted = Object.keys(attempt.request.bundle.document.questions);
    // HTTP saved_version_id is intentionally adapted to the source model's version_id.
    const next = copy(attempt.value);
    for (const id of submitted) {
      const index = next.document.content.content!.findIndex((block) => block.attrs?.client_id === id);
      next.document.content.content![index] = copy(normalized.document.content.content!.find((block) => block.attrs?.client_id === id)!);
      next.document.questions[id] = { ...copy(normalized.document.questions[id]!), score_cents: next.document.questions[id]!.score_cents };
    }
    next.session = { option_ids: { ...next.session?.option_ids, ...normalized.option_ids }, identities: {}, layouts: { ...next.session?.layouts, ...normalized.layouts } };
    attempt.value = applyQuestionCommitResult(next, { request_id: result.request_id, items: result.items.map(({ saved_version_id, ...item }) => ({ ...item, version_id: saved_version_id })) }, { request_id: attempt.request.request_id, client_ids: submitted });
    attempt.phase = 'question_receipt_known'; attempt.unknown = null;
  }
  async function saveDraft(value: PaperDesignerValue, context: SaveContext & { intent?: 'save' }): Promise<SaveOutcome<PaperDesignerValue>> {
    requireAccess('read'); requireAccess('write'); requireAccess('questionsRead');
    if (value.paper.id !== options.paperId || !context.request_id) throw new Error('试卷或保存请求身份不一致');
    if (busy.value) throw new Error('试卷正在保存，请等待');
    let attempt = attempts.get(context.request_id);
    if (!attempt) {
      if (active?.unknown) throw new Error('保存结果尚未确认，请先恢复原请求');
      const issues = preflightPaper(value); if (issues.length) throw new Error(issues[0]!.message);
      const settings = config(value); // Validate paper settings and layout before the first question write.
      const plan = planPaperSave(value);
      const ids = Object.keys(plan.submit.questions);
      const regulations = value.paper.regulation_ids || [];
      if (regulations.length && ids.some((id) => value.bindings[id]!.kind === 'bound' && value.document.questions[id]!.regulation_id)) {
        throw new Error('修改副本将作为人工题保存，请先清空试卷关联资料/来源筛选');
      }
      if (regulations.length && Object.values(value.document.questions).some((meta) => !meta.regulation_id || !regulations.includes(meta.regulation_id))) throw new Error('固定题目不在试卷资料筛选范围内');
      if (regulations.length && ids.some((id) => !plan.submit.questions[id]!.regulation_id)) throw new Error('固定题目不在试卷资料筛选范围内');
      if (ids.length) requireAccess('questionsWrite');
      const bundle = ids.length ? toAuthoringBundle(plan.submit, value.session || { option_ids: {}, identities: {}, layouts: {} }) : null;
      if (bundle) bundle.identities = {};
      const request = bundle ? { request_id: context.request_id, bundle } : null;
      if (request && new TextEncoder().encode(JSON.stringify(request)).length > 2 * 1024 * 1024) throw new Error('题目提交超过 2 MiB，请减少内容后重试');
      const normalized = copy(value);
      Object.assign(normalized.paper, { requires_learning: settings.requires_learning, course_ids: settings.course_ids,
        required_learning_minutes: settings.required_learning_minutes, remark: settings.remark });
      attempt = { phase: 'unsubmitted', value: normalized, request, commitSent: false, unknown: null };
      attempts.set(context.request_id, attempt);
    }
    active = attempt; busy.value = true;
    try {
      if (attempt.phase === 'unsubmitted') {
        try { await receipt(attempt); }
        catch (failure) { if (!attempt.commitSent || knownRejection(failure) && !attempt.unknown) { attempts.delete(context.request_id); active = null; throw failure; }
          attempt.unknown = 'commit'; return incomplete(attempt, failure); }
      }
      if (attempt.phase === 'question_receipt_known') {
        try {
          const payload = config(attempt.value);
          if (attempt.unknown === 'config') {
            const current = await api.get(`/admin/papers/${options.paperId}`) as Record<string, unknown>;
            if (Object.entries(payload).every(([key, expected]) => JSON.stringify(current[key]) === JSON.stringify(expected))) attempt.phase = 'config_saved';
          }
          if (attempt.phase !== 'config_saved') Object.assign(attempt.value.paper, operationInfo(await api.put(`/admin/papers/${options.paperId}`, payload)));
          attempt.phase = 'config_saved'; attempt.unknown = null;
        } catch (failure) { attempt.unknown = knownRejection(failure) ? null : 'config'; return incomplete(attempt, failure); }
      }
      if (attempt.phase === 'config_saved') {
        try {
          const payload = links(attempt.value);
          if (attempt.unknown === 'questions') {
            const current = await api.get(`/admin/papers/${options.paperId}`) as MainPaperDetail;
            Object.assign(attempt.value.paper, operationInfo(current));
            if (JSON.stringify(current.questions.map(({ question_version_id, score_cents }) => ({ question_version_id, score_cents }))) === JSON.stringify(payload.items)) attempt.phase = 'questions_saved';
          }
          if (attempt.phase !== 'questions_saved') Object.assign(attempt.value.paper, operationInfo(await api.put(`/admin/papers/${options.paperId}/questions`, payload)));
          attempt.phase = 'questions_saved'; attempt.unknown = null;
        } catch (failure) { attempt.unknown = knownRejection(failure) ? null : 'questions'; return incomplete(attempt, failure); }
      }
      pending.value = false; return { status: 'saved', value: copy(attempt.value) };
    } finally { busy.value = false; }
  }
  return { load, questionLibrarySource, paperLibrarySource, saveDraft, busy, pending,
    canDiscard: () => !busy.value && !active?.unknown,
    dispose() { disposed = true; serial += 1; questionRows.clear(); attempts.clear(); } };
}
