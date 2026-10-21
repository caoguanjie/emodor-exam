import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { lastValueFrom, of } from 'rxjs';
import { MediaUploadInterceptor } from '../src/modules/media/media-upload.interceptor';

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

function multipartBody(filenameParameter: Buffer): { boundary: string; body: Buffer } {
  const boundary = 'ruleexam-media-filename-boundary';
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; `),
      filenameParameter,
      Buffer.from(`\r\nContent-Type: video/mp4\r\n\r\nfixture\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function parsedOriginalName(filenameParameter: Buffer): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-filename-'));
  roots.push(root);
  const previousUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = root;
  try {
    const { boundary, body } = multipartBody(filenameParameter);
    const req = Readable.from(body) as Readable & {
      headers: Record<string, string>;
      method: string;
      file?: Express.Multer.File;
    };
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    };
    req.method = 'POST';
    const media = {
      uploadByteLimit: () => 1024,
      markTempPath: () => undefined,
      cleanupTempPath: async (path: string | undefined) => {
        if (path) await rm(path, { force: true });
      },
    };
    const Interceptor = MediaUploadInterceptor() as unknown as new (service: typeof media) => {
      intercept: (context: any, next: any) => any;
    };
    const interceptor = new Interceptor(media);
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    };
    const stream = await interceptor.intercept(context, {
      handle: () => of(req.file?.originalname),
    });
    return String(await lastValueFrom(stream));
  } finally {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
  }
}

describe('media upload multipart filename metadata', () => {
  it.each([
    ['ASCII', Buffer.from('filename="course.mp4"'), 'course.mp4'],
    ['browser UTF-8 Chinese', Buffer.from('filename="课程.mp4"'), '课程.mp4'],
    ['already decoded Unicode', Buffer.from(`filename="fallback.mp4"; filename*=UTF-8''${encodeURIComponent('课程😀.mp4')}`), '课程😀.mp4'],
    ['invalid UTF-8 bytes', Buffer.concat([Buffer.from('filename="'), Buffer.from([0xff, 0xfe]), Buffer.from('.mp4"')]), 'ÿþ.mp4'],
    ['ambiguous Latin-only bytes', Buffer.from('filename="é.mp4"'), 'Ã©.mp4'],
  ])('preserves safe %s metadata at the real Multer boundary', async (_label, parameter, expected) => {
    expect(await parsedOriginalName(parameter as Buffer)).toBe(expected);
  });
});
