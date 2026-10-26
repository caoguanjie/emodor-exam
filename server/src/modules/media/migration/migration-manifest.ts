import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import type { StorageLocator, StoredObject } from '../storage/media-storage.port';

export type MigrationItem = {
  assetId: string;
  purpose: string;
  source: StorageLocator;
  sha256: string;
  sizeBytes: number;
  updatedAt: string;
  status?: string;
  mediaKind?: string;
  mimeType?: string;
  referenceCount?: number;
  anomaly?: string | null;
};
export type MigrationState = 'planned' | 'uploaded' | 'verified' | 'switched' | 'rolled_back' | 'skipped' | 'failed';
export type MigrationCheckpoint = {
  item: MigrationItem;
  target: StorageLocator | null;
  state: MigrationState;
  verifiedSha256: string | null;
  reason: string | null;
  object?: StoredObject | null;
  uploadStartedAt?: string | null;
  switchedUpdatedAt?: string | null;
  cleanupPending?: boolean;
};
export interface MigrationManifest {
  /** Required for candidate reclamation; normal business writes remain unlocked. */
  readonly exclusive?: boolean;
  get(assetId: string): Promise<MigrationCheckpoint | null>;
  save(value: MigrationCheckpoint): Promise<void>;
}

type ManifestFile = { version: 1; entries: Record<string, MigrationCheckpoint> };
const STATES = new Set<MigrationState>(['planned', 'uploaded', 'verified', 'switched', 'rolled_back', 'skipped', 'failed']);
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !rel || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function text(value: unknown, length = 512): string {
  if (typeof value !== 'string' || value.length > length || /[\r\n\0]/.test(value)) throw new Error('MANIFEST_INVALID');
  return value;
}
function nullableText(value: unknown, length = 512): string | null { return value === null || value === undefined ? null : text(value, length); }
function locator(value: any): StorageLocator {
  if (!value || !['local', 'cos'].includes(value.provider)) throw new Error('MANIFEST_INVALID');
  return { provider: value.provider, key: text(value.key), bucket: nullableText(value.bucket, 255), region: nullableText(value.region, 64), versionId: nullableText(value.versionId, 255) };
}

/** Copy an explicit whitelist so accidental credentials never enter a manifest. */
function checkpoint(value: any): MigrationCheckpoint {
  if (!value?.item || !STATES.has(value.state) || !/^[1-9]\d{0,19}$/.test(value.item.assetId)
    || !Number.isSafeInteger(value.item.sizeBytes)) throw new Error('MANIFEST_INVALID');
  const item: MigrationItem = {
    assetId: value.item.assetId, purpose: text(value.item.purpose, 32), source: locator(value.item.source),
    sha256: text(value.item.sha256, 64), sizeBytes: value.item.sizeBytes, updatedAt: text(value.item.updatedAt, 32),
  };
  for (const key of ['status', 'mediaKind', 'mimeType'] as const) if (value.item[key] !== undefined) item[key] = text(value.item[key], 128);
  if (value.item.referenceCount !== undefined) {
    if (!Number.isSafeInteger(value.item.referenceCount) || value.item.referenceCount < 0) throw new Error('MANIFEST_INVALID');
    item.referenceCount = value.item.referenceCount;
  }
  if (value.item.anomaly !== undefined) item.anomaly = nullableText(value.item.anomaly, 64);
  const result: MigrationCheckpoint = { item, target: value.target ? locator(value.target) : null,
    state: value.state, verifiedSha256: nullableText(value.verifiedSha256, 64), reason: nullableText(value.reason, 128) };
  if (value.object) result.object = { locator: locator(value.object.locator), sizeBytes: value.object.sizeBytes,
    mimeType: text(value.object.mimeType, 128), etag: nullableText(value.object.etag, 255), crc64: nullableText(value.object.crc64, 64) };
  else if (value.object === null) result.object = null;
  if (value.uploadStartedAt !== undefined) result.uploadStartedAt = nullableText(value.uploadStartedAt, 32);
  if (value.switchedUpdatedAt !== undefined) result.switchedUpdatedAt = nullableText(value.switchedUpdatedAt, 32);
  if (value.cleanupPending !== undefined) result.cleanupPending = value.cleanupPending === true;
  return result;
}

/** A single operator batch holds the lock, including its cloud operations. */
export class FileMigrationManifest implements MigrationManifest {
  readonly path: string;
  private readonly repositoryRoots: string[];
  private lockToken: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(path: string, repositoryRoot: string, additionalRepositoryRoots: string[] = []) {
    this.path = resolve(path);
    this.repositoryRoots = [repositoryRoot, ...additionalRepositoryRoots].map((root) => resolve(root));
    if (this.repositoryRoots.some((root) => inside(root, this.path))) throw new Error('MANIFEST_MUST_BE_OUTSIDE_REPOSITORY');
  }
  get exclusive(): boolean { return this.lockToken !== null; }

  private async prepare(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(this.path));
    for (const root of this.repositoryRoots) {
      const actualRoot = await realpath(root);
      if (inside(actualRoot, join(parent, basename(this.path)))) throw new Error('MANIFEST_MUST_BE_OUTSIDE_REPOSITORY');
    }
    const info = await lstat(this.path).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error('MANIFEST_INVALID_FILE');
    if (info && (info.mode & 0o077) !== 0) throw new Error('MANIFEST_PERMISSIONS_INVALID');
  }
  private async load(): Promise<ManifestFile> {
    await this.prepare();
    let raw: any;
    try { raw = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: {} }; throw new Error('MANIFEST_INVALID'); }
    if (raw?.version !== 1 || !raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) throw new Error('MANIFEST_INVALID');
    const entries: Record<string, MigrationCheckpoint> = {};
    for (const [id, value] of Object.entries(raw.entries)) {
      const entry = checkpoint(value);
      if (entry.item.assetId !== id) throw new Error('MANIFEST_INVALID');
      entries[id] = entry;
    }
    return { version: 1, entries };
  }
  async get(assetId: string): Promise<MigrationCheckpoint | null> { return (await this.load()).entries[assetId] ?? null; }
  async entries(): Promise<MigrationCheckpoint[]> { return Object.values((await this.load()).entries); }

  async save(value: MigrationCheckpoint): Promise<void> {
    if (!this.exclusive) throw new Error('MANIFEST_EXCLUSIVE_LOCK_REQUIRED');
    const entry = checkpoint(value);
    const operation = this.queue.then(async () => {
      const currentLock = await readFile(`${this.path}.lock`, 'utf8').catch(() => '');
      try { if (JSON.parse(currentLock).token !== this.lockToken) throw new Error(); }
      catch { throw new Error('MANIFEST_LOCK_LOST'); }
      const file = await this.load();
      file.entries[entry.item.assetId] = entry;
      const temporary = join(dirname(this.path), `.${basename(this.path)}.${randomUUID()}.tmp`);
      const writer = await open(temporary, 'wx', 0o600);
      try {
        await writer.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8');
        await writer.sync();
        await writer.close();
        await rename(temporary, this.path);
        await chmod(this.path, 0o600);
        const directory = await open(dirname(this.path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } catch (error) { await writer.close().catch(() => undefined); await rm(temporary, { force: true }).catch(() => undefined); throw error; }
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }

  async withExclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.exclusive) throw new Error('MANIFEST_LOCKED');
    await this.prepare();
    const token = randomUUID();
    let lock;
    try { lock = await open(`${this.path}.lock`, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('MANIFEST_LOCKED'); throw error; }
    try {
      await lock.writeFile(JSON.stringify({ version: 1, host: hostname(), pid: process.pid, token, createdAt: new Date().toISOString() }));
      await lock.sync();
      this.lockToken = token;
      return await work();
    } finally {
      await this.queue;
      this.lockToken = null;
      await lock.close();
      // Do not remove a lock replaced externally while the process was running.
      const contents = await readFile(`${this.path}.lock`, 'utf8').catch(() => '');
      try { if (JSON.parse(contents).token === token) await rm(`${this.path}.lock`); } catch { /* preserve ambiguous ownership */ }
    }
  }
}
