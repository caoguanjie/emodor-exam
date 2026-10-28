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

describe('public random paper contract', () => {
  it('accepts public random category null and partial updates at the strict DTO boundary', async () => {
    expect(await dto(CREATE)).toMatchObject({ pool_scope: 'public', category_id: null });
    expect(await dto({ pool_scope: 'public', category_id: null }, true)).toMatchObject({ pool_scope: 'public', category_id: null });
  });

  it('keeps missing scope compatible with category requests', async () => {
    expect(await dto({ title: '旧类别卷', mode: 'fixed', category_id: '7' })).toMatchObject({ category_id: '7' });
    await expect(dto({ title: '缺类别', mode: 'random' })).rejects.toMatchObject({ status: 400 });
  });

  it.each(['invalid', '', null, 1])('rejects pool_scope %s', async pool_scope => {
    await expect(dto({ ...CREATE, pool_scope })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects public fixed and public requests with a category', async () => {
    await expect(dto({ ...CREATE, mode: 'fixed' })).rejects.toMatchObject({ status: 400 });
    await expect(dto({ ...CREATE, category_id: '7' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('public current question candidates', () => {
  it('keeps only enabled non-deleted current versions across categories without category admission', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: String(501 + i), questionId: String(101 + i), revision: 1, categoryId: i % 2 ? '7' : '8', type: 'single', difficulty: 'easy',
      stem: '合法题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: i === 5 ? [99] : [0], analysis: null,
      source: 'manual', regulationId: null, regulationVersionId: null, approvedBy: null, approvedAt: null,
    }));
    const identities = rows.map((row, i) => ({ id: row.questionId, currentVersionId: i === 4 ? '999' : row.id,
      categoryId: i === 6 ? '9' : row.categoryId, type: 'single', difficulty: 'easy', isEnabled: i !== 2, deletedAt: i === 3 ? new Date() : null }));
    const queries: Array<{ sql: string; params: any }> = [];
    const qb: any = { innerJoin: (_e: any, _alias: string, sql: string) => { queries.push({ sql, params: {} }); return qb; },
      where: (sql: string, params: any) => { queries.push({ sql, params }); return qb; },
      andWhere: (sql: string, params: any) => { queries.push({ sql, params }); return qb; }, orderBy: () => qb, getMany: async () => rows };
    const versionRepo = { createQueryBuilder: () => qb };
    const manager: any = { getRepository(entity: any) {
      if (entity === QuestionVersion) return versionRepo;
      if (entity === Question) return { findOne: async ({ where }: any) => identities.find(row => row.id === where.id) };
      throw new Error(`unexpected repository ${entity.name}`);
    } };
    const service = Object.create(QuestionVersionService.prototype) as QuestionVersionService;
    const lockCategory = vi.fn(async () => { throw new Error('public pool must not require a category'); });
    Object.assign(service, { versionRepo, categories: { lockActive: lockCategory, assertActive: lockCategory } });
    const result = await service.enabledCandidates({ poolScope: 'public', type: 'single', difficulty: 'easy' }, manager);
    expect(result.map(row => row.questionId)).toEqual(['101', '102']);
    expect(new Set(result.map(row => row.categoryId))).toEqual(new Set(['7', '8']));
    expect(queries.some(row => row.sql.includes('question.current_version_id = version.id'))).toBe(true);
    expect(queries.some(row => row.sql.includes('question.is_enabled = :enabled') && row.params.enabled === true)).toBe(true);
    expect(queries.some(row => row.sql.includes('question.deleted_at IS NULL'))).toBe(true);
    expect(queries.some(row => row.params?.categoryId !== undefined)).toBe(false);
    expect(lockCategory).not.toHaveBeenCalled();
  });
});

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
  return { service, publishing, papers, candidates, enabledCandidates, categories, releases, items, courses };
}

describe('public random paper persistence and publication', () => {
  it('persists 100 questions for 100 points, round-trips edits and copies with default three attempts', async () => {
    const f = fixture();
    const created = await f.service.createTraining(CREATE as any, ACTOR, null);
    expect(created).toMatchObject({ pool_scope: 'public', category_id: null, max_attempts: 3, rules: [{ type: 'single', count: 100, score_cents: 100 }] });
    expect(f.papers.get(created.id).ruleConfig.totalCents).toBe(10000);
    expect(await f.service.trainingDetail(created.id)).toMatchObject({ pool_scope: 'public', category_id: null });
    const edited = await f.service.updateTraining(created.id, { title: '80题100分', rules: [
      { type: 'single', count: 60, score_cents: 100 }, { type: 'multiple', count: 10, score_cents: 300 }, { type: 'judgment', count: 10, score_cents: 100 },
    ] }, ACTOR, null);
    expect(edited.rules.reduce((sum, rule) => sum + rule.count, 0)).toBe(80);
    expect(edited.rules.reduce((sum, rule) => sum + rule.count * rule.score_cents, 0)).toBe(10000);
    expect(await f.service.copyTraining(created.id, ACTOR, null)).toMatchObject({ pool_scope: 'public', category_id: null, rules: edited.rules });
    expect(f.categories.lockActive).not.toHaveBeenCalled();
  });

  it('score_total_must_match at both create and merged update', async () => {
    const f = fixture();
    await expect(f.service.createTraining({ ...CREATE, rules: [{ type: 'single', count: 99, score_cents: 100 }] } as any, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
    const created = await f.service.createTraining(CREATE as any, ACTOR, null);
    await expect(f.service.updateTraining(created.id, { total_score: 120 }, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
    expect(f.papers.get(created.id).totalScore).toBe('100.00');
  });

  it.each([
    { mode: 'fixed' }, { pool_scope: 'other' }, { pool_scope: 'category', category_id: null }, { category_id: '7' },
    { regulation_ids: ['9'] }, { max_attempts: 101 }, { duration_minutes: 1441 },
    { total_score: 501, rules: [{ type: 'single', count: 501, score_cents: 100 }] },
  ])('rejects invalid scope/rules even when bypassing DTO validation: %j', async patch => {
    const f = fixture();
    await expect(f.service.createTraining({ ...CREATE, ...patch } as any, ACTOR, null)).rejects.toBeDefined();
    expect(f.papers.size).toBe(0);
  });

  it('does not allow mode or scope conversion and preserves old missing-scope category drafts', async () => {
    const f = fixture();
    const old = await f.service.createTraining({ title: '旧卷', mode: 'fixed', category_id: '7' }, ACTOR, null);
    await expect(f.service.updateTraining(old.id, { mode: 'random', pool_scope: 'public', category_id: null }, ACTOR, null)).rejects.toMatchObject({ code: 40970 });
    expect(await f.service.updateTraining(old.id, { title: '旧卷编辑' }, ACTOR, null)).toMatchObject({ mode: 'fixed', pool_scope: 'category', category_id: '7' });
  });

  it('public_pool_uses_enabled_questions_across_categories and freezes scope/rules/version content', async () => {
    const f = fixture(), created = await f.service.createTraining(CREATE as any, ACTOR, null);
    const { releaseId } = await f.publishing.publish(created.id, ACTOR.id);
    const frozen = await f.publishing.get(releaseId);
    expect(frozen).toMatchObject({ poolScope: 'public', categoryId: null, rule: { maxAttempts: 3 } });
    expect(new Set(frozen.pool.map(row => row.categoryId))).toEqual(new Set(['7', '8']));
    expect(frozen.pool).toHaveLength(210);
    f.candidates[0].stem = '修改题库';
    expect((await f.publishing.get(releaseId)).pool[0].stem).toBe('题目0');
    expect(f.items.every(row => row.scoreCents === 100)).toBe(true);
  });

  it('returns pool_scope with publication metadata at the HTTP boundary', async () => {
    const f = fixture(), created = await f.service.createTraining(CREATE as any, ACTOR, null);
    const controller = new PaperAdminController(f.service, f.publishing, {} as any, {} as any);
    expect(await controller.publish(created.id, { id: ACTOR.id } as any)).toMatchObject({ release_id: '21', pool_scope: 'public' });
  });

  it.each([
    ['easy', 'single'], ['hard', 'single'], ['easy', 'multiple'], ['hard', 'multiple'], ['easy', 'judgment'], ['hard', 'judgment'],
  ])('both_difficulties_must_satisfy_each_rule: %s %s deficit aborts publication', async (difficulty, type) => {
    const f = fixture(), created = await f.service.createTraining({ ...CREATE, rules: [{ type, count: 100, score_cents: 100 }] } as any, ACTOR, null);
    f.candidates.forEach(row => { row.type = type; });
    f.candidates.splice(0, f.candidates.length, ...f.candidates.filter(row => row.difficulty !== difficulty).concat(f.candidates.filter(row => row.difficulty === difficulty).slice(0, 99)));
    await expect(f.publishing.publish(created.id, ACTOR.id)).rejects.toMatchObject({ code: 40971, data: { deficits: [{ difficulty, type, required: 100, available: 99 }] } });
    expect(f.releases).toHaveLength(0);
    expect(f.items).toHaveLength(0);
    expect(f.papers.get(created.id).status).toBe('draft');
  });

  it('allows public learning courses from multiple categories but still requires published courses', async () => {
    const f = fixture();
    const created = await f.service.createTraining({ ...CREATE, requires_learning: true, required_learning_minutes: 2, course_ids: ['31', '32'] } as any, ACTOR, null);
    const { releaseId } = await f.publishing.publish(created.id, ACTOR.id);
    expect(await f.publishing.get(releaseId)).toMatchObject({ courseIds: ['31', '32'], requiredLearningMinutes: 2 });
    f.courses[1].status = 'offline';
    await expect(f.service.createTraining({ ...CREATE, requires_learning: true, required_learning_minutes: 2, course_ids: ['32'] } as any, ACTOR, null)).rejects.toMatchObject({ code: 40972 });
  });

  it('queries published course options across categories only with an explicit public scope', async () => {
    const f = fixture(), queries: Array<{ sql: string; params: any }> = [];
    const qb: any = { getManyAndCount: async () => [f.courses, 2] };
    for (const method of ['where', 'andWhere']) qb[method] = (sql: string, params: any) => { queries.push({ sql, params }); return qb; };
    for (const method of ['orderBy', 'skip', 'take']) qb[method] = () => qb;
    Object.assign(f.service, { courseRepo: { createQueryBuilder: () => qb } });
    const query = await new StrictDtoValidationPipe(PAPER_OPTION_KEYS).transform({ pool_scope: 'public' }, { type: 'query', metatype: PaperOptionQueryDto });
    const controller = new PaperAdminController(f.service, f.publishing, {} as any, {} as any);
    expect(await controller.courseOptions(query, { query: { pool_scope: 'public' } } as any)).toMatchObject({ total: 2, items: [{ id: '31' }, { id: '32' }] });
    expect(queries.some(row => row.params?.status === 'published')).toBe(true);
    expect(queries.some(row => row.params?.categoryId !== undefined)).toBe(false);
    expect(() => controller.courseOptions({}, { query: {} } as any)).toThrow();
  });
});
