import { CallHandler, ExecutionContext, Injectable, NestInterceptor, mixin } from '@nestjs/common';
import { diskStorage } from 'multer';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Observable, catchError, concatMap, finalize, from, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { Errors } from '../../common/errors';
import { MediaService } from './media.service';

type MediaRequest = Request & {
  file?: Express.Multer.File;
  mediaTempPath?: string;
};

function uploadTempRoot(): string {
  const root = process.env.UPLOAD_DIR || './data/uploads';
  const path = join(root, 'tmp', 'media');
  mkdirSync(path, { recursive: true });
  return path;
}

/** Multer wrapper that always reaps the exact UUID temporary path it created. */
@Injectable()
class MediaUploadInterceptorImpl implements NestInterceptor {
  private readonly upload: any;

  constructor(private readonly media: MediaService) {
    this.upload = multer({
      storage: diskStorage({
        destination: (_req, _file, callback) => callback(null, uploadTempRoot()),
        filename: (req, _file, callback) => {
          const name = `${randomUUID()}.upload`;
          (req as MediaRequest).mediaTempPath = join(uploadTempRoot(), name);
          callback(null, name);
        },
      }),
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
    const onAborted = () => {
      aborted = true;
      void this.cleanup(req);
    };
    req.once('aborted', onAborted);
    return new Promise<Observable<unknown>>((resolve, reject) => {
      this.upload(req, res, (error: unknown) => {
        if (req.file?.path) {
          req.mediaTempPath = req.file.path;
          this.media.markTempPath(req.file.path);
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
