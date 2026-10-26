import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { proveDeletePublicationOrdering } from './paper-release-concurrency-checks.mjs';

export function assertDeleteReceipt(response, questionId, check = assert) {
  check.equal(response.status, 200, 'DELETE question must be a registered logical-delete operation');
  check.equal(response.code, 0);
  check.deepEqual(Object.keys(response.data).sort(), ['deleted', 'deleted_at', 'question_id']);
  check.equal(response.data.question_id, String(questionId));
  check.equal(response.data.deleted, true);
  check.equal(new Date(response.data.deleted_at).toISOString(), response.data.deleted_at);
  return response.data;
}

async function deleteAudits(ctx, questionId) {
  const directory = join(ctx.env.LOG_DIR, 'audit');
  const files = (await readdir(directory)).filter((name) => /^audit-.*\.log$/.test(name));
  const entries = (await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8'))))
    .flatMap((body) => body.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
  return entries.filter((entry) => entry.action === 'question.delete' && entry.object_type === 'question'
    && String(entry.object_id) === String(questionId));
}

// Catch accidental physical deletion, current-query leakage, revival writes,
// audit replay and lock-order regressions through real HTTP and MySQL effects.
export async function proveQuestionSoftDelete(ctx, fixtures) {
  let assertions = 0;
  const check = Object.fromEntries(['equal', 'deepEqual', 'ok'].map((method) => [method, (...args) => {
    assertions++;
    return assert[method](...args);
  }]));
  const { admin, writer, reader, categoryId, manual, staleVersionId, media, mediaId, scoredPapers, writerQuestion, legacyId } = fixtures;
  const questionId = String(manual.question_id);
  const versionId = String(manual.current_version_id);
  const baseline = { expected_version_id: versionId, expected_enabled: true };
  const ok = async (method, path, body, actor = admin.actor) => {
    const response = await ctx.request(actor, method, path, body);
    check.equal(response.status, 200, `${method} ${path}: ${response.status}/${response.code}`);
    return response.data;
  };
  const facts = async (id) => ({
    identity: await ctx.queryTestDb('SELECT * FROM question WHERE id=?', [id]),
    versions: await ctx.queryTestDb('SELECT * FROM question_version WHERE question_id=? ORDER BY revision', [id]),
  });
  const deleteQuestion = async (question, actor = admin.actor) => assertDeleteReceipt(
    await ctx.request(actor, 'DELETE', `/ai/questions/${question.question_id}`, {
      expected_version_id: question.current_version_id, expected_enabled: question.enabled,
    }), question.question_id, check,
  );
  const createDraft = async (question, label) => {
    const paper = await ok('POST', '/admin/papers', { title: `删除隔离验收 ${label} ${randomUUID()}`, mode: 'fixed', category_id: categoryId });
    await ok('PUT', `/admin/papers/${paper.id}/questions`, { items: [{ question_version_id: question.current_version_id, score_cents: 10000 }] });
    return String(paper.id);
  };

  const before = await facts(questionId);
  const beforeAudits = await deleteAudits(ctx, questionId);
  check.equal(beforeAudits.length, 0);
  for (const [actor, expectedStatus] of [[null, 401], [reader.actor, 403]]) {
    const denied = await ctx.request(actor, 'DELETE', `/ai/questions/${questionId}`, baseline);
    check.equal(denied.status, expectedStatus, 'DELETE must require questions:write');
  }
  for (const invalid of [
    {}, { expected_enabled: true }, { expected_version_id: versionId },
    { ...baseline, expected_enabled: 'true' }, { ...baseline, expected_enabled: null },
    { ...baseline, expected_version_id: Number(versionId) }, { ...baseline, expected_version_id: 'invalid' },
    { ...baseline, enabled: false },
  ]) {
    const rejected = await ctx.request(admin.actor, 'DELETE', `/ai/questions/${questionId}`, invalid);
    check.equal(rejected.status, 400, 'DELETE DTO must reject missing, coerced and unknown fields');
  }
  for (const stale of [{ ...baseline, expected_version_id: staleVersionId }, { ...baseline, expected_enabled: false }]) {
    const rejected = await ctx.request(admin.actor, 'DELETE', `/ai/questions/${questionId}`, stale);
    check.equal(rejected.status, 409);
    check.equal(rejected.code, 40940, 'DELETE compares version and enabled baselines independently');
  }
  check.deepEqual(await facts(questionId), before, 'invalid/conflicting/forbidden DELETE must leave every stored fact unchanged');
  check.deepEqual(await deleteAudits(ctx, questionId), beforeAudits);

  const stopped = await ok('PUT', `/ai/questions/${writerQuestion.question_id}/enabled`, {
    expected_version_id: writerQuestion.current_version_id, enabled: false,
  }, writer.actor);
  check.equal(stopped.enabled, false);
  const [stoppedRow] = await ctx.queryTestDb('SELECT deleted_at FROM question WHERE id=?', [writerQuestion.question_id]);
  check.equal(stoppedRow.deleted_at, null, 'stopping is reversible and is not logical deletion');
  check.equal((await ok('GET', `/ai/questions/${writerQuestion.question_id}`)).enabled, false);
  const disabledList = await ok('GET', `/ai/questions?category_id=${categoryId}&enabled=false&page_size=100`);
  check.ok(disabledList.list.some((item) => item.question_id === String(writerQuestion.question_id)));
  await deleteQuestion(stopped, writer.actor); // write-only administrator is sufficient.

  const draftId = await createDraft(manual, '草稿保留');
  const mediaPaperId = await createDraft(media, '历史媒体');
  await ok('POST', `/admin/papers/${mediaPaperId}/publish`);
  const paperIds = [...scoredPapers.map((paper) => String(paper.id)), mediaPaperId];
  const frozenViews = await Promise.all(paperIds.map((id) => ok('GET', `/admin/papers/${id}/preview/answers`)));
  const frozenRows = await ctx.queryTestDb(
    'SELECT rq.* FROM paper_release_question rq JOIN paper_release r ON r.id=rq.release_id WHERE r.paper_id IN (?,?,?) ORDER BY rq.id', paperIds,
  );
  const mediaBefore = await facts(String(media.question_id));
  const referencesBefore = await ctx.queryTestDb('SELECT * FROM media_reference WHERE asset_id=? ORDER BY id', [mediaId]);
  const authoring = await ok('POST', '/admin/question-documents/assemble', { version_ids: [versionId] });
  const candidatesBefore = await ok('GET', `/admin/papers/${draftId}/candidates?type=single&difficulty=easy&page_size=100`);
  check.ok(candidatesBefore.items.some((item) => String(item.question_id) === questionId), 'fixture must be a real current candidate before deletion');

  const receipt = assertDeleteReceipt(await ctx.request(admin.actor, 'DELETE', `/ai/questions/${questionId}`, baseline), questionId, check);
  await deleteQuestion(media);
  const after = await facts(questionId);
  check.equal(after.identity.length, 1, 'deleted identity must remain physically stored');
  check.equal(after.identity[0].is_enabled, 0);
  // queryTestDb uses mysql2's host-local Date parser, while the API stores UTC
  // DATETIME values. Read the SQL literal to verify precision without re-zoning.
  const [storedDeleteTime] = await ctx.queryTestDb("SELECT DATE_FORMAT(deleted_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS utc_value FROM question WHERE id=?", [questionId]);
  check.equal(new Date(storedDeleteTime.utc_value).toISOString(), receipt.deleted_at);
  const { deleted_at: deletedAt, is_enabled: enabled, ...retained } = after.identity[0];
  const { deleted_at: originalDeletedAt, is_enabled: originalEnabled, ...original } = before.identity[0];
  check.deepEqual(retained, original, 'delete only changes deleted_at and is_enabled');
  check.deepEqual(after.versions, before.versions, 'delete must not create revisions or rewrite historical content');
  check.deepEqual((await facts(String(media.question_id))).versions, mediaBefore.versions);
  check.deepEqual(await ctx.queryTestDb('SELECT * FROM media_reference WHERE asset_id=? ORDER BY id', [mediaId]), referencesBefore, 'delete must preserve exact media owners');
  check.equal((await ctx.request(admin.actor, 'GET', `/media/${mediaId}/content`)).status, 200, 'historical media remains authorized');
  check.deepEqual(await Promise.all(paperIds.map((id) => ok('GET', `/admin/papers/${id}/preview/answers`))), frozenViews);
  check.deepEqual(await ctx.queryTestDb(
    'SELECT rq.* FROM paper_release_question rq JOIN paper_release r ON r.id=rq.release_id WHERE r.paper_id IN (?,?,?) ORDER BY rq.id', paperIds,
  ), frozenRows, 'published questions, scores and media snapshots must remain byte-for-byte stable');

  for (const enabledFilter of ['', '&enabled=true', '&enabled=false']) {
    const list = await ok('GET', `/ai/questions?category_id=${categoryId}&page_size=100${enabledFilter}`);
    for (const id of [questionId, String(media.question_id), String(writerQuestion.question_id)]) {
      check.equal(list.list.some((item) => String(item.question_id) === id), false, `deleted question leaked through list ${enabledFilter}`);
    }
  }
  const detail = await ctx.request(admin.actor, 'GET', `/ai/questions/${questionId}`);
  check.equal(detail.status, 404); check.equal(detail.code, 40401);
  const history = await ok('GET', `/ai/questions/${questionId}/history`);
  check.equal(history.total, 2);
  check.deepEqual(history.items.map((item) => item.stem), ['<p>修订后的题干</p>', '<p>进入受限空间前应做什么？</p>']);
  const candidatesAfter = await ok('GET', `/admin/papers/${draftId}/candidates?type=single&difficulty=easy&page_size=100`);
  check.equal(candidatesAfter.items.some((item) => [questionId, String(media.question_id)].includes(String(item.question_id))), false);
  const draft = await ok('GET', `/admin/papers/${draftId}`);
  check.equal(draft.questions.length, 1);
  check.equal(draft.questions[0].question_id, questionId);
  check.equal(draft.questions[0].question_version_id, versionId);
  const refusedPublish = await ctx.request(admin.actor, 'POST', `/admin/papers/${draftId}/publish`);
  check.equal(refusedPublish.status, 409); check.equal(refusedPublish.code, 40970);
  const [draftState] = await ctx.queryTestDb('SELECT status,(SELECT COUNT(*) FROM paper_release WHERE paper_id=?) AS releases FROM exam_paper WHERE id=?', [draftId, draftId]);
  check.equal(draftState.status, 'draft'); check.equal(Number(draftState.releases), 0);

  for (const [method, path, body] of [
    ['PUT', `/ai/questions/${questionId}/enabled`, { enabled: true, expected_version_id: versionId }],
    ['PUT', `/ai/questions/${questionId}/enabled`, { enabled: false, expected_version_id: versionId }],
    ['PUT', `/ai/questions/${questionId}`, { expected_version_id: versionId, expected_enabled: false, stem: '<p>不能修订复活</p>' }],
    ['POST', '/admin/question-documents/commit', { request_id: randomUUID(), bundle: authoring }],
  ]) {
    const rejected = await ctx.request(admin.actor, method, path, body);
    check.equal(rejected.status, 404); check.equal(rejected.code, 40401, 'deleted identity cannot be revived by any write path');
  }
  const repeated = assertDeleteReceipt(await ctx.request(writer.actor, 'DELETE', `/ai/questions/${questionId}`, {
    expected_version_id: staleVersionId, expected_enabled: true,
  }), questionId, check);
  check.deepEqual(repeated, receipt, 'repeated DELETE returns original timestamp even with stale baselines');
  check.deepEqual(await facts(questionId), after, 'retries and rejected writes cannot touch deleted facts');
  const [commits] = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question_authoring_commit WHERE owner_id=?', [admin.id]);
  check.equal(Number(commits.total), 0, 'rejected authoring commit must roll back its receipt reservation');
  const audits = await deleteAudits(ctx, questionId);
  check.equal(audits.length, 1, 'only the first successful DELETE is audited');
  check.equal(audits[0].detail.deleted_at, receipt.deleted_at);

  const legacyBefore = await facts(legacyId);
  await deleteQuestion({ question_id: legacyId, current_version_id: null, enabled: true });
  const legacyAfter = await facts(legacyId);
  check.equal(legacyAfter.identity.length, 1);
  check.equal(legacyAfter.identity[0].current_version_id, null);
  check.deepEqual(legacyAfter.versions, legacyBefore.versions, 'deleting true legacy must not synthesize a revision');

  const raceEvidence = [];
  for (const deleteFirst of [true, false]) {
    const question = await ok('POST', '/ai/questions', {
      category_id: categoryId, difficulty: 'easy', type: 'single', stem: '<p>并发发布删除验收题</p>',
      options: [{ text: '正确项' }, { text: '干扰项' }], answer: [0],
    });
    const paperId = await createDraft(question, deleteFirst ? '先删除' : '先发布');
    raceEvidence.push(await proveDeletePublicationOrdering(ctx, {
      paperId, questionId: question.question_id, versionId: question.current_version_id, deleteFirst,
    }, admin.id));
  }
  console.log(JSON.stringify({ suite: 'question-soft-delete', assertions, races: raceEvidence,
    boundaries: 'http-permission,dto,double-cas,disabled-not-deleted,lists,candidates,history,physical-facts,media,frozen-release,draft-publish,revival,idempotency,audit,legacy-null-version' }));
}
