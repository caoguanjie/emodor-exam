import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { Response } from 'express';

export const SKIP_ENVELOPE_KEY = 'skip_envelope';
/** 文件下载/二进制流响应跳过统一信封（04 册 1.1：Excel 导出响应为二进制流） */
export const SkipEnvelope = (): MethodDecorator => (target, key, desc) => {
  Reflect.defineMetadata(SKIP_ENVELOPE_KEY, true, desc.value!);
  return desc;
};

/**
 * 全局响应拦截器：输出统一信封 { code, message, data }，code = 0 表示成功（README 3.4）。
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const handler = ctx.getHandler();
    const skip = Reflect.getMetadata(SKIP_ENVELOPE_KEY, handler);
    return next.handle().pipe(
      map((body) => {
        if (skip) return body;
        const res = ctx.switchToHttp().getResponse<Response>();
        if (res.headersSent) return body;
        // 成功统一 200（04 册 5.1：code=0 → 200/201，取 200 保持调用端一致）
        res.status(200);
        return { code: 0, message: 'success', data: body ?? null };
      }),
    );
  }
}
