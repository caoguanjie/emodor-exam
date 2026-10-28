import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { CreateTrainingPaperDto, UpdateTrainingPaperDto, TrainingPaperDtoValidationPipe, PaperOptionQueryDto, PAPER_OPTION_KEYS, PAPER_CREATE_KEYS, PAPER_UPDATE_KEYS } from '../src/modules/exams/paper.dto';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { PaperRelease } from '../src/entities/paper-release.entity';
import { PaperReleaseQuestion } from '../src/entities/paper-release-question.entity';
import { TrainingCourse } from '../src/entities/training-course.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';
import { PaperAdminController } from '../src/modules/exams/paper-admin.controller';

const CREATE = { title: '公共随机考试', mode: 'random', pool_scope: 'public', category_id: null, rules: [{ type: 'single', count: 100, score_cents: 100 }] };
function dto(value: unknown, update = false) {
  return new TrainingPaperDtoValidationPipe(update ? PAPER_UPDATE_KEYS : PAPER_CREATE_KEYS).transform(value, {
    type: 'body', metatype: update ? UpdateTrainingPaperDto : CreateTrainingPaperDto,
  });
}

const ACTOR = { id: '9', name: '管理员' };
function fixture() {
  const papers = new Map<string, any>(), releases: any[] = [], items: any[] = [];
  const courses = [{ id: '31', categoryId: '7', status: 'published' }, { id: '32', categoryId: '8', status: 'published' }];
  const paperRepo = {
    create: (value: any) => structuredClone(value),
    findOne: async ({ where }: any) => structuredClone(papers.get(String(where.id)) ?? null),
    find: async () => [...papers.values()].map(value => structuredClone(value)),
    save: async (value: any) => { const row = { ...structuredClone(value), id: value.id ?? String(papers.size + 1) }; papers.set(row.id, row); return structuredClone(row); },
  };
  const pqRepo = { find: async () => [], existsBy: async () => false, delete: vi.fn(async () => ({ affected: 0 })) };
  const releaseRepo = {
    create: (value: any) => structuredClone(value),
    save: async (value: any) => { const row = { id: String(21 + releases.length), ...structuredClone(value) }; releases.push(row); return row; },
    findOne: async ({ where }: any) => [...releases].reverse().find(row => where.id ? row.id === where.id : row.paperId === where.paperId) ?? null,
  };
  const itemRepo = {
    create: (value: any) => structuredClone(value),
    save: async (values: any[]) => { items.push(...structuredClone(values)); return values; },
    find: async ({ where }: any) => structuredClone(items.filter(row => row.releaseId === where.releaseId)),
  };
  const manager = { getRepository(entity: unknown) {
    if (entity === ExamPaper) return paperRepo;
    if (entity === PaperQuestion) return pqRepo;
    if (entity === PaperRelease) return releaseRepo;
    if (entity === PaperReleaseQuestion) return itemRepo;
    if (entity === TrainingCourse) return { findBy: async ({ id }: any) => courses.filter(row => id.value.includes(row.id)) };
    throw new Error(`unexpected repository ${(entity as any).name}`);
  } };
  const categories = { lockActive: vi.fn(async (_manager: any, id: string) => {
    if (!['7', '8'].includes(id)) throw new Error('no valid category');
    return { id, status: 1 };
  }) };
  const dataSource = { transaction: (work: any) => work(manager) }, audit = { log: vi.fn() };
  const service = Object.create(PaperService.prototype) as PaperService;
  Object.assign(service, {
    paperRepo, pqRepo, releaseRepo, categories, dataSource, audit,
    userRepo: { findBy: async ({ id }: any) => id.value.map((value: string) => ({ id: value, username: 'admin' })) },
  });
  const candidates: any[] = [];
  for (const difficulty of ['easy', 'hard']) for (let i = 0; i < 105; i++) candidates.push({
    questionId: String((difficulty === 'easy' ? 1000 : 2000) + i), versionId: String((difficulty === 'easy' ? 3000 : 4000) + i),
    revision: 1, categoryId: i % 2 ? '7' : '8', difficulty, type: 'single',
    stem: `题目${i}`, options: [{ key: 'A', text: '正确项' }, { key: 'B', text: '错误项' }], answer: [0], analysis: '解析',
    source: 'manual', approvedBy: null, approvedAt: null,
  });
  const enabledCandidates = vi.fn(async (input: any) => (Array.isArray(input) ? input : [input]).flatMap(filter => candidates.filter(row => row.type === filter.type && row.difficulty === filter.difficulty
    && (filter.poolScope === 'public' || row.categoryId === filter.categoryId))));
  const publishing = Object.create(PaperReleaseService.prototype) as PaperReleaseService;
  Object.assign(publishing, { paperRepo, releaseRepo, releaseQuestionRepo: itemRepo, categories, dataSource, audit,
    questions: { enabledCandidates }, sampling: new SamplingService() });
  Object.assign(service, { releaseService: publishing });
  return { service, publishing, papers, candidates, enabledCandidates, categories, releases, items, courses };
}

describe('practice paper configuration and publication', () => {
  const PRACTICE = { ...CREATE, exam_purpose: 'practice', max_attempts: null, rules: [{ type: 'single', count: 50, score_cents: 200 }] };
  it('persists unlimited practice independently and freezes a fresh candidate pool', async () => {
    const f = fixture();
    const formal = await f.service.createTraining(CREATE as any, ACTOR, null);
    const practice = await f.service.createTraining(PRACTICE as any, ACTOR, null);
    expect(practice).toMatchObject({ exam_purpose: 'practice', status: 'draft', max_attempts: null });
    expect(practice.id).not.toBe(formal.id);
    const published = await f.publishing.publish(practice.id, ACTOR.id);
    expect(await f.publishing.get(published.releaseId)).toMatchObject({ examPurpose: 'practice', rule: { maxAttempts: null, totalCents: 10000 } });
    expect(f.releases[0]).toMatchObject({ examPurpose: 'practice', paperId: practice.id });
    expect(f.papers.get(formal.id)).toMatchObject({ status: 'draft', maxAttempts: 3 });
    await expect(f.service.updateTraining(practice.id, { exam_purpose: 'formal' } as any, ACTOR, null)).rejects.toBeDefined();
  });
  it('uses saved draft configuration, clones learning, truncates title by Unicode and performs no writes', async () => {
    const f = fixture();
    const formal = await f.service.createTraining({ ...CREATE, title: '😀'.repeat(128), requires_learning: true, required_learning_minutes: 12, course_ids: ['31','32'] } as any, ACTOR, null);
    const before = structuredClone([...f.papers]);
    const template = await f.service.practiceTemplate(formal.id);
    expect(template).toMatchObject({ title: '模拟考 · '+ '😀'.repeat(122), exam_purpose: 'practice', pool_scope: 'public', category_id: null, max_attempts: null,
      requires_learning: true, required_learning_minutes: 12, course_ids: ['31','32'], regulation_ids: [], remark: null, sort_order: 0 });
    expect(Array.from(template.title)).toHaveLength(128);
    expect(template.rules).toEqual(CREATE.rules);
    template.rules[0].count = 1;
    expect([...f.papers]).toEqual(before);
    expect(f.releases).toHaveLength(0);
  });
  it('uses the latest published release rule and learning rather than mutable draft-shaped fields', async () => {
    const f = fixture();
    const formal = await f.service.createTraining({ ...CREATE, requires_learning: true, required_learning_minutes: 12, course_ids: ['31'] } as any, ACTOR, null);
    const published = await f.publishing.publish(formal.id, ACTOR.id);
    Object.assign(f.papers.get(formal.id), { durationMinutes: 999, courseIds: ['32'], requiredLearningMinutes: 99 });
    const template = await f.service.practiceTemplate(formal.id);
    expect(template).toMatchObject({ duration_minutes: 30, course_ids: ['31'], required_learning_minutes: 12 });
    expect(f.releases).toHaveLength(1);
    expect(f.releases[0].id).toBe(published.releaseId);
  });
  it('validates trusted stored purpose during updates and rejects unsupported creation', async () => {
    const f = fixture();
    for (const patch of [{ mode: 'fixed' }, { pool_scope: 'category', category_id: '7' }, { max_attempts: 3 }]) {
      await expect(f.service.createTraining({ ...PRACTICE, ...patch } as any, ACTOR, null)).rejects.toBeDefined();
    }
    await expect(f.service.createTraining({ ...CREATE, max_attempts: null } as any, ACTOR, null)).rejects.toBeDefined();
    const practice = await f.service.createTraining(PRACTICE as any, ACTOR, null);
    await expect(f.service.updateTraining(practice.id, { max_attempts: 3 }, ACTOR, null)).rejects.toBeDefined();
    expect(await f.service.updateTraining(practice.id, { max_attempts: null, title: '模拟100题', rules: CREATE.rules }, ACTOR, null)).toMatchObject({ max_attempts: null, exam_purpose: 'practice', rules: CREATE.rules });
    await expect(f.service.practiceTemplate(practice.id)).rejects.toBeDefined();
    const formal = await f.service.createTraining(CREATE as any, ACTOR, null);
    await expect(f.service.updateTraining(formal.id, { max_attempts: null }, ACTOR, null)).rejects.toBeDefined();
  });
});
