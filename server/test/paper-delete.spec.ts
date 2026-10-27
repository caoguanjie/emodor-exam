import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { ExamAssignment } from '../src/entities/exam-assignment.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import { PaperAdminController } from '../src/modules/exams/paper-admin.controller';

const ACTOR = { id: '9', name: 'paper-admin' };

function fixture(overrides: Record<string, unknown> = {}) {
  const state = {
    papers: [
      { id: '11', businessScope: 'training', status: 'draft', mode: 'fixed', categoryId: '7', ...overrides },
      { id: '12', businessScope: 'training', status: 'draft', mode: 'fixed', categoryId: '7' },
    ],
    links: [
      { id: '21', paperId: '11', questionId: '101' },
      { id: '22', paperId: '12', questionId: '101' },
    ],
    releases: [] as Record<string, unknown>[],
    assignments: [] as Record<string, unknown>[],
    records: [] as Record<string, unknown>[],
  };
  const findOne = vi.fn();
  let deleteError: Error | undefined;
  const transaction = vi.fn(async (work: (manager: any) => Promise<unknown>) => {
    const pending = structuredClone(state);
    const manager = { getRepository(entity: unknown) {
      if (entity === ExamPaper) return {
        async findOne(options: any) {
          findOne(options);
          return pending.papers.find((paper) => paper.id === options.where.id) || null;
        },
        async delete(where: any) {
          if (deleteError) throw deleteError;
          pending.papers = pending.papers.filter((paper) => paper.id !== where.id);
        },
      };
      if (entity === PaperQuestion) return {
        async delete(where: any) { pending.links = pending.links.filter((link) => link.paperId !== where.paperId); },
      };
      const rows = entity === PaperRelease ? pending.releases
        : entity === ExamAssignment ? pending.assignments
          : entity === ExamRecord ? pending.records : null;
      if (!rows) throw new Error(`unexpected repository ${(entity as any)?.name}`);
      return { existsBy: async (where: any) => rows.some((row) => row.paperId === where.paperId) };
    } };
    const result = await work(manager);
    Object.assign(state, pending);
    return result;
  });
  const audit = { log: vi.fn() };
  const service = Object.create(PaperService.prototype) as PaperService;
  Object.assign(service, {
    dataSource: { transaction }, audit,
    paperRepo: { findOne() { throw new Error('delete must read the paper inside its transaction'); } },
    categories: { lockActive() { throw new Error('draft deletion must not depend on an active category'); } },
  });
  return { service, state, findOne, transaction, audit, failPaperDelete: (error: Error) => { deleteError = error; } };
}

describe('training draft paper deletion', () => {
  it.each(['fixed', 'random'])('deletes only the selected %s draft and its links, under the paper write lock', async (mode) => {
    const f = fixture({ mode });
    // References belonging to a different paper must not block this deletion.
    f.state.releases.push({ id: '31', paperId: '12' });
    f.state.assignments.push({ id: '41', paperId: '12' });
    f.state.records.push({ id: '51', paperId: '12' });
    const otherHistory = structuredClone({ releases: f.state.releases, assignments: f.state.assignments, records: f.state.records });

    await expect(f.service.deleteTraining('11', ACTOR, '127.0.0.1')).resolves.toBeNull();

    expect(f.findOne).toHaveBeenCalledWith({ where: { id: '11' }, lock: { mode: 'pessimistic_write' } });
    expect(f.state.papers.map((paper) => paper.id)).toEqual(['12']);
    expect(f.state.links).toEqual([{ id: '22', paperId: '12', questionId: '101' }]);
    expect({ releases: f.state.releases, assignments: f.state.assignments, records: f.state.records }).toEqual(otherHistory);
    expect(f.audit.log).toHaveBeenCalledOnce();
    expect(f.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: 9, actor_name: 'paper-admin', action: 'training_paper.delete',
      object_type: 'exam_paper', object_id: '11', result: 'success', source_ip: '127.0.0.1',
    }));
    await expect(f.service.deleteTraining('11', ACTOR, null)).rejects.toMatchObject({ code: 40401 });
    expect(f.audit.log).toHaveBeenCalledOnce();
  });

  it('also deletes an empty draft without requiring an active category', async () => {
    const f = fixture({ categoryId: 'retired' });
    f.state.links = f.state.links.filter((link) => link.paperId !== '11');
    await expect(f.service.deleteTraining('11', ACTOR, null)).resolves.toBeNull();
    expect(f.state.papers.map((paper) => paper.id)).toEqual(['12']);
  });

  it.each(['published', 'withdrawn', 'archived'])('rejects %s papers without changing data or auditing success', async (status) => {
    const f = fixture({ status });
    const before = structuredClone(f.state);
    await expect(f.service.deleteTraining('11', ACTOR, null)).rejects.toMatchObject({ code: 40970 });
    expect(f.state).toEqual(before);
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it.each(['regulation', null])('hides a non-training paper (%s) behind the existing not-found response', async (businessScope) => {
    const f = fixture({ businessScope });
    const before = structuredClone(f.state);
    await expect(f.service.deleteTraining('11', ACTOR, null)).rejects.toMatchObject({ code: 40401 });
    expect(f.state).toEqual(before);
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it('returns not-found for a missing paper', async () => {
    const f = fixture();
    await expect(f.service.deleteTraining('999', ACTOR, null)).rejects.toMatchObject({ code: 40401 });
    expect(f.state.papers).toHaveLength(2);
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it.each(['releases', 'assignments', 'records'] as const)('retains a draft with an existing %s reference', async (table) => {
    const f = fixture();
    f.state[table].push({ id: '31', paperId: '11' });
    const before = structuredClone(f.state);
    await expect(f.service.deleteTraining('11', ACTOR, null)).rejects.toMatchObject({ code: 40970 });
    expect(f.state).toEqual(before);
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it('rolls back removed draft links when the paper delete fails, without a success audit', async () => {
    const f = fixture();
    const before = structuredClone(f.state);
    const error = new Error('paper deletion failed');
    f.failPaperDelete(error);
    await expect(f.service.deleteTraining('11', ACTOR, null)).rejects.toBe(error);
    expect(f.state).toEqual(before);
    expect(f.audit.log).not.toHaveBeenCalled();
  });
});

describe('paper deletion route', () => {
  it('requires papers:write on DELETE /admin/papers/:id and forwards the authenticated actor', async () => {
    const f = fixture();
    const controller = new PaperAdminController(f.service, {} as any, {} as any, {} as any);
    expect(Reflect.getMetadata(PATH_METADATA, PaperAdminController)).toBe('admin/papers');
    expect(Reflect.getMetadata(PATH_METADATA, controller.delete)).toBe(':id');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.delete)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.delete)).toEqual(['papers:write']);
    await expect(controller.delete('11', { id: 9, username: 'paper-admin' } as any, { ip: '127.0.0.1' } as any)).resolves.toBeNull();
    expect(f.state.papers.map((paper) => paper.id)).toEqual(['12']);
    expect(f.audit.log).toHaveBeenCalledWith(expect.objectContaining({ actor_id: 9, actor_name: 'paper-admin' }));
  });

  it.each(['0', '-1', '01', '1x'])('rejects malformed paper id %s before starting a transaction', async (paperId) => {
    const f = fixture();
    const controller = new PaperAdminController(f.service, {} as any, {} as any, {} as any);
    await expect(Promise.resolve().then(() => controller.delete(paperId, {} as any, {} as any)))
      .rejects.toMatchObject({ code: 40001 });
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.audit.log).not.toHaveBeenCalled();
  });
});
