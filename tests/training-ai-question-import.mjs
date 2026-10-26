import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const HEADERS = ['category', 'type', 'difficulty', 'stem', 'options', 'answer', 'analysis'];

async function captchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST,
    port: Number(ctx.env.REDIS_PORT),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try { return await redis.get(`${ctx.env.REDIS_KEY_PREFIX}auth:captcha:${captchaId}`); }
  finally { await redis.quit(); }
}

let loginSequence = 231;
async function accountLogin(ctx, username, password, ...personalValues) {
  loginSequence = loginSequence >= 245 ? 231 : loginSequence + 1;
  const headers = { 'X-Forwarded-For': `198.51.100.${loginSequence}` };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200);
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username,
    password,
    captcha_id: captcha.data.captcha_id,
    captcha_code: await captchaAnswer(ctx, captcha.data.captcha_id),
  }, headers);
  assert.equal(login.status, 200, `${username} login: ${JSON.stringify(login)}`);
  actor.accessToken = login.data.access_token;
  if (!login.data.force_change_password) return { actor, id: String(login.data.user.id) };
  const nextPassword = randomStrongPassword(username, ...personalValues);
  const currentPassword = username === 'admin' ? ctx.adminPassword : password;
  const changed = await ctx.request(actor, 'PUT', '/auth/password', {
    old_password: currentPassword,
    new_password: nextPassword,
  });
  assert.equal(changed.status, 200);
  actor.accessToken = changed.data.access_token;
  return { actor, id: String(login.data.user.id) };
}

function multipart(fields, bytes, filename, contentType) {
  const boundary = `----ruleexam-ai-import-${randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(bytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

function referenceFile(categoryId, count = 20) {
  const options = JSON.stringify([{ key: 'A', text: '先辨识风险' }, { key: 'B', text: '直接作业' }]);
  const rows = Array.from({ length: count }, (_unused, index) => ({
    category: categoryId,
    type: 'single',
    difficulty: 'easy',
    concept: '',
    stem: `一次性参考题-${index + 1}-${randomBytes(3).toString('hex')}`,
    options,
    answer: '[0]',
    analysis: `一次性参考解析-${index + 1}`,
  }));
  return Buffer.from(`\uFEFF${[
    HEADERS.join('\t'),
    ...rows.map((row) => HEADERS.map((header) => row[header] ?? '').join('\t')),
  ].join('\r\n')}\r\n`, 'utf8');
}

export function startMockAi() {
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
      response.writeHead(404); response.end(); return;
    }
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      let prompt = '';
      let requested = ['easy', 'hard'];
      try {
        const parsed = JSON.parse(body);
        prompt = (parsed.messages || []).map((message) => message.content).join('\n');
        const input = JSON.parse(parsed.messages.find((message) => message.role === 'user')?.content || '{}');
        if (Array.isArray(input.requested_difficulties)) requested = input.requested_difficulties;
      } catch { /* malformed provider requests fail below */ }
      const content = prompt.includes('请回复 OK')
        ? 'OK'
        : JSON.stringify([
          {
            difficulty: 'easy',
            stem: `简单生成题-${randomBytes(4).toString('hex')}`,
            options: [{ key: 'A', text: '正确措施（正确）' }, { key: 'B', text: '错误措施' }],
            answer: [0],
            analysis: '简单题解析',
          },
          {
            difficulty: 'hard',
            stem: `困难生成题-${randomBytes(4).toString('hex')}`,
            options: [{ key: 'A', text: '错误措施' }, { key: 'B', text: '综合判断后的正确措施（正确）' }],
            answer: [1],
            analysis: '困难题解析',
          },
        ].filter((question) => requested.includes(question.difficulty)));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(server);
    });
  });
}

async function waitTask(ctx, actor, taskId) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const response = await ctx.request(actor, 'GET', `/admin/questions/ai-import-tasks/${taskId}`);
    assert.equal(response.status, 200, JSON.stringify(response));
    if (response.data.status === 'completed' || response.data.status === 'failed') return response.data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('AI 参考题生成任务超时');
}

async function filesUnder(root) {
  const names = await readdir(root, { recursive: true });
  return names.filter((name) => !String(name).endsWith('/')).map(String).sort();
}

async function textUnder(root) {
  const chunks = [];
  for (const name of await filesUnder(root)) {
    try { chunks.push(await readFile(join(root, name), 'utf8')); }
    catch { /* directory entries and non-text artifacts are irrelevant here */ }
  }
  return chunks.join('\n');
}

async function runBody(ctx, mockPort) {
  const admin = await accountLogin(ctx, 'admin', ctx.adminPassword, 'AI导入管理员');
  const suffix = randomBytes(4).toString('hex');
  const category = await ctx.request(admin.actor, 'POST', '/admin/training-categories', { name: `AI 导入类别 ${suffix}` });
  assert.equal(category.status, 200, JSON.stringify(category));
  const categoryId = String(category.data.id);

  const config = await ctx.request(admin.actor, 'PUT', '/ai/config', {
    base_url: `http://127.0.0.1:${mockPort}/v1`,
    api_key: `test-${randomBytes(16).toString('hex')}`,
    model: 'mock-ai-question-import',
  });
  assert.equal(config.status, 200, JSON.stringify(config));

  const otherUsername = `ai_import_other_${suffix}`;
  const otherName = `AI导入隔离员${suffix}`;
  const otherPassword = randomStrongPassword(otherUsername, otherName);
  const role = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `ai_import_other_${suffix}`,
    name: `AI 导入隔离角色 ${suffix}`,
    permissions: ['ai:read', 'ai:write', 'questions:write'],
  });
  assert.equal(role.status, 200, JSON.stringify(role));
  const user = await ctx.request(admin.actor, 'POST', '/admin/administrators', {
    username: otherUsername,
    password: otherPassword,
    real_name: otherName,
    role_ids: [String(role.data.id)],
  });
  assert.equal(user.status, 200, JSON.stringify(user));
  const other = await accountLogin(ctx, otherUsername, otherPassword, otherName);

  const beforeQuestions = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question');
  const beforeVersions = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question_version');
  const beforeUploads = await filesUnder(ctx.env.UPLOAD_DIR);
  const referenceBytes = referenceFile(categoryId);
  const upload = multipart({ format: 'txt' }, referenceBytes, 'references.txt', 'text/plain; charset=utf-8');
  const started = await ctx.request(
    admin.actor,
    'POST',
    '/admin/questions/ai-import-tasks',
    upload.body,
    upload.headers,
  );
  assert.equal(started.status, 200, JSON.stringify(started));
  assert.equal(started.data.total_count, 20);
  assert.equal(started.data.status, 'queued');

  const crossTask = await ctx.request(other.actor, 'GET', `/admin/questions/ai-import-tasks/${started.data.task_id}`);
  assert.equal(crossTask.status, 403, '其他管理员不得读取任务');
  const task = await waitTask(ctx, admin.actor, started.data.task_id);
  assert.equal(task.status, 'completed', JSON.stringify(task));
  assert.equal(task.completed_count, 20);
  assert.equal(task.generated_count, 40);
  assert.equal(task.failed_count, 0);

  const afterGeneration = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question');
  const afterGenerationVersions = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question_version');
  assert.equal(Number(afterGeneration[0].total), Number(beforeQuestions[0].total), '生成阶段不得创建题目');
  assert.equal(Number(afterGenerationVersions[0].total), Number(beforeVersions[0].total), '生成阶段不得创建题目版本');
  assert.deepEqual(await filesUnder(ctx.env.UPLOAD_DIR), beforeUploads, '内存上传不得在上传目录留文件');
  const redis = new Redis({
    host: ctx.env.REDIS_HOST,
    port: Number(ctx.env.REDIS_PORT),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try {
    const taskState = await redis.get(`${ctx.env.REDIS_KEY_PREFIX}ai:question-import:task:${started.data.task_id}`);
    assert.equal(String(taskState).includes('一次性参考题'), false, 'Redis 任务不得包含参考题正文');
    assert.equal(String(taskState).includes('一次性参考解析'), false, 'Redis 任务不得包含参考题解析');
  } finally { await redis.quit(); }
  const batch = await ctx.request(admin.actor, 'GET', `/admin/questions/ai-import-batches/${task.batch_id}`);
  assert.equal(batch.status, 200, JSON.stringify(batch));
  assert.equal(batch.data.rows.length, 40);
  assert.equal(batch.data.rows.filter((row) => row.difficulty === 'easy').length, 20);
  assert.equal(batch.data.rows.filter((row) => row.difficulty === 'hard').length, 20);
  assert.ok(batch.data.rows.every((row) => row.category === categoryId && row.type === 'single'));
  assert.ok(batch.data.rows.every((row) => !Object.hasOwn(row, 'concept') && !Object.hasOwn(row, 'score')));
  assert.equal(JSON.stringify(batch.data).includes('一次性参考题'), false, '预览批次不得包含参考题正文');
  assert.equal(JSON.stringify(batch.data).includes('一次性参考解析'), false, '预览批次不得包含参考题解析');

  const crossBatch = await ctx.request(other.actor, 'GET', `/admin/questions/ai-import-batches/${task.batch_id}`);
  assert.equal(crossBatch.status, 403, '其他管理员不得读取生成批次');
  const download = await ctx.request(admin.actor, 'GET', `/admin/questions/ai-import-batches/${task.batch_id}/download?format=txt`);
  assert.equal(download.status, 200, JSON.stringify(download));
  const downloadText = download.body.toString('utf8').replace(/^\uFEFF/, '');
  assert.equal(downloadText.split(/\r?\n/)[0], HEADERS.join('\t'));
  assert.equal(downloadText.includes('一次性参考题'), false);

  const editableRow = batch.data.rows[0].row_number;
  const crossUpdate = await ctx.request(other.actor, 'PATCH', `/admin/questions/ai-import-batches/${task.batch_id}/rows/${editableRow}`, { stem: '跨 owner 修改' });
  assert.equal(crossUpdate.status, 403);
  const rejectedScore = await ctx.request(admin.actor, 'PATCH', `/admin/questions/ai-import-batches/${task.batch_id}/rows/${editableRow}`, { score: 7 });
  assert.equal(rejectedScore.status, 400);
  const updated = await ctx.request(admin.actor, 'PATCH', `/admin/questions/ai-import-batches/${task.batch_id}/rows/${editableRow}`, { stem: `人工修订生成题-${suffix}`, answer: [1] });
  assert.equal(updated.status, 200, JSON.stringify(updated));
  assert.equal(updated.data.rows.find((row) => row.row_number === editableRow).stem, `人工修订生成题-${suffix}`);
  const regenerated = await ctx.request(admin.actor, 'POST', `/admin/questions/ai-import-batches/${task.batch_id}/rows/${editableRow}/regenerate`, {});
  assert.equal(regenerated.status, 200, JSON.stringify(regenerated));
  const regeneratedRow = regenerated.data.rows.find((row) => row.row_number === editableRow);
  assert.equal(regeneratedRow.category, categoryId); assert.equal(regeneratedRow.type, 'single');
  assert.equal(regeneratedRow.difficulty, batch.data.rows[0].difficulty);
  assert.notEqual(regeneratedRow.stem, `人工修订生成题-${suffix}`);
  assert.equal(Object.hasOwn(regeneratedRow, 'score'), false); assert.equal(Object.hasOwn(regeneratedRow, 'concept'), false);
  assert.deepEqual(await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question'), beforeQuestions, '编辑和重生成不能提前写题库');
  assert.deepEqual(await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question_version'), beforeVersions);

  const selectedRows = batch.data.rows.slice(0, 2).map((row) => row.row_number);
  const crossCommit = await ctx.request(other.actor, 'POST', `/admin/questions/ai-import-batches/${task.batch_id}/commit`, {
    row_numbers: selectedRows,
  });
  assert.equal(crossCommit.status, 403, '其他管理员不得确认生成批次');
  const [committed, concurrentRetry] = await Promise.all([
    ctx.request(admin.actor, 'POST', `/admin/questions/ai-import-batches/${task.batch_id}/commit`, { row_numbers: selectedRows }),
    ctx.request(admin.actor, 'POST', `/admin/questions/ai-import-batches/${task.batch_id}/commit`, { row_numbers: selectedRows }),
  ]);
  assert.equal(committed.status, 200, JSON.stringify(committed));
  assert.equal(concurrentRetry.status, 200, JSON.stringify(concurrentRetry));
  assert.deepEqual(concurrentRetry.data, committed.data, '并发同集合确认必须只产生一份回执');
  assert.equal(committed.data.created_ids.length, 2);
  assert.equal(committed.data.enabled, true);
  const retried = await ctx.request(admin.actor, 'POST', `/admin/questions/ai-import-batches/${task.batch_id}/commit`, {
    row_numbers: selectedRows,
  });
  assert.equal(retried.status, 200, JSON.stringify(retried));
  assert.deepEqual(retried.data, committed.data, '相同行号重复确认必须幂等');
  const committedStatus = await ctx.request(admin.actor, 'GET', `/admin/questions/ai-import-batches/${task.batch_id}`);
  assert.deepEqual({ batch_id: committedStatus.data.batch_id, created_ids: committedStatus.data.created_ids, committed_rows: committedStatus.data.committed_rows, enabled: committedStatus.data.enabled }, committed.data, '原批次 GET 对账必须返回原启用回执');
  const changedRows = await ctx.request(admin.actor, 'POST', `/admin/questions/ai-import-batches/${task.batch_id}/commit`, { row_numbers: [selectedRows[0]] });
  assert.equal(changedRows.status, 409); assert.equal(changedRows.code, 40911);
  const committedEdit = await ctx.request(admin.actor, 'PATCH', `/admin/questions/ai-import-batches/${task.batch_id}/rows/${editableRow}`, { stem: '已确认不可修改' });
  assert.equal(committedEdit.status, 409);

  const placeholders = committed.data.created_ids.map(() => '?').join(',');
  const created = await ctx.queryTestDb(
    `SELECT q.id,q.status,q.is_enabled,q.concept_id,q.score,q.source,q.regulation_id,q.version_id,q.difficulty,v.score_cents,v.concept_id AS version_concept_id,v.approved_by,v.approved_at,v.reviewed_by,v.reviewed_at FROM question q JOIN question_version v ON v.id=q.current_version_id WHERE q.id IN (${placeholders}) ORDER BY q.id`,
    committed.data.created_ids,
  );
  assert.equal(created.length, 2);
  assert.ok(created.every((row) => row.status === 'approved' && Number(row.is_enabled) === 1 && row.source === 'ai'));
  for (const row of created) {
    for (const key of ['concept_id', 'version_concept_id', 'score', 'score_cents', 'approved_by', 'approved_at', 'reviewed_by', 'reviewed_at']) assert.equal(row[key], null);
  }
  assert.ok(created.every((row) => row.regulation_id === null && row.version_id === null));
  assert.ok(created.every((row) => row.difficulty === 'easy' || row.difficulty === 'hard'));

  const storedBatch = await ctx.queryTestDb('SELECT kind,normalized_rows FROM import_batch WHERE id = ?', [task.batch_id]);
  assert.equal(storedBatch[0].kind, 'questions_ai');
  const storedPreview = JSON.stringify(storedBatch[0].normalized_rows);
  assert.equal(storedPreview.includes('一次性参考题'), false);
  assert.equal(storedPreview.includes('一次性参考解析'), false);
  const auditText = await textUnder(ctx.env.LOG_DIR);
  assert.equal(auditText.includes('一次性参考题'), false, '审计文件不得包含参考题正文');
  assert.equal(auditText.includes('一次性参考解析'), false, '审计文件不得包含参题解析');
}

export async function run(ctx) {
  const mockServer = await startMockAi();
  const address = mockServer.address();
  const mockPort = address && typeof address !== 'string' ? address.port : null;
  if (!Number.isInteger(mockPort) || mockPort < 1024) {
    mockServer.close();
    throw new Error('AI 参考题 Mock 服务未返回有效监听端口');
  }
  try {
    await runBody(ctx, mockPort);
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
  }
}
