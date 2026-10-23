import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { initializeLocalEnv, inspectBackendEnv, readBackendEnv, formatReport } from '../scripts/backend-env.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-env-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'deploy'));
  await mkdir(join(root, 'server'));
  await copyFile(new URL('../deploy/.env.example', import.meta.url), join(root, 'deploy/.env.example'));
  return root;
}

test('initialization carries forward local SMS credentials, generates distinct persistent secrets and protects the file', async (t) => {
  const root = await workspace(t);
  const existing = randomBytes(24).toString('base64');
  const legacy = `SMS_PROVIDER=yunxin\nYUNXIN_SMS_APP_SECRET='${existing}'\n`;
  await writeFile(join(root, 'server/.env'), legacy);
  assert.equal((await initializeLocalEnv(root, {})).created, true);
  const values = parseEnv(await readFile(join(root, '.env'), 'utf8'));
  assert.equal(values.YUNXIN_SMS_APP_SECRET, existing);
  assert.equal(values.DB_USERNAME, 'root');
  assert.equal(values.IDENTITY_PROVIDER, 'tencent');
  assert.equal(values.TENCENT_FACEID_SECRET_KEY, '');
  const secrets = ['IDENTITY_DATA_ENCRYPTION_KEY', 'IDENTITY_FINGERPRINT_SECRET', 'MEDIA_TICKET_SECRET'].map(key => values[key]);
  assert.equal(new Set(secrets).size, 3);
  for (const secret of secrets) assert.equal(Buffer.from(secret, 'base64').length, 32);
  assert.equal((await stat(join(root, '.env'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(root, 'server/.env'), 'utf8'), legacy);
  const before = await readFile(join(root, '.env'), 'utf8');
  assert.equal((await initializeLocalEnv(root, {})).created, false);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), before);
});

test('explicit runtime secrets survive initialization and shell overrides are also checked', async (t) => {
  const root = await workspace(t);
  const secret = randomBytes(32).toString('base64');
  await initializeLocalEnv(root, { APP_ENCRYPTION_KEY: secret });
  const values = await readBackendEnv(root, { IDENTITY_PROVIDER: 'disabled' });
  assert.equal(values.APP_ENCRYPTION_KEY, secret);
  assert.equal(values.IDENTITY_PROVIDER, 'disabled');
  assert.ok(inspectBackendEnv(values, { real: true }).some(row => row.name === 'IDENTITY_PROVIDER' && !row.ok));
});

test('real readiness rejects missing vendor values without disclosing any configured credential', async (t) => {
  const root = await workspace(t);
  await initializeLocalEnv(root, {});
  const values = await readBackendEnv(root, {});
  const secret = randomBytes(24).toString('base64');
  values.YUNXIN_SMS_APP_SECRET = secret;
  const rows = inspectBackendEnv(values, { real: true });
  assert.ok(rows.some(row => row.name === 'TENCENT_FACEID_SECRET_KEY' && !row.ok));
  const output = formatReport(rows);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(values.JWT_SECRET), false);
  for (const name of ['YUNXIN_SMS_APP_KEY', 'YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID', 'TENCENT_FACEID_SECRET_ID', 'TENCENT_FACEID_SECRET_KEY', 'TENCENT_ID_CARD_OCR_SECRET_ID', 'TENCENT_ID_CARD_OCR_SECRET_KEY']) values[name] = randomBytes(20).toString('hex');
  assert.ok(inspectBackendEnv(values, { real: true }).every(row => row.ok));
  values.SERVER_DEBUG_LOGIN_ENABLED = 'true';
  assert.ok(inspectBackendEnv(values, { real: true }).some(row => row.name === 'SERVER_DEBUG_LOGIN_ENABLED' && !row.ok));
});

test('invalid or shared identity encryption keys are rejected before startup', async (t) => {
  const root = await workspace(t);
  await initializeLocalEnv(root, {});
  const values = await readBackendEnv(root, {});
  values.IDENTITY_PROVIDER = 'disabled';
  values.SMS_PROVIDER = 'disabled';
  values.TENCENT_FACEID_ENABLED = 'false';
  values.TENCENT_ID_CARD_OCR_ENABLED = 'false';
  assert.ok(inspectBackendEnv(values).every(row => row.ok));
  values.MEDIA_TICKET_SECRET = values.IDENTITY_DATA_ENCRYPTION_KEY;
  assert.ok(inspectBackendEnv(values).some(row => !row.ok && row.name === 'IDENTITY_KEYS'));
  values.MEDIA_TICKET_SECRET = 'not-a-base64-key';
  assert.ok(inspectBackendEnv(values).some(row => !row.ok && row.name === 'MEDIA_TICKET_SECRET'));
});

test('an existing encrypted AI configuration prevents silent key replacement', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/ai-config.json.enc'), 'opaque encrypted fixture');
  await assert.rejects(initializeLocalEnv(root, {}), /原 APP_ENCRYPTION_KEY/);
  await assert.rejects(stat(join(root, '.env')), { code: 'ENOENT' });
});

test('CLI fails closed on missing real-provider configuration and never prints secret values', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'scripts'));
  await copyFile(new URL('../scripts/backend-env.mjs', import.meta.url), join(root, 'scripts/backend-env.mjs'));
  await initializeLocalEnv(root, {});
  const values = await readBackendEnv(root, {});
  const run = spawnSync(process.execPath, [join(root, 'scripts/backend-env.mjs'), 'check', '--real'], { encoding: 'utf8', env: {} });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /TENCENT_FACEID_SECRET_KEY: 未配置/);
  for (const key of ['JWT_SECRET', 'APP_ENCRYPTION_KEY', 'IDENTITY_DATA_ENCRYPTION_KEY']) assert.equal(`${run.stdout}${run.stderr}`.includes(values[key]), false);
});
