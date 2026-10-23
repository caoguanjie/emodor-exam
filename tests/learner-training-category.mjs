import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { debugLearner } from './mobile-identity.mjs';
import { randomStrongPassword } from './support/password-fixture.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

async function adminLogin(ctx) {
  const captcha = await ctx.request(null, 'POST', '/auth/captcha');
  assert.equal(captcha.status, 200);
  const redis = new Redis({ host: ctx.env.REDIS_HOST, port: Number(ctx.env.REDIS_PORT), password: ctx.env.REDIS_PASSWORD || undefined });
  let answer;
  try { answer = await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captcha.data.captcha_id}`); }
  finally { await redis.quit(); }
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username: 'admin', password: ctx.adminPassword, captcha_id: captcha.data.captcha_id, captcha_code: answer,
  });
  assert.equal(login.status, 200);
  actor.accessToken = login.data.access_token;
  if (login.data.force_change_password) {
    const changed = await ctx.request(actor, 'PUT', '/auth/password', {
      old_password: ctx.adminPassword, new_password: randomStrongPassword('admin', '超级管理员'),
    });
    assert.equal(changed.status, 200);
    actor.accessToken = changed.data.access_token;
  }
  return actor;
}

/** Owned HTTP/MySQL/Redis regression; debug login replaces only SMS transport. */
export async function run(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_/);
  const admin = await adminLogin(ctx);
  const learner = await debugLearner(ctx);
  const before = await ctx.request(learner, 'GET', '/me/profile');
  assert.equal(before.status, 200);
  assert.equal(before.data.category_id, null);
  const categories = [];
  for (const name of ['电工', '班组长', '停用工种']) {
    const created = await ctx.request(admin, 'POST', '/admin/training-categories', { name: `${name}-${randomBytes(3).toString('hex')}` });
    assert.equal(created.status, 200);
    categories.push(created.data);
  }
  const [a, b, inactive] = categories;
  assert.equal((await ctx.request(admin, 'PUT', `/admin/training-categories/${inactive.id}/status`, { status: 0 })).status, 200);

  const options = await ctx.request(learner, 'GET', '/me/training-categories?page=1&page_size=1');
  assert.equal(options.status, 200, 'new mobile category option route must exist');
  assert.equal(options.data.items.length, 1);
  assert.equal(options.data.page_size, 1);
  assert.ok(options.data.total >= 2);
  for (const item of options.data.items) assert.deepEqual(Object.keys(item).sort(), ['id', 'name']);
  const allOptions = await ctx.request(learner, 'GET', '/me/training-categories?page=1&page_size=100');
  assert.ok(allOptions.data.items.some((item) => item.id === a.id));
  assert.ok(!allOptions.data.items.some((item) => item.id === inactive.id));
  let deadline;
  try {
    const parallel = await Promise.race([
      Promise.all(Array.from({ length: 4 }, () => ctx.request(learner, 'GET', '/me/training-categories'))),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('category reads exhausted the 2-connection test pool')), 5000); }),
    ]);
    assert.ok(parallel.every((result) => result.status === 200));
  } finally { clearTimeout(deadline); }
  for (const query of ['page=0', 'page=1.5', 'page_size=101', 'status=0']) {
    assert.equal((await ctx.request(learner, 'GET', `/me/training-categories?${query}`)).status, 400, query);
  }
  assert.equal((await ctx.request(null, 'GET', '/me/training-categories')).status, 401);
  assert.equal((await ctx.request(admin, 'GET', '/me/training-categories')).status, 403);
  assert.equal((await ctx.request(admin, 'PUT', '/me/training-category', { category_id: a.id })).status, 403);
  assert.equal((await ctx.request(learner, 'GET', '/admin/training-categories')).status, 403);
  for (const body of [{}, { category_id: Number(a.id) }, { category_id: null }, { category_id: a.id, source: 'institution' }, { category_id: a.id, user_id: '1' }]) {
    assert.equal((await ctx.request(learner, 'PUT', '/me/training-category', body)).status, 400);
  }
  assert.equal((await ctx.request(learner, 'PUT', '/me/training-category', { category_id: inactive.id })).code, 40910);
  assert.equal((await ctx.request(learner, 'POST', '/me/profile', { category_id: a.id })).status, 400);

  // Distinct choices compete on the same real MySQL row: exactly one wins.
  const raced = await Promise.all([a, b].map((category) => ctx.request(learner, 'PUT', '/me/training-category', { category_id: category.id })));
  assert.deepEqual(raced.map((result) => result.status).sort(), [200, 400]);
  const selected = raced.find((result) => result.status === 200).data;
  const blocked = raced.find((result) => result.status === 400);
  assert.equal(blocked.data.reason_code, 'TRAINING_CATEGORY_LOCKED');
  assert.equal(selected.source, before.data.source);
  assert.equal(selected.real_name, before.data.real_name);
  assert.equal(selected.category_name, categories.find((category) => category.id === selected.category_id).name);
  assert.equal((await ctx.request(learner, 'PUT', '/me/training-category', { category_id: selected.category_id })).status, 200);
  const firstAudit = await ctx.request(admin, 'GET', '/admin/audit-logs?action=student.training_category.confirm&page_size=100');
  assert.equal(firstAudit.status, 200);
  const ownAudit = firstAudit.data.items.filter((item) => String(item.object_id) === learner.userId);
  assert.equal(ownAudit.length, 1, 'race/replay must record the initial category once');
  assert.equal(String(ownAudit[0].actor_id), learner.userId);
  assert.deepEqual(ownAudit[0].detail, { before_category_id: null, after_category_id: selected.category_id });
  const stored = await ctx.queryTestDb('SELECT category_id,source,real_name FROM sys_user WHERE id=?', [learner.userId]);
  assert.equal(String(stored[0].category_id), selected.category_id);
  assert.equal(stored[0].source, 'external');
  assert.equal((await ctx.queryTestDb('SELECT id FROM learner_identity WHERE user_id=?', [learner.userId])).length, 0, 'category confirmation must not fabricate identity');
  assert.equal((await ctx.request(admin, 'DELETE', `/admin/training-categories/${selected.category_id}`)).code, 40910, 'selected category reference protects deletion');

  // PC can adjust authority; mobile reads current names and remains locked.
  const replacement = selected.category_id === a.id ? b : a;
  assert.equal((await ctx.request(admin, 'PUT', `/admin/students/${learner.userId}`, { category_id: replacement.id })).status, 200);
  const adjusted = await ctx.request(learner, 'GET', '/me/profile');
  assert.equal(adjusted.data.category_id, replacement.id);
  assert.equal(adjusted.data.category_name, replacement.name);
  const pcAudit = await ctx.request(admin, 'GET', '/admin/audit-logs?action=student.update&page_size=100');
  const categoryChange = pcAudit.data.items.find((item) => String(item.object_id) === learner.userId);
  assert.equal(categoryChange.detail.before_category_id, selected.category_id);
  assert.equal(categoryChange.detail.after_category_id, replacement.id);
  assert.equal((await ctx.request(learner, 'PUT', '/me/training-category', { category_id: selected.category_id })).status, 400);
  const renamed = `${replacement.name}-更名`;
  assert.equal((await ctx.request(admin, 'PUT', `/admin/training-categories/${replacement.id}`, { name: renamed })).status, 200);
  assert.equal((await ctx.request(admin, 'PUT', `/admin/training-categories/${replacement.id}/status`, { status: 0 })).status, 200);
  assert.equal((await ctx.request(learner, 'GET', '/me/profile')).data.category_name, renamed);
  assert.equal((await ctx.request(learner, 'PUT', '/me/training-category', { category_id: replacement.id })).status, 200, 'same-value replay survives later category disable');

  // Real import path: its assigned category is never self-service editable.
  const username = `category_import_${randomBytes(4).toString('hex')}`;
  const phone = `139${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;
  const preview = await ctx.request(admin, 'POST', '/admin/students/import-preview', { rows: [{
    row: 2, username, real_name: '合成导入学员', phone, source: 'institution', category_id: selected.category_id,
  }] });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.valid_rows, [2]);
  const imported = await ctx.request(admin, 'POST', `/admin/students/import-batches/${preview.data.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(imported.status, 200);
  const importActor = {};
  const logged = await ctx.request(importActor, 'POST', '/mobile/auth/debug-login', { phone });
  assert.equal(logged.status, 200);
  importActor.accessToken = logged.data.access_token;
  assert.equal(String(logged.data.user.id), String(imported.data.created_ids[0]));
  assert.equal((await ctx.request(importActor, 'GET', '/me/profile')).data.category_id, selected.category_id);
  assert.equal((await ctx.request(importActor, 'PUT', '/me/training-category', { category_id: replacement.id })).status, 400);

  // A PC update is allowed regardless of whether it arrives before/after a first choice.
  const pcRace = await debugLearner(ctx);
  assert.equal((await ctx.request(admin, 'PUT', `/admin/training-categories/${replacement.id}/status`, { status: 1 })).status, 200);
  const [selfRace, adminRace] = await Promise.all([
    ctx.request(pcRace, 'PUT', '/me/training-category', { category_id: selected.category_id }),
    ctx.request(admin, 'PUT', `/admin/students/${pcRace.userId}`, { category_id: replacement.id }),
  ]);
  assert.ok([200, 400].includes(selfRace.status));
  assert.equal(adminRace.status, 200);
  assert.equal((await ctx.request(pcRace, 'GET', '/me/profile')).data.category_id, replacement.id);

  const roleBound = await debugLearner(ctx);
  const role = await ctx.queryTestDb('INSERT INTO sys_role (code,name,is_system,status) VALUES (?,?,0,0)', [`category_role_${randomBytes(4).toString('hex')}`, '合成停用角色']);
  await ctx.queryTestDb('INSERT INTO sys_user_role (user_id,role_id) VALUES (?,?)', [roleBound.userId, String(role.insertId)]);
  assert.ok([403, 404].includes((await ctx.request(roleBound, 'GET', '/me/training-categories')).status));
  assert.ok([403, 404].includes((await ctx.request(roleBound, 'PUT', '/me/training-category', { category_id: selected.category_id })).status));
  await ctx.queryTestDb('UPDATE sys_user SET status=0 WHERE id=?', [learner.userId]);
  assert.equal((await ctx.request(learner, 'PUT', '/me/training-category', { category_id: selected.category_id })).status, 403);
  console.log('learner-training-category: real HTTP/MySQL first-choice race, replay, import, PC override, strict input and permissions passed');
}
