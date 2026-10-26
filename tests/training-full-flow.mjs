import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { startMockAi } from './training-ai-question-import.mjs';
import { randomStrongPassword } from './training-access.mjs';
import { assertAttemptView, assertPureTimeout, assertTimeoutFacts, examLearner } from './support/exam-mobile-fixtures.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One dataset crosses the real HTTP boundaries. A broken publication snapshot,
// changed frozen question, incorrect manual score, or mixed-difficulty report must
// fail the independent literal expectations below, not merely a helper mock.
async function ok(ctx, actor, method, path, body, headers) {
  const response = await ctx.request(actor, method, path, body, headers);
  assert.equal(response.status, 200, `${method} ${path}: ${response.status}/${response.code} ${response.message || ''}`);
  return response.data;
}

export async function flowLogin(ctx, username, password, label) {
  const headers = { 'X-Forwarded-For': `198.51.100.${(flowLogin.sequence = (flowLogin.sequence || 100) + 1)}` };
  const captcha = await ok(ctx, null, 'POST', '/auth/captcha', undefined, headers);
  const redis = new Redis({ host: ctx.env.REDIS_HOST, port: Number(ctx.env.REDIS_PORT), password: ctx.env.REDIS_PASSWORD || undefined });
  let answer;
  try { answer = await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captcha.captcha_id}`); }
  finally { await redis.quit(); }
  const actor = {};
  const login = await ok(ctx, actor, 'POST', '/auth/login', {
    username, password, captcha_id: captcha.captcha_id, captcha_code: answer,
  }, headers);
  actor.accessToken = login.access_token;
  let currentPassword = password;
  if (login.force_change_password) {
    currentPassword = randomStrongPassword(username, label);
    const changed = await ok(ctx, actor, 'PUT', '/auth/password', { old_password: password, new_password: currentPassword });
    actor.accessToken = changed.access_token;
  }
  return { actor, id: String(login.user.id), username, password: currentPassword };
}

function multipart(fields, bytes, filename, contentType) {
  const boundary = `----full-flow-${randomBytes(12).toString('hex')}`;
  const chunks = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(ctx, actor, path, fields, bytes, filename, type) {
  const part = multipart(fields, bytes, filename, type);
  return ok(ctx, actor, 'POST', path, part.body, part.headers);
}

async function poll(read, done, label) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const value = await read();
    assert.notEqual(value.status || value.parse_status, 'failed', `${label} failed`);
    if (done(value)) return value;
    await pause(250);
  }
  throw new Error(`${label} did not finish within 45 seconds`);
}

async function regulationDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = [
    '第一章 总则：为加强安全生产管理，制定本制度。本制度适用于全部生产场所和机构学员。',
    '第二章 动火作业必须事先审批，审批有效期不超过二十四小时，清理现场可燃物。',
    '第三章 新员工必须完成三级安全教育；每年复训，考试结果必须保留。',
    '第四章 受限空间作业先通风再检测，安排监护人员，进入前核验防护设备。',
    '第五章 定期开展安全隐患排查，重大隐患立即上报并建立整改台账。',
  ];
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function videoBytes(ctx) {
  const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ctx.trackChild(child);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let errorText = '';
    let error;
    const timeout = setTimeout(() => { error = new Error('video fixture timed out'); child.kill('SIGKILL'); }, 15_000);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { errorText = `${errorText}${chunk}`.slice(-2000); });
    child.once('error', (cause) => { error = cause; });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (error || code !== 0) reject(error || new Error(`video fixture: ${errorText}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function assertSafe(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.equal(['answer', 'analysis', 'rubric', 'snapshot_json', 'display_to_original'].includes(key), false, `in-progress secret: ${key}`);
    assertSafe(item);
  }
}

export async function prepareTrainingFlow(ctx) {
  const tag = randomBytes(4).toString('hex');
  const admin = await flowLogin(ctx, 'admin', ctx.adminPassword, '超级管理员');
  const category = await ok(ctx, admin.actor, 'POST', '/admin/training-categories', { name: `全链安全培训 ${tag}` });
  const categoryId = String(category.id);
  const learners = [];
  for (const source of ['institution', 'external']) {
    const username = `flow_${source}_${tag}`;
    const actor = await examLearner(ctx, { categoryId, source, username });
    learners.push({ actor, id: actor.userId, username, source, difficulty: source === 'institution' ? 'easy' : 'hard' });
  }

  const regulation = await ok(ctx, admin.actor, 'POST', '/admin/question-materials', { title: `全链安全资料 ${tag}`, description: '安全生产出题依据' });
  const regulationId = String(regulation.id);
  const version = await upload(ctx, admin.actor, `/admin/question-materials/${regulationId}/versions`, {}, await regulationDocx(), 'safety.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await poll(() => ok(ctx, admin.actor, 'GET', `/admin/question-materials/${regulationId}/versions/${version.id}/status`), (value) => value.parse_status === 'parsed', 'material parsing');

  const mock = await startMockAi(0);
  try {
    await ok(ctx, admin.actor, 'PUT', '/ai/config', { base_url: `http://127.0.0.1:${mock.address().port}/v1`, api_key: `mock-${randomBytes(18).toString('hex')}`, model: 'mock-model' });
    assert.equal((await ok(ctx, admin.actor, 'POST', '/ai/config/test')).ok, true);
    const referenceHeaders = ['category', 'type', 'difficulty', 'stem', 'options', 'answer', 'analysis'];
    const referenceRow = [categoryId, 'single', 'easy', `全链参考题 ${tag}`, JSON.stringify([{ text: '先核验' }, { text: '直接作业' }]), '[0]', '参考题解析'];
    const beforeGeneration = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question');
    const generated = await upload(ctx, admin.actor, '/admin/questions/ai-import-tasks', { format: 'txt' }, Buffer.from(`${referenceHeaders.join('\t')}\n${referenceRow.join('\t')}\n`), 'reference.txt', 'text/plain; charset=utf-8');
    const task = await poll(() => ok(ctx, admin.actor, 'GET', `/admin/questions/ai-import-tasks/${generated.task_id}`), (value) => value.status === 'completed', 'AI reference generation');
    const generatedBatch = await ok(ctx, admin.actor, 'GET', `/admin/questions/ai-import-batches/${task.batch_id}`);
    assert.equal(generatedBatch.rows.length, 2);
    assert.deepEqual(await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question'), beforeGeneration, '生成与预览前不得入库');
    const selected = generatedBatch.rows.filter((item) => item.difficulty === 'easy').map((item) => item.row_number);
    const confirmed = await ok(ctx, admin.actor, 'POST', `/admin/questions/ai-import-batches/${task.batch_id}/commit`, { row_numbers: selected });
    assert.equal(confirmed.enabled, true); assert.equal(confirmed.created_ids.length, 1);
    const aiQuestion = await ok(ctx, admin.actor, 'GET', `/ai/questions/${confirmed.created_ids[0]}`);
    assert.equal(aiQuestion.enabled, true); assert.equal(aiQuestion.source, 'ai');
    assert.equal(Object.hasOwn(aiQuestion, 'score'), false); assert.equal(Object.hasOwn(aiQuestion, 'concept_id'), false);
    // Seed only a historical material binding in this isolated fixture so the
    // retained source filter contract remains covered after its write route retires.
    await ctx.queryTestDb('UPDATE question SET regulation_id=?,version_id=? WHERE id=?', [regulationId, String(version.id), aiQuestion.question_id]);
    await ctx.queryTestDb('UPDATE question_version SET regulation_id=?,regulation_version_id=? WHERE id=?', [regulationId, String(version.id), aiQuestion.current_version_id]);
    const sources = await ok(ctx, admin.actor, 'GET', `/admin/papers/regulation-options?category_id=${categoryId}`);
    assert.ok(sources.items.some(item => item.id === regulationId), 'new AI material must be selectable as a paper source');
    const sourcedPaper = await ok(ctx, admin.actor, 'POST', '/admin/papers', {
      title: `资料来源固定卷 ${tag}`, mode: 'fixed', category_id: categoryId, regulation_ids: [regulationId],
    });
    await ok(ctx, admin.actor, 'PUT', `/admin/papers/${sourcedPaper.id}`, { regulation_ids: [regulationId], title: `资料来源固定卷已编辑 ${tag}` });
    await ok(ctx, admin.actor, 'PUT', `/admin/papers/${sourcedPaper.id}/questions`, {
      items: [{ question_version_id: String(aiQuestion.current_version_id), score_cents: 10000 }],
    });
    await ok(ctx, admin.actor, 'POST', `/admin/papers/${sourcedPaper.id}/publish`);
    const otherCategory = await ok(ctx, admin.actor, 'POST', '/admin/training-categories', { name: `无题来源类别 ${tag}` });
    const otherSources = await ok(ctx, admin.actor, 'GET', `/admin/papers/regulation-options?category_id=${otherCategory.id}`);
    assert.equal(otherSources.items.some(item => item.id === regulationId), false);
    const invalidSource = await ctx.request(admin.actor, 'POST', '/admin/papers', {
      title: `不能跨类别选择资料 ${tag}`, mode: 'fixed', category_id: String(otherCategory.id), regulation_ids: [regulationId],
    });
    assert.equal(invalidSource.status, 409, 'source must contain questions in this paper category');
  } finally {
    mock.closeAllConnections();
    await new Promise((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
  }

  const question = (difficulty, type) => ({
    category_id: categoryId, difficulty, type, stem: `<p>${difficulty} ${type} ${tag}</p>`,
    options: type === 'judgment' ? [{ text: '正确' }, { text: '错误' }] : [{ text: '安全核验' }, { text: '现场监护' }, { text: '忽略隐患' }],
    answer: type === 'multiple' ? [0, 1] : [0],
    analysis: '<p>遵守安全制度。</p>',
  });
  for (const difficulty of ['easy', 'hard']) {
    for (const type of ['single', 'multiple', 'judgment']) {
      if ((difficulty === 'easy' && type === 'single') || (difficulty === 'hard' && type === 'multiple')) continue;
      const created = await ok(ctx, admin.actor, 'POST', '/ai/questions', question(difficulty, type));
      assert.equal(created.enabled, true);
    }
  }
  const imported = question('hard', 'multiple');
  const headers = ['category', 'type', 'difficulty', 'stem', 'options', 'answer', 'analysis'];
  const row = { ...imported, category: '', options: JSON.stringify(imported.options), answer: JSON.stringify(imported.answer) };
  const bytes = Buffer.from(`\uFEFF${headers.join('\t')}\r\n${headers.map((key) => row[key] ?? '').join('\t')}\r\n`);
  const preview = await upload(ctx, admin.actor, '/admin/questions/import-preview', { format: 'txt', category_id: categoryId }, bytes, 'questions.txt', 'text/plain; charset=utf-8');
  assert.deepEqual(preview.valid_rows, [2]);
  const committed = await ok(ctx, admin.actor, 'POST', `/admin/questions/import-batches/${preview.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(committed.created_ids.length, 1);
  assert.equal(committed.enabled, true);

  const course = await ok(ctx, admin.actor, 'POST', '/admin/courses', { title: `安全培训视频 ${tag}`, category_id: categoryId, regulation_ids: [regulationId] });
  const courseId = String(course.id);
  const chapter = await ok(ctx, admin.actor, 'POST', `/admin/courses/${courseId}/chapters`, { title: '安全入门', sort_order: 1 });
  const lesson = await ok(ctx, admin.actor, 'POST', `/admin/courses/${courseId}/lessons`, { chapter_id: String(chapter.id), title: '作业前检查', lesson_type: 'video', required: true, sort_order: 1 });
  const video = await upload(ctx, admin.actor, '/media/upload', { purpose: 'video' }, await videoBytes(ctx), 'safety.mp4', 'video/mp4');
  assert.equal(video.status, 'ready');
  await ok(ctx, admin.actor, 'POST', `/admin/courses/${courseId}/lessons/${lesson.id}/versions`, { asset_id: String(video.asset_id) });
  await ok(ctx, admin.actor, 'POST', `/admin/courses/${courseId}/publish`);
  const session = await ok(ctx, learners[0].actor, 'POST', '/me/video-sessions', { lesson_id: String(lesson.id) });
  await ok(ctx, learners[0].actor, 'POST', `/me/video-sessions/${session.session_id}/heartbeat`, { seq: 1, position_ms: 0, state: 'playing' });
  await pause(1300);
  const learned = await ok(ctx, learners[0].actor, 'POST', `/me/video-sessions/${session.session_id}/heartbeat`, { seq: 2, position_ms: session.progress.duration_ms, state: 'ended' });
  assert.equal(learned.completed, true, 'one-second real-time video fixture must be completed by server accounting');
  await ok(ctx, learners[0].actor, 'POST', `/me/video-sessions/${session.session_id}/close`);

  const paper = await ok(ctx, admin.actor, 'POST', '/admin/papers', {
    title: `同场分难度考试 ${tag}`, category_id: categoryId, mode: 'random', requires_learning: false,
    course_ids: [courseId], rules: ['single', 'multiple', 'judgment'].map((type) => ({ type, count: 1, score_cents: type === 'multiple' ? 2000 : 4000 })),
  });
  const paperId = String(paper.id);
  const release = await ok(ctx, admin.actor, 'POST', `/admin/papers/${paperId}/publish`);
  for (const learner of learners) {
    learner.attempt = await ok(ctx, learner.actor, 'POST', `/me/exams/${paperId}/start`);
    assertAttemptView(learner.attempt);
    const [assignment] = await ctx.queryTestDb('SELECT difficulty FROM exam_record WHERE id=?', [learner.attempt.record_id]);
    assert.equal(assignment.difficulty, learner.difficulty);
    assert.equal(learner.attempt.questions.length, 3);
    assertSafe(learner.attempt);
    learner.answers = learner.attempt.questions.map((item) => {
      if (learner.source === 'external' && item.type !== 'multiple') return { item_id: item.item_id, option_ids: [] };
      const text = (node) => node.text || (node.content || []).map(text).join('');
      const selected = item.options.flatMap((option) => {
        const label = text(option.content);
        const correct = item.type === 'judgment' ? label === '正确' : /安全核验|现场监护|（正确）/.test(label);
        return correct ? [option.id] : [];
      });
      return { item_id: item.item_id, option_ids: item.type === 'multiple' && learner.source === 'institution' ? selected.slice(0, 1) : selected };
    });
    const [unsent] = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM exam_answer WHERE exam_record_id=?', [learner.attempt.record_id]);
    assert.equal(Number(unsent.count), 0, 'local answers do not write server drafts');
  }
  await ctx.restartApi();
  for (const learner of learners) {
    const recovered = await ok(ctx, learner.actor, 'GET', `/me/exam-records/${learner.attempt.record_id}`);
    assertSafe(recovered);
    assertAttemptView(recovered);
    assert.deepEqual(recovered.questions, learner.attempt.questions);
  }
  return { admin, learners, categoryId, regulationId, courseId, paperId, releaseId: String(release.release_id) };
}

export async function finishTrainingFlow(ctx, flow) {
  const [institution, external] = flow.learners;
  const manual = await ok(ctx, institution.actor, 'POST', `/me/exam-records/${institution.attempt.record_id}/submit`, { record_id: institution.attempt.record_id, answers: institution.answers });
  assert.equal(manual.grading_state, 'finalized');
  assert.equal(manual.score, 90);
  // Advance only the owned fixture's deadline, never the persisted answer/score.
  await ctx.queryTestDb('UPDATE exam_record SET deadline_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?', [external.attempt.record_id]);
  const timeout = await ok(ctx, external.actor, 'GET', `/me/exam-records/${external.attempt.record_id}`);
  assertAttemptView(timeout, { status: 'timeout' });
  await assertTimeoutFacts(ctx, external.attempt.record_id);
  for (const [learner, expected] of [[institution, 90], [external, 0]]) {
    // The administrator result reader uses the rich-content projection. Compare
    // the same negotiated representation instead of schema-2 and schema-3 shapes.
    const result = await ok(ctx, learner.actor, 'GET', `/me/exam-records/${learner.attempt.record_id}/result`, undefined, {
      'X-Question-Content-Version': '3',
    });
    assert.equal(result.grading_state, learner === institution ? 'finalized' : 'not_submitted');
    assert.equal(result.score, expected);
    assert.equal(result.passed, expected >= 60);
    assert.equal(result.items.length, learner === institution ? 3 : 0);
    if (learner === external) assertPureTimeout(result);
    const administrative = await ok(ctx, flow.admin.actor, 'GET', `/admin/exam-records/${learner.attempt.record_id}/result`);
    assert.deepEqual(administrative, result, 'admin and learner must consume the same final result');
    learner.result = result;
  }
}

export async function run(ctx) {
  const flow = await prepareTrainingFlow(ctx);
  const recordsPath = `/admin/exam-records?paper_id=${flow.paperId}`;
  const active = await ok(ctx, flow.admin.actor, 'GET', recordsPath);
  assert.equal(active.total, 2);
  assertSafe(active);
  for (const learner of flow.learners) {
    const row = active.items.find((item) => item.record_id === learner.attempt.record_id);
    assert.equal(row.source, learner.source);
    assert.equal(row.difficulty, learner.difficulty);
    assert.equal(row.grading_state, 'not_submitted');
  }
  await finishTrainingFlow(ctx, flow);
  const ended = await ok(ctx, flow.admin.actor, 'GET', recordsPath);
  assert.equal(ended.items.filter((row) => row.grading_state === 'finalized').length, 1);
  assert.equal(ended.items.filter((row) => row.status === 'timeout').length, 1);
  for (const path of ['/users', '/departments/tree', '/regulations', '/admin/grading', `/admin/exams/${flow.paperId}/monitor`]) {
    assert.equal((await ctx.request(flow.admin.actor, 'GET', path)).status, 404, `retired interface must not remain callable: ${path}`);
  }
  const summary = await ok(ctx, flow.admin.actor, 'GET', `/statistics/training/summary?paper_id=${flow.paperId}`);
  assert.equal(summary.release_id, flow.releaseId);
  assert.equal(summary.eligible_count, 2);
  assert.equal(summary.eligible_started_count, 2);
  assert.equal(summary.historical_started_count, 2);
  assert.equal(summary.participation_rate, 1);
  assert.equal(summary.finalized_users, 1);
  for (const path of [
    '/statistics/training/options?unexpected=1',
    `/statistics/training/summary?paper_id=${flow.paperId}&unexpected=1`,
    `/statistics/training/ranking?paper_id=${flow.paperId}&difficulty=easy&unexpected=1`,
    `/statistics/training/export?paper_id=${flow.paperId}&difficulty=easy&unexpected=1`,
    '/admin/dashboard?unexpected=1',
  ]) {
    const rejected = await ctx.request(flow.admin.actor, 'GET', path);
    assert.equal(rejected.status, 400, `unknown query must be rejected: ${path}`);
    assert.equal(rejected.code, 40001);
  }
  assert.equal((await ctx.request(flow.admin.actor, 'GET', `/statistics/training/ranking?paper_id=${flow.paperId}`)).status, 400);
  for (const [learner, expectedScore] of [[flow.learners[0], 90], [flow.learners[1], null]]) {
    const group = summary.score_groups.find((item) => item.difficulty === learner.difficulty);
    assert.equal(group?.finalized_users || 0, expectedScore === null ? 0 : 1);
    if (expectedScore !== null) {
      assert.equal(group.average_score, expectedScore);
      assert.equal(group.pass_rate, expectedScore >= 60 ? 1 : 0);
    }
    const filter = `paper_id=${flow.paperId}&difficulty=${learner.difficulty}&page=1&page_size=20`;
    const ranking = await ok(ctx, flow.admin.actor, 'GET', `/statistics/training/ranking?${filter}`);
    assert.equal(ranking.total, expectedScore === null ? 0 : 1);
    if (expectedScore !== null) {
      assert.equal(ranking.items[0].rank, 1);
      assert.equal(ranking.items[0].user_id, learner.id);
      assert.equal(ranking.items[0].score, expectedScore);
      assert.equal(ranking.items[0].record_id, learner.attempt.record_id);
    }
    const exported = await ok(ctx, flow.admin.actor, 'GET', `/statistics/training/export?${filter}`);
    assert.ok(Buffer.isBuffer(exported));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported);
    const rows = [];
    workbook.getWorksheet('难度排名').eachRow((row, number) => {
      if (number > 1) rows.push(Array.from({ length: 8 }, (_, index) => row.getCell(index + 1).value));
    });
    assert.deepEqual(rows, ranking.items.map((row) => [row.rank, row.user_id, row.name, row.source, row.difficulty, row.score, row.duration_seconds, row.record_id]), 'export and screen must use identical query rows');
  }
  assert.equal((await ctx.request(flow.learners[0].actor, 'GET', `/statistics/training/summary?paper_id=${flow.paperId}`)).status, 403);
  console.log('[training-full-flow] materials/AI-preview-confirm/import/enabled/video/mobile-identity/stable-ID/restart/manual-scoring/pure-timeout/records/statistics/export passed');
}
