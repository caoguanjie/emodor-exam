import { describe, expect, it } from 'vitest';
import { PayloadTooLargeException } from '@nestjs/common';
import { IdentityExceptionFilter } from '../src/modules/identity/identity-exception.filter';
import { Errors } from '../src/common/errors';
describe('identity material error recovery envelope', () => {
  it.each([
    [Errors.param('请重拍', { reason_code: 'FACE_QUALITY_FAILED' }), 400, 40001, { reason_code: 'FACE_QUALITY_FAILED', clear_materials: ['face'] }],
    [Errors.serviceUnavailable(), 503, 50004, { reason_code: null, clear_materials: [] }],
    [new PayloadTooLargeException(), 422, 42202, { reason_code: null, clear_materials: [] }],
    [Errors.identityAlreadyVerified(), 409, 40960, { status: 'verified', reason_code: null, clear_materials: [] }],
  ])('normalizes business and multipart failures without exposing raw material data', (error, status, code, data) => {
    let observedStatus; let observedBody;
    const response = { status: (value) => { observedStatus = value; return response; }, json: (value) => { observedBody = value; } };
    new IdentityExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => response }) } as any);
    expect(observedStatus).toBe(status); expect(observedBody).toMatchObject({ code, data });
  });
});
