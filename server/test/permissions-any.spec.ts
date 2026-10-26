import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import * as decorators from '../src/common/decorators/permissions.decorator';
import { legacyPermissionForRequest, PermissionsGuard } from '../src/common/guards/permissions.guard';
import { isRegisteredPermission } from '../src/modules/access/permission-catalog';
import { Errors } from '../src/common/errors';
import { QuestionAuthoringOptionsController } from '../src/modules/questions/question-authoring-options.controller';

function context(handler: Function, request: any, controller: Function = QuestionAuthoringOptionsController): any {
  return { getHandler: () => handler, getClass: () => controller, switchToHttp: () => ({ getRequest: () => request }) };
}
function accessWith(permissions: string[]) {
  return { assertAllowed: vi.fn(async (_user: string, code: string) => { if (!permissions.includes(code)) throw Errors.forbidden(); }) };
}

describe('authoring catalog permissions', () => {
  it('retires only question review permission and leaves removed write routes unmapped', () => {
    expect(isRegisteredPermission('questions:review')).toBe(false);
    expect(isRegisteredPermission('ai:review')).toBe(true);
    expect(isRegisteredPermission('papers:review')).toBe(true);
    for (const path of ['/ai/questions/5/review', '/ai/questions/5/regenerate', '/ai/generate-questions', '/ai/question-concepts']) {
      expect(legacyPermissionForRequest({ originalUrl: '/api/v1' + path, method: 'POST' })).toBeUndefined();
    }
    expect(legacyPermissionForRequest({ originalUrl: '/api/v1/ai/questions/5/enabled', method: 'PUT' })).toBe('questions:write');
  });
  it.each([['questions:read'], ['questions:write']])('permits %s to consume the same non-content authoring catalog', async (...permissions) => {
    const access = accessWith(permissions);
    const guard = new PermissionsGuard(new Reflector(), access as any);
    const req = { user: { id: 9 }, originalUrl: '/api/v1/admin/questions/authoring-options', method: 'GET' };
    await expect(guard.canActivate(context(QuestionAuthoringOptionsController.prototype.options, req))).resolves.toBe(true);
    expect(new QuestionAuthoringOptionsController().options().difficulties.filter((item) => item.enabled).map((item) => item.code)).toEqual(['easy', 'hard']);
    expect(req).toMatchObject({ permission_authorized: true });
  });

  it('denies missing permissions, unauthenticated users and propagates infrastructure errors', async () => {
    const handler = QuestionAuthoringOptionsController.prototype.options;
    await expect(new PermissionsGuard(new Reflector(), accessWith([]) as any).canActivate(context(handler, { user: { id: 9 } }))).rejects.toMatchObject({ code: 40301 });
    await expect(new PermissionsGuard(new Reflector(), accessWith(['questions:read']) as any).canActivate(context(handler, {}))).rejects.toMatchObject({ code: 40101 });
    await expect(new PermissionsGuard(new Reflector(), { assertAllowed: async () => { throw new Error('storage unavailable'); } } as any)
      .canActivate(context(handler, { user: { id: 9 } }))).rejects.toThrow('storage unavailable');
  });

  it('keeps existing Permissions declarations as AND and never grants question-content reading to a writer', async () => {
    const content = () => undefined;
    Reflect.defineMetadata(decorators.PERMISSIONS_KEY, ['questions:read'], content);
    const both = () => undefined;
    Reflect.defineMetadata(decorators.PERMISSIONS_KEY, ['questions:read', 'questions:write'], both);
    const guard = new PermissionsGuard(new Reflector(), accessWith(['questions:write']) as any);
    await expect(guard.canActivate(context(content, { user: { id: 9 } }, class Content {}))).rejects.toMatchObject({ code: 40301 });
    await expect(guard.canActivate(context(both, { user: { id: 9 } }, class Both {}))).rejects.toMatchObject({ code: 40301 });
  });
});
