import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { QuestionGenerationService } from '../src/modules/ai/question-generation.service';
import { AiController } from '../src/modules/ai/ai.controller';
import { QuestionBankService } from '../src/modules/questions/question-bank.service';
import { PaperService } from '../src/modules/ai/paper.service';
import { PaperAdminController } from '../src/modules/exams/paper-admin.controller';

const MATERIAL_SERVICE_MODULE = '../src/modules/question-materials/question-materials.service';
const MATERIAL_CONTROLLER_MODULE = '../src/modules/question-materials/question-materials.controller';

describe('training demo admin slimming', () => {
  it('registers the retained account and learning controllers without legacy management controllers', async () => {
    const module = await import('../src/app.module').catch(() => null) as any;
    expect(module, 'AppModule must load after deleted controllers are removed').not.toBeNull();
    if (!module) return;

    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module.AppModule) as Function[];
    const names = controllers.map((controller) => controller.name);
    expect(names).toEqual(expect.arrayContaining([
      'StudentsController', 'MeProfileController', 'RegulationContentController', 'QuestionMaterialsController',
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      'UsersController', 'DepartmentsController', 'RegulationsController',
      'AnswerMediaController', 'GradingAdminController',
    ]));
  });

  it('creates a question material without exposing legacy regulation state', async () => {
    const module = await import(MATERIAL_SERVICE_MODULE).catch(() => null) as any;
    expect(module, 'question-materials service must exist').not.toBeNull();
    if (!module) return;

    const savedRows: any[] = [];
    const repository = {
      create: vi.fn((value: any) => ({ id: '41', ...value })),
      save: vi.fn(async (value: any) => {
        savedRows.push(value);
        return value;
      }),
    };
    const service = Object.create(module.QuestionMaterialsService.prototype) as any;
    Object.assign(service, {
      materialRepo: repository,
      audit: { log: vi.fn() },
    });

    const result = await service.create(
      { title: '  安全培训资料  ', description: '  供 AI 出题  ' },
      { id: 9, name: 'admin' },
      '127.0.0.1',
    );

    expect(savedRows).toEqual([expect.objectContaining({
      title: '安全培训资料',
      description: '供 AI 出题',
      category: 'question_material',
      categoryId: null,
      status: 'draft',
      createdBy: '9',
    })]);
    expect(result).toEqual({ id: '41', title: '安全培训资料', description: '供 AI 出题' });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('required_minutes');
    expect(result).not.toHaveProperty('current_version_id');

    await expect(service.create(
      { title: '   ', description: 'blank title' }, { id: 9, name: 'admin' }, null,
    )).rejects.toMatchObject({ code: 40001 });
    expect(savedRows).toHaveLength(1);
  });

  it('lists only question materials with stable pagination and safe fields', async () => {
    const module = await import(MATERIAL_SERVICE_MODULE) as any;
    const calls: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const builder: any = {
      where(sql: string, params?: Record<string, unknown>) { calls.push({ sql, params }); return builder; },
      andWhere(sql: string, params?: Record<string, unknown>) { calls.push({ sql, params }); return builder; },
      orderBy: vi.fn(() => builder),
      skip: vi.fn(() => builder),
      take: vi.fn(() => builder),
      getCount: vi.fn(async () => 21),
      getMany: vi.fn(async () => [{
        id: '42', title: '危化品培训', description: null,
        category: 'question_material', status: 'draft', requiredMinutes: 10,
      }]),
    };
    const service = Object.create(module.QuestionMaterialsService.prototype) as any;
    service.materialRepo = { createQueryBuilder: vi.fn(() => builder) };

    expect(typeof service.list, 'question materials must provide a list operation').toBe('function');
    if (typeof service.list !== 'function') return;
    const result = await service.list({ page: 2, page_size: 10, keyword: '危化' });

    expect(calls).toContainEqual({ sql: 'material.category = :category', params: { category: 'question_material' } });
    expect(calls).toContainEqual({ sql: 'material.title LIKE :keyword', params: { keyword: '%危化%' } });
    expect(builder.skip).toHaveBeenCalledWith(10);
    expect(builder.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      items: [{ id: '42', title: '危化品培训', description: null }],
      total: 21,
      page: 2,
      page_size: 10,
    });
  });

  it('returns material-owned versions with only a safe parse failure reason', async () => {
    const module = await import(MATERIAL_SERVICE_MODULE) as any;
    const material = {
      id: '41', title: '安全培训资料', description: null, category: 'question_material',
    };
    const failed = {
      id: '52', regulationId: '41', versionNo: 2, fileType: 'pdf', parseStatus: 'failed',
      filePath: 'private/path.pdf', fileHash: 'secret-hash', textContent: 'private content',
    };
    const parsed = {
      id: '51', regulationId: '41', versionNo: 1, fileType: 'docx', parseStatus: 'parsed',
      filePath: 'private/path.docx', fileHash: 'other-hash', textContent: 'private content',
    };
    const versionRepo = {
      find: vi.fn(async () => [failed, parsed]),
      findOne: vi.fn(async ({ where }: any) => (
        String(where.id) === '52' && String(where.regulationId) === '41' ? failed : null
      )),
    };
    const service = Object.create(module.QuestionMaterialsService.prototype) as any;
    Object.assign(service, {
      materialRepo: { findOne: vi.fn(async () => material) },
      versionRepo,
    });

    expect(typeof service.detail, 'question materials must provide detail').toBe('function');
    expect(typeof service.status, 'question materials must provide version status').toBe('function');
    if (typeof service.detail !== 'function' || typeof service.status !== 'function') return;
    const detail = await service.detail('41');
    const status = await service.status('41', '52');

    expect(detail).toEqual({
      id: '41',
      title: '安全培训资料',
      description: null,
      versions: [
        {
          id: '52', version_no: 2, file_type: 'pdf', parse_status: 'failed',
          failure_reason: '文件解析失败，请重试或上传新版本',
        },
        {
          id: '51', version_no: 1, file_type: 'docx', parse_status: 'parsed', failure_reason: null,
        },
      ],
    });
    expect(status).toEqual({
      material_id: '41',
      id: '52',
      version_no: 2,
      file_type: 'pdf',
      parse_status: 'failed',
      failure_reason: '文件解析失败，请重试或上传新版本',
    });
    expect(JSON.stringify({ detail, status })).not.toContain('private/path');
    expect(JSON.stringify({ detail, status })).not.toContain('secret-hash');
    expect(versionRepo.find).toHaveBeenCalledWith({ where: { regulationId: '41' }, order: { versionNo: 'DESC' } });
  });

  it('uploads and retries a material version through the existing parse pipeline', async () => {
    const module = await import(MATERIAL_SERVICE_MODULE) as any;
    const upload = vi.fn(async () => ({
      version_id: 52, version_no: 2, file_type: 'pdf', file_hash: 'hash',
      parse_status: 'pending', duplicate_hint: null,
    }));
    const retryParse = vi.fn(async () => ({ version_id: 52, parse_status: 'pending', retry_count: 1 }));
    const enqueue = vi.fn();
    const service = Object.create(module.QuestionMaterialsService.prototype) as any;
    Object.assign(service, {
      materialRepo: { findOne: vi.fn(async () => ({ id: '41', category: 'question_material' })) },
      versions: { upload, retryParse },
      parsePipeline: { enqueue },
    });
    const file = { originalname: '安全资料.pdf', buffer: Buffer.from('%PDF-test') } as any;
    const actor = { id: 9, name: 'admin' };

    expect(typeof service.upload, 'question materials must upload a version').toBe('function');
    expect(typeof service.retry, 'question materials must retry failed parsing').toBe('function');
    if (typeof service.upload !== 'function' || typeof service.retry !== 'function') return;
    const uploaded = await service.upload('41', file, actor, '127.0.0.1');
    const retried = await service.retry('41', '52', actor, '127.0.0.1');

    expect(upload).toHaveBeenCalledWith('41', file, actor, '127.0.0.1');
    expect(retryParse).toHaveBeenCalledWith('41', '52', actor, '127.0.0.1');
    expect(enqueue.mock.calls).toEqual([['52'], ['52']]);
    expect(uploaded).toEqual({
      id: '52', version_no: 2, file_type: 'pdf', parse_status: 'pending', duplicate_hint: null,
    });
    expect(retried).toEqual({ material_id: '41', id: '52', parse_status: 'pending', retry_count: 1 });
  });

  it('uses ai read/write permissions for question material routes', async () => {
    const module = await import(MATERIAL_CONTROLLER_MODULE).catch(() => null) as any;
    expect(module, 'question-materials controller must exist').not.toBeNull();
    if (!module) return;
    const Controller = module.QuestionMaterialsController;
    const access = {
      assertAllowed: vi.fn(async (_userId: string, permission: string) => {
        if (permission === 'ai:write') throw Object.assign(new Error('forbidden'), { code: 40301 });
      }),
    };
    const guard = new PermissionsGuard(new Reflector(), access as any);
    const context = (handler: Function, method: string) => ({
      switchToHttp: () => ({ getRequest: () => ({
        originalUrl: '/api/v1/admin/question-materials', method, user: { id: 7, role: 'employee' },
      }) }),
      getHandler: () => handler,
      getClass: () => Controller,
    }) as any;

    await expect(guard.canActivate(context(Controller.prototype.list, 'GET'))).resolves.toBe(true);
    await expect(guard.canActivate(context(Controller.prototype.create, 'POST'))).rejects.toMatchObject({ code: 40301 });
    expect(access.assertAllowed.mock.calls).toEqual([['7', 'ai:read'], ['7', 'ai:write']]);
  });

  it('starts AI generation from the explicitly selected parsed material version', async () => {
    const material = { id: '41', title: '安全培训资料', category: 'question_material', currentVersionId: null };
    const version = {
      id: '52', regulationId: '41', parseStatus: 'parsed', fileType: 'docx', textContent: 'x'.repeat(100),
    };
    const service = Object.create(QuestionGenerationService.prototype) as QuestionGenerationService & Record<string, any>;
    Object.assign(service, {
      regRepo: { findOne: vi.fn(async ({ where }: any) => String(where.id) === '41' ? material : null) },
      versionRepo: {
        findOne: vi.fn(async ({ where }: any) => (
          String(where.id) === '52' && String(where.regulationId) === '41' ? version : null
        )),
      },
      categories: { assertActive: vi.fn(async () => undefined) },
      pdfVision: { shouldUseVision: vi.fn(() => false) },
      aiConfig: { isConfigured: vi.fn(async () => true) },
      redis: { setNx: vi.fn(async () => true), del: vi.fn(async () => undefined) },
      setTask: vi.fn(async () => undefined),
      runTask: vi.fn(async () => undefined),
    });

    const result = await service.start({
      materialId: '41',
      materialVersionId: '52',
      categoryId: '7',
      difficulty: 'easy',
      questionCountSingle: 20,
      questionCountMultiple: 5,
      scoreSingle: 3,
      scoreMultiple: 8,
      actor: { id: 9, name: 'admin' },
    } as any);

    expect((service as any).versionRepo.findOne).toHaveBeenCalledWith({
      where: { id: '52', regulationId: '41' },
    });
    expect(result).toMatchObject({
      material_id: '41', material_version_id: '52', category_id: '7', difficulty: 'easy', status: 'running',
    });
    expect((service as any).runTask).toHaveBeenCalledWith(
      expect.any(String), material, version, expect.objectContaining({ categoryId: '7', difficulty: 'easy' }),
    );
  });

  it('retires direct AI writing, review and concept routes while retaining historical task reads', () => {
    const routes = Object.getOwnPropertyNames(AiController.prototype).flatMap((name) => {
      const handler = (AiController.prototype as any)[name];
      const path = Reflect.getMetadata('path', handler);
      return typeof path === 'string' ? [path] : [];
    });
    expect(routes).toContain('generate-status/:taskId');
    expect(routes).toContain('questions/:id/enabled');
    expect(routes).not.toEqual(expect.arrayContaining(['generate-questions', 'questions/:id/regenerate', 'questions/:id/review', 'question-concepts', 'question-concept-options']));
  });

  it('retires paper withdrawal and archive routes while retaining publish and copy', () => {
    const paths = (controller: { prototype: object }) => Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      const path = Reflect.getMetadata('path', handler as object);
      return typeof path === 'string' ? [path] : [];
    });

    const trainingRoutes = paths(PaperAdminController);
    expect(trainingRoutes).toEqual(expect.arrayContaining([':id/publish', ':id/copy']));
    expect(trainingRoutes).not.toEqual(expect.arrayContaining([':id/withdraw', ':id/archive']));

    const legacyRoutes = paths(AiController);
    expect(legacyRoutes).toEqual(expect.arrayContaining(['papers/:id/publish', 'papers/:id/copy']));
    expect(legacyRoutes).not.toContain('papers/:id/archive');
  });

  it('exposes material source names and no removed rubric in reviewed question views', async () => {
    const service = Object.create(QuestionBankService.prototype) as QuestionBankService & Record<string, any>;
    service.versions = { current: vi.fn(async () => null) };

    const view = await (service as any).questionView({
      id: '81', regulationId: '41', versionId: '52', categoryId: '7', conceptId: null,
      currentVersionId: null, difficulty: 'easy', type: 'single', stem: '题干',
      options: [{ key: 'A', text: '选项' }], answer: [0], analysis: '解析', score: '5.00',
      status: 'approved', source: 'ai', createdAt: new Date(), updatedAt: new Date(), rubric: 'legacy',
    });

    expect(view).toMatchObject({ material_id: '41', material_version_id: '52' });
    expect(view).not.toHaveProperty('regulation_id');
    expect(view).not.toHaveProperty('regulation_version_id');
    expect(view).not.toHaveProperty('rubric');
  });

  it('accepts only the three objective question types in training paper rules and candidates', async () => {
    const service = Object.create(PaperService.prototype) as PaperService & Record<string, any>;
    const strategy = { passScore: 60, durationMinutes: 30, maxAttempts: 1, partialCreditRatio: 0.5 };
    expect(() => (service as any).trainingRule(
      strategy, [{ type: 'image', count: 1, scoreCents: 10000 }], false,
    )).toThrow('题型、题量或分值规则不合法');

    const candidateTypes: string[] = [];
    Object.assign(service, {
      paperRepo: { findOne: vi.fn(async () => ({ id: '91', businessScope: 'training', categoryId: '7', regulationIds: [] })) },
      versions: { enabledCandidates: vi.fn(async ({ type }: any) => { candidateTypes.push(type); return []; }) },
    });
    await service.trainingCandidates('91', {});
    expect(new Set(candidateTypes)).toEqual(new Set(['single', 'multiple', 'judgment']));
  });
});
