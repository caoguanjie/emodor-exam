import { afterEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import multer from 'multer';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaUploadStorage } from '../src/modules/media/media-upload.interceptor';

type TestRequest = {
  mediaTempPath?: string;
  mediaUploadAborted?: boolean;
  mediaUploadWriter?: unknown;
};

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

function fileFor(source: PassThrough): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'fixture.bin',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    stream: source,
  } as Express.Multer.File;
}

async function waitForValue(read: () => string | undefined, label: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`${label} did not become available`);
}

describe('media upload storage lifecycle', () => {
  it('settles an abort that arrives before the file writer starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-upload-before-start-'));
    roots.push(root);
    const storage = new MediaUploadStorage(() => root);
    const req: TestRequest = { mediaUploadAborted: true };
    const source = new PassThrough();
    let callbacks = 0;
    const done = new Promise<void>((resolve) => {
      storage._handleFile(req as any, fileFor(source), (error) => {
        expect(error?.message).toContain('上传已取消');
        callbacks += 1;
        resolve();
      });
    });

    source.end('ignored');
    await done;
    expect(callbacks).toBe(1);
    expect(req.mediaTempPath).toBeUndefined();
    expect(req.mediaUploadWriter).toBeUndefined();
  });

  it('closes the writer before abort callback and settles it once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-upload-abort-'));
    roots.push(root);
    const storage = new MediaUploadStorage(() => root);
    const req: TestRequest = {};
    const source = new PassThrough();
    let callbacks = 0;
    let callbackWriter: unknown;
    let callbackError: Error | undefined;
    const done = new Promise<void>((resolve) => {
      storage._handleFile(req as any, fileFor(source), (error) => {
        callbacks += 1;
        callbackError = error;
        callbackWriter = req.mediaUploadWriter;
        resolve();
      });
    });

    source.write(Buffer.alloc(1024));
    expect(storage.abort(req as any)).toBe(true);
    source.end();
    await done;

    expect(callbacks).toBe(1);
    expect(callbackError?.message).toContain('上传已取消');
    expect(callbackWriter).toBeUndefined();
    expect(req.mediaUploadWriter).toBeUndefined();
    await expect(stat(req.mediaTempPath!)).resolves.toBeDefined();
  });

  it('settles an abort when the disconnected source never emits end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-upload-no-end-'));
    roots.push(root);
    const storage = new MediaUploadStorage(() => root);
    const req: TestRequest = {};
    const source = new PassThrough();
    let callbacks = 0;
    const done = new Promise<void>((resolve) => {
      storage._handleFile(req as any, fileFor(source), (error) => {
        expect(error?.message).toContain('上传已取消');
        callbacks += 1;
        resolve();
      });
    });

    source.write(Buffer.alloc(1024));
    expect(storage.abort(req as any)).toBe(true);
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const settled = await Promise.race([
      done.then(() => true),
      new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), 250);
      }),
    ]);
    clearTimeout(timeoutHandle!);
    if (!settled) source.destroy();
    expect(settled).toBe(true);
    expect(callbacks).toBe(1);
    expect(source.destroyed).toBe(true);
    expect(req.mediaUploadWriter).toBeUndefined();
  });

  it('reports a successful file exactly once after the writer closes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-upload-success-'));
    roots.push(root);
    const storage = new MediaUploadStorage(() => root);
    const req: TestRequest = {};
    const source = new PassThrough();
    let callbacks = 0;
    let info: Partial<Express.Multer.File> | undefined;
    let callbackWriter: unknown;
    const done = new Promise<void>((resolve) => {
      storage._handleFile(req as any, fileFor(source), (error, value) => {
        expect(error).toBeUndefined();
        callbacks += 1;
        info = value;
        callbackWriter = req.mediaUploadWriter;
        resolve();
      });
    });

    source.end('hello');
    await done;

    expect(callbacks).toBe(1);
    expect(info?.size).toBe(5);
    expect(callbackWriter).toBeUndefined();
    await expect(stat(info?.path!)).resolves.toBeDefined();
  });

  it('reports a writer error exactly once and clears the active writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-upload-error-'));
    roots.push(root);
    const storage = new MediaUploadStorage(() => join(root, 'missing'));
    const req: TestRequest = {};
    const source = new PassThrough();
    let callbacks = 0;
    let callbackError: Error | undefined;
    const done = new Promise<void>((resolve) => {
      storage._handleFile(req as any, fileFor(source), (error) => {
        callbacks += 1;
        callbackError = error;
        resolve();
      });
    });

    source.end('hello');
    await done;

    expect(callbacks).toBe(1);
    expect(callbackError).toBeInstanceOf(Error);
    expect(req.mediaUploadWriter).toBeUndefined();
  });

  it('awaits writer close before cleanup on an installed Multer source error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-upload-source-error-'));
    roots.push(root);
    let tempPath: string | undefined;
    const storage = new class extends MediaUploadStorage {
      override _handleFile(req: any, file: any, callback: any): void {
        super._handleFile(req, file, callback);
        setImmediate(() => file.stream.emit('error', new Error('source stream error')));
      }
    }(() => root, (path) => { tempPath = path; }, (path) => {
      const writer = createWriteStream(path);
      const originalDestroy = writer.destroy.bind(writer);
      writer.destroy = ((error?: Error) => {
        setTimeout(() => originalDestroy(error), 100);
        return writer;
      }) as typeof writer.destroy;
      return writer;
    });
    const upload = multer({ storage }).single('file');
    const boundary = 'media-upload-boundary';
    let callbackError: unknown;
    let cleanup: Promise<void> | undefined;
    let finishHandler: (() => void) | undefined;
    const handlerDone = new Promise<void>((resolve) => { finishHandler = resolve; });
    const server = createServer((req, res) => {
      upload(req, res, (error: unknown) => {
        callbackError = error;
        tempPath = (req as any).mediaTempPath;
        cleanup = MediaUploadStorage.waitForClose(req).then(() => unlink(tempPath!));
        void cleanup.finally(() => {
          res.statusCode = 400;
          res.end();
          finishHandler?.();
        });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    let client: ReturnType<typeof httpRequest> | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('server did not bind');
      client = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      client.on('error', () => undefined);
      client.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
      client.write(Buffer.alloc(1024));
      const path = await waitForValue(() => tempPath || undefined, 'storage path');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(stat(path)).resolves.toBeDefined();
      await handlerDone;
      expect(callbackError).toBeInstanceOf(Error);
      await cleanup;
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      client?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
