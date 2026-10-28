import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamAssignment } from '../src/entities/exam-assignment.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { TrainingCourse } from '../src/entities/training-course.entity';
import { VideoLearningRecord } from '../src/entities/video-learning-record.entity';
import { AttemptService } from '../src/modules/exams/attempt.service';
import { projectExamRuleMetadata } from '../src/modules/exams/learner-exam-summary';
import { ExamHistoryService, projectFinalResult } from '../src/modules/exams/exam-history.service';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { AttemptPageDto, TrainingExamsController } from '../src/modules/exams/training-exams.controller';

const nowMs = Date.parse('2030-01-01T00:00:00.000Z');
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(nowMs));
afterEach(() => vi.restoreAllMocks());

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
    { id: '41', paperId: '11', userId: '9', status: 'in_progress', deadlineAt: new Date(nowMs + 60_000) },
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
  service.paperRepo = { find: vi.fn(async ({ where }: any) => papers.filter(paper => where.id ? where.id._value.includes(paper.id) : paper.status === 'published' && (where.categoryId === undefined || paper.categoryId === where.categoryId))) };
  service.dataSource = { manager };
  return { service, user, papers, assignments, releases, records, noWrite, releaseRepo, recordRepo, query, learningBuilder, setCreditedMs: (value: string) => { creditedMs = value; } };
}

describe('learner exam summaries', () => {
  it('reads frozen 120-point rules and本人 record links without loading a question pool', async () => {
    const f = fixture();
    const result = await f.service.list('9');
    expect(result.items.find((row: any) => row.paper_id === '11')).toMatchObject({ total_score: 120, pass_score: 72, duration_minutes: 45, question_count: 20, active_record_id: '41', latest_record_id: '41' });
    expect(result.items.find((row: any) => row.paper_id === '12')).toMatchObject({ total_score: 120, pass_score: 72, active_record_id: null });
    expect(result.items.map((row: any) => row.paper_id)).toEqual(['12', '11']);
    expect(result.total).toBe(2);
    expect(f.recordRepo.find).toHaveBeenCalledWith(expect.objectContaining({ select: expect.arrayContaining(['deadlineAt']) }));
    expect(f.releaseRepo.find).toHaveBeenCalledTimes(1);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('returns unused release limits in both list and detail before the first successful start', async () => {
    const f = fixture();
    expect((await f.service.list('9')).items.find((row: any) => row.paper_id === '12')).toMatchObject({
      attempts_used: 0, max_attempts: 3, attempts_remaining: 3,
    });
    expect(await f.service.detail('9', '12')).toMatchObject({ attempts_used: 0, max_attempts: 3, attempts_remaining: 3 });
    expect(f.recordRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: '9' }) }));
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('counts timeout and pre-assignment records as successful starts, independently of attempt ordinals', async () => {
    const f = fixture();
    f.papers[2].status = 'published';
    Object.assign(f.records[0], { status: 'timeout', attemptNo: 17, assignmentId: null });
    f.records.push({ id: '44', paperId: '11', userId: '9', status: 'failed', attemptNo: 21 });
    expect((await f.service.list('9')).items.find((row: any) => row.paper_id === '11')).toMatchObject({
      attempts_used: 2, max_attempts: 3, attempts_remaining: 1, active_record_id: null, latest_record_id: '44',
    });
    expect(await f.service.detail('9', '11')).toMatchObject({ attempts_used: 2, max_attempts: 3, attempts_remaining: 1 });
    expect(await f.service.detail('9', '12')).toMatchObject({ attempts_used: 0, attempts_remaining: 3 });
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('keeps the remaining quota after a pass instead of treating passing as exhaustion', async () => {
    const f = fixture();
    f.papers[2].status = 'published';
    f.records[0].status = 'passed';
    expect((await f.service.list('9')).items.find((row: any) => row.paper_id === '11')).toMatchObject({
      attempts_used: 1, max_attempts: 3, attempts_remaining: 2, active_record_id: null,
    });
    expect(await f.service.detail('9', '11')).toMatchObject({ attempts_used: 1, max_attempts: 3, attempts_remaining: 2 });
  });

  it('prefers the assignment limit across republication and uses the latest release only for unassigned learners', async () => {
    const f = fixture();
    f.assignments[0].ruleSnapshot.maxAttempts = 2;
    f.releases[0].ruleSnapshot.maxAttempts = 9;
    f.releases[1].ruleSnapshot.maxAttempts = 7;
    f.releases.push({ ...f.releases[2], id: '25', versionNo: 2, ruleSnapshot: { ...rule, maxAttempts: 5 } });
    const result = await f.service.list('9');
    expect(result.items.find((row: any) => row.paper_id === '11')).toMatchObject({ attempts_used: 1, max_attempts: 2, attempts_remaining: 1 });
    expect(result.items.find((row: any) => row.paper_id === '12')).toMatchObject({ attempts_used: 0, max_attempts: 5, attempts_remaining: 5 });
    expect(await f.service.detail('9', '11')).toMatchObject({ max_attempts: 2 });
    expect(f.assignments[0].ruleSnapshot.maxAttempts).toBe(2);
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('falls back to the assigned release limit when an old assignment omits it', async () => {
    const f = fixture();
    delete f.assignments[0].ruleSnapshot.maxAttempts;
    f.releases[0].ruleSnapshot.maxAttempts = 9;
    f.releases[1].ruleSnapshot.maxAttempts = 4;
    expect(await f.service.detail('9', '11')).toMatchObject({ attempts_used: 1, max_attempts: 4, attempts_remaining: 3 });
  });

  it('counts the active last attempt while clamping an over-limit history to zero remaining', async () => {
    const f = fixture();
    for (const id of ['44', '45']) f.records.push({ id, paperId: '11', userId: '9', status: 'timeout' });
    expect(await f.service.detail('9', '11')).toMatchObject({ attempts_used: 3, max_attempts: 3, attempts_remaining: 0, active_record_id: '41' });
    f.records.push({ id: '46', paperId: '11', userId: '9', status: 'failed' });
    expect(await f.service.detail('9', '11')).toMatchObject({ attempts_used: 4, max_attempts: 3, attempts_remaining: 0, active_record_id: '41' });
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('does not count or link another learner records for the same paper', async () => {
    const f = fixture();
    f.records.push({ id: '999', paperId: '11', userId: '99', status: 'in_progress', deadlineAt: new Date(nowMs + 60_000) });
    expect(await f.service.detail('9', '11')).toMatchObject({ attempts_used: 1, max_attempts: 3, attempts_remaining: 2, active_record_id: '41', latest_record_id: '41' });
    expect(f.recordRepo.find).toHaveBeenCalledWith(expect.objectContaining({ select: expect.arrayContaining(['userId']) }));
  });

  it('returns explicit null limits for unknown historical rules without reading mutable paper defaults', async () => {
    const f = fixture();
    f.papers[0].maxAttempts = 3;
    expect(await f.service.detail('9', '13')).toMatchObject({ attempts_used: 1, max_attempts: null, attempts_remaining: null });
  });

  it('filters the available set before pagination, including legacy state queries', async () => {
    const f = fixture();
    expect(await f.service.list('9', 1, 1, 'active')).toMatchObject({ total: 1, items: [{ paper_id: '11', active_record_id: '41' }] });
    expect(await f.service.list('9', 1, 1, 'ended')).toMatchObject({ total: 0, items: [] });
    expect(await f.service.list('9', 2, 1)).toMatchObject({ total: 2, items: [{ paper_id: '11' }] });
    expect(await f.service.list('9', 1, 1, 'published')).toMatchObject({ total: 1, items: [{ paper_id: '12' }] });
  });

  it.each(['withdrawn', 'archived'])('keeps %s papers only while本人 active attempt is still before its deadline', async status => {
    const f = fixture();
    f.papers[0].status = status;
    f.records[1].status = 'in_progress';
    f.records[1].deadlineAt = new Date(nowMs + 1);
    expect(await f.service.list('9', 1, 1)).toMatchObject({ total: 3, items: [{ paper_id: '13', active_record_id: '43' }] });
    f.records[1].deadlineAt = new Date(nowMs);
    expect(await f.service.list('9', 1, 1)).toMatchObject({ total: 2, items: [{ paper_id: '12' }] });
    expect(await f.service.list('9', 2, 1)).toMatchObject({ total: 2, items: [{ paper_id: '11' }] });
    expect(await f.service.detail('9', '13')).toMatchObject({ paper_id: '13', active_record_id: null, latest_record_id: '43' });
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it.each([-1, 0, 1])('uses the same exact cutoff in list and detail for deadline offset %s ms', async offset => {
    const f = fixture();
    const deadline = new Date(nowMs + offset);
    f.records[0].deadlineAt = deadline;
    const list = await f.service.list('9');
    const detail = await f.service.detail('9', '11');
    expect(list.items.some((row: any) => row.paper_id === '11')).toBe(offset > 0);
    expect(detail.active_record_id).toBe(offset > 0 ? '41' : null);
    expect(detail).toMatchObject({ total_score: 120, latest_record_id: '41' });
    expect(f.records[0].deadlineAt).toBe(deadline);
    expect(f.records[0].status).toBe('in_progress');
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it.each([undefined, null, new Date('invalid')])('does not infer an active attempt from an unknown deadline: %s', async deadline => {
    const f = fixture();
    f.records[0].deadlineAt = deadline;
    expect(await f.service.list('9')).toMatchObject({ total: 1, items: [{ paper_id: '12' }] });
    expect(await f.service.detail('9', '11')).toMatchObject({ active_record_id: null, latest_record_id: '41' });
  });

  it('uses the same time snapshot for list eligibility and returned active links', async () => {
    const f = fixture();
    f.records[0].deadlineAt = new Date(nowMs + 1);
    f.releaseRepo.find.mockImplementationOnce(async () => {
      vi.mocked(Date.now).mockReturnValue(nowMs + 2);
      return f.releases;
    });
    expect(await f.service.list('9', 1, 20, 'active')).toMatchObject({
      total: 1, items: [{ paper_id: '11', active_record_id: '41' }],
    });
  });

  it.each(['submitted', 'passed', 'failed', 'timeout'])('does not offer a %s record as active even with a future deadline', async status => {
    const f = fixture();
    f.records[0].status = status;
    expect(await f.service.list('9')).toMatchObject({ total: 1, items: [{ paper_id: '12' }] });
    expect(await f.service.detail('9', '11')).toMatchObject({ active_record_id: null, latest_record_id: '41' });
  });

  it('still lists a published paper after its old active deadline expires without inventing a new attempt', async () => {
    const f = fixture();
    f.papers[2].status = 'published';
    f.records[0].deadlineAt = new Date(nowMs);
    expect(await f.service.list('9', 1, 20, 'active')).toMatchObject({ total: 0, items: [] });
    expect(await f.service.list('9', 1, 20, 'published')).toMatchObject({ total: 2, items: [
      { paper_id: '12', active_record_id: null }, { paper_id: '11', active_record_id: null, latest_record_id: '41', total_score: 120 },
    ] });
    expect(f.noWrite).not.toHaveBeenCalled();
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
    expect(await f.service.detail('9', '12')).toMatchObject({ paper_id: '12', category_id: '7' });
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

describe('frozen question type composition', () => {
  it('aggregates all three types in stable order using integer cents and omits empty types', () => {
    expect(projectExamRuleMetadata({ totalCents: 12000, rules: [
      { type: 'judgment', count: 5, scoreCents: 400 },
      { type: 'multiple', count: 5, scoreCents: 800 },
      { type: 'single', count: 10, scoreCents: 600 },
      { type: 'single', count: 0, scoreCents: 0 },
    ] }).question_types).toEqual([
      { type: 'single', count: 10, score_per_question: 6, total_score: 60 },
      { type: 'multiple', count: 5, score_per_question: 8, total_score: 40 },
      { type: 'judgment', count: 5, score_per_question: 4, total_score: 20 },
    ]);
    expect(projectExamRuleMetadata({ totalCents: 3, rules: [
      { type: 'multiple', count: 0, scoreCents: 100 },
      { type: 'single', count: 3, scoreCents: 1 },
    ] }).question_types).toEqual([{ type: 'single', count: 3, score_per_question: 0.01, total_score: 0.03 }]);
  });

  it('combines repeated equal-score rows without inventing one score for mixed-score questions', () => {
    expect(projectExamRuleMetadata({ totalCents: 950, rules: [
      { type: 'single', count: 2, scoreCents: 125 },
      { type: 'single', count: 2, scoreCents: 125 },
      { type: 'multiple', count: 1, scoreCents: 200 },
      { type: 'multiple', count: 1, scoreCents: 250 },
    ] }).question_types).toEqual([
      { type: 'single', count: 4, score_per_question: 1.25, total_score: 5 },
      { type: 'multiple', count: 2, score_per_question: null, total_score: 4.5 },
    ]);
  });

  it.each([
    undefined, null, {}, { totalCents: 100 }, { totalCents: 100, rules: [] },
    { totalCents: 100, rules: [null] },
    { totalCents: 100, rules: [{ type: 'essay', count: 1, scoreCents: 100 }] },
    { totalCents: 100, rules: [{ type: 'single', count: -1, scoreCents: 100 }] },
    { totalCents: 100, rules: [{ type: 'single', count: 1.5, scoreCents: 100 }] },
    { totalCents: 100, rules: [{ type: 'single', count: '1', scoreCents: 100 }] },
    { totalCents: 100, rules: [{ type: 'single', count: 1, scoreCents: -100 }] },
    { totalCents: 100, rules: [{ type: 'single', count: 1, scoreCents: 0.5 }] },
    { totalCents: 100, rules: [{ type: 'single', count: 1, scoreCents: '100' }] },
    { totalCents: 100, rules: [{ type: 'single', count: Number.MAX_SAFE_INTEGER + 1, scoreCents: 1 }] },
    { totalCents: 100, rules: [{ type: 'single', count: Number.MAX_SAFE_INTEGER, scoreCents: 2 }] },
    { totalCents: 100.5, rules: [{ type: 'single', count: 1, scoreCents: 100 }] },
    { totalCents: 100, rules: [{ type: 'single', count: 1, scoreCents: 99 }] },
  ])('keeps incomplete or inconsistent historical composition unknown: %j', snapshot => {
    expect(projectExamRuleMetadata(snapshot).question_types).toBeNull();
  });

  it('uses assignment rules ahead of newer releases and returns only safe composition fields', async () => {
    const f = fixture();
    Object.assign(f.assignments[0].ruleSnapshot.rules[0], { answer: ['do-not-project'], analysis: 'private analysis', questions: [{ stem: 'private stem' }] });
    expect((await f.service.detail('9', '11')).question_types).toEqual([
      { type: 'single', count: 20, score_per_question: 6, total_score: 120 },
    ]);
    expect((await f.service.detail('9', '12')).question_types).toEqual([
      { type: 'single', count: 20, score_per_question: 6, total_score: 120 },
    ]);
    expect((await f.service.detail('9', '13')).question_types).toBeNull();
    expect(JSON.stringify(await f.service.list('9'))).not.toMatch(/do-not-project|private analysis|private stem/);
    expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('keeps final-result metadata within its original response fields', () => {
    const record: any = { id: '41', assignmentId: '31', status: 'timeout', score: '0.00', gradingState: 'not_submitted', submittedAt: null, gradedAt: null, submissionMethod: null, ruleSnapshot: rule };
    expect(projectFinalResult(record, { rule, items: [] } as any, [])).not.toHaveProperty('question_types');
  });
});
