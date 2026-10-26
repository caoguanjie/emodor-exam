import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { MediaStoragePort, StorageLocator, StoredObject } from './media-storage.port';

export class LocalMediaStorage implements MediaStoragePort {
  constructor(private readonly root: string) {}

  private async path(locator: StorageLocator, writing = false): Promise<string> {
    const key = locator.key;
    if (locator.provider !== 'local' || !key || isAbsolute(key) || /[\\\0]/.test(key)
      || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('媒体存储路径无效');
    const root = resolve(this.root);
    const path = resolve(root, key);
    const rel = relative(root, path);
    if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('媒体存储路径无效');
    if (writing) await mkdir(root, { recursive: true });
    const actualRoot = await realpath(root);
    // Resolve every existing component before creating directories or touching a file.
    let cursor = root;
    for (const part of key.split('/')) {
      cursor = resolve(cursor, part);
      try {
        const actual = await realpath(cursor);
        const within = relative(actualRoot, actual);
        if (within.startsWith(`..${sep}`) || within === '..' || isAbsolute(within)) throw new Error('媒体存储路径无效');
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error('媒体存储路径不允许符号链接');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        break;
      }
    }
    return path;
  }

  async stat(locator: StorageLocator): Promise<StoredObject> {
    const info = await stat(await this.path(locator));
    if (!info.isFile()) throw new Error('媒体对象不是文件');
    const extension = locator.key.split('.').pop()?.toLowerCase();
    const mimeType = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' })[extension || ''] || 'application/octet-stream';
    return { locator, sizeBytes: info.size, mimeType, etag: null, crc64: null };
  }

  async open(locator: StorageLocator, range?: { start: number; end: number }): Promise<Readable> {
    const path = await this.path(locator);
    const info = await stat(path);
    if (!info.isFile()) throw new Error('媒体对象不是文件');
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end >= info.size)) throw new RangeError('invalid byte range');
    return createReadStream(path, range ? { start: range.start, end: range.end } : {});
  }

  async putFile(locator: StorageLocator, filePath: string, mimeType: string): Promise<StoredObject> {
    const path = await this.path(locator, true);
    await mkdir(dirname(path), { recursive: true });
    // Recheck after mkdir to prevent a pre-existing symlink parent from being followed.
    await this.path(locator);
    let created = false;
    const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    output.once('open', () => { created = true; });
    try { await pipeline(createReadStream(filePath), output); }
    catch (error) { if (created) await rm(path, { force: true }); throw error; }
    return { ...(await this.stat(locator)), mimeType };
  }

  async remove(locator: StorageLocator): Promise<void> {
    await rm(await this.path(locator), { force: true });
  }
}
