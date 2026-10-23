import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { BizError } from '../../common/errors';
import { clearIdentityMaterials } from './identity.service';

/** Stable material recovery data. Never log raw supplier errors or request bodies. */
@Catch()
export class IdentityExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let code = 50001; let status = 500; let message = '认证服务暂不可用'; let reason: string | null = null; let extra = {};
    if (error instanceof BizError) { code = error.code; status = error.httpStatus; message = error.message; const data = error.data as any; reason = typeof data?.reason_code === 'string' ? data.reason_code : null; if (data?.status === 'verified') extra = { status: 'verified' }; }
    else if (error instanceof HttpException) { status = error.getStatus(); code = status === 413 ? 42202 : status === 400 ? 40001 : status * 100 + 1; if (status === 413) { status = 422; message = '文件超过大小上限'; } else message = status < 500 ? '认证请求参数错误' : '认证服务暂不可用'; }
    else if ((error as any)?.code === 'LIMIT_FILE_SIZE') { code = 42202; status = 422; message = '文件超过大小上限'; }
    host.switchToHttp().getResponse<Response>().status(status).json({ code, message, data: { ...extra, reason_code: reason, clear_materials: clearIdentityMaterials(reason) } });
  }
}
