#!/usr/bin/env node
// Environment is supplied by Node --env-file=.env or the caller; this module
// never searches for, reads or copies another project's credential files.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../server/package.json', import.meta.url));

export function parseMigrationArgs(argv) {
  let action = 'plan'; let selectedAction = false; let manifest;
  const assetIds = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (['--plan', '--apply', '--rollback'].includes(value)) {
      if (selectedAction) throw new Error('INVALID_ARGUMENTS');
      selectedAction = true; action = value.slice(2);
    } else if (value === '--manifest') {
      if (manifest || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENTS');
      manifest = resolve(argv[++i]);
    } else if (value === '--asset-id') {
      const id = argv[++i];
      if (!/^[1-9]\d{0,19}$/.test(id || '')) throw new Error('INVALID_ARGUMENTS');
      assetIds.push(id);
    } else throw new Error('INVALID_ARGUMENTS');
  }
  if (!manifest) throw new Error('MANIFEST_PATH_REQUIRED');
  return { action, manifest, assetIds: [...new Set(assetIds)] };
}

function config(env, name) {
  if (!env[name]?.trim()) throw new Error(`CONFIG_REQUIRED_${name}`);
  return env[name];
}
export function readMigrationDatabasePassword(env) {
  const localDevelopment = ['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)
    && (env.NODE_ENV === undefined || env.NODE_ENV === 'development');
  if (localDevelopment && Object.hasOwn(env, 'DB_PASSWORD') && env.DB_PASSWORD === '') return '';
  return config(env, 'DB_PASSWORD');
}
function repositoryRoots() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return [dirname(common)];
  } catch { return []; }
}
function report(value) {
  // No source/target key, identity name, signed URL, or credential is printed.
  process.stdout.write(`${JSON.stringify({ asset_id: value.item.assetId, purpose: value.item.purpose,
    state: value.state, reason: value.reason, cleanup_pending: value.cleanupPending === true })}\n`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseMigrationArgs(argv);
  require('reflect-metadata');
  const { DataSource } = require('typeorm');
  const { MediaAsset } = require('./dist/entities/media-asset.entity.js');
  const { MediaReference } = require('./dist/entities/media-reference.entity.js');
  const { MediaStorageRouter } = require('./dist/modules/media/storage/media-storage.router.js');
  const { LocalMediaStorage } = require('./dist/modules/media/storage/local-media-storage.js');
  const { CosMediaStorage } = require('./dist/modules/media/storage/cos-media-storage.js');
  const { readCosMediaConfig } = require('./dist/modules/media/storage/cos-media.config.js');
  const { MediaPublisher } = require('./dist/modules/media/media-publisher.service.js');
  const { MediaStorageMigrationService } = require('./dist/modules/media/migration/media-storage-migration.service.js');
  const { FileMigrationManifest } = require('./dist/modules/media/migration/migration-manifest.js');
  const manifest = new FileMigrationManifest(args.manifest, ROOT, repositoryRoots());
  const database = config(env, 'DB_DATABASE');
  if (!/^[A-Za-z0-9_]+$/.test(database) || ['mysql', 'sys', 'information_schema', 'performance_schema'].includes(database.toLowerCase())) throw new Error('DATABASE_TARGET_INVALID');
  const port = Number(env.DB_PORT || '3306');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('CONFIG_INVALID_DB_PORT');
  const sourceRoot = resolve(ROOT, config(env, 'UPLOAD_DIR'));
  const source = new DataSource({ type: 'mysql', host: config(env, 'DB_HOST'), port,
    username: config(env, 'DB_USERNAME'), password: readMigrationDatabasePassword(env), database,
    entities: [MediaAsset, MediaReference], synchronize: false, logging: false,
    charset: 'utf8mb4_0900_ai_ci', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
    extra: { connectionLimit: 2 } });
  const mediaConfig = args.action === 'plan'
    ? readCosMediaConfig({ MEDIA_STORAGE_PROVIDER: 'local' })
    : readCosMediaConfig({ ...env, MEDIA_STORAGE_PROVIDER: 'cos' });
  const router = new MediaStorageRouter(mediaConfig, new LocalMediaStorage(sourceRoot), args.action === 'plan' ? undefined : new CosMediaStorage(mediaConfig));
  const service = new MediaStorageMigrationService(source, router, new MediaPublisher(router), { sourceRoot });
  const summary = { action: args.action, total: 0, planned: 0, switched: 0, rolled_back: 0, skipped: 0, failed: 0 };
  await manifest.withExclusive(async () => {
    const existing = await manifest.entries();
    const selected = args.assetIds.length ? existing.filter((entry) => args.assetIds.includes(entry.item.assetId)) : existing;
    if (args.action !== 'plan' && (!selected.length || args.assetIds.some((id) => !selected.some((entry) => entry.item.assetId === id)))) throw new Error('MANIFEST_BATCH_NOT_FOUND');
    try {
      try { await source.initialize(); } catch { throw new Error('DATABASE_UNAVAILABLE'); }
      if (args.action === 'plan') {
        for await (const item of service.plan()) {
          if (args.assetIds.length && !args.assetIds.includes(item.assetId)) continue;
          // Replanning never erases an existing candidate, version or receipt.
          let entry = await manifest.get(item.assetId);
          if (!entry) {
            entry = { item, target: null, state: item.anomaly ? 'skipped' : 'planned', verifiedSha256: null, reason: item.anomaly ?? null };
            await manifest.save(entry);
          }
          summary.total++; summary[entry.state] = (summary[entry.state] || 0) + 1; report(entry);
        }
      } else {
        for (const entry of selected) {
          const result = await service[args.action](entry.item, manifest);
          summary.total++; summary[result.state] = (summary[result.state] || 0) + 1; report(result);
        }
      }
    } finally { if (source.isInitialized) await source.destroy(); }
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.message || '') ? error.message : 'MIGRATION_TOOL_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
