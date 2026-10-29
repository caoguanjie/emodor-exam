import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const library = () => import('../scripts/build-lib.mjs');
const repositoryRoot = new URL('../', import.meta.url);
const require = createRequire(new URL('../mobile/package.json', import.meta.url));

async function waitUntil(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

async function readJsonIfPresent(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function prepareCliFixture(rootDir, compiler) {
  await mkdir(join(rootDir, 'scripts'));
  for (const name of ['build.mjs', 'build-lib.mjs']) {
    await cp(new URL(`../scripts/${name}`, import.meta.url), join(rootDir, 'scripts', name));
  }
  await writeTree(join(rootDir, 'web'), {
    'package.json': JSON.stringify({ scripts: { build: 'node compiler.mjs' } }),
    'compiler.mjs': compiler,
  });
}

function startFixture(rootDir, entry = 'scripts/build.mjs') {
  const child = spawn(process.execPath, [entry, 'web'], {
    cwd: rootDir,
    env: { PATH: process.env.PATH, npm_config_cache: join(rootDir, 'npm-cache') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, output: () => output };
}

async function writeTree(root, files) {
  for (const [path, value] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, value);
  }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-build-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeTree(join(root, 'dist'), {
    'index.html': '<html>old-pc</html>',
    'assets/old.js': 'old-pc-asset',
    'mobile/index.html': '<html>old-h5</html>',
    'mobile/assets/old.js': 'old-h5-asset',
  });
  return root;
}

async function snapshot(root) {
  const files = [];
  async function walk(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files.push([relative(root, file), createHash('sha256').update(await readFile(file)).digest('hex')]);
    }
  }
  await walk(root);
  return files;
}

async function compileFixture(target, { outputDir }) {
  await writeTree(outputDir, target === 'mp-weixin'
    ? { 'app.json': '{"pages":["pages/index/index"]}', 'app.js': 'new-mp' }
    : { 'index.html': `<html>new-${target}</html>`, 'assets/new.js': `new-${target}-asset` });
}

test('real npm compiler publishes from a project directory containing spaces', async (t) => {
  const root = await fixture(t);
  const rootDir = join(root, 'project with spaces');
  await mkdir(rootDir);
  await prepareCliFixture(rootDir, `
    import { mkdir, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    await mkdir(process.env.RULEEXAM_BUILD_OUT_DIR, { recursive: true });
    await writeFile(join(process.env.RULEEXAM_BUILD_OUT_DIR, 'index.html'), '<html>real-npm</html>');
  `);
  const { runBuild } = await library();
  await runBuild(['web'], { rootDir });
  assert.equal(await readFile(join(rootDir, 'dist/index.html'), 'utf8'), '<html>real-npm</html>');
  assert.equal((await readdir(rootDir)).some(name => name.startsWith('.build')), false);
});

test('target parser accepts website combinations and rejects ambiguous or missing targets', async () => {
  const { parseBuildTargets } = await library();
  assert.deepEqual(parseBuildTargets(['web']), ['web']);
  assert.deepEqual(parseBuildTargets(['h5']), ['h5']);
  assert.deepEqual(parseBuildTargets(['h5', 'web', 'h5']), ['h5', 'web']);
  assert.deepEqual(parseBuildTargets(['mp-weixin']), ['mp-weixin']);
  for (const argv of [[], ['unknown'], ['web', 'mp-weixin']]) {
    assert.throws(() => parseBuildTargets(argv), /web|h5|mp-weixin/);
  }
});

test('web-only publish replaces stale PC files and preserves H5 byte for byte', async (t) => {
  const rootDir = await fixture(t);
  const before = await snapshot(join(rootDir, 'dist/mobile'));
  const { runBuild } = await library();
  await runBuild(['web'], { rootDir, buildTarget: compileFixture });
  assert.equal(await readFile(join(rootDir, 'dist/index.html'), 'utf8'), '<html>new-web</html>');
  assert.deepEqual(await snapshot(join(rootDir, 'dist/mobile')), before);
  await assert.rejects(readFile(join(rootDir, 'dist/assets/old.js')), { code: 'ENOENT' });
});

test('H5-only publish replaces stale H5 files and preserves every PC file', async (t) => {
  const rootDir = await fixture(t);
  const { runBuild } = await library();
  await runBuild(['h5'], { rootDir, buildTarget: compileFixture });
  assert.equal(await readFile(join(rootDir, 'dist/index.html'), 'utf8'), '<html>old-pc</html>');
  assert.equal(await readFile(join(rootDir, 'dist/assets/old.js'), 'utf8'), 'old-pc-asset');
  assert.equal(await readFile(join(rootDir, 'dist/mobile/index.html'), 'utf8'), '<html>new-h5</html>');
  await assert.rejects(readFile(join(rootDir, 'dist/mobile/assets/old.js')), { code: 'ENOENT' });
});

test('combined publish includes both new entrypoints after both compilers succeed', async (t) => {
  const rootDir = await fixture(t);
  const { runBuild } = await library();
  await runBuild(['web', 'h5'], { rootDir, buildTarget: compileFixture });
  assert.equal(await readFile(join(rootDir, 'dist/index.html'), 'utf8'), '<html>new-web</html>');
  assert.equal(await readFile(join(rootDir, 'dist/mobile/index.html'), 'utf8'), '<html>new-h5</html>');
  assert.equal((await snapshot(join(rootDir, 'dist'))).length, 4);
});

test('failed second compiler leaves the existing release byte-identical', async (t) => {
  const rootDir = await fixture(t);
  const before = await snapshot(join(rootDir, 'dist'));
  const { runBuild } = await library();
  await assert.rejects(runBuild(['web', 'h5'], {
    rootDir,
    buildTarget: async (target, options) => {
      if (target === 'h5') throw new Error('compiler failed');
      await compileFixture(target, options);
    },
  }), /compiler failed/);
  assert.deepEqual(await snapshot(join(rootDir, 'dist')), before);
  assert.deepEqual(await readdir(rootDir), ['dist']);
});

test('missing or empty generated entrypoint never replaces current dist', async (t) => {
  const rootDir = await fixture(t);
  const before = await snapshot(join(rootDir, 'dist'));
  const { runBuild } = await library();
  for (const files of [{ 'assets/app.js': 'bad' }, { 'index.html': '' }]) {
    await assert.rejects(runBuild(['h5'], {
      rootDir, buildTarget: async (_target, { outputDir }) => writeTree(outputDir, files),
    }), /index.html/);
    assert.deepEqual(await snapshot(join(rootDir, 'dist')), before);
  }
});

test('first single-target build does not require an unbuilt counterpart', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'ruleexam-build-first-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const { runBuild } = await library();
  await runBuild(['h5'], { rootDir, buildTarget: compileFixture });
  assert.equal(await readFile(join(rootDir, 'dist/mobile/index.html'), 'utf8'), '<html>new-h5</html>');
  await assert.rejects(readFile(join(rootDir, 'dist/index.html')), { code: 'ENOENT' });
});

test('assembly rejects PC output that could overwrite the reserved mobile subtree', async (t) => {
  const rootDir = await fixture(t);
  await writeTree(join(rootDir, 'web-output'), {
    'index.html': 'new-pc', 'mobile/index.html': 'unexpected-overwrite',
  });
  const { assembleRelease } = await library();
  await assert.rejects(assembleRelease({
    targets: ['web'], existingDist: join(rootDir, 'dist'),
    webOutput: join(rootDir, 'web-output'), stagingDir: join(rootDir, 'stage'),
  }), /mobile/);
  assert.equal(await readFile(join(rootDir, 'dist/mobile/index.html'), 'utf8'), '<html>old-h5</html>');
});

test('publish rename failure restores the complete old release and retains staged output', async (t) => {
  const rootDir = await fixture(t);
  const distDir = join(rootDir, 'dist');
  const stagingDir = join(rootDir, 'stage');
  const before = await snapshot(distDir);
  await writeTree(stagingDir, { 'index.html': 'new-pc' });
  const { atomicPublish } = await library();
  await assert.rejects(atomicPublish(stagingDir, distDir, {
    rename: async (source, destination) => {
      if (source === stagingDir && destination === distDir) throw new Error('rename denied');
      return rename(source, destination);
    },
  }), /rename denied/);
  assert.deepEqual(await snapshot(distDir), before);
  assert.equal(await readFile(join(stagingDir, 'index.html'), 'utf8'), 'new-pc');
  assert.deepEqual((await readdir(rootDir)).sort(), ['dist', 'stage']);
});

test('an already-held build lock prevents a racing compiler and leaves dist untouched', async (t) => {
  const rootDir = await fixture(t);
  await mkdir(join(rootDir, '.build.lock'));
  const before = await snapshot(join(rootDir, 'dist'));
  const { runBuild } = await library();
  let started = false;
  await assert.rejects(runBuild(['web'], {
    rootDir, buildTarget: async () => { started = true; },
  }), /build.*lock|构建.*锁/i);
  assert.equal(started, false);
  assert.deepEqual(await snapshot(join(rootDir, 'dist')), before);
});

test('mp-weixin publishes only its own output and never changes website dist', async (t) => {
  const rootDir = await fixture(t);
  const before = await snapshot(join(rootDir, 'dist'));
  await writeTree(join(rootDir, 'mobile/dist/build/mp-weixin'), { 'old.js': 'old-mp' });
  const { runBuild } = await library();
  await runBuild(['mp-weixin'], { rootDir, buildTarget: compileFixture });
  assert.deepEqual(await snapshot(join(rootDir, 'dist')), before);
  assert.equal(await readFile(join(rootDir, 'mobile/dist/build/mp-weixin/app.js'), 'utf8'), 'new-mp');
  await assert.rejects(readFile(join(rootDir, 'mobile/dist/build/mp-weixin/old.js')), { code: 'ENOENT' });
});

for (const [signal, expectedCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`CLI ${signal} waits for compiler descendants and removes owned lock/temp without publishing`, async (t) => {
    const rootDir = await fixture(t);
    const before = await snapshot(join(rootDir, 'dist'));
    await prepareCliFixture(rootDir, `
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(`
        const fs = require('node:fs');
        for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => setTimeout(() => {
          fs.writeFileSync('../descendant-stopped', signal); process.exit(0);
        }, 150));
        fs.writeFileSync('../descendant-ready', 'ready');
        setInterval(() => {}, 1000);
      `)}], { stdio: 'inherit' });
      for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => setTimeout(() => {
        writeFileSync('../compiler-stopped', signal); process.exit(0);
      }, 75));
      writeFileSync('../compiler-pids.json', JSON.stringify([process.pid, descendant.pid]));
      setInterval(() => {}, 1000);
    `);
    const run = startFixture(rootDir);
    let pids = [];
    try {
      pids = await waitUntil(() => readJsonIfPresent(join(rootDir, 'compiler-pids.json')), 'compiler did not start');
      await waitUntil(async () => (await readdir(rootDir)).includes('descendant-ready'), 'descendant did not start');
      run.child.kill(signal);
      let timeout;
      const outcome = await Promise.race([run.exited, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('build signal cleanup timed out')), 10_000);
      })]).finally(() => clearTimeout(timeout));
      assert.deepEqual(outcome, { code: expectedCode, signal: null }, run.output());
      assert.equal(await readFile(join(rootDir, 'compiler-stopped'), 'utf8'), signal);
      assert.equal(await readFile(join(rootDir, 'descendant-stopped'), 'utf8'), signal);
      await waitUntil(() => pids.every((pid) => !isAlive(pid)), 'compiler process survived orchestrator exit');
      assert.deepEqual(await snapshot(join(rootDir, 'dist')), before);
      assert.deepEqual((await readdir(rootDir)).filter((name) => name.startsWith('.build')), []);
    } finally {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  });
}

for (const failPublish of [false, true]) {
test(`SIGTERM during publish ${failPublish ? 'rolls back the previous release' : 'finishes a complete release'} before cleaning lock and returning 143`, async (t) => {
  const rootDir = await fixture(t);
  const before = await snapshot(join(rootDir, 'dist'));
  await prepareCliFixture(rootDir, `
    import { mkdirSync, writeFileSync } from 'node:fs';
    mkdirSync(process.env.RULEEXAM_BUILD_OUT_DIR, { recursive: true });
    writeFileSync(process.env.RULEEXAM_BUILD_OUT_DIR + '/index.html', 'new-critical-pc');
  `);
  await writeTree(rootDir, { 'launch.mjs': `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { resolve } from 'node:path';
    const rename = fs.rename;
    fs.rename = async (source, destination) => {
      if (${failPublish} && destination === resolve('dist') && source.endsWith('/release')) throw new Error('injected publish failure');
      await rename(source, destination);
      if (source === resolve('dist')) {
        await fs.writeFile('publish-paused', 'ready');
        while (!(await fs.readdir('.')).includes('publish-continue')) await new Promise((r) => setTimeout(r, 10));
      }
    };
    syncBuiltinESMExports();
    await import('./scripts/build.mjs');
  ` });
  const run = startFixture(rootDir, 'launch.mjs');
  try {
    await waitUntil(async () => (await readdir(rootDir)).includes('publish-paused'), 'publish did not reach rename boundary');
    run.child.kill('SIGTERM');
    await waitUntil(() => run.output().includes('收到 SIGTERM'), 'CLI did not acknowledge SIGTERM');
    await writeFile(join(rootDir, 'publish-continue'), 'continue');
    const outcome = await run.exited;
    assert.deepEqual(outcome, { code: 143, signal: null }, run.output());
    assert.equal(await readFile(join(rootDir, 'dist/index.html'), 'utf8'), failPublish ? '<html>old-pc</html>' : 'new-critical-pc');
    if (failPublish) assert.deepEqual(await snapshot(join(rootDir, 'dist')), before);
    assert.equal(await readFile(join(rootDir, 'dist/mobile/index.html'), 'utf8'), '<html>old-h5</html>');
    assert.deepEqual((await readdir(rootDir)).filter((name) => name.startsWith('.build')), []);
  } finally {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
  }
});
}

test('a lock owned by a live process is never reclaimed or deleted', async (t) => {
  const rootDir = await fixture(t);
  const owner = { pid: process.pid, token: 'another-live-build' };
  await writeTree(join(rootDir, '.build.lock'), { 'owner.json': JSON.stringify(owner) });
  const { runBuild } = await library();
  await assert.rejects(runBuild(['web'], { rootDir, buildTarget: compileFixture }), /运行|活跃|running|active/i);
  assert.deepEqual(await readJsonIfPresent(join(rootDir, '.build.lock/owner.json')), owner);
});

test('a stale lock is diagnosed without deleting or guessing ownership', async (t) => {
  const rootDir = await fixture(t);
  const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  const owner = { pid: exited.pid, token: 'stale-owner' };
  await writeTree(join(rootDir, '.build.lock'), { 'owner.json': JSON.stringify(owner) });
  const { runBuild } = await library();
  await assert.rejects(runBuild(['web'], { rootDir, buildTarget: compileFixture }), /旧进程.*已退出.*手动移除旧锁/);
  assert.deepEqual(await readJsonIfPresent(join(rootDir, '.build.lock/owner.json')), owner);
});

test('Compose forwards Gate E/G configuration and production config consumes synthetic providers', async () => {
  const { parse } = require('yaml');
  const compose = parse(await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'));
  const generated = () => randomBytes(32).toString('base64');
  const supplied = {
    JWT_SECRET: generated(), EXAM_SHUFFLE_SECRET: generated(), APP_ENCRYPTION_KEY: generated(),
    IDENTITY_DATA_ENCRYPTION_KEY: generated(), IDENTITY_FINGERPRINT_SECRET: generated(), MEDIA_TICKET_SECRET: generated(),
    SMS_PROVIDER: 'yunxin', SERVER_DEBUG_LOGIN_ENABLED: 'false',
    YUNXIN_SMS_APP_KEY: randomBytes(8).toString('hex'), YUNXIN_SMS_APP_SECRET: generated(),
    YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID: '123456', YUNXIN_SMS_BASE_URL: 'https://sms.yunxinapi.com',
    YUNXIN_SMS_TIMEOUT_SECONDS: '7', YUNXIN_SMS_LOGIN_RESEND_SECONDS: '61',
    YUNXIN_SMS_LOGIN_VERIFY_TTL_SECONDS: '301', YUNXIN_SMS_LOGIN_MAX_VERIFY_ATTEMPTS: '6',
    YUNXIN_SMS_LOGIN_PHONE_DAILY_LIMIT: '11', YUNXIN_SMS_LOGIN_IP_DAILY_LIMIT: '101',
    YUNXIN_SMS_REDIS_KEY_PREFIX: 'synthetic:sms', IDENTITY_PROVIDER: 'tencent',
    IDENTITY_SESSION_TTL_SECONDS: '601', MEDIA_TICKET_TTL_SECONDS: '301',
    TENCENT_ID_CARD_OCR_ENABLED: 'true', TENCENT_ID_CARD_OCR_SECRET_ID: randomBytes(8).toString('hex'),
    TENCENT_ID_CARD_OCR_SECRET_KEY: generated(), TENCENT_ID_CARD_OCR_TOKEN: generated(),
    TENCENT_ID_CARD_OCR_ENDPOINT: 'https://ocr.tencentcloudapi.com', TENCENT_ID_CARD_OCR_HTTP_TIMEOUT_SECONDS: '11',
    TENCENT_FACEID_ENABLED: 'true', TENCENT_FACEID_SECRET_ID: randomBytes(8).toString('hex'),
    TENCENT_FACEID_SECRET_KEY: generated(), TENCENT_FACEID_TOKEN: generated(),
    TENCENT_FACEID_ENDPOINT: 'https://faceid.tencentcloudapi.com', TENCENT_FACEID_HTTP_TIMEOUT_SECONDS: '12',
  };
  const environment = Object.fromEntries(Object.entries(compose.services.api.environment).map(([key, value]) => [
    key, String(value).replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_all, name, fallback) => supplied[name] || fallback || ''),
  ]));
  for (const [name, value] of Object.entries(supplied)) assert.equal(environment[name], value, `Compose dropped ${name}`);
  const script = `
    const assert = require('node:assert/strict');
    const c = require('./server/dist/config/configuration.js').loadConfig();
    assert.equal(c.env, 'production'); assert.equal(c.debugLoginEnabled, false);
    assert.equal(c.sms.provider, 'yunxin'); assert.equal(c.sms.timeoutSeconds, 7);
    assert.equal(c.sms.resendSeconds, 61); assert.equal(c.sms.verifyTtlSeconds, 301);
    assert.equal(c.sms.maxVerifyAttempts, 6); assert.equal(c.sms.phoneDailyLimit, 11);
    assert.equal(c.sms.ipDailyLimit, 101); assert.equal(c.sms.redisKeyPrefix, 'synthetic:sms');
    assert.equal(c.sms.appKey, process.env.YUNXIN_SMS_APP_KEY); assert.equal(c.sms.appSecret, process.env.YUNXIN_SMS_APP_SECRET);
    assert.equal(c.sms.templateId, '123456'); assert.equal(c.sms.baseUrl, 'https://sms.yunxinapi.com');
    assert.equal(c.identity.provider, 'tencent'); assert.equal(c.identity.sessionTtlSeconds, 601);
    assert.equal(c.identity.dataEncryptionKey, process.env.IDENTITY_DATA_ENCRYPTION_KEY);
    assert.equal(c.identity.fingerprintSecret, process.env.IDENTITY_FINGERPRINT_SECRET);
    assert.equal(c.mediaTicket.secret, process.env.MEDIA_TICKET_SECRET); assert.equal(c.mediaTicket.ttlSeconds, 301);
    for (const [provider, prefix, timeout, endpoint] of [
      ['idCardOcr','TENCENT_ID_CARD_OCR',11,'https://ocr.tencentcloudapi.com/'],
      ['faceId','TENCENT_FACEID',12,'https://faceid.tencentcloudapi.com/']
    ]) { const p = c.identity[provider]; assert.equal(p.enabled, true); assert.equal(p.secretId, process.env[prefix+'_SECRET_ID']);
      assert.equal(p.secretKey, process.env[prefix+'_SECRET_KEY']); assert.equal(p.token, process.env[prefix+'_TOKEN']);
      assert.equal(p.timeoutSeconds, timeout); assert.equal(p.endpoint, endpoint); }
  `;
  const child = spawnSync(process.execPath, ['-e', script], { cwd: repositoryRoot, env: environment, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('PC and H5 CSP allow the data font emitted by compiling the installed uni-app stylesheet', async () => {
  const { build } = await import('../web/node_modules/vite/dist/node/index.js');
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: { write: false, rollupOptions: {
      input: fileURLToPath(new URL('../mobile/node_modules/@dcloudio/uni-h5/style/video.css', import.meta.url)),
    } },
  });
  const css = result.output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
  const font = css.match(/url\((['"]?)(data:font\/[^)'"]+)\1\)/)?.[2];
  assert.ok(font, 'real uni-app build must contain its data font for this regression');
  const nginx = await readFile(new URL('../deploy/nginx/default.conf', import.meta.url), 'utf8');
  const policies = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(policies.length >= 3);
  for (const policy of policies) {
    const directives = Object.fromEntries(policy.split(';').map((part) => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
    assert.ok((directives['font-src'] || directives['default-src']).includes('data:'), 'emitted data font is blocked by CSP');
    assert.ok(directives['font-src'].includes("'self'"));
    assert.deepEqual(directives['script-src'], ["'self'"]);
  }
});
