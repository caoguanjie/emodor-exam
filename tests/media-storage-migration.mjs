import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { DataSource } = require('typeorm');
const { MediaAsset } = require('./dist/entities/media-asset.entity.js');
const { MediaReference } = require('./dist/entities/media-reference.entity.js');
const { MediaStorageRouter } = require('./dist/modules/media/storage/media-storage.router.js');
const { LocalMediaStorage } = require('./dist/modules/media/storage/local-media-storage.js');
const { MediaPublisher } = require('./dist/modules/media/media-publisher.service.js');
const { MediaStorageMigrationService } = require('./dist/modules/media/migration/media-storage-migration.service.js');
const { FileMigrationManifest } = require('./dist/modules/media/migration/migration-manifest.js');
const digest = (body) => createHash('sha256').update(body).digest('hex');
const exec = promisify(execFile);

export async function run(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_/);
  const options = { type: 'mysql', host: ctx.env.DB_HOST, port: Number(ctx.env.DB_PORT),
    username: ctx.env.DB_USERNAME, password: ctx.env.DB_PASSWORD, database: ctx.env.DB_DATABASE,
    entities: [MediaAsset, MediaReference], synchronize: false, logging: false,
    charset: 'utf8mb4_0900_ai_ci', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
    extra: { connectionLimit: 2 } };
  const first = new DataSource(options); const second = new DataSource(options);
  await first.initialize(); await second.initialize();
  const manifestsRoot = await mkdtemp(join(tmpdir(), 'ruleexam-migration-manifest-'));
  const sourceRoot = ctx.env.UPLOAD_DIR;
  const createdAssets = new Set(); const createdFiles = new Set(); const regulationIds = [];
  const objects = new Map(); let puts = 0;
  const cloud = {
    async stat(locator) {
      const value = objects.get(locator.key);
      if (!value || locator.versionId !== null && locator.versionId !== value.object.locator.versionId) throw Object.assign(new Error('absent'), { statusCode: 404, code: 'NoSuchKey' });
      return { ...value.object, locator: { ...value.object.locator } };
    },
    async putFile(locator, path, mimeType) {
      puts++; const body = await readFile(path);
      const object = { locator: { ...locator, versionId: `migration-fixture-${puts}` }, sizeBytes: body.length, mimeType, etag: `etag-${puts}`, crc64: String(puts) };
      objects.set(locator.key, { body, object }); return object;
    },
    async open(locator) { await cloud.stat(locator); return Readable.from(objects.get(locator.key).body); },
    async remove(locator) { await cloud.stat(locator); objects.delete(locator.key); },
  };
  const config = { provider: 'cos', bucket: 'migration-fixture-123456', region: 'ap-fixture', keyPrefix: 'ruleexam/', secretId: 'test-only-not-usable', secretKey: 'test-only-not-usable', sessionToken: null };
  const router = new MediaStorageRouter(config, new LocalMediaStorage(sourceRoot), cloud);
  const publisher = new MediaPublisher(router);
  const service = (connection, onCheckpoint) => new MediaStorageMigrationService(connection, router, publisher, { sourceRoot, onCheckpoint });
  const manifest = (label) => new FileMigrationManifest(join(manifestsRoot, `${label}.json`), new URL('../', import.meta.url).pathname);
  const seed = async (purpose = 'question', referenced = false) => {
    const body = Buffer.from(`migration fixture ${randomUUID()}`);
    const storageKey = `media/migration-fixture-${randomUUID()}.png`;
    await mkdir(join(sourceRoot, 'media'), { recursive: true });
    await writeFile(join(sourceRoot, storageKey), body, { mode: 0o600 }); createdFiles.add(join(sourceRoot, storageKey));
    const repo = first.getRepository(MediaAsset);
    const asset = await repo.save(repo.create({ ownerId: '1', uploadedBy: '1', purpose, mediaKind: 'image', originalName: null,
      mimeType: 'image/png', storageProvider: 'local', storageKey, sizeBytes: String(body.length), sha256: digest(body), status: 'ready', durationMs: null, probeError: null }));
    createdAssets.add(String(asset.id));
    if (referenced) await first.getRepository(MediaReference).insert({ assetId: String(asset.id), ownerType: 'exam_record_question', ownerId: '9881' });
    return { asset, body, path: join(sourceRoot, storageKey) };
  };
  const itemFor = async (migration, id) => {
    for await (const item of migration.plan()) if (item.assetId === String(id)) return item;
    assert.fail('fixture missing from authoritative media plan');
  };
  try {
    // Real legacy document originals are outside the asset migration entirely.
    const created = await first.query("INSERT INTO regulation (title,category,status,created_by) VALUES ('migration-original-exclusion','test','draft',1)");
    const regulationId = String(created.insertId); regulationIds.push(regulationId);
    for (const [index, type] of ['pdf', 'docx'].entries()) {
      const path = `regulations/migration-original-${randomUUID()}.${type}`; const body = Buffer.from(`original-${type}`);
      await mkdir(join(sourceRoot, 'regulations'), { recursive: true }); await writeFile(join(sourceRoot, path), body, { mode: 0o600 }); createdFiles.add(join(sourceRoot, path));
      await first.query('INSERT INTO regulation_version (regulation_id,version_no,file_path,file_type,file_hash,parse_status,created_by) VALUES (?,?,?,?,?,?,1)', [regulationId, index + 1, path, type, digest(body), 'parsed']);
    }
    const originalsBefore = await first.query('SELECT * FROM regulation_version WHERE regulation_id=? ORDER BY id', [regulationId]);

    // PUT completed, but no object receipt saved: a new instance uses the same key.
    const history = await seed('question', true); let failAfterPut = true;
    const putManifest = manifest('put-crash');
    const interrupted = service(first, (event) => { if (event === 'after-upload' && failAfterPut) { failAfterPut = false; throw new Error('injected put crash'); } });
    const item = await itemFor(interrupted, history.asset.id);
    const referencesBefore = await first.query('SELECT * FROM media_reference WHERE asset_id=? ORDER BY id', [history.asset.id]);
    const putsBefore = puts;
    await assert.rejects(() => putManifest.withExclusive(() => interrupted.apply(item, putManifest)), /injected put crash/);
    const candidate = (await putManifest.get(item.assetId)).target.key;
    const resumedManifest = manifest('put-crash');
    const recovered = await resumedManifest.withExclusive(() => service(second).apply(item, resumedManifest));
    assert.equal(recovered.state, 'switched'); assert.equal(recovered.target.key, candidate); assert.equal(puts, putsBefore + 1);
    assert.deepEqual(await first.query('SELECT * FROM media_reference WHERE asset_id=? ORDER BY id', [history.asset.id]), referencesBefore);
    assert.equal(String((await first.getRepository(MediaAsset).findOneByOrFail({ id: String(history.asset.id) })).id), item.assetId);

    // A corrupt or missing local backup cannot be used for rollback.
    await writeFile(history.path, Buffer.alloc(history.body.length, 0x78));
    const refused = await resumedManifest.withExclusive(() => service(second).rollback(item, resumedManifest));
    assert.equal(refused.state, 'failed'); assert.equal(refused.reason, 'SOURCE_HASH_MISMATCH');
    await writeFile(history.path, history.body);
    assert.equal((await resumedManifest.withExclusive(() => service(second).rollback(item, resumedManifest))).state, 'rolled_back');
    assert.equal((await first.getRepository(MediaAsset).findOneByOrFail({ id: item.assetId })).storageProvider, 'local');
    assert.deepEqual(await readFile(history.path), history.body);

    // The row switch commits before manifest receipt persistence; recover from DB.
    const switchedFixture = await seed(); const switchedManifest = manifest('switch-crash'); let crash = true;
    const switching = service(first, (event) => { if (event === 'after-switch' && crash) { crash = false; throw new Error('injected switch crash'); } });
    const switchItem = await itemFor(switching, switchedFixture.asset.id);
    await assert.rejects(() => switchedManifest.withExclusive(() => switching.apply(switchItem, switchedManifest)), /injected switch crash/);
    assert.equal((await first.getRepository(MediaAsset).findOneByOrFail({ id: switchItem.assetId })).storageProvider, 'cos');
    assert.equal((await switchedManifest.withExclusive(() => service(second).apply(switchItem, switchedManifest))).state, 'switched');

    // A real second connection deletes the original while copying is outside locks.
    const deleted = await seed(); const deletedManifest = manifest('delete-race');
    const deleting = service(first, async (event) => {
      if (event !== 'verified') return;
      await second.transaction(async (manager) => {
        const repo = manager.getRepository(MediaAsset);
        const current = await repo.findOne({ where: { id: String(deleted.asset.id) }, lock: { mode: 'pessimistic_write' } });
        assert.equal(current.status, 'ready');
        current.status = 'deleting'; await repo.save(current); await repo.delete({ id: String(deleted.asset.id) });
      });
    });
    const deletedItem = await itemFor(deleting, deleted.asset.id);
    const deleteResult = await deletedManifest.withExclusive(() => deleting.apply(deletedItem, deletedManifest));
    assert.equal(deleteResult.state, 'skipped'); assert.equal(deleteResult.reason, 'ROW_CHANGED');
    assert.equal(await first.getRepository(MediaAsset).countBy({ id: deletedItem.assetId }), 0);
    assert.equal(objects.has(deleteResult.target.key), false);

    // Two manifests/instances can race one asset, but only one source CAS wins.
    const competing = await seed(); const manifestA = manifest('competing-a'); const manifestB = manifest('competing-b');
    let reached; let release;
    const waiting = new Promise((resolve) => { reached = resolve; }); const continueA = new Promise((resolve) => { release = resolve; });
    const migrationA = service(first, async (event) => { if (event === 'verified') { reached(); await continueA; } });
    const competingItem = await itemFor(migrationA, competing.asset.id);
    const firstRun = manifestA.withExclusive(() => migrationA.apply(competingItem, manifestA));
    await waiting;
    let resultB;
    try { resultB = await manifestB.withExclusive(() => service(second).apply(competingItem, manifestB)); }
    finally { release(); }
    const resultA = await firstRun;
    assert.equal(resultB.state, 'switched'); assert.equal(resultA.state, 'skipped');
    assert.notEqual(resultA.target.key, resultB.target.key);
    assert.equal((await first.getRepository(MediaAsset).findOneByOrFail({ id: competingItem.assetId })).storageKey, resultB.target.key);
    assert.equal(objects.has(resultA.target.key), false); assert.equal(objects.has(resultB.target.key), true);

    // Private identity migration stays outside the ordinary media distribution tree.
    const identity = await seed('identity_face'); const identityManifest = manifest('identity'); const identityService = service(first);
    const identityItem = await itemFor(identityService, identity.asset.id);
    const identityResult = await identityManifest.withExclusive(() => identityService.apply(identityItem, identityManifest));
    assert.match(identityResult.target.key, /^ruleexam\/identity\/migration\//);

    // The actual CLI defaults to plan and cannot accidentally issue cloud writes.
    const cliManifest = join(manifestsRoot, 'cli-plan.json');
    const output = await exec(process.execPath, [new URL('../scripts/media/migrate-local-to-cos.mjs', import.meta.url).pathname, '--manifest', cliManifest], { env: { ...process.env, ...ctx.env }, maxBuffer: 1024 * 1024 });
    const summary = JSON.parse(output.stdout.trim().split('\n').at(-1)); assert.equal(summary.action, 'plan');
    assert.equal(output.stdout.includes(ctx.env.DB_PASSWORD), false);
    assert.equal(output.stdout.includes('content_url'), false);
    assert.deepEqual(await first.query('SELECT * FROM regulation_version WHERE regulation_id=? ORDER BY id', [regulationId]), originalsBefore);
    for (const original of originalsBefore) assert.equal((await readFile(join(sourceRoot, original.file_path))).toString(), `original-${original.file_type}`);
    console.log('[media-storage-migration] isolated DB CAS/delete/two-manifest races, crash reconciliation, history, rollback, identity and read-only CLI passed');
  } finally {
    for (const id of createdAssets) { await first.getRepository(MediaReference).delete({ assetId: id }); await first.getRepository(MediaAsset).delete({ id }); }
    for (const id of regulationIds) { await first.query('DELETE FROM regulation_version WHERE regulation_id=?', [id]); await first.query('DELETE FROM regulation WHERE id=?', [id]); }
    for (const path of createdFiles) await rm(path, { force: true });
    await first.destroy(); await second.destroy(); await rm(manifestsRoot, { recursive: true, force: true });
  }
}
