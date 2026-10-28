import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolvePublicMediaConfig, serializePublicMediaEnv } from '../deploy/nginx/public-media-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://fixture-1234567890.cos.ap-guangzhou.myqcloud.com';
const prefix = 'ruleexam/test/media/';
const metadata = { COS_BUCKET: 'fixture-1234567890', COS_REGION: 'ap-guangzhou', COS_KEY_PREFIX: 'ruleexam/test/' };

test('frontend configuration derives exact public COS metadata without copying secrets', () => {
  const result = resolvePublicMediaConfig({ ...metadata, COS_SECRET_ID: 'must-not-leak', COS_SECRET_KEY: 'must-not-leak' });
  assert.deepEqual(result, { origin, prefix });
  assert.equal(serializePublicMediaEnv(result), `export VITE_COS_MEDIA_ORIGIN='${origin}'\nexport VITE_COS_MEDIA_PREFIX='${prefix}'\n`);
});

test('local deployment keeps both public settings empty', () => {
  assert.deepEqual(resolvePublicMediaConfig({}), { origin: '', prefix: '' });
});

test('explicit exact settings are accepted and mismatching API bucket is rejected', () => {
  assert.deepEqual(resolvePublicMediaConfig({ VITE_COS_MEDIA_ORIGIN: origin, VITE_COS_MEDIA_PREFIX: prefix }), { origin, prefix });
  assert.throws(() => resolvePublicMediaConfig({ ...metadata, VITE_COS_MEDIA_ORIGIN: origin.replace('guangzhou', 'shanghai') }), /match|一致/);
});

for (const bad of [origin + '/', origin + ':443', origin + '?x=1', origin + '#x', origin + '; img-src *', origin + '\n', origin + "'", '${EVIL}', 'https://*.myqcloud.com', 'https:', origin.replace('https:', 'http:'), 'https://evil.example']) {
  test(`public origin rejects injection or unsupported sources ${JSON.stringify(bad)}`, () => {
    assert.throws(() => resolvePublicMediaConfig({ VITE_COS_MEDIA_ORIGIN: bad, VITE_COS_MEDIA_PREFIX: prefix }));
  });
}

for (const bad of ['foo/media/', 'ruleexam/a/b/media/', '../media/', 'ruleexam/identity/', 'ruleexam/staging/', 'ruleexam/test/media/;x', 'ruleexam/test/media/\n', 'https://evil.example/']) {
  test(`public prefix rejects unsafe values ${JSON.stringify(bad)}`, () => {
    assert.throws(() => resolvePublicMediaConfig({ VITE_COS_MEDIA_ORIGIN: origin, VITE_COS_MEDIA_PREFIX: bad }));
  });
}

test('real entrypoint and envsubst render only the exact CSP sources while retaining nginx variables', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'training-nginx-media-'));
  try {
    const environmentFile = join(directory, 'public-media.env');
    await writeFile(environmentFile, serializePublicMediaEnv({ origin, prefix }));
    const script = `set -eu\n. "$1"\nenvsubst '$COS_MEDIA_CSP_SOURCE' < "$2"`;
    const rendered = spawnSync('/bin/sh', ['-c', script, 'test', join(root, 'deploy/nginx/15-public-media.envsh'), join(root, 'deploy/nginx/default.conf')], { env: { ...process.env, NGINX_PUBLIC_MEDIA_ENV: environmentFile }, encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /try_files \$uri \$uri\/ \/index\.html/);
    assert.match(rendered.stdout, /proxy_set_header Host \$host/);
    assert.doesNotMatch(rendered.stdout, /\$\{COS_MEDIA_CSP_SOURCE\}/);
    const policies = [...rendered.stdout.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(match => match[1]);
    assert.ok(policies.length >= 3);
    for (const policy of policies) {
      const directives = Object.fromEntries(policy.split(';').map(part => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
      assert.deepEqual(directives['script-src'], ["'self'"]);
      assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'"]);
      assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'blob:', origin]);
      assert.deepEqual(directives['media-src'], ["'self'", 'blob:', origin]);
      assert.deepEqual(directives['connect-src'], ["'self'", origin]);
      assert.deepEqual(directives['object-src'], ["'none'"]);
      assert.ok(directives['font-src'].includes('data:'));
    }
    await writeFile(environmentFile, serializePublicMediaEnv({ origin: '', prefix: '' }));
    const local = spawnSync('/bin/sh', ['-c', script, 'test', join(root, 'deploy/nginx/15-public-media.envsh'), join(root, 'deploy/nginx/default.conf')], { env: { ...process.env, NGINX_PUBLIC_MEDIA_ENV: environmentFile }, encoding: 'utf8' });
    assert.equal(local.status, 0, local.stderr);
    assert.match(local.stdout, /img-src 'self' data: blob:;/);
    assert.match(local.stdout, /connect-src 'self';/);
    assert.doesNotMatch(local.stdout, /\$\{COS_MEDIA_CSP_SOURCE\}/);
    for (const [, policy] of local.stdout.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)) assert.doesNotMatch(policy, /https:\/\//);
    await writeFile(environmentFile, serializePublicMediaEnv({ origin, prefix }));
    const mismatch = spawnSync('/bin/sh', ['-c', '. "$1"', 'test', join(root, 'deploy/nginx/15-public-media.envsh')], { env: { ...process.env, NGINX_PUBLIC_MEDIA_ENV: environmentFile, VITE_COS_MEDIA_ORIGIN: 'https://evil.example' }, encoding: 'utf8' });
    assert.notEqual(mismatch.status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Docker and Compose use one public build configuration and a template instead of a read-only output file', async () => {
  const [dockerfile, compose, ignore] = await Promise.all(['Dockerfile', 'docker-compose.yml', '.dockerignore'].map(name => readFile(join(root, name), 'utf8')));
  assert.match(dockerfile, /COPY deploy\/nginx\/default.conf \/etc\/nginx\/templates\/default.conf.template/);
  assert.match(dockerfile, /COPY --from=build \/app\/public-media.env \/etc\/nginx\/public-media.env/);
  assert.match(dockerfile, /node scripts\/build.mjs web h5/);
  assert.match(dockerfile, /ENV NGINX_ENVSUBST_FILTER=\^COS_MEDIA_CSP_SOURCE\$/);
  for (const name of ['VITE_COS_MEDIA_ORIGIN', 'VITE_COS_MEDIA_PREFIX', 'COS_BUCKET', 'COS_REGION', 'COS_KEY_PREFIX']) {
    assert.match(dockerfile, new RegExp(`ARG ${name}=`));
    assert.match(compose, new RegExp(`        ${name}:`));
  }
  assert.match(compose, /\.\/deploy\/nginx\/default.conf:\/etc\/nginx\/templates\/default.conf.template:ro/);
  assert.doesNotMatch(compose, /\.\/deploy\/nginx\/default.conf:\/etc\/nginx\/conf.d\/default.conf:ro/);
  for (const name of ['default.conf', 'public-media-config.mjs', '15-public-media.envsh']) assert.ok(ignore.includes(`!deploy/nginx/${name}`));
});

test('Docker build context includes every local helper imported by the Vite configs', async () => {
  const [dockerfile, ignore] = await Promise.all(['Dockerfile', '.dockerignore'].map(name => readFile(join(root, name), 'utf8')));
  const buildStage = dockerfile.split(/^FROM nginx:/m)[0];
  const copiedFiles = new Set(buildStage.split(/\r?\n/).filter(line => /^COPY /.test(line)).flatMap(line => line.split(/\s+/).slice(1, -1)));
  for (const client of ['web', 'mobile']) {
    const source = await readFile(join(root, client, 'vite.config.ts'), 'utf8');
    const helpers = [...source.matchAll(/from\s+['"](\.\/build\/[^'"]+)['"]/g)].map(match => match[1]);
    assert.ok(helpers.length, `${client} has build-time helpers that Docker must preserve`);
    for (const helper of helpers) {
      const relative = `${client}/${helper.slice(2)}${helper.endsWith('.mjs') ? '' : '.ts'}`;
      assert.ok(copiedFiles.has(relative), `Docker COPY is missing ${relative}`);
      assert.ok(ignore.split(/\r?\n/).includes(`!${relative}`), `Docker context ignores ${relative}`);
      await readFile(join(root, relative), 'utf8');
    }
  }
  assert.doesNotMatch(buildStage, /^COPY\s+(?:\.\s|[^\n]*\.env)/m, 'build context must not copy environment files');
});
