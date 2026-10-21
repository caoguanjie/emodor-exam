import { CallHandler, ExecutionContext, Injectable, NestInterceptor, mixin } from '@nestjs/common';
import multer, { type StorageEngine } from 'multer';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, unlink } from 'node:fs';
import { join } from 'node:path';
import { Observable, catchError, concatMap, finalize, from, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { Errors } from '../../common/errors';
import { MediaService } from './media.service';

type MediaRequest = Request & {
  file?: Express.Multer.File;
  mediaTempPath?: string;
  mediaUploadAborted?: boolean;
  mediaUploadWriter?: { abort: () => void };
};

function uploadTempRoot(): string {
  const root = process.env.UPLOAD_DIR || './data/uploads';
  const path = join(root, 'tmp', 'media');
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * Multer's public StorageEngine contract with a request-local writer handle.
 * The handle is intentionally not global: aborting one request must only
 * destroy that request's writer, and the interceptor cleans the path after
 * this engine has observed the writer's `close` event.
 */
export class MediaUploadStorage implements StorageEngine {
  constructor(
    private readonly destination: () => string = uploadTempRoot,
    private readonly markActivePath: (path: string) => void = () => undefined,
  ) {}

  _handleFile(
    req: Request,
    file: Express.Multer.File,
    callback: (error?: any, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const mediaReq = req as MediaRequest;
    if (mediaReq.mediaUploadAborted) {
      let callbackCalled = false;
      let sourceFailed = false;
      const detach = () => {
        file.stream.removeListener('error', onSourceError);
        file.stream.removeListener('end', onSourceSettled);
        file.stream.removeListener('close', onSourceSettled);
      };
      const settle = () => {
        if (callbackCalled || sourceFailed) return;
        callbackCalled = true;
        detach();
        callback(Errors.param('上传已取消'));
      };
      const onSourceError = () => {
        // Multer already owns the source-error callback and pending counter.
        sourceFailed = true;
        detach();
      };
      const onSourceSettled = () => settle();
      file.stream.once('error', onSourceError);
      file.stream.once('end', onSourceSettled);
      file.stream.once('close', onSourceSettled);
      // Destroy without an error: Multer's own source-error listener remains
      // the sole owner of pending-write decrementing for real source errors.
      file.stream.destroy();
      return;
    }

    const destination = this.destination();
    const filename = `${randomUUID()}.upload`;
    const path = join(destination, filename);
    mediaReq.mediaTempPath = path;
    this.markActivePath(path);

    const writer = createWriteStream(path);
    let callbackCalled = false;
    let writerClosed = false;
    let writerFinished = false;
    let sourceFailed = false;
    let sourceSettled = false;
    let abortRequested = false;
    let writerError: Error | undefined;

    const clearWriter = () => {
      if (mediaReq.mediaUploadWriter === handle) mediaReq.mediaUploadWriter = undefined;
    };
    const detachListeners = () => {
      file.stream.removeListener('error', onSourceError);
      file.stream.removeListener('end', onSourceEnd);
      file.stream.removeListener('close', onSourceClose);
      writer.removeListener('error', onWriterError);
      writer.removeListener('finish', onWriterFinish);
      writer.removeListener('close', onWriterClose);
    };
    const settle = (error?: Error) => {
      if (callbackCalled) return;
      callbackCalled = true;
      detachListeners();
      clearWriter();
      if (error) {
        callback(error);
      } else {
        callback(undefined, {
          destination,
          filename,
          path,
          size: writer.bytesWritten,
        });
      }
    };
    const settleAfterClose = () => {
      if (!writerClosed) return;
      if (sourceFailed) {
        // Multer's public file-stream error listener already decrements its
        // pending write counter. Do not call its storage callback a second
        // time; only finish closing this writer and clear the request handle.
        detachListeners();
        clearWriter();
        return;
      }
      if (abortRequested || writerError) {
        // Let Multer's source-error listener win if disconnecting the request
        // produces a source error after the writer was destroyed. Calling the
        // storage callback before the source settles would decrement its
        // pending-write counter twice.
        if (!sourceSettled) return;
        return settle(abortRequested ? Errors.param('上传已取消') : writerError);
      }
      if (writerFinished) return settle();
      settle(new Error('媒体临时文件写入未完成'));
    };
    const onSourceError = () => {
      sourceFailed = true;
      sourceSettled = true;
      file.stream.unpipe(writer);
      file.stream.destroy();
      if (!writer.destroyed) writer.destroy();
    };
    const onSourceEnd = () => {
      sourceSettled = true;
      settleAfterClose();
    };
    const onSourceClose = () => {
      sourceSettled = true;
      settleAfterClose();
    };
    const onWriterError = (error: Error) => {
      writerError = error;
      file.stream.unpipe(writer);
      file.stream.destroy();
      if (!writer.destroyed) writer.destroy();
    };
    const onWriterFinish = () => {
      writerFinished = true;
      settleAfterClose();
    };
    const onWriterClose = () => {
      writerClosed = true;
      settleAfterClose();
    };
    const handle = {
      abort: () => {
        if (callbackCalled || sourceFailed) return;
        abortRequested = true;
        file.stream.unpipe(writer);
        // A disconnected client may never emit `end`; close the source
        // without an error so Multer does not receive a second source error.
        file.stream.destroy();
        if (!writer.destroyed) writer.destroy();
        settleAfterClose();
      },
    };

    mediaReq.mediaUploadWriter = handle;
    file.stream.once('error', onSourceError);
    file.stream.once('end', onSourceEnd);
    file.stream.once('close', onSourceClose);
    writer.once('error', onWriterError);
    writer.once('finish', onWriterFinish);
    writer.once('close', onWriterClose);
    file.stream.pipe(writer);
  }

  abort(req: Request): boolean {
    const handle = (req as MediaRequest).mediaUploadWriter;
    if (!handle) return false;
    handle.abort();
    return true;
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void {
    const path = file.path;
    const mutableFile = file as Partial<Express.Multer.File>;
    delete mutableFile.destination;
    delete mutableFile.filename;
    delete mutableFile.path;
    if (!path) return callback(null);
    unlink(path, (error) => callback(error?.code === 'ENOENT' ? null : error));
  }
}

/** Multer wrapper that always reaps the exact UUID temporary path it created. */
@Injectable()
class MediaUploadInterceptorImpl implements NestInterceptor {
  private readonly storage: MediaUploadStorage;
  private readonly upload: any;

  constructor(private readonly media: MediaService) {
    this.storage = new MediaUploadStorage(uploadTempRoot, (path) => this.media.markTempPath(path));
    this.upload = multer({
      storage: this.storage,
      limits: {
        fileSize: media.uploadByteLimit(),
        files: 1,
        fields: 2,
        // Keep a finite envelope above the one-file/two-field contract; the
        // stricter `fields`/`files` caps remain authoritative for extra parts.
        parts: 4,
        fieldSize: 512,
        fieldNameSize: 64,
        headerPairs: 200,
      },
    }).single('file');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> | Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<MediaRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    let aborted = false;
    req.mediaUploadAborted = false;
    const onAborted = () => {
      aborted = true;
      req.mediaUploadAborted = true;
      this.storage.abort(req);
      // If Multer has not reached the storage engine yet, draining the
      // request lets Busboy close and invoke Multer's public callback.
      req.resume();
    };
    req.once('aborted', onAborted);
    return new Promise<Observable<unknown>>((resolve, reject) => {
      this.upload(req, res, (error: unknown) => {
        if (req.file?.path) {
          req.mediaTempPath = req.file.path;
        }
        if (error || aborted) {
          req.removeListener('aborted', onAborted);
          void this.cleanup(req).finally(() => reject(error || Errors.param('上传已取消')));
          return;
        }
        try {
          resolve(next.handle().pipe(
            // Await cleanup before the response is emitted, so DTO/controller
            // failures cannot race a caller that immediately inspects storage.
            concatMap((value) => from(this.cleanup(req)).pipe(map(() => value))),
            catchError((nextError) => from(this.cleanup(req)).pipe(
              concatMap(() => throwError(() => nextError)),
            )),
            finalize(() => {
              req.removeListener('aborted', onAborted);
            }),
          ));
        } catch (nextError) {
          req.removeListener('aborted', onAborted);
          void this.cleanup(req).finally(() => reject(nextError));
        }
      });
    });
  }

  private cleanup(req: MediaRequest): Promise<void> {
    const path = req.mediaTempPath || req.file?.path;
    return this.media.cleanupTempPath(path);
  }
}

export const MediaUploadInterceptor = () => mixin(MediaUploadInterceptorImpl);
