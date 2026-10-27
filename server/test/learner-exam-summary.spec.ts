import { describe, expect, it, vi } from 'vitest';
import { ExamAssignment } from '../src/entities/exam-assignment.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { TrainingCourse } from '../src/entities/training-course.entity';
import { VideoLearningRecord } from '../src/entities/video-learning-record.entity';
import { AttemptService } from '../src/modules/exams/attempt.service';
import { ExamHistoryService, projectFinalResult } from '../src/modules/exams/exam-history.service';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { AttemptPageDto, TrainingExamsController } from '../src/modules/exams/training-exams.controller';

const rule = { totalCents: 12000, passCents: 7200, durationMinutes: 45, maxAttempts: 3, partialCreditRatio: 0.5, rules: [{ type: 'single', count: 20, scoreCents: 600 }] };

function fixture() {
  const user: any = { id: '9', status: 1, categoryId: '7', source: 'institution' };
  const papers: any[] = [
    { id: '13', title: '旧归档卷', businessScope: 'training', categoryId: '7', status: 'archived', mode: 'fixed' },
    { id: '12', title: '可考卷', businessScope: 'training', categoryId: '7', status: 'published', mode: 'fixed', totalScore: '999.00' },
    { id: '11', title: '撤回但仍在答', businessScope: 'training', categoryId: '7', status: 'withdrawn', mode: 'fixed' },
  ];
  const assignments: any[] = [
    { id: '31', paperId: '11', userId: '9', releaseId: '21', source: 'institution', categoryId: '7', difficulty: 'easy', ruleSnapshot: structuredClone(rule) },
    { id: '33', paperId: '13', userId: '9', releaseId: null, source: 'institution', categoryId: '7', difficulty: 'easy', ruleSnapshot: null },
  ];
  const releases: any[] = [
    { id: '22', paperId: '11', versionNo: 2, businessScope: 'training', ruleSnapshot: { ...rule, totalCents: 99900 }, requiresLearning: 0 },
    { id: '21', paperId: '11', versionNo: 1, businessScope: 'training', ruleSnapshot: structuredClone(rule), requiresLearning: 1, requiredLearningMinutes: 2, courseIds: ['71', '72', '73'] },
    { id: '24', paperId: '12', versionNo: 1, businessScope: 'training', ruleSnapshot: structuredClone(rule), requiresLearning: 0, requiredLearningMinutes: null, courseIds: [] },
  ];
  const records: any[] = [
    { id: '41', paperId: '11', userId: '9', status: 'in_progress', deadlineAt: new Date(0) },
    { id: '43', paperId: '13', userId: '9', status: 'failed' },
  ];
  const courses: any[] = [{ id: '71', title: '消防课程', status: 'published' }, { id: '72', title: '下架课程', status: 'offline' }];
  let creditedMs = '119001';
  const noWrite = vi.fn(() => { throw new Error('summary must not write'); });
  const releaseRepo = { find: vi.fn(async () => releases) };
  const recordRepo = { find: vi.fn(async () => records), save: noWrite };
  const query = vi.fn(async () => [{ version_id: '81' }]);
  const learningBuilder: any = {};
  for (const method of ['select', 'where', 'andWhere']) learningBuilder[method] = vi.fn(() => learningBuilder);
  learningBuilder.getRawOne = vi.fn(async () => ({ creditedMs }));
  const manager: any = { query, getRepository: (entity: unknown) => {
    if (entity === PaperRelease) return releaseRepo;
    if (entity === ExamRecord) return recordRepo;
    if (entity === ExamAssignment) return { find: async () => assignments, save: noWrite };
    if (entity === TrainingCourse) return { findBy: vi.fn(async () => courses) };
    if (entity === VideoLearningRecord) return { createQueryBuilder: () => learningBuilder };
    throw new Error(`unexpected entity ${(entity as any).name}`);
  } };
  const service: any = Object.create(AttemptService.prototype);
  service.userRepo = { findOne: async () => user };
  service.assignmentRepo = { find: async () => assignments };
  service.recordRepo = recordRepo;
  service.paperRepo = { find: vi.fn(async ({ where }: any) => papers.filter(paper => where.id ? where.id._value.includes(paper.id) : paper.status === 'published' && paper.categoryId === where.categoryId)) };
  service.dataSource = { manager };
  return { service, user, papers, assignments, releases, records, noWrite, releaseRepo, recordRepo, query, learningBuilder, setCreditedMs: (value: string) => { creditedMs = value; } };
}

describe('learner exam summaries', () => {
  it('reads frozen 120-point rules and本人 record links without loading a question pool', async () => {
    const f = fixture();
    const result = await f.service.list('9');
    expect(result.items.find((row: any) => row.paper_id === '11')).toMatchObject({ total_score: 120, pass_score: 72, duration_minutes: 45, question_count: 20, active_record_id: '41', latest_record_id: '41' });
    expect(result.items.find((row: any) => row.paper_id === '12')).toMatchObject({ total_score: 120, pass_score: 72, active_record_id: null });
    expect(result.items.find((row: any) => row.paper_id === '13')).toMatchObject({ total_score: null, pass_score: null, duration_minutes: null, question_count: null, latest_record_id: '43' });
    expect(f.releaseRepo.find).toHaveBeenCalledTimes(1);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('filters before pagination so ended and active tabs return complete totals', async () => {
    const f = fixture();
    expect(await f.service.list('9', 1, 1, 'active')).toMatchObject({ total: 1, items: [{ paper_id: '11', active_record_id: '41' }] });
    expect(await f.service.list('9', 1, 1, 'ended')).toMatchObject({ total: 1, items: [{ paper_id: '13' }] });
    expect(await f.service.list('9', 1, 1, 'published')).toMatchObject({ total: 1, items: [{ paper_id: '12' }] });
  });

  it('returns original release learning with precise remaining seconds and unavailable course names', async () => {
    const f = fixture();
    expect(await f.service.detail('9', '11')).toMatchObject({ total_score: 120, learning: { required_learning_minutes: 2, credited_seconds: 119, remaining_seconds: 1, courses: [
      { id: '71', title: '消防课程', available: true }, { id: '72', title: '下架课程', available: false }, { id: '73', title: null, available: false },
    ] } });
    expect(f.noWrite).not.toHaveBeenCalled();
    f.setCreditedMs('120000');
    expect((await f.service.detail('9', '11')).learning.remaining_seconds).toBe(0);
  });

  it('preserves null legacy learning and rejects invisible paper details', async () => {
    const f = fixture();
    expect((await f.service.detail('9', '13')).learning).toEqual({ required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] });
    await expect(f.service.detail('9', '999')).rejects.toMatchObject({ code: 40401 });
    f.assignments.splice(0);
    await expect(f.service.detail('9', '11')).rejects.toMatchObject({ code: 40401 });
    f.user.categoryId = '8';
    await expect(f.service.detail('9', '12')).rejects.toMatchObject({ code: 40401 });
  });

  it('validates state and exposes the read-only detail through the mobile controller', async () => {
    const pipe = new DtoValidationPipe();
    await expect(pipe.transform({ state: 'ended', page: '2' }, { type: 'query', metatype: AttemptPageDto })).resolves.toMatchObject({ state: 'ended', page: 2 });
    await expect(pipe.transform({ state: 'draft' }, { type: 'query', metatype: AttemptPageDto })).rejects.toThrow();
    const f = fixture();
    const controller: any = new TrainingExamsController(f.service, {} as any, {} as any);
    await expect(controller.detail('11', { id: '9', client: 'mobile', role: 'employee' })).resolves.toMatchObject({ paper_id: '11' });
    expect(() => controller.detail('11', { id: '9', client: 'pc', role: 'employee' })).toThrow();
  });
});

describe('frozen result metadata', () => {
  it('projects total, pass threshold and duration only from the record snapshot', async () => {
    const record: any = { id: '41', assignmentId: '31', status: 'passed', score: '95.00', gradingState: 'finalized', submittedAt: new Date(), gradedAt: new Date(), submissionMethod: 'manual' };
    expect(projectFinalResult(record, { rule, items: [] } as any, [])).toMatchObject({ total_score: 120, pass_score: 72, duration_minutes: 45 });
    const service = new ExamHistoryService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    expect(await service.resultInTransaction({} as any, { ...record, assignmentId: null, ruleSnapshot: null })).toMatchObject({ total_score: null, pass_score: null, duration_minutes: null });
  });

  it('retains reliable timeout metadata without scoring or returning answer items', async () => {
    const record: any = { id: '41', assignmentId: '31', status: 'timeout', score: '0.00', gradingState: 'not_submitted', submittedAt: null, gradedAt: null, submissionMethod: null, ruleSnapshot: rule };
    expect(projectFinalResult(record, { rule, items: [] } as any, [])).toMatchObject({ total_score: 120, pass_score: 72, duration_minutes: 45, status: 'timeout', grading_state: 'not_submitted', submitted_at: null, items: [] });
  });
});
