import { BizError } from '../../../common/errors';

export function uploadConflict(reason: string, message = '上传会话状态已变化，请读取原会话确认') {
  return new BizError(40906,409,message,{reason_code:reason});
}
export function isMissingObject(error: any): boolean {
  return error?.statusCode === 404 && ['NoSuchKey','NoSuchVersion','NotFound','NoSuchUpload'].includes(error.code);
}
