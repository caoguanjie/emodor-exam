import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { PaperReleaseQuestion } from '../src/entities/paper-release-question.entity';
import { ExamAssignment } from '../src/entities/exam-assignment.entity';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamRecordQuestion } from '../src/entities/exam-record-question.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { TrainingCategory } from '../src/entities/training-category.entity';
import { TrainingCourse } from '../src/entities/training-course.entity';
import { VideoLearningRecord } from '../src/entities/video-learning-record.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import { AttemptService } from '../src/modules/exams/attempt.service';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { CreateTrainingPaperDto, PAPER_CREATE_KEYS, TrainingPaperDtoValidationPipe, UpdateTrainingPaperDto } from '../src/modules/exams/paper.dto';

const ACTOR = { id: '9', name: '学习要求管理员' };
const CREATE = { title: '考前学习试卷', mode: 'fixed', category_id: '7' } as const;
const RULE = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }] };
const QUESTION = {
  questionId: '101', versionId: '201', revision: 1, categoryId: '7', difficulty: 'easy', type: 'single',
  stem: '培训题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0], analysis: null,
  scoreCents: 10000, source: 'manual', approvedBy: null, approvedAt: null,
};

function dto(input: unknown, update = false) {
  return new TrainingPaperDtoValidationPipe(PAPER_CREATE_KEYS).transform(input, {
    type: 'body', metatype: update ? UpdateTrainingPaperDto : CreateTrainingPaperDto,
  });
}

function paperFixture() {
  const papers = new Map<string, any>();
  const courses = [{ id: '31', categoryId: '7', status: 'published' }, { id: '32', categoryId: '7', status: 'published' }];
  const paperRepo = {
    create: (value: any) => Object.assign(new ExamPaper(), structuredClone(value)),
    findOne: async ({ where }: any) => structuredClone(papers.get(String(where.id)) ?? null),
    save: async (value: any) => {
      const saved = { ...structuredClone(value), id: value.id ?? String(papers.size + 1) };
      papers.set(saved.id, saved);
      return structuredClone(saved);
    },
  };
  const pqRepo = { find: async () => [] };
  const manager = { getRepository(entity: unknown) {
    if (entity === ExamPaper) return paperRepo;
    if (entity === PaperQuestion) return pqRepo;
    if (entity === TrainingCourse) return { findBy: async ({ id }: any) => courses.filter(course => id.value.includes(course.id)) };
    throw new Error(`unexpected repository ${(entity as any).name}`);
  } };
  const service = Object.create(PaperService.prototype) as PaperService;
  Object.assign(service, {
    paperRepo, pqRepo, releaseRepo: { findOne: async () => null },
    userRepo: { findBy: async ({ id }: any) => id.value.map((value: string) => ({ id: value, realName: null, username: 'admin' })) },
    categories: { lockActive: async () => ({ id: '7', status: 1 }) },
    audit: { log: () => undefined }, dataSource: { transaction: (work: any) => work(manager) },
  });
  return { service, papers, courses };
}

function releaseFixture() {
  const paper: any = {
    id: '11', businessScope: 'training', mode: 'random', categoryId: '7', title: '发布学习要求', status: 'draft',
    totalScore: '100.00', passScore: '60.00', durationMinutes: 30, maxAttempts: 3, partialCreditRatio: '0.50',
    requiresLearning: 1, requiredLearningMinutes: 2, courseIds: ['31', '32'], regulationIds: [], ruleConfig: structuredClone(RULE),
  };
  const courses = [{ id: '31', categoryId: '7', status: 'published' }, { id: '32', categoryId: '7', status: 'published' }];
  const releases: any[] = [];
  const items: any[] = [];
  const paperRepo = { findOne: async () => paper, save: async (value: any) => value };
  const releaseRepo = {
    create: (value: any) => structuredClone(value),
    save: async (value: any) => { const row = { id: '21', ...value }; releases.push(row); return row; },
    findOne: async ({ where }: any) => releases.find(row => where.id ? row.id === where.id : row.paperId === where.paperId) ?? null,
  };
  const releaseQuestionRepo = {
    create: (value: any) => value, save: async (values: any[]) => { items.push(...structuredClone(values)); return values; },
    find: async () => structuredClone(items),
  };
  const manager = { getRepository(entity: unknown) {
    if (entity === ExamPaper) return paperRepo;
    if (entity === PaperRelease) return releaseRepo;
    if (entity === PaperReleaseQuestion) return releaseQuestionRepo;
    if (entity === TrainingCourse) return { findBy: async ({ id }: any) => courses.filter(course => id.value.includes(course.id)) };
    throw new Error(`unexpected repository ${(entity as any).name}`);
  } };
  const service = Object.create(PaperReleaseService.prototype) as PaperReleaseService;
  Object.assign(service, {
    paperRepo, releaseRepo, releaseQuestionRepo, categories: { lockActive: async () => ({ id: '7', status: 1 }) },
    questions: { enabledCandidates: async ({ difficulty }: any) => [{ ...structuredClone(QUESTION), difficulty, questionId: difficulty === 'easy' ? '101' : '102', versionId: difficulty === 'easy' ? '201' : '202' }] },
    sampling: new SamplingService(), audit: { log: () => undefined }, dataSource: { transaction: (work: any) => work(manager) },
  });
  return { service, paper, courses, releases, items };
}

function attemptFixture(creditedMs = '0') {
  const assignments: any[] = [];
  const records: any[] = [];
  const savedItems: any[] = [];
  const release: any = { id: '21', paperId: '11', businessScope: 'training', mode: 'fixed', categoryId: '7', requiresLearning: true, requiredLearningMinutes: 2, courseIds: ['31', '32'], rule: structuredClone(RULE), pool: [structuredClone(QUESTION)] };
  const paper: any = { id: '11', businessScope: 'training', status: 'published', regulationId: null, requiresLearning: 0, requiredLearningMinutes: null, courseIds: [] };
  const recordRepo = {
    create: (value: any) => value,
    save: async (value: any) => { const saved = { id: String(41 + records.length), ...value }; records.push(saved); return saved; },
    createQueryBuilder: () => {
      const qb: any = {};
      for (const method of ['setLock', 'where', 'orderBy', 'addOrderBy']) qb[method] = () => qb;
      qb.getMany = async () => records;
      return qb;
    },
  };
  const itemRepo = {
    create: (value: any) => value, save: async (values: any[]) => { savedItems.push(...values); return values; },
    find: async () => [{ id: '51', snapshotJson: structuredClone(QUESTION), scoreCents: 10000 }],
  };
  const manager = { getRepository(entity: unknown) {
    if (entity === SysUser) return { findOne: async () => ({ id: '5', username: 'learner', status: 1, role: 'employee', categoryId: '7', source: 'institution' }) };
    if (entity === TrainingCategory) return { findOne: async () => ({ id: '7', status: 1 }) };
    if (entity === ExamPaper) return { findOne: async () => paper };
    if (entity === ExamAssignment) return { findOne: async () => assignments[0] ?? null, create: (value: any) => value, save: async (value: any) => { const row = { id: '30', ...value }; assignments.push(row); return row; } };
    if (entity === ExamRecord) return recordRepo;
    if (entity === ExamRecordQuestion) return itemRepo;
    if (entity === VideoLearningRecord) return { createQueryBuilder: () => {
      const qb: any = {};
      for (const method of ['select', 'where', 'andWhere']) qb[method] = () => qb;
      qb.getRawOne = async () => ({ creditedMs });
      return qb;
    } };
    throw new Error(`unexpected repository ${(entity as any).name}`);
  } };
  const service = Object.create(AttemptService.prototype) as AttemptService;
  Object.assign(service, {
    dataSource: { transaction: (work: any) => work(manager) },
    releases: { latestForPaper: async () => structuredClone(release), get: async () => structuredClone(release) },
    shuffle: { deriveSeed: () => 'seed', shuffleQuestionOrder: (value: any) => value, snapshotOptionMapping: () => [0, 1] },
    reader: { forStudent: async (_userId: string, recordId: string) => ({ record_id: recordId }) },
    redis: { set: async () => undefined }, audit: { log: () => undefined }, media: { bind: async () => undefined },
  });
  return { service, release, paper, assignments, records, savedItems };
}

describe('training paper learning requirement', () => {
  it('accepts the new fields at the strict DTO boundary and bounds minutes and remarks', async () => {
    expect(await dto({ ...CREATE, requires_learning: true, course_ids: ['31'], required_learning_minutes: 2, remark: '保存说明' })).toMatchObject({ required_learning_minutes: 2, remark: '保存说明' });
    for (const minutes of [0, -1, 1.5, '2', 2147483648]) {
      await expect(dto({ ...CREATE, required_learning_minutes: minutes })).rejects.toMatchObject({ status: 400 });
    }
    await expect(dto({ remark: '字'.repeat(1001) }, true)).rejects.toMatchObject({ status: 400 });
    await expect(dto({ remark: 1 }, true)).rejects.toMatchObject({ status: 400 });
  });

  it('persists, reopens, updates and copies the remark and learning configuration', async () => {
    const f = paperFixture();
    const created = await f.service.createTraining({ ...CREATE, requires_learning: true, course_ids: ['31', '32'], required_learning_minutes: 2, remark: '  考前说明  ' } as any, ACTOR, null);
    expect(created).toMatchObject({ requires_learning: true, required_learning_minutes: 2, course_ids: ['31', '32'], remark: '考前说明' });
    expect(await f.service.trainingDetail(created.id)).toMatchObject({ required_learning_minutes: 2, remark: '考前说明' });
    expect(await f.service.updateTraining(created.id, { title: '只改标题' }, ACTOR, null)).toMatchObject({ required_learning_minutes: 2, remark: '考前说明' });
    expect(await f.service.copyTraining(created.id, ACTOR, null)).toMatchObject({ required_learning_minutes: 2, course_ids: ['31', '32'], remark: '考前说明' });
    expect(await f.service.updateTraining(created.id, { remark: null } as any, ACTOR, null)).toMatchObject({ remark: null });
  });

  it('validates the merged patch and clears hidden learning fields when disabled', async () => {
    const f = paperFixture();
    const created = await f.service.createTraining({ ...CREATE, requires_learning: true, course_ids: ['31'], required_learning_minutes: 2 } as any, ACTOR, null);
    await expect(f.service.updateTraining(created.id, { required_learning_minutes: null } as any, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
    await expect(f.service.updateTraining(created.id, { course_ids: [] }, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
    expect(f.papers.get(created.id).requiredLearningMinutes).toBe(2);
    expect(await f.service.updateTraining(created.id, { requires_learning: false }, ACTOR, null)).toMatchObject({ requires_learning: false, required_learning_minutes: null, course_ids: [] });
    await expect(f.service.updateTraining(created.id, { requires_learning: true }, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
  });

  it('copies an old null threshold without inventing minutes or changing the source', async () => {
    const f = paperFixture();
    const created = await f.service.createTraining(CREATE, ACTOR, null);
    Object.assign(f.papers.get(created.id), { requiresLearning: 1, requiredLearningMinutes: null, courseIds: ['31'], remark: '旧卷备注' });
    const copy = await f.service.copyTraining(created.id, ACTOR, null);
    expect(copy).toMatchObject({ requires_learning: true, required_learning_minutes: null, course_ids: ['31'], remark: '旧卷备注' });
    expect(f.papers.get(created.id).requiredLearningMinutes).toBeNull();
  });

  it('requires a positive threshold and at least one same-category published course', async () => {
    const f = paperFixture();
    for (const patch of [{}, { required_learning_minutes: 1 }, { course_ids: ['31'] }, { required_learning_minutes: 0, course_ids: ['31'] }]) {
      await expect(f.service.createTraining({ ...CREATE, ...patch, requires_learning: true } as any, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
    }
    for (const status of ['draft', 'offline']) {
      f.courses[0].status = status;
      await expect(f.service.createTraining({ ...CREATE, requires_learning: true, course_ids: ['31'], required_learning_minutes: 1 } as any, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
    }
    f.courses[0].status = 'published';
    f.courses[0].categoryId = '8';
    await expect(f.service.createTraining({ ...CREATE, requires_learning: true, course_ids: ['31'], required_learning_minutes: 1 } as any, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
    expect(f.papers.size).toBe(0);
  });

  it('normalizes disabled writes and empty remarks without requiring a learning course', async () => {
    const f = paperFixture();
    expect(await f.service.createTraining({ ...CREATE, requires_learning: false, course_ids: ['99'], required_learning_minutes: null, remark: '  ' } as any, ACTOR, null)).toMatchObject({ requires_learning: false, required_learning_minutes: null, course_ids: [], remark: null });
  });

  it('freezes the threshold and selected courses in the immutable release', async () => {
    const f = releaseFixture();
    const { releaseId } = await f.service.publish('11', '9');
    expect(f.paper.updatedBy).toBe('9');
    expect(f.paper.updatedAt).toBeInstanceOf(Date);
    const updatedAt = f.paper.updatedAt;
    expect(await f.service.publish('11', '10')).toEqual({ releaseId });
    expect(f.paper.updatedBy).toBe('9');
    expect(f.paper.updatedAt).toBe(updatedAt);
    f.paper.requiredLearningMinutes = 900;
    f.paper.courseIds = ['99'];
    expect(await f.service.get(releaseId)).toMatchObject({ requiresLearning: true, requiredLearningMinutes: 2, courseIds: ['31', '32'] });
    expect(f.releases).toHaveLength(1);
  });

  it('revalidates incomplete requirements and unavailable courses before writing a release', async () => {
    for (const change of ['missing-minutes', 'empty-courses', 'offline-course']) {
      const f = releaseFixture();
      if (change === 'missing-minutes') f.paper.requiredLearningMinutes = null;
      if (change === 'empty-courses') f.paper.courseIds = [];
      if (change === 'offline-course') f.courses[0].status = 'offline';
      await expect(f.service.publish('11', '9')).rejects.toMatchObject({ code: 40972 });
      expect(f.releases).toHaveLength(0);
      expect(f.items).toHaveLength(0);
      expect(f.paper.status).toBe('draft');
    }
  });

  it('rejects a one-millisecond deficit before allocating an assignment or attempt', async () => {
    const f = attemptFixture('119999');
    await expect(f.service.start('5', '11')).rejects.toMatchObject({ code: 40901, data: { reason_code: 'LEARNING_REQUIRED', required_learning_minutes: 2, credited_seconds: 119, remaining_seconds: 1, course_ids: ['31', '32'] } });
    expect(f.assignments).toHaveLength(0);
    expect(f.records).toHaveLength(0);
    expect(f.savedItems).toHaveLength(0);
  });

  it('allows the exact threshold using frozen release requirements instead of mutable paper fields', async () => {
    const f = attemptFixture('120000');
    expect(await f.service.start('5', '11')).toMatchObject({ record_id: '41' });
    expect(f.records).toHaveLength(1);
  });

  it('checks a new retake against its original release without consuming a failed attempt', async () => {
    const f = attemptFixture('0');
    f.assignments.push({ id: '30', paperId: '11', userId: '5', releaseId: '21', source: 'institution', categoryId: '7', difficulty: 'easy', ruleSnapshot: structuredClone(RULE), snapshotOrigin: 'release' });
    f.records.push({ id: '40', status: 'failed', attemptNo: 1, assignmentId: '30' });
    await expect(f.service.start('5', '11')).rejects.toMatchObject({ code: 40901 });
    expect(f.records).toHaveLength(1);
    expect(f.assignments).toHaveLength(1);
  });

  it('preserves old releases with null thresholds and restores an active attempt before checking learning', async () => {
    const legacy = attemptFixture('0');
    legacy.release.requiredLearningMinutes = null;
    expect(await legacy.service.start('5', '11')).toMatchObject({ record_id: '41' });
    const active = attemptFixture('0');
    active.assignments.push({ id: '30', paperId: '11', userId: '5', releaseId: '21' });
    active.records.push({ id: '40', status: 'in_progress', assignmentId: '30', deadlineAt: new Date(Date.now() + 60_000) });
    active.paper.status = 'archived';
    expect(await active.service.start('5', '11')).toMatchObject({ record_id: '40' });
    expect(active.records).toHaveLength(1);
  });
});
