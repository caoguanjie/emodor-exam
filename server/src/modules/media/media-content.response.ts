import type { Response } from 'express';
import type { MediaContentDescriptor } from './media.service';

/** All media controllers share streaming, HEAD and disconnect handling. */
export function sendMediaContent(res: Response, descriptor: MediaContentDescriptor): void {
  const { stream, size, range, asset } = descriptor;
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  res.status(range ? 206 : 200);
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(end - start + 1));
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'private, no-store');
  if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);

  const cleanup = () => {
    res.removeListener('close', stop);
    res.removeListener('finish', stop);
    res.removeListener('error', stop);
    stream.removeListener('error', failed);
  };
  const stop = () => { stream.unpipe(res); stream.destroy(); cleanup(); };
  const failed = () => {
    stop();
    if (!res.headersSent) {
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Range');
      res.status(404).end();
    } else res.destroy();
  };
  res.once('close', stop);
  res.once('finish', stop);
  res.once('error', stop);
  stream.once('error', failed);
  if (res.req?.method === 'HEAD') {
    stop();
    res.end();
    return;
  }
  stream.pipe(res);
}
