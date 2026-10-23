import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../../common/audit.service';
import { BizError, Errors } from '../../common/errors';
import type { Difficulty, Id, ImportPreview, ImportResult, QuestionOption, QuestionType } from '../../common/training-contracts';
import { ImportBatch } from '../../entities/import-batch.entity';
import { Question } from '../../entities/question.entity';
import { QuestionConcept } from '../../entities/question-concept.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { ImportBatchService } from '../imports/import-batch.service';
import {
  buildQuestionImportTemplate,
  parseQuestionImportFile,
  type ParsedQuestionImportRow,
  type QuestionImportFormat,
} from './question-import-format';
import { QuestionVersionService, type QuestionDraft } from './question-version.service';
import { docHtml, legacyHtmlDoc } from './question-content';

export interface QuestionImportDefaults {
  categoryId?: Id;
  difficulty?: Difficulty;
}

interface NormalizedQuestionImportRow {
  row: number;
  fingerprint: string;
  draft: QuestionDraft;
}

type QuestionImportKind = 'questions' | 'questions_ai';
export interface AiImportContentPatch {
  stem?: string;
  options?: QuestionOption[];
  answer?: number[];
  analysis?: string;
}

export function questionImportFields(draft: QuestionDraft) {
  return {
    category: draft.categoryId,
    type: draft.type,
    difficulty: draft.difficulty,
    concept: draft.conceptId || '',
    stem: draft.stem,
    options: draft.options,
    answer: draft.answer,
    analysis: draft.analysis || '',
    score: (draft.scoreCents / 100).toFixed(2),
  };
}

interface CandidateRow extends NormalizedQuestionImportRow {
  normalizedDraft: QuestionDraft;
}

const TYPES = new Set<QuestionType>(['single', 'multiple', 'judgment']);
const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard']);
const RAW_KEYS = new Set([
  'row', 'format_errors', 'category', 'type', 'difficulty', 'concept', 'stem',
  'options', 'answer', 'analysis', 'score',
]);

function normalizeContent(value: unknown): string {
  return String(value ?? '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

function normalizeRichContent(value: unknown): string {
  // Preview retains legacy HTML, while the version adapter renders v2 content
  // on confirmation. Compare both through the same supported document shape.
  return normalizeContent(docHtml(legacyHtmlDoc(String(value ?? ''))));
}

function fingerprint(draft: Pick<QuestionDraft,
  'categoryId' | 'type' | 'difficulty' | 'stem' | 'options' | 'answer' | 'analysis'>): string {
  const canonical = {
    category_id: String(draft.categoryId),
    type: draft.type,
    difficulty: draft.difficulty,
    content: {
      stem: normalizeRichContent(draft.stem),
      options: (draft.options || []).map((option) => ({
        key: normalizeContent(option.key),
        text: normalizeRichContent(option.text),
      })),
      analysis: normalizeRichContent(draft.analysis),
    },
    answer: [...(draft.answer || [])].map(Number).sort((a, b) => a - b),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function inputHash(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function parseJsonArray(value: string, field: string): unknown[] {
  if (!value) throw Errors.param(`${field} 必须是 JSON 数组`);
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not-array');
    return parsed;
  } catch {
    throw Errors.param(`${field} 必须是合法 JSON 数组`);
  }
}

function scoreCents(value: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) throw Errors.param('score 必须是最多两位小数的数字');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000) throw Errors.param('score 必须大于 0 且不超过 100');
  return cents;
}

function questionOptions(value: unknown[]): QuestionOption[] {
  return value.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw Errors.param('options 每项必须是对象');
    const record = option as Record<string, unknown>;
    const unknown = Object.keys(record).filter((key) => key !== 'key' && key !== 'text');
    if (unknown.length) throw Errors.param(`options 包含不支持的字段：${unknown.join(',')}`);
    if (record.key !== undefined && typeof record.key !== 'string') throw Errors.param('options.key 必须是字符串');
    if (typeof record.text !== 'string') throw Errors.param('options.text 必须是字符串');
    return { key: record.key || '', text: record.text };
  });
}

function answerIndexes(value: unknown[]): number[] {
  if (value.some((item) => typeof item !== 'number' || !Number.isInteger(item))) {
    throw Errors.param('answer 必须是 JSON 整数下标数组');
  }
  return value as number[];
}

function publicPreview(batch: ImportBatch): ImportPreview {
  return {
    batch_id: String(batch.id),
    valid_rows: Array.isArray(batch.validRows) ? batch.validRows : [],
    errors: Array.isArray(batch.errors) ? batch.errors : [],
    duplicates: Array.isArray(batch.duplicates) ? batch.duplicates : [],
  };
}

@Injectable()
export class QuestionImportService implements OnModuleInit {
  constructor(
    @InjectRepository(ImportBatch) private readonly batchRepo: Repository<ImportBatch>,
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    @InjectRepository(TrainingCategory) private readonly categoryRepo: Repository<TrainingCategory>,
    @InjectRepository(QuestionConcept) private readonly conceptRepo: Repository<QuestionConcept>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly importBatches: ImportBatchService,
    private readonly versions: QuestionVersionService,
  ) {}

  onModuleInit(): void {
    this.importBatches.registerAdapter('questions', {
      preview: (ownerId, rows) => this.previewRows(String(ownerId), rows),
      commit: (ownerId, batchId, rowNumbers) => this.commitRows(String(ownerId), String(batchId), rowNumbers),
    });
    this.importBatches.registerAdapter('questions_ai', {
      preview: (ownerId, rows) => this.previewRows(String(ownerId), rows, 'questions_ai'),
      commit: (ownerId, batchId, rowNumbers) => this.commitRows(String(ownerId), String(batchId), rowNumbers, 'questions_ai'),
    });
  }

  buildTemplate(format: QuestionImportFormat): Promise<Buffer> {
    return buildQuestionImportTemplate(format);
  }

  async preview(
    ownerId: Id,
    file: Buffer,
    format: QuestionImportFormat,
    defaults: QuestionImportDefaults = {},
  ): Promise<ImportPreview> {
    if (defaults.categoryId !== undefined && !/^[1-9]\d*$/.test(String(defaults.categoryId))) {
      throw Errors.param('defaults.category_id 非法');
    }
    if (defaults.difficulty !== undefined && !DIFFICULTIES.has(defaults.difficulty)) {
      throw Errors.param('defaults.difficulty 非法');
    }
    const rows = await parseQuestionImportFile(file, format, {
      maxBytes: this.config.upload.maxImportSizeMb * 1024 * 1024,
      maxRows: this.config.upload.maxImportRows,
    });
    const merged = rows.map((row) => ({
      ...row,
      category: row.category || String(defaults.categoryId || ''),
      difficulty: row.difficulty || String(defaults.difficulty || ''),
    }));
    return this.importBatches.preview(String(ownerId), 'questions', merged);
  }

  private rawRow(value: unknown, index: number): ParsedQuestionImportRow {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        row: index + 2,
        category: '', type: '', difficulty: '', concept: '', stem: '', options: '', answer: '',
        analysis: '', score: '', format_errors: ['导入行必须是对象'],
      };
    }
    const record = value as Record<string, unknown>;
    const unknown = Object.keys(record).filter((key) => !RAW_KEYS.has(key));
    const row = Number(record.row);
    return {
      row: Number.isInteger(row) && row > 1 ? row : index + 2,
      category: String(record.category ?? '').trim(),
      type: String(record.type ?? '').trim(),
      difficulty: String(record.difficulty ?? '').trim(),
      concept: String(record.concept ?? '').trim(),
      stem: String(record.stem ?? '').trim(),
      options: String(record.options ?? '').trim(),
      answer: String(record.answer ?? '').trim(),
      analysis: String(record.analysis ?? '').trim(),
      score: String(record.score ?? '').trim(),
      format_errors: [
        ...(Array.isArray(record.format_errors) ? record.format_errors.map(String) : []),
        ...(unknown.length ? [`导入行包含不支持的字段：${unknown.join(',')}`] : []),
      ],
    };
  }

  private async resolveCategory(value: string, cache: Map<string, TrainingCategory | null>): Promise<TrainingCategory> {
    if (!value) throw Errors.param('category 必填，可填写类别 ID/名称或选择默认类别');
    if (!cache.has(value)) {
      const category = /^[1-9]\d*$/.test(value)
        ? await this.categoryRepo.findOne({ where: { id: value } })
        : await this.categoryRepo.findOne({ where: { name: value } });
      cache.set(value, category || null);
    }
    const category = cache.get(value);
    if (!category || Number(category.status) !== 1) throw Errors.categoryInactive();
    return category;
  }

  private async resolveConcept(
    value: string,
    categoryId: string,
    type: QuestionType,
    cache: Map<string, QuestionConcept | null>,
  ): Promise<QuestionConcept | undefined> {
    if (!value) return undefined;
    const key = `${categoryId}:${type}:${value}`;
    if (!cache.has(key)) {
      const concept = /^[1-9]\d*$/.test(value)
        ? await this.conceptRepo.findOne({ where: { id: value } })
        : await this.conceptRepo.findOne({ where: { categoryId, type, name: value } });
      cache.set(key, concept || null);
    }
    const concept = cache.get(key);
    if (!concept) throw Errors.notFound('考点不存在');
    if (String(concept.categoryId) !== categoryId || concept.type !== type) {
      throw Errors.param('考点必须与题目属于同一类别和题型');
    }
    return concept;
  }

  private async candidate(
    ownerId: string,
    row: ParsedQuestionImportRow,
    categoryCache: Map<string, TrainingCategory | null>,
    conceptCache: Map<string, QuestionConcept | null>,
    kind: QuestionImportKind = 'questions',
  ): Promise<CandidateRow> {
    if (row.format_errors?.length) throw Errors.param(row.format_errors.join('；'));
    if (!TYPES.has(row.type as QuestionType)) throw Errors.param('题型 type 必须是 single / multiple / judgment');
    if (!DIFFICULTIES.has(row.difficulty as Difficulty)) throw Errors.param('difficulty 必须是 easy / medium / hard');
    if (row.stem.length > 100_000 || row.analysis.length > 100_000) {
      throw Errors.param('stem / analysis 单元格不得超过 100000 字符');
    }
    const category = await this.resolveCategory(row.category, categoryCache);
    const type = row.type as QuestionType;
    const concept = await this.resolveConcept(row.concept, String(category.id), type, conceptCache);
    const draft: QuestionDraft = {
      categoryId: String(category.id),
      difficulty: row.difficulty as Difficulty,
      type,
      stem: row.stem,
      options: questionOptions(parseJsonArray(row.options, 'options')),
      answer: answerIndexes(parseJsonArray(row.answer, 'answer')),
      analysis: row.analysis || null,
      scoreCents: scoreCents(row.score),
      conceptId: concept ? String(concept.id) : undefined,
      source: kind === 'questions_ai' ? 'ai' : 'import',
    };
    const normalizedDraft = kind === 'questions_ai'
      ? await this.versions.validateAiImportDraft(draft, ownerId)
      : await this.versions.validateImportDraft(draft, ownerId);
    return {
      row: row.row,
      fingerprint: fingerprint(normalizedDraft),
      draft: normalizedDraft,
      normalizedDraft,
    };
  }

  private async existingFingerprints(
    drafts: readonly QuestionDraft[],
    manager?: EntityManager,
    currentRead = false,
  ): Promise<Set<string>> {
    const categoryIds = [...new Set(drafts.map((draft) => draft.categoryId))];
    if (!categoryIds.length) return new Set();
    let rows: Question[];
    if (manager) {
      const query = manager.getRepository(Question)
        .createQueryBuilder('question')
        .where('question.category_id IN (:...categoryIds)', { categoryIds });
      if (currentRead) query.setLock('pessimistic_read');
      rows = await query.getMany();
    } else {
      rows = await this.questionRepo.find({ where: { categoryId: In(categoryIds) } });
    }
    const allowed = new Set(drafts.map((draft) => `${draft.categoryId}:${draft.type}:${draft.difficulty}`));
    const result = new Set<string>();
    for (const row of rows) {
      if (!row.categoryId || !row.difficulty) continue;
      if (!allowed.has(`${row.categoryId}:${row.type}:${row.difficulty}`)) continue;
      const draft = {
        categoryId: String(row.categoryId),
        type: row.type as QuestionType,
        difficulty: row.difficulty as Difficulty,
        stem: row.stem,
        options: row.options,
        answer: row.answer,
        analysis: row.analysis,
      };
      try {
        result.add(fingerprint(draft));
      } catch (error) {
        // An unrelated legacy row may exceed today's content rules. Only its
        // deterministic content-validation failure is isolated; query failures
        // and unexpected errors must still abort preview or confirmation.
        if (!(error instanceof BizError) || error.code !== 40001) throw error;
      }
    }
    return result;
  }

  private async previewRows(ownerId: string, values: unknown[], kind: QuestionImportKind = 'questions'): Promise<ImportPreview> {
    const errors: Array<{ row: number; message: string }> = [];
    const duplicates: number[] = [];
    const candidates: CandidateRow[] = [];
    const categoryCache = new Map<string, TrainingCategory | null>();
    const conceptCache = new Map<string, QuestionConcept | null>();
    const seenRows = new Set<number>();

    for (let index = 0; index < values.length; index++) {
      const row = this.rawRow(values[index], index);
      if (seenRows.has(row.row)) {
        errors.push({ row: row.row, message: '导入行号重复' });
        continue;
      }
      seenRows.add(row.row);
      try {
        candidates.push(await this.candidate(ownerId, row, categoryCache, conceptCache, kind));
      } catch (error: any) {
        errors.push({ row: row.row, message: error?.message || '导入行校验失败' });
      }
    }

    const existing = await this.existingFingerprints(candidates.map((candidate) => candidate.draft));
    const accepted = new Set<string>();
    const normalizedRows: NormalizedQuestionImportRow[] = [];
    const validRows: number[] = [];
    for (const candidate of candidates) {
      if (existing.has(candidate.fingerprint) || accepted.has(candidate.fingerprint)) {
        duplicates.push(candidate.row);
        continue;
      }
      accepted.add(candidate.fingerprint);
      validRows.push(candidate.row);
      normalizedRows.push({ row: candidate.row, fingerprint: candidate.fingerprint, draft: candidate.normalizedDraft });
    }

    const batch = await this.batchRepo.save(this.batchRepo.create({
      ownerId,
      kind,
      inputHash: inputHash(values),
      status: 'previewed',
      normalizedRows: normalizedRows as unknown as Record<string, unknown>[],
      validRows,
      errors,
      duplicates,
      committedRows: null,
      createdIds: null,
    }));
    this.audit.log({
      actor_id: ownerId, actor_name: `user:${ownerId}`, action: 'question.import.preview',
      object_type: 'import_batch', object_id: batch.id,
      detail: { valid_rows: validRows.length, error_rows: errors.length, duplicate_rows: duplicates.length },
      result: errors.length || duplicates.length ? 'failure' : 'success', source_ip: null,
    });
    return publicPreview(batch);
  }

  private storedRows(batch: ImportBatch, requested: number[]): NormalizedQuestionImportRow[] {
    const rows = (batch.normalizedRows || []) as unknown as NormalizedQuestionImportRow[];
    const selected = rows.filter((row) => requested.includes(Number(row.row)));
    if (selected.length !== requested.length) throw Errors.importBatchConflict('导入批次数据已不完整');
    return selected.sort((left, right) => left.row - right.row);
  }

  private async commitRows(
    ownerId: string, batchId: string, rowNumbers: number[], kind: QuestionImportKind = 'questions',
  ): Promise<ImportResult> {
    const requested = [...new Set((rowNumbers || []).map(Number))].sort((a, b) => a - b);
    let receipts: Array<{ questionId: string; versionId: string }> = [];
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const batch = await manager.findOne(ImportBatch, {
          where: { id: batchId, ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!batch || batch.kind !== kind) throw Errors.dataForbidden();
        if (kind === 'questions_ai') this.assertAiBatchActive(batch);
        const valid = [...new Set((batch.validRows || []).map(Number))].sort((a, b) => a - b);
        if (!requested.length || requested.some((row) => !Number.isInteger(row) || !valid.includes(row))) {
          throw Errors.param('只能确认预检查通过的行');
        }
        if (batch.status === 'committed') {
          const committed = [...(batch.committedRows || [])].map(Number).sort((a, b) => a - b);
          if (JSON.stringify(committed) !== JSON.stringify(requested)) throw Errors.importBatchConflict();
          return { batch_id: String(batch.id), created_ids: batch.createdIds || [], committed_rows: committed };
        }
        if (batch.status === 'committing') throw Errors.importBatchConflict('导入批次正在确认，请稍后查询状态');
        const rows = this.storedRows(batch, requested);
        batch.status = 'committing';
        await manager.save(batch);
        const create = kind === 'questions_ai'
          ? this.versions.createPendingAiImportsInManager.bind(this.versions)
          : this.versions.createApprovedImportsInManager.bind(this.versions);
        receipts = await create(
          manager,
          rows.map((row) => row.draft),
          ownerId,
          async (lockedManager, drafts) => {
            // The category locks are already held. A locking query forces a
            // current read even if media/source validation established an
            // older REPEATABLE READ snapshot before this transaction waited.
            const existing = await this.existingFingerprints(drafts, lockedManager, true);
            if (drafts.some((draft) => existing.has(fingerprint(draft)))) {
              throw Errors.importBatchConflict('题库已出现重复题，请重新预检查');
            }
          },
        );
        const createdIds = receipts.map((receipt) => receipt.questionId);
        batch.status = 'committed';
        batch.committedRows = requested;
        batch.createdIds = createdIds;
        await manager.save(batch);
        return { batch_id: String(batch.id), created_ids: createdIds, committed_rows: requested };
      });
      this.audit.log({
        actor_id: ownerId, actor_name: `user:${ownerId}`, action: 'question.import.commit',
        object_type: 'import_batch', object_id: result.batch_id,
        detail: {
          committed_rows: result.committed_rows,
          created: receipts.map((receipt) => ({ question_id: receipt.questionId, saved_version_id: receipt.versionId })),
        },
        result: 'success', source_ip: null,
      });
      return result;
    } catch (error) {
      this.audit.log({
        actor_id: ownerId, actor_name: `user:${ownerId}`, action: 'question.import.commit',
        object_type: 'import_batch', object_id: batchId,
        detail: { committed_rows: requested }, result: 'failure', source_ip: null,
      });
      throw error;
    }
  }

  /** Validate references without calling any preview/DB/cache/audit writer. */
  async normalizeAiReferences(ownerId: string, rows: ParsedQuestionImportRow[]): Promise<QuestionDraft[]> {
    const categoryCache = new Map<string, TrainingCategory | null>();
    const conceptCache = new Map<string, QuestionConcept | null>();
    const drafts: QuestionDraft[] = [];
    for (const row of rows) {
      try {
        const candidate = await this.candidate(ownerId, { ...row, difficulty: 'easy' }, categoryCache, conceptCache);
        drafts.push(candidate.draft);
      } catch {
        // Reference text or arbitrary cell contents must not escape in errors.
        throw Errors.param(`参考题第 ${row.row} 行无效，请检查类别、考点和题目格式`);
      }
    }
    return drafts;
  }

  async validateAiGenerated(ownerId: string, draft: QuestionDraft): Promise<QuestionDraft> {
    return this.versions.validateAiImportDraft(draft, ownerId);
  }

  async previewAiGenerated(ownerId: string, drafts: QuestionDraft[]): Promise<ImportPreview> {
    const rows = drafts.map((draft, index) => {
      const fields = questionImportFields(draft);
      return { row: index + 2, ...fields, options: JSON.stringify(fields.options), answer: JSON.stringify(fields.answer) };
    });
    return this.previewRows(ownerId, rows, 'questions_ai');
  }

  private assertAiBatchActive(batch: ImportBatch): void {
    if (batch.status !== 'committed' && batch.createdAt
      && Date.now() - new Date(batch.createdAt).getTime() >= 24 * 3600 * 1000) {
      throw Errors.notFound('AI 预览批次已过期，请重新生成');
    }
  }

  private async aiBatch(ownerId: string, id: string, manager?: EntityManager): Promise<ImportBatch> {
    const batch = manager
      ? await manager.findOne(ImportBatch, { where: { id }, lock: { mode: 'pessimistic_write' } })
      : await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw Errors.notFound('导入批次不存在');
    if (String(batch.ownerId) !== ownerId || batch.kind !== 'questions_ai') throw Errors.dataForbidden();
    this.assertAiBatchActive(batch);
    return batch;
  }

  async readAiGenerated(ownerId: string, id: string) {
    const batch = await this.aiBatch(ownerId, id);
    return {
      ...publicPreview(batch),
      status: batch.status,
      rows: ((batch.normalizedRows || []) as unknown as NormalizedQuestionImportRow[]).map((row) => ({
        row_number: row.row, ...questionImportFields(row.draft), errors: [] as string[],
      })),
      ...(batch.status === 'committed' ? { created_ids: batch.createdIds || [], committed_rows: batch.committedRows || [] } : {}),
    };
  }

  async readAiGeneratedDraft(ownerId: string, id: string, rowNumber: number): Promise<QuestionDraft> {
    const batch = await this.aiBatch(ownerId, id);
    if (batch.status !== 'previewed') throw Errors.importBatchConflict('已确认批次不能修改');
    const row = this.storedRows(batch, [rowNumber])[0];
    return structuredClone(row.draft);
  }

  async updateAiGenerated(
    ownerId: string, id: string, rowNumber: number, patch: AiImportContentPatch, expected?: QuestionDraft,
  ) {
    const keys = ['stem', 'options', 'answer', 'analysis'];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length
      || Object.keys(patch).some((key) => !keys.includes(key))) throw Errors.param('只允许修改题干、选项、答案和解析');
    if (patch.options !== undefined && !Array.isArray(patch.options)
      || patch.answer !== undefined && !Array.isArray(patch.answer)) {
      throw Errors.param('options / answer 必须是数组');
    }
    if (patch.stem !== undefined && (typeof patch.stem !== 'string' || patch.stem.length > 100_000)
      || patch.analysis !== undefined && (typeof patch.analysis !== 'string' || patch.analysis.length > 100_000)) {
      throw Errors.param('stem / analysis 必须是最多 100000 字符的字符串');
    }
    await this.dataSource.transaction(async (manager) => {
      const batch = await this.aiBatch(ownerId, id, manager);
      if (batch.status !== 'previewed') throw Errors.importBatchConflict('已确认批次不能修改');
      const rows = batch.normalizedRows as unknown as NormalizedQuestionImportRow[];
      const row = this.storedRows(batch, [rowNumber])[0];
      if (expected && fingerprint(expected) !== row.fingerprint) throw Errors.importBatchConflict('题目已被修改，请刷新后重试');
      const input = {
        ...row.draft, ...patch,
        contentSchemaVersion: undefined, contentJson: undefined,
        ...(patch.options !== undefined ? { options: questionOptions(patch.options) } : {}),
        ...(patch.answer !== undefined ? { answer: answerIndexes(patch.answer) } : {}),
      };
      const draft = await this.versions.validateAiImportDraft(input, ownerId, manager);
      const nextFingerprint = fingerprint(draft);
      if (rows.some((other) => other.row !== row.row && other.fingerprint === nextFingerprint)) {
        throw Errors.importBatchConflict('批次中已存在相同题目');
      }
      row.draft = draft;
      row.fingerprint = nextFingerprint;
      await manager.save(batch);
    });
    return this.readAiGenerated(ownerId, id);
  }

  async commitAiGenerated(ownerId: string, id: string, rows: number[]): Promise<ImportResult> {
    await this.aiBatch(ownerId, id);
    return this.commitRows(ownerId, id, rows, 'questions_ai');
  }
}
