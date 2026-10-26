import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { initializeLocalEnv, inspectBackendEnv, readBackendEnv, formatReport, importLocalCosEnv } from '../scripts/backend-env.mjs';

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

test('media delivery environment inspection rejects unbounded signed URL lifetimes', () => {
  for (const env of [{ MEDIA_DELIVERY_MODE: 'public' }, { MEDIA_VIDEO_URL_TTL_SECONDS: '3601' }, { MEDIA_READ_URL_TTL_SECONDS: '0' }]) {
    const rows = inspectBackendEnv(env);
    assert.ok(rows.some(row => row.name === Object.keys(env)[0] && !row.ok));
  }
  const rows = inspectBackendEnv({ MEDIA_DELIVERY_MODE: 'cos-signed', MEDIA_READ_URL_TTL_SECONDS: '300', MEDIA_VIDEO_URL_TTL_SECONDS: '3600' });
  for (const name of ['MEDIA_DELIVERY_MODE', 'MEDIA_READ_URL_TTL_SECONDS', 'MEDIA_VIDEO_URL_TTL_SECONDS']) {
    assert.ok(rows.some(row => row.name === name && row.ok));
  }
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

test('COS import atomically merges only the four allowed keys and preserves all other local values', async (t) => {
  const root = await workspace(t);
  const original = "# retain comment\nDB_PASSWORD='local value'\nJWT_SECRET='local jwt fixture'\nCOS_KEY_PREFIX='ruleexam/test/'\nCOS_BUCKET='old-1234567890'\n";
  await writeFile(join(root, '.env'), original);
  const source = join(root, 'source.env');
  await writeFile(source, "COS_SECRET_ID='unusable-source-id'\nCOS_SECRET_KEY='unusable-source-key'\nCOS_BUCKET='new-1234567890'\nCOS_REGION='ap-guangzhou'\nCOS_KEY_PREFIX='gooodwork/prod/'\nJWT_SECRET='foreign fixture'\nDB_PASSWORD='foreign fixture'\n");
  const result = await importLocalCosEnv(root, source);
  assert.deepEqual(result, { changed: true, keys: ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'] });
  const after = await readFile(join(root, '.env'), 'utf8');
  assert.ok(after.startsWith(original));
  const values = parseEnv(after);
  assert.equal(values.COS_SECRET_ID, 'unusable-source-id');
  assert.equal(values.COS_SECRET_KEY, 'unusable-source-key');
  assert.equal(values.COS_BUCKET, 'new-1234567890');
  assert.equal(values.COS_KEY_PREFIX, 'ruleexam/test/');
  assert.equal(values.DB_PASSWORD, 'local value');
  assert.equal(values.JWT_SECRET, 'local jwt fixture');
  assert.equal((await stat(join(root, '.env'))).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(result).includes('unusable-source'), false);
  assert.deepEqual(await importLocalCosEnv(root, source), { changed: false, keys: result.keys });
  assert.equal(await readFile(join(root, '.env'), 'utf8'), after);
});

test('COS import rejects an incomplete source pair without changing any destination byte', async (t) => {
  const root = await workspace(t); const before = 'COS_SECRET_ID=existing-id\nCOS_SECRET_KEY=existing-key\n';
  await writeFile(join(root, '.env'), before); const source = join(root, 'source.env');
  await writeFile(source, 'COS_SECRET_ID=unusable-id\nCOS_BUCKET=fixture-1234567890\n');
  await assert.rejects(importLocalCosEnv(root, source), /COS_SECRET_KEY/);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), before);
  await assert.rejects(importLocalCosEnv(root, join(root, '.env')), /源文件/);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), before);
});

test('COS import leaves optional bucket and region intact when the explicit source has only the key pair', async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, '.env'), 'COS_BUCKET=fixture-1234567890\nCOS_REGION=ap-shanghai\n');
  const source = join(root, 'source.env'); await writeFile(source, 'COS_SECRET_ID=unusable-id\nCOS_SECRET_KEY=unusable-key\n');
  assert.deepEqual((await importLocalCosEnv(root, source)).keys, ['COS_SECRET_ID', 'COS_SECRET_KEY']);
  const values = await readBackendEnv(root, {});
  assert.equal(values.COS_BUCKET, 'fixture-1234567890'); assert.equal(values.COS_REGION, 'ap-shanghai');
});

test('COS environment inspection refuses incomplete configuration and unsafe prefixes without exposing values', () => {
  const absent = inspectBackendEnv({ MEDIA_STORAGE_PROVIDER: 'cos' });
  for (const key of ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION', 'COS_KEY_PREFIX']) assert.ok(absent.some(row => row.name === key && !row.ok));
  const secret = 'unusable-fixture-private-value';
  const rows = inspectBackendEnv({ MEDIA_STORAGE_PROVIDER: 'cos', COS_BUCKET: 'fixture-1234567890', COS_REGION: 'ap-shanghai', COS_SECRET_ID: secret, COS_SECRET_KEY: secret, COS_KEY_PREFIX: '../foreign/' });
  assert.ok(rows.some(row => row.name === 'COS_KEY_PREFIX' && !row.ok));
  assert.equal(formatReport(rows).includes(secret), false);
});
