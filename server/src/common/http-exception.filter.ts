import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { BizError } from './errors';

function traceId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 全局异常过滤器：BizError → { code, message, data }；
 * class-validator 校验失败 → 40001（附字段级原因，04 册 5.2）；
 * 其余未分类异常 → 50001（附 trace_id，04 册 6.3）。
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof BizError) {
      res.status(exception.httpStatus).json({
        code: exception.code,
        message: exception.message,
        data: exception.data ?? null,
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: any = exception.getResponse();
      // class-validator ValidationFilter 已转换为 { fields }，此处映射 40001
      if (status === HttpStatus.BAD_REQUEST && body && typeof body === 'object' && 'fields' in body) {
        res.status(400).json({ code: 40001, message: '参数错误', data: { fields: body.fields } });
        return;
      }
      if (status === HttpStatus.UNAUTHORIZED) {
        res.status(401).json({ code: 40101, message: '未认证或令牌无效', data: null });
        return;
      }
      if (status === HttpStatus.NOT_FOUND) {
        res.status(404).json({ code: 40401, message: '资源不存在', data: null });
        return;
      }
      if (status === HttpStatus.FORBIDDEN) {
        res.status(403).json({ code: 40301, message: '无权限访问该资源', data: null });
        return;
      }
      const message = typeof body === 'string' ? body : body?.message || exception.message;
      res.status(status).json({ code: status * 100 + 1, message, data: null });
      return;
    }
    const tid = traceId();
    // 关键链路日志（NFR-16）：未分类异常带 trace_id 供排查，不打印请求体避免敏感信息入日志
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', trace_id: tid, msg: String((exception as any)?.stack || exception) }));
    res.status(500).json({ code: 50001, message: '服务器内部错误', data: { trace_id: tid } });
  }
}
