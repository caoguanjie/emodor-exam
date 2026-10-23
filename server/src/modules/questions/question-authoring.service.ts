import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Errors } from '../../common/errors';
import type { AuthoringBundle, AuthoringCommitRequest, AuthoringReceipt } from '../../common/question-authoring';
import type { Difficulty, QuestionType } from '../../common/training-contracts';
import { QuestionAuthoringCommit } from '../../entities/question-authoring-commit.entity';
import { QuestionVersion } from '../../entities/question-version.entity';
import { AccessService } from '../access/access.service';
import { parseQuestionContent } from './question-content-dispatch';
import { canonicalAuthoringHash, decodeAuthoringBundle, joinAuthoringBundles, synchronizeFormAuthoring, type AuthoringQuestionWrite, type AuthoringSavedItem } from './question-authoring-codec';
import { QuestionVersionService } from './question-version.service';

export function normalizeAuthoringRequestId(input: unknown): string {
  if (typeof input !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input)) throw Errors.param('request_id 必须是 UUID', { path: '$.request_id' });
  return input.toLowerCase();
}
function duplicate(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ('code' in error && error.code === 'ER_DUP_ENTRY') || ('errno' in error && error.errno === 1062);
}
function versionId(input: unknown): string {
  if (typeof input !== 'string' || !/^[1-9]\d{0,19}$/.test(input) || BigInt(input) > 18446744073709551615n) throw Errors.param('version_ids 必须是十进制 ID 字符串');
  return input;
}

@Injectable()
export class QuestionAuthoringService {
  constructor(private readonly dataSource: DataSource, private readonly versions: QuestionVersionService, private readonly access: AccessService) {}

  private async permission(actorId: string, permission: 'questions:read' | 'questions:write'): Promise<void> {
    if (!(await this.access.permissions(actorId)).includes(permission)) throw Errors.forbidden();
  }

  async assemble(versionIds: string[], actorId: string): Promise<AuthoringBundle> {
    await this.permission(actorId, 'questions:read');
    if (!Array.isArray(versionIds) || !versionIds.length || versionIds.length > 100 || new Set(versionIds).size !== versionIds.length) throw Errors.param('version_ids 须为 1–100 个不重复版本 ID');
    const repo = this.dataSource.getRepository(QuestionVersion);
    const bundles: AuthoringBundle[] = []; const used = new Set<string>();
    for (const rawId of versionIds) {
      const exactId = versionId(rawId);
      const version = await repo.findOne({ where: { id: exactId } });
      if (!version) throw Errors.notFound('题目版本不存在');
      if (!version.categoryId || !['easy', 'medium', 'hard'].includes(version.difficulty || '') || !['single', 'multiple', 'judgment'].includes(version.type)) throw Errors.param('题目版本缺少可编辑的类别、难度或题型');
      const content = parseQuestionContent(version);
      let base = version.authoringJson ? structuredClone(version.authoringJson) : null;
      let client = Object.keys(base?.document.questions || {})[0] || `version_${exactId}`;
      if (used.has(client)) {
        const replacement = `version_${exactId}`;
        if (base) {
          const block = base.document.content.content?.[0]; if (block) block.attrs = { client_id: replacement };
          base = { document: { ...base.document, questions: { [replacement]: base.document.questions[client] } },
            option_ids: { [replacement]: base.option_ids[client] || {} }, identities: base.identities[client] ? { [replacement]: base.identities[client] } : {}, layouts: base.layouts[client] ? { [replacement]: base.layouts[client] } : {} };
        }
        client = replacement;
      }
      used.add(client);
      const identity = { question_id: String(version.questionId), expected_version_id: exactId };
      const placeholder: AuthoringBundle = { document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: { [client]: {
        type: version.type as QuestionType, category_id: String(version.categoryId), difficulty: version.difficulty as Difficulty, concept_id: version.conceptId,
        regulation_id: version.regulationId, regulation_version_id: version.regulationVersionId, analysis: { type: 'doc', content: [] }, score_cents: version.scoreCents,
      } } }, option_ids: {}, identities: {}, layouts: {} };
      const write: AuthoringQuestionWrite = { client_id: client, bundle: base || placeholder, identity, content, category_id: String(version.categoryId),
        type: version.type as QuestionType, difficulty: version.difficulty as Difficulty, score: Number(version.scoreCents) / 100, concept_id: version.conceptId || undefined };
      const bundle = synchronizeFormAuthoring(base, write);
      bundle.document.questions[client].question_id = String(version.questionId);
      bundle.document.questions[client].base_revision = Number(version.revision);
      bundles.push(bundle);
    }
    return joinAuthoringBundles(bundles);
  }

  async commit(input: AuthoringCommitRequest, actorId: string): Promise<AuthoringReceipt> {
    await this.permission(actorId, 'questions:write');
    if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !['request_id', 'bundle'].includes(key))) throw Errors.param('请求包含不支持的字段');
    const requestId = normalizeAuthoringRequestId(input.request_id);
    const writes = decodeAuthoringBundle(input.bundle);
    const normalized = joinAuthoringBundles(writes.map((write) => write.bundle));
    const hash = canonicalAuthoringHash(normalized);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const commits = manager.getRepository(QuestionAuthoringCommit);
        // MySQL's unique insert waits for an in-flight owner/request. NULL never
        // leaves this transaction; an exception rolls back the reservation too.
        await commits.insert({ ownerId: actorId, requestId, contentHash: hash, resultJson: null });
        await this.versions.lockAuthoringBatch(manager, writes);
        const saved: AuthoringSavedItem[] = [];
        for (const write of writes) saved.push(await this.versions.writeAuthoringInTransaction(manager, write, actorId));
        const receipt: AuthoringReceipt = { request_id: requestId, bundle: joinAuthoringBundles(saved.map((item) => item.bundle)),
          items: saved.map(({ client_id, question_id, saved_version_id, revision }) => ({ client_id, question_id, saved_version_id, revision })) };
        const row = await commits.findOne({ where: { ownerId: actorId, requestId }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw Errors.internal('提交回执预约丢失');
        row.resultJson = receipt; await commits.save(row);
        return receipt;
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      // A unique loser reads the committed winner outside its rolled-back
      // transaction. It never invents another request ID or recreates versions.
      const existing = await this.dataSource.getRepository(QuestionAuthoringCommit).findOne({ where: { ownerId: actorId, requestId } });
      if (!existing) throw error;
      if (existing.contentHash !== hash) throw Errors.questionVersionConflict('request_id 已用于不同内容');
      if (!existing.resultJson) throw Errors.internal('提交回执尚未完成');
      return existing.resultJson;
    }
  }

  async getCommit(requestId: string, actorId: string): Promise<AuthoringReceipt> {
    await this.permission(actorId, 'questions:write');
    const normalized = normalizeAuthoringRequestId(requestId);
    const row = await this.dataSource.getRepository(QuestionAuthoringCommit).findOne({ where: { ownerId: actorId, requestId: normalized } });
    if (!row?.resultJson) throw Errors.notFound('尚无成功提交回执');
    return row.resultJson;
  }
}
