import { Reflector } from '@nestjs/core';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { Errors } from '../src/common/errors';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';

describe('ExamMonitorService safe monitor projection', () => {
  it('keeps the connection at exactly 90 seconds, marks later or missing heartbeats uncertain, and clamps remaining time', async () => {
    const { monitorRowView } = await import('../src/modules/exams/exam-monitor.service');
    const now = new Date('2026-10-22T10:00:00.000Z');
    const row = (lastHeartbeatAt: Date | null, deadlineAt = new Date('2026-10-22T10:00:01.900Z')) => monitorRowView({
      record_id: '41', user_id: '9', name: '学员甲', source: 'institution', difficulty: 'easy',
      started_at: new Date('2026-10-22T09:30:00.000Z'), deadline_at: deadlineAt,
      answered_count: '2', total_count: '4', last_heartbeat_at: lastHeartbeatAt,
      switch_count: '1', device_summary: 'Chrome', status: 'in_progress',
      grading_state: 'not_submitted', submission_method: null,
    }, now);

    expect(row(new Date(now.getTime() - 90_000)).connection_state).toBe('connected');
    expect(row(new Date(now.getTime() - 90_001)).connection_state).toBe('uncertain');
    expect(row(null).connection_state).toBe('uncertain');
    expect(row(new Date(now.getTime()), new Date(now.getTime() - 1)).remaining_seconds).toBe(0);
    expect(row(new Date(now.getTime())).remaining_seconds).toBe(1);
  });

  it('paginates by paper and exposes only acknowledged counts plus frozen record facts', async () => {
    const { ExamMonitorService } = await import('../src/modules/exams/exam-monitor.service');
    const raw = {
      record_id: '41', user_id: '9', name: '学员甲', source: 'external', difficulty: 'hard',
      started_at: new Date('2026-10-22T09:30:00.000Z'), deadline_at: new Date('2026-10-22T10:30:00.000Z'),
      answered_count: '2', total_count: '4', last_heartbeat_at: new Date('2026-10-22T09:59:30.000Z'),
      switch_count: '3', device_summary: 'Chrome', status: 'in_progress',
      grading_state: 'not_submitted', submission_method: 'unrecognized-history-value',
    };
    const page = { offset: -1, limit: -1 };
    const builder: any = {
      innerJoin: () => builder, select: () => builder, addSelect: () => builder,
      where: () => builder, andWhere: () => builder, orderBy: () => builder, addOrderBy: () => builder,
      skip: () => { throw new Error('joined raw projection must not use skip/take'); },
      take: () => { throw new Error('joined raw projection must not use skip/take'); },
      offset: (value: number) => { page.offset = value; return builder; },
      limit: (value: number) => { page.limit = value; return builder; },
      getCount: async () => 25,
      getRawMany: async () => [raw],
    };
    const service = new ExamMonitorService({ createQueryBuilder: () => builder } as any, {} as any);
    (service as any).now = () => new Date('2026-10-22T10:00:00.000Z');

    const result = await service.list('7', '11', 2, 10);

    expect(page).toEqual({ offset: 10, limit: 10 });
    expect(result).toMatchObject({ total: 25, page: 2, page_size: 10 });
    expect(result.items[0]).toMatchObject({
      source: 'external', difficulty: 'hard', answered_count: 2, total_count: 4,
      submission_method: null,
    });
    expect(result.items[0]).not.toHaveProperty('answer');
    expect(result.items[0]).not.toHaveProperty('analysis');
    expect(result.items[0]).not.toHaveProperty('asset_ids');
  });

  it('returns paged record metadata and a safe detail without grading answers', async () => {
    const { ExamMonitorService } = await import('../src/modules/exams/exam-monitor.service');
    const raw = {
      record_id: '52', paper_id: '12', paper_title: '安全考试', user_id: '10',
      username: 'learner10', name: '学员乙', source: null, category_id: null,
      difficulty: null, release_id: null, attempt_no: '2',
      started_at: new Date('2026-10-22T09:00:00.000Z'), deadline_at: new Date('2026-10-22T09:30:00.000Z'),
      submitted_at: new Date('2026-10-22T09:20:00.000Z'), answered_count: '3', total_count: '4',
      last_heartbeat_at: null, switch_count: '2', device_summary: null, status: 'passed',
      grading_state: 'finalized', submission_method: null, score: '88.50',
    };
    const page = { offset: -1, limit: -1 };
    const builder: any = {
      innerJoin: () => builder, select: () => builder, addSelect: () => builder,
      where: () => builder, andWhere: () => builder, orderBy: () => builder, addOrderBy: () => builder,
      skip: () => { throw new Error('joined raw projection must not use skip/take'); },
      take: () => { throw new Error('joined raw projection must not use skip/take'); },
      offset: (value: number) => { page.offset = value; return builder; },
      limit: (value: number) => { page.limit = value; return builder; },
      getCount: async () => 1,
      getRawMany: async () => [raw], getRawOne: async () => raw,
    };
    const service = new ExamMonitorService({ createQueryBuilder: () => builder } as any, {} as any);
    (service as any).now = () => new Date('2026-10-22T10:00:00.000Z');

    const records = await service.listRecords('7', { page: 1, page_size: 20, keyword: '学员乙' });
    const detail = await service.detail('7', '52');

    expect(page).toEqual({ offset: 0, limit: 20 });
    expect(records.items[0]).toMatchObject({
      record_id: '52', paper_title: '安全考试', name: '学员乙', attempt_no: 2,
      source: null, difficulty: null, score: 88.5, submission_method: null,
    });
    expect(detail).toMatchObject({
      record_id: '52', connection_state: 'ended', remaining_seconds: 0,
      answered_count: 3, total_count: 4,
    });
    for (const forbidden of ['answer', 'correct_answer', 'analysis', 'rubric', 'asset_ids']) {
      expect(JSON.stringify(detail)).not.toContain(`\"${forbidden}\"`);
    }
  });

  it('documents the TypeORM joined raw-query pagination boundary in generated SQL', async () => {
    const [{ ExamRecord }, { ExamPaper }, { SysUser }] = await Promise.all([
      import('../src/entities/exam-record.entity'),
      import('../src/entities/exam-paper.entity'),
      import('../src/entities/sys-user.entity'),
    ]);
    const dataSource = new DataSource({
      type: 'mysql', host: '127.0.0.1', username: 'unused', database: 'unused',
      entities: [ExamRecord, ExamPaper, SysUser],
    });
    await (dataSource as any).buildMetadatas();
    const joinedRawQuery = () => dataSource.getRepository(ExamRecord).createQueryBuilder('record')
      .innerJoin(SysUser, 'learner', 'learner.id = record.user_id')
      .innerJoin(ExamPaper, 'paper', 'paper.id = record.paper_id')
      .select('record.id', 'record_id')
      .orderBy('record.id', 'DESC');

    expect(joinedRawQuery().skip(10).take(10).getSql()).not.toMatch(/\bLIMIT\b/);
    expect(joinedRawQuery().offset(10).limit(10).getSql()).toMatch(/\bLIMIT 10 OFFSET 10$/);
  });

  it('enforces record-read and monitor permissions independently through the real guard', async () => {
    const { ExamAdminController } = await import('../src/modules/exams/exam-admin.controller');
    const granted = new Set<string>(['exam_records:read']);
    const guard = new PermissionsGuard(new Reflector(), {
      async assertAllowed(_userId: string, code: string) {
        if (!granted.has(code)) throw Errors.forbidden();
      },
    } as any);
    const context = (handler: Function) => ({
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/v1/admin/test', method: 'GET', user: { id: 7 } }) }),
      getHandler: () => handler,
      getClass: () => ExamAdminController,
    }) as any;

    await expect(guard.canActivate(context(ExamAdminController.prototype.records))).resolves.toBe(true);
    await expect(guard.canActivate(context(ExamAdminController.prototype.record))).resolves.toBe(true);
    await expect(guard.canActivate(context(ExamAdminController.prototype.monitor))).rejects.toMatchObject({ code: 40301 });
    await expect(guard.canActivate(context((ExamAdminController.prototype as any).monitorOptions))).rejects.toMatchObject({ code: 40301 });

    granted.clear();
    granted.add('exam_records:monitor');
    await expect(guard.canActivate(context(ExamAdminController.prototype.monitor))).resolves.toBe(true);
    await expect(guard.canActivate(context((ExamAdminController.prototype as any).monitorOptions))).resolves.toBe(true);
    await expect(guard.canActivate(context(ExamAdminController.prototype.records))).rejects.toMatchObject({ code: 40301 });
  });

  it('registers the admin controller and monitor service in the application module', async () => {
    const [{ AppModule }, { ExamAdminController }, { ExamMonitorService }] = await Promise.all([
      import('../src/app.module'),
      import('../src/modules/exams/exam-admin.controller'),
      import('../src/modules/exams/exam-monitor.service'),
    ]);
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) as unknown[];

    expect(controllers).toContain(ExamAdminController);
    expect(providers).toContain(ExamMonitorService);
  });

  it('registers both pages in the managed-menu route allowlist', async () => {
    const { REGISTERED_ADMIN_ROUTES } = await import('../src/modules/system/system.service');

    expect(REGISTERED_ADMIN_ROUTES).toContain('/admin/exam-records');
    expect(REGISTERED_ADMIN_ROUTES).toContain('/admin/exam-monitor');
  });

  it('offers monitor-scoped paper choices without requiring paper-management permission', async () => {
    const { ExamMonitorService } = await import('../src/modules/exams/exam-monitor.service');
    const builder: any = {
      select: () => builder, addSelect: () => builder, where: () => builder, andWhere: () => builder,
      orderBy: () => builder, addOrderBy: () => builder, skip: () => builder, take: () => builder,
      getCount: async () => 2,
      getRawMany: async () => [{ id: '11', title: '安全考试', status: 'published', business_scope: 'training' }],
    };
    const service = new ExamMonitorService({} as any, { createQueryBuilder: () => builder } as any);

    await expect(service.paperOptions('7', { page: 1, page_size: 20, keyword: '安全' })).resolves.toEqual({
      items: [{ id: '11', title: '安全考试', status: 'published', business_scope: 'training' }],
      total: 2,
      page: 1,
      page_size: 20,
    });
  });

  it('cancels the previous monitor request and rejects stale or stopped responses', async () => {
    const { createLatestRequestScope } = await import('../../web/src/utils/latest-request-scope');
    const scope = createLatestRequestScope();

    const first = scope.begin();
    const second = scope.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(scope.beginIfIdle()).toBeNull();

    second.finish();
    const automatic = scope.beginIfIdle();
    expect(automatic).not.toBeNull();
    expect(automatic?.isCurrent()).toBe(true);

    const manual = scope.begin();
    expect(automatic?.signal.aborted).toBe(true);
    expect(manual.isCurrent()).toBe(true);

    scope.stop();
    expect(manual.signal.aborted).toBe(true);
    expect(manual.isCurrent()).toBe(false);
  });

  it('can append the 101st remote paper option and preserve the current selection on search', async () => {
    const { mergePagedOptions } = await import('../../web/src/utils/paged-options');
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1), title: `试卷 ${index + 1}`,
    }));
    const withNextPage = mergePagedOptions([], firstPage, { replace: true, selectedId: '' });
    const withItem101 = mergePagedOptions(withNextPage, [{ id: '101', title: '试卷 101' }], {
      replace: false, selectedId: '1',
    });

    expect(withItem101).toHaveLength(101);
    expect(withItem101.at(-1)?.id).toBe('101');
    expect(mergePagedOptions(withItem101, [{ id: '88', title: '命中搜索的试卷' }], {
      replace: true, selectedId: '101',
    }).map((item) => item.id)).toEqual(['101', '88']);
  });
});
