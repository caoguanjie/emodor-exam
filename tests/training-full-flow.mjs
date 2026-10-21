import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { startMockAi } from './e2e-smoke.mjs';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One dataset crosses the real HTTP boundaries. A broken publication snapshot,
// lost confirmed draft, premature manual score, or mixed-difficulty report must
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
    '第三章 新员工必须完成三级安全教育；每年复训，考试和阅卷结果必须保留。',
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
  for (const [source, label] of [['institution', '本机构学员'], ['external', '外来学员']]) {
    const username = `flow_${source}_${tag}`;
    const initialPassword = randomStrongPassword(username, label);
    const created = await ok(ctx, admin.actor, 'POST', '/admin/students', {
      username, password: initialPassword, real_name: label, employee_no: `F${source[0]}${tag}`, category_id: categoryId, source,
    });
    const signedIn = await flowLogin(ctx, username, initialPassword, label);
    assert.equal(signedIn.id, String(created.id));
    learners.push({ ...signedIn, source, difficulty: source === 'institution' ? 'easy' : 'hard' });
  }

  const regulation = await ok(ctx, admin.actor, 'POST', '/regulations', { title: `全链安全制度 ${tag}`, category: '安全教育', category_id: categoryId });
  const regulationId = String(regulation.id);
  const version = await upload(ctx, admin.actor, `/regulations/${regulationId}/versions`, {}, await regulationDocx(), 'safety.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const parsed = await poll(() => ok(ctx, admin.actor, 'GET', `/regulations/${regulationId}/versions/${version.version_id}`), (value) => value.parse_status === 'parsed', 'regulation parsing');
  assert.match(parsed.content_html, /安全/);
  await ok(ctx, admin.actor, 'PUT', `/regulations/${regulationId}/current-version`, { version_id: String(version.version_id) });

  const mock = await startMockAi(0);
  try {
    await ok(ctx, admin.actor, 'PUT', '/ai/config', { base_url: `http://127.0.0.1:${mock.address().port}/v1`, api_key: `mock-${randomBytes(18).toString('hex')}`, model: 'mock-model' });
    assert.equal((await ok(ctx, admin.actor, 'POST', '/ai/config/test')).ok, true);
    const generated = await ok(ctx, admin.actor, 'POST', '/ai/generate-questions', {
      regulation_id: regulationId, category_id: categoryId, difficulty: 'easy', question_count_single: 10, question_count_multiple: 5, score_single: 6, score_multiple: 8,
    });
    const task = await poll(() => ok(ctx, admin.actor, 'GET', `/ai/generate-status/${generated.task_id}`), (value) => value.status === 'completed', 'AI generation');
    assert.equal(task.questions.length, 15);
    assert.ok(task.questions.every((question) => question.source === 'ai' && question.status === 'pending'));
    const aiQuestion = task.questions.find((question) => question.type === 'single');
    await ok(ctx, admin.actor, 'PUT', `/ai/questions/${aiQuestion.id}/review`, { expected_version_id: String(aiQuestion.current_version_id), status: 'approved' });
  } finally {
    mock.closeAllConnections();
    await new Promise((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
  }

  const question = (difficulty, type) => ({
    category_id: categoryId, difficulty, type, stem: `<p>${difficulty} ${type} ${tag}</p>`, score: 25,
    options: type === 'image' ? [] : type === 'judgment' ? [{ text: '正确' }, { text: '错误' }] : [{ text: '安全核验' }, { text: '现场监护' }, { text: '忽略隐患' }],
    answer: type === 'image' ? [] : type === 'multiple' ? [0, 1] : [0],
    analysis: type === 'image' ? null : '<p>遵守安全制度。</p>', rubric: type === 'image' ? '<p>检查风险识别和防护。</p>' : null,
  });
  for (const difficulty of ['easy', 'hard']) {
    for (const type of ['single', 'multiple', 'judgment', 'image']) {
      if ((difficulty === 'easy' && type === 'single') || (difficulty === 'hard' && type === 'multiple')) continue;
      await ok(ctx, admin.actor, 'POST', '/ai/questions', question(difficulty, type));
    }
  }
  const imported = question('hard', 'multiple');
  const headers = ['category', 'type', 'difficulty', 'concept', 'stem', 'options', 'answer', 'analysis', 'rubric', 'score'];
  const row = { ...imported, category: '', concept: '', options: JSON.stringify(imported.options), answer: JSON.stringify(imported.answer), rubric: '' };
  const bytes = Buffer.from(`\uFEFF${headers.join('\t')}\r\n${headers.map((key) => row[key] ?? '').join('\t')}\r\n`);
  const preview = await upload(ctx, admin.actor, '/admin/questions/import-preview', { format: 'txt', category_id: categoryId }, bytes, 'questions.txt', 'text/plain; charset=utf-8');
  assert.deepEqual(preview.valid_rows, [2]);
  const committed = await ok(ctx, admin.actor, 'POST', `/admin/questions/import-batches/${preview.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(committed.created_ids.length, 1);

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
    course_ids: [courseId], rules: ['single', 'multiple', 'judgment', 'image'].map((type) => ({ type, count: 1, score_cents: 2500 })),
  });
  const paperId = String(paper.id);
  const release = await ok(ctx, admin.actor, 'POST', `/admin/papers/${paperId}/publish`);
  for (const learner of learners) {
    learner.attempt = await ok(ctx, learner.actor, 'POST', `/me/exams/${paperId}/start`);
    assert.equal(learner.attempt.difficulty, learner.difficulty);
    assert.equal(learner.attempt.questions.length, 4);
    assertSafe(learner.attempt);
    const image = learner.attempt.questions.find((item) => item.type === 'image');
    const answer = await upload(ctx, learner.actor, `/me/exam-records/${learner.attempt.record_id}/answer-images`, { item_id: image.item_id }, PNG, 'answer.png', 'image/png');
    learner.imageItemId = image.item_id;
    learner.answers = learner.attempt.questions.flatMap((item) => {
      if (item.type === 'image') return [{ item_id: item.item_id, asset_ids: [String(answer.asset_id)] }];
      if (learner.source === 'external' && item.type !== 'multiple') return [];
      const selected = item.options.flatMap((option, index) => {
        const correct = item.type === 'judgment' ? option.text === '正确' : /安全核验|现场监护|（正确）/.test(option.text);
        return correct ? [index] : [];
      });
      return [{ item_id: item.item_id, selected: item.type === 'multiple' && learner.source === 'institution' ? selected.slice(0, 1) : selected }];
    });
    const saved = await ok(ctx, learner.actor, 'PUT', `/me/exam-records/${learner.attempt.record_id}/draft`, { revision: 1, answers: learner.answers });
    assert.equal(saved.revision, 1);
  }
  await ctx.restartApi();
  for (const learner of learners) {
    const recovered = await ok(ctx, learner.actor, 'GET', `/me/exam-records/${learner.attempt.record_id}`);
    assertSafe(recovered);
    assert.equal(recovered.draft_revision, 1);
    assert.deepEqual(recovered.questions, learner.attempt.questions);
    const byId = (items) => [...items].sort((a, b) => a.item_id.localeCompare(b.item_id));
    assert.deepEqual(byId(recovered.answers), byId(learner.answers));
  }
  return { admin, learners, categoryId, regulationId, courseId, paperId, releaseId: String(release.release_id) };
}

export async function finishTrainingFlow(ctx, flow, { verifyStatistics = false } = {}) {
  const [institution, external] = flow.learners;
  const manual = await ok(ctx, institution.actor, 'POST', `/me/exam-records/${institution.attempt.record_id}/submit`);
  assert.equal(manual.grading_state, 'pending_manual');
  assert.equal(manual.score, null);
  // Advance only the owned fixture's deadline, never the persisted answer/score.
  await ctx.queryTestDb('UPDATE exam_record SET deadline_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?', [external.attempt.record_id]);
  const timeout = await ok(ctx, external.actor, 'POST', `/me/exam-records/${external.attempt.record_id}/submit`);
  assert.equal(timeout.submission_method, 'timeout');
  assert.equal(timeout.grading_state, 'pending_manual');
  if (verifyStatistics) {
    const pending = await ok(ctx, flow.admin.actor, 'GET', `/statistics/training/summary?paper_id=${flow.paperId}`);
    assert.equal(pending.pending_users, 2);
    assert.equal(pending.pending_attempts, 2);
    assert.equal(pending.finalized_users, 0, 'pending image answers must not enter final statistics');
    for (const difficulty of ['easy', 'hard']) {
      const ranking = await ok(ctx, flow.admin.actor, 'GET', `/statistics/training/ranking?paper_id=${flow.paperId}&difficulty=${difficulty}`);
      assert.deepEqual(ranking.items, [], 'pending results must not be displayed as zero-score ranking entries');
    }
  }
  for (const [learner, cents, expected] of [[institution, 1750, 80], [external, 1000, 35]]) {
    await ok(ctx, flow.admin.actor, 'PUT', `/admin/exam-records/${learner.attempt.record_id}/grades/${learner.imageItemId}`, { score_cents: cents, comment: '全链验收受控评分', expected_version: 0 });
    const result = await ok(ctx, learner.actor, 'GET', `/me/exam-records/${learner.attempt.record_id}/result`);
    assert.equal(result.grading_state, 'finalized');
    assert.equal(result.score, expected);
    assert.equal(result.passed, expected >= 60);
    assert.equal(result.items.length, 4);
    const administrative = await ok(ctx, flow.admin.actor, 'GET', `/admin/exam-records/${learner.attempt.record_id}/result`);
    assert.deepEqual(administrative, result, 'admin and learner must consume the same final result');
    learner.result = result;
  }
}

export async function run(ctx) {
  const flow = await prepareTrainingFlow(ctx);
  const monitorPath = `/admin/exams/${flow.paperId}/monitor`;
  const active = await ok(ctx, flow.admin.actor, 'GET', monitorPath);
  assert.equal(active.total, 2);
  assertSafe(active);
  for (const learner of flow.learners) {
    const row = active.items.find((item) => item.record_id === learner.attempt.record_id);
    assert.equal(row.source, learner.source);
    assert.equal(row.difficulty, learner.difficulty);
    assert.equal(row.answered_count, learner.source === 'institution' ? 4 : 2);
    assert.equal(row.total_count, 4);
    assert.equal(row.grading_state, 'not_submitted');
  }
  await finishTrainingFlow(ctx, flow, { verifyStatistics: true });
  const ended = await ok(ctx, flow.admin.actor, 'GET', monitorPath);
  assert.ok(ended.items.every((row) => row.connection_state === 'ended' && row.grading_state === 'finalized'));
  const summary = await ok(ctx, flow.admin.actor, 'GET', `/statistics/training/summary?paper_id=${flow.paperId}`);
  assert.equal(summary.release_id, flow.releaseId);
  assert.equal(summary.eligible_count, 2);
  assert.equal(summary.eligible_started_count, 2);
  assert.equal(summary.historical_started_count, 2);
  assert.equal(summary.participation_rate, 1);
  assert.equal(summary.pending_users, 0);
  assert.equal(summary.finalized_users, 2);
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
  for (const [learner, expectedScore] of [[flow.learners[0], 80], [flow.learners[1], 35]]) {
    const group = summary.score_groups.find((item) => item.difficulty === learner.difficulty);
    assert.equal(group.finalized_users, 1);
    assert.equal(group.average_score, expectedScore);
    assert.equal(group.pass_rate, expectedScore >= 60 ? 1 : 0);
    const filter = `paper_id=${flow.paperId}&difficulty=${learner.difficulty}&page=1&page_size=20`;
    const ranking = await ok(ctx, flow.admin.actor, 'GET', `/statistics/training/ranking?${filter}`);
    assert.equal(ranking.total, 1);
    assert.equal(ranking.items[0].rank, 1);
    assert.equal(ranking.items[0].user_id, learner.id);
    assert.equal(ranking.items[0].score, expectedScore);
    assert.equal(ranking.items[0].record_id, learner.attempt.record_id);
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
  console.log('[training-full-flow] regulation/AI/review/import/video/dual-difficulty/restart/submit/grade/monitor/statistics/export passed');
}
