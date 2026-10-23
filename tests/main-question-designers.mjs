import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { flowLogin } from './training-full-flow.mjs';
import { examLearner } from './support/exam-mobile-fixtures.mjs';

export const CONTENT_V3 = { 'X-Question-Content-Version': '3' };
export function assertions() {
  let count = 0;
  const check = Object.fromEntries(['equal', 'deepEqual', 'ok', 'match', 'notEqual'].map((name) => [name, (...args) => { count++; assert[name](...args); }]));
  return { check, count: () => count };
}
export async function api(ctx, actor, method, path, body, headers) {
  const response = await ctx.request(actor, method, path, body, headers);
  assert.equal(response.status, 200, `${method} ${path}: ${JSON.stringify(response)}`);
  return response.data;
}
export async function prepare(ctx, label) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[a-zA-Z0-9_]+$/, 'designer suites only use their owned test database');
  const admin = await flowLogin(ctx, 'admin', ctx.adminPassword, label);
  const category = await api(ctx, admin.actor, 'POST', '/admin/training-categories', { name: `${label} ${randomBytes(4).toString('hex')}` });
  return { admin, categoryId: String(category.id) };
}
export async function authoringBundle(categoryId, assetId) {
  const document = JSON.parse(await readFile(new URL('./fixtures/question-authoring-v3/rich-authoring.json', import.meta.url), 'utf8'));
  const clientId = 'question_fixture_00001';
  document.questions[clientId].category_id = categoryId;
  document.questions[clientId].score_cents = 10000;
  const stem = document.content.content[0].content[0].content;
  stem.push({ type: 'paragraph', content: [{ type: 'text', text: '保留斜体和下划线', marks: [{ type: 'italic' }, { type: 'underline' }] }] });
  stem.push({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '表格事实' }] }] }] }] });
  if (assetId) stem.push({ type: 'paragraph', content: [{ type: 'mediaImage', attrs: { asset_id: assetId, alt: '受控题图' } }] });
  // The shared contract fixture exercises every enabled node/mark family,
  // nested lists and merged table cells across form -> author -> exam reads.
  const rich = JSON.parse(await readFile(new URL('./fixtures/question-authoring-v3/rich-content.json', import.meta.url), 'utf8'));
  const controlled = (node) => {
    if (node.type === 'image') return assetId ? { type: 'mediaImage', attrs: { asset_id: assetId, alt: null } } : null;
    return { ...node, ...(node.content ? { content: node.content.map(controlled).filter(Boolean) } : {}) };
  };
  stem.push(...rich.stem.content.map(controlled));
  document.content.content[0].content.slice(1).forEach((option, index) => { option.content = rich.options[index].content.content.map(controlled); });
  document.questions[clientId].analysis = controlled(rich.analysis);
  return {
    document, identities: {},
    option_ids: { [clientId]: { editor_option_00000001: 'A', editor_option_00000002: 'B' } },
    layouts: { [clientId]: layout('原稿布局') },
  };
}
export function layout(title) {
  return { schema_version: 1, settings: { templateName: title, pageSize: 'A5', pageOrientation: 2, pageSizeReduce: { top: 12, bottom: 13, left: 14, right: 15 } } };
}
export async function uploadImage(ctx, actor) {
  const boundary = `----designer-${randomBytes(12).toString('hex')}`;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nquestion\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="designer.png"\r\nContent-Type: image/png\r\n\r\n`), bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return String((await api(ctx, actor, 'POST', '/media/upload', body, { 'Content-Type': `multipart/form-data; boundary=${boundary}` })).asset_id);
}
export async function fixedPaper(ctx, actor, categoryId, versionId, title) {
  const paper = await api(ctx, actor, 'POST', '/admin/papers', { title, mode: 'fixed', category_id: categoryId, requires_learning: false, pass_score: 60, max_attempts: 3, designer_layout: layout(title) });
  await api(ctx, actor, 'PUT', `/admin/papers/${paper.id}/questions`, { items: [{ question_version_id: versionId, score_cents: 10000 }] });
  const published = await api(ctx, actor, 'POST', `/admin/papers/${paper.id}/publish`);
  return { paperId: String(paper.id), releaseId: String(published.release_id) };
}
export async function writeFacts(ctx) {
  const [facts] = await ctx.queryTestDb('SELECT (SELECT COUNT(*) FROM question) AS questions,(SELECT COUNT(*) FROM question_version) AS versions,(SELECT COUNT(*) FROM question_authoring_commit) AS receipts,(SELECT COUNT(*) FROM exam_assignment) AS assignments,(SELECT COUNT(*) FROM exam_record) AS records,(SELECT COUNT(*) FROM exam_answer) AS answers');
  return facts;
}
export function assertSafe(check, value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    check.equal(['answer', 'correct_answer', 'answer_option_ids', 'analysis', 'checked', 'correct', 'authoring_json', 'authoringJson', 'identities', 'display_to_original', 'source', 'difficulty', 'category_id', 'href', 'src', 'style', 'onclick'].includes(key), false, `unsafe student field ${key}`);
    assertSafe(check, child);
  }
}

export async function run(ctx) {
  const { check, count } = assertions(); let stage = 'setup';
  try {
    const { admin, categoryId } = await prepare(ctx, 'main试卷设计器');
    stage = 'difficulty catalog';
    const options = await api(ctx, admin.actor, 'GET', '/admin/questions/authoring-options');
    check.deepEqual(options.difficulties.filter((item) => item.enabled).map((item) => item.code), ['easy', 'hard']);
    check.deepEqual(options.difficulties.find((item) => item.code === 'medium'), { code: 'medium', label: '中级', enabled: false, sort: 20 });
    const assetId = await uploadImage(ctx, admin.actor);
    const bundle = await authoringBundle(categoryId, assetId);
    stage = 'commit and lost response recovery';
    const request = { request_id: randomUUID(), bundle };
    const receipt = await api(ctx, admin.actor, 'POST', '/admin/question-documents/commit', request);
    check.equal(receipt.items.length, 1);
    const { question_id: questionId, saved_version_id: originalVersion } = receipt.items[0];
    const afterCommit = await writeFacts(ctx);
    check.deepEqual(await api(ctx, admin.actor, 'GET', `/admin/question-documents/commits/${request.request_id}`), receipt);
    check.deepEqual(await api(ctx, admin.actor, 'POST', '/admin/question-documents/commit', request), receipt);
    check.deepEqual(await writeFacts(ctx), afterCommit);
    const assembled = await api(ctx, admin.actor, 'POST', '/admin/question-documents/assemble', { version_ids: [originalVersion] });
    check.deepEqual(assembled.option_ids, bundle.option_ids);
    check.deepEqual(assembled.layouts, bundle.layouts);
    check.deepEqual(assembled.document.content, bundle.document.content);
    stage = 'ordinary form revision synchronizes the author copy';
    const original = await api(ctx, admin.actor, 'GET', `/ai/questions/${questionId}`);
    check.equal(original.content_schema_version, 3);
    const revised = await api(ctx, admin.actor, 'PUT', `/ai/questions/${questionId}`, { expected_version_id: originalVersion, difficulty: 'hard', answer: [1] });
    check.equal(revised.status, 'pending');
    check.equal(revised.content_schema_version, 3);
    check.deepEqual(revised.content_json.stem, original.content_json.stem);
    check.deepEqual(revised.content_json.options, original.content_json.options);
    check.deepEqual(revised.content_json.answer_option_ids, ['B']);
    check.notEqual(revised.saved_version_id, originalVersion);
    const reopened = await api(ctx, admin.actor, 'POST', '/admin/question-documents/assemble', { version_ids: [revised.saved_version_id] });
    check.deepEqual(reopened.document.content.content[0].content[0], bundle.document.content.content[0].content[0]);
    check.deepEqual(reopened.option_ids, bundle.option_ids);
    check.deepEqual(reopened.layouts, bundle.layouts);
    check.equal(reopened.document.questions.question_fixture_00001.difficulty, 'hard');
    check.deepEqual(reopened.document.content.content[0].content.slice(1).map((node) => node.attrs.checked), [false, true]);
    const approved = await api(ctx, admin.actor, 'PUT', `/ai/questions/${questionId}/review`, { expected_version_id: revised.saved_version_id, status: 'approved' });
    check.equal(approved.status, 'approved');
    stage = 'fixed layout and publication';
    const { paperId, releaseId } = await fixedPaper(ctx, admin.actor, categoryId, revised.saved_version_id, 'main固定富文卷');
    const detail = await api(ctx, admin.actor, 'GET', `/admin/papers/${paperId}`);
    check.deepEqual(detail.designer_layout, layout('main固定富文卷'));
    check.equal(detail.questions[0].question_version_id, revised.saved_version_id);
    stage = 'schema3 preview preserves rich content without leaking answers';
    const preview = await api(ctx, admin.actor, 'GET', `/admin/papers/${paperId}/preview`);
    const publicQuestion = preview.questions[0];
    check.equal(publicQuestion.content_schema_version, 3);
    check.deepEqual(Object.keys(publicQuestion.content_json).sort(), ['options', 'stem']);
    check.deepEqual(publicQuestion.content_json.stem, revised.content_json.stem);
    check.deepEqual(publicQuestion.content_json.options, revised.content_json.options);
    check.equal(Object.hasOwn(publicQuestion, 'answer'), false);
    check.equal(Object.hasOwn(publicQuestion, 'analysis'), false);
    assertSafe(check, publicQuestion.content_json);
    const answerPreview = await api(ctx, admin.actor, 'GET', `/admin/papers/${paperId}/preview/answers`);
    const answerQuestion = answerPreview.questions[0];
    check.equal(answerQuestion.content_schema_version, 3);
    check.deepEqual(answerQuestion.content_json, revised.content_json);
    check.deepEqual(answerQuestion.content_json.answer_option_ids, ['B']);
    check.deepEqual(answerQuestion.answer, [1]);
    check.ok(JSON.stringify(answerQuestion.content_json.analysis).includes('先通风检测。'));
    stage = 'copy persists independent paper layout';
    const copied = await api(ctx, admin.actor, 'POST', `/admin/papers/${paperId}/copy`);
    const copiedDetail = await api(ctx, admin.actor, 'GET', `/admin/papers/${copied.id}`);
    check.deepEqual(copiedDetail.designer_layout, layout('main固定富文卷'));
    const changedLayout = structuredClone(copiedDetail.designer_layout);
    changedLayout.settings.pageSize = 'A4';
    changedLayout.settings.pageOrientation = 1;
    changedLayout.settings.pageSizeReduce.left = 21;
    await api(ctx, admin.actor, 'PUT', `/admin/papers/${copied.id}`, { designer_layout: changedLayout });
    check.deepEqual((await api(ctx, admin.actor, 'GET', `/admin/papers/${copied.id}`)).designer_layout, changedLayout);
    check.deepEqual((await api(ctx, admin.actor, 'GET', `/admin/papers/${paperId}`)).designer_layout, layout('main固定富文卷'), 'editing the copied layout cannot mutate the source paper layout');
    const learner = await examLearner(ctx, { categoryId, source: 'institution' });
    stage = 'old client rejects before any attempt write';
    const beforeStart = await writeFacts(ctx);
    const old = await ctx.request(learner, 'POST', `/me/exams/${paperId}/start`);
    check.equal(old.status, 409);
    check.equal(old.data.reason_code, 'CONTENT_VERSION_REQUIRED');
    check.deepEqual(await writeFacts(ctx), beforeStart);
    stage = 'capability3 stable ids and exact media access';
    const attempt = await api(ctx, learner, 'POST', `/me/exams/${paperId}/start`, undefined, CONTENT_V3);
    check.equal(attempt.release_id, releaseId);
    check.equal(attempt.questions[0].content_schema_version, 3);
    check.deepEqual(attempt.questions[0].options.map((item) => item.id).sort(), ['A', 'B']);
    assertSafe(check, attempt);
    // Freeze an explicitly reversed display fixture so this check cannot pass
    // by chance when the random seed happens to leave two options in order.
    await ctx.queryTestDb('UPDATE exam_record_question SET display_to_original=? WHERE id=?', ['[1,0]', attempt.questions[0].item_id]);
    const shuffled = await api(ctx, learner, 'GET', `/me/exam-records/${attempt.record_id}`, undefined, CONTENT_V3);
    check.deepEqual(shuffled.questions[0].options.map((option) => option.id), ['B', 'A']);
    check.ok(JSON.stringify(shuffled.questions[0].options[0].content).includes('直接进入'));
    const ticket = await api(ctx, learner, 'POST', `/media/${assetId}/tickets`, { owner_type: 'exam_record_question', owner_id: attempt.questions[0].item_id });
    check.equal(ticket.content_url.includes(learner.accessToken), false);
    const image = await ctx.request(null, 'GET', ticket.content_url.replace(/^\/api\/v1/, ''));
    check.equal(image.status, 200);
    check.equal(image.headers['content-type'], 'image/png');
    const result = await api(ctx, learner, 'POST', `/me/exam-records/${attempt.record_id}/submit`, { record_id: attempt.record_id, answers: shuffled.questions.map((item) => ({ item_id: item.item_id, option_ids: ['B'] })) }, CONTENT_V3);
    check.equal(result.score, 100);
    check.equal(result.submission_method, 'manual');
    check.deepEqual(await api(ctx, learner, 'GET', `/me/exam-records/${attempt.record_id}/result`, undefined, CONTENT_V3), result);
    const wrongLearner = await examLearner(ctx, { categoryId });
    const wrongAttempt = await api(ctx, wrongLearner, 'POST', `/me/exams/${paperId}/start`, undefined, CONTENT_V3);
    await api(ctx, wrongLearner, 'POST', `/me/exam-records/${wrongAttempt.record_id}/submit`, { record_id: wrongAttempt.record_id, answers: wrongAttempt.questions.map((item) => ({ item_id: item.item_id, option_ids: [] })) }, CONTENT_V3);
    const wrong = await api(ctx, wrongLearner, 'GET', '/me/wrong-questions', undefined, CONTENT_V3);
    check.equal(wrong.total, 1);
    check.equal(wrong.items[0].content_schema_version, 3);
    check.ok(JSON.stringify(wrong.items[0]).includes('表格事实'));
    console.log(`[main-question-designers] ${count()} assertions passed: authoring/form/layout/release/capability/media/stable-ID/result/wrong-book`);
  } catch (error) { error.message = `[main-question-designers stage=${stage}] ${error.message}`; throw error; }
}
