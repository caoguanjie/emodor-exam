import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { PaperService } from '../src/modules/ai/paper.service';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { CreateTrainingPaperDto, UpdateTrainingPaperDto, FixedQuestionDto, PAPER_CREATE_KEYS, TrainingPaperDtoValidationPipe } from '../src/modules/exams/paper.dto';
import { validate } from 'class-validator';

const ACTOR = { id: '9', name: '组卷管理员' };
const CREATE = { title: '可配总分试卷', mode: 'fixed', category_id: '7' } as const;
function dto(input: unknown, update = false) {
  return new TrainingPaperDtoValidationPipe(PAPER_CREATE_KEYS).transform(input, { type: 'body', metatype: update ? UpdateTrainingPaperDto : CreateTrainingPaperDto });
}
function fixture() {
  const papers = new Map<string, any>();
  const links: any[] = [];
  const paperRepo = {
    create: (value: any) => Object.assign(new ExamPaper(), structuredClone(value)),
    findOne: async ({ where }: any) => structuredClone(papers.get(String(where.id)) ?? null),
    save: async (value: any) => { const saved = { ...structuredClone(value), id: value.id ?? String(papers.size + 1) }; papers.set(saved.id, saved); return structuredClone(saved); },
  };
  const pqRepo = { create: (value: any) => value, find: async () => links, delete: async () => { links.length = 0; }, save: async (values: any[]) => { links.push(...values); return values; } };
  const manager = { getRepository(entity: unknown) {
    if (entity === ExamPaper) return paperRepo;
    if (entity === PaperQuestion) return pqRepo;
    if (entity === QuestionVersion) return { findBy: async () => [{ id: '21', questionId: '31', categoryId: '7', type: 'single', difficulty: 'easy' }] };
    if (entity === Question) return { findOne: async () => ({ id: '31', currentVersionId: '21', isEnabled: true, deletedAt: null }) };
    throw new Error('unexpected repository');
  } };
  const service = Object.create(PaperService.prototype) as PaperService;
  Object.assign(service, { paperRepo, pqRepo, userRepo: { findBy: async () => [] }, categories: { lockActive: async () => ({ id: '7', status: 1 }) }, audit: { log: vi.fn() }, dataSource: { transaction: (work: any) => work(manager) } });
  return { service, papers, links };
}

describe('configurable training paper total score', () => {
  it('accepts decimal totals and pass scores at the strict boundary and permits zero-point draft links', async () => {
    await expect(dto({ ...CREATE, total_score: 120.5, pass_score: 110.25 })).resolves.toMatchObject({ total_score: 120.5, pass_score: 110.25 });
    await expect(dto({ total_score: 999.99 }, true)).resolves.toMatchObject({ total_score: 999.99 });
    for (const total_score of [0, -1, 1000, 120.001, '120', null]) await expect(dto({ ...CREATE, total_score })).rejects.toMatchObject({ status: 400 });
    expect(await validate(Object.assign(new FixedQuestionDto(), { question_version_id: '21', score_cents: 0 }))).toHaveLength(0);
  });

  it('defaults to 100, persists 120, and validates the merged pass score when updating the target', async () => {
    const f = fixture();
    expect(await f.service.createTraining(CREATE, ACTOR, null)).toMatchObject({ total_score: 100 });
    const created = await f.service.createTraining({ ...CREATE, total_score: 120, pass_score: 110 } as any, ACTOR, null);
    expect(created).toMatchObject({ total_score: 120, pass_score: 110 });
    await expect(f.service.updateTraining(created.id, { total_score: 100 } as any, ACTOR, null)).rejects.toBeDefined();
    expect(await f.service.updateTraining(created.id, { total_score: 80, pass_score: 60 } as any, ACTOR, null)).toMatchObject({ total_score: 80, pass_score: 60 });
    await expect(f.service.createTraining({ ...CREATE, total_score: 50, pass_score: 60 } as any, ACTOR, null)).rejects.toBeDefined();
  });

  it('persists incomplete fixed draft scores and defers total equality until release', async () => {
    const f = fixture(); const paper = await f.service.createTraining({ ...CREATE, total_score: 120 } as any, ACTOR, null);
    const result = await f.service.setTrainingQuestions(paper.id, [{ question_version_id: '21', score_cents: 0 }], ACTOR, null);
    expect(result.sum_score_cents).toBe(0);
    expect(f.links[0].score).toBe('0.00');
    const release = Object.create(PaperReleaseService.prototype) as any;
    const strategy = { totalScore: '120.00', passScore: '60.00', durationMinutes: 30, maxAttempts: 3, partialCreditRatio: '0.5' };
    expect(() => release.ruleForPaper(strategy, [{ type: 'single', count: 1, scoreCents: 0 }])).toThrow();
    expect(() => release.ruleForPaper(strategy, [{ type: 'single', count: 1, scoreCents: 10000 }])).toThrow();
    expect(release.ruleForPaper(strategy, [{ type: 'single', count: 1, scoreCents: 12000 }])).toMatchObject({ totalCents: 12000, passCents: 6000 });
  });

  it('draws random papers against the frozen target and keeps the existing default at 100', () => {
    const service = new SamplingService();
    const candidate: any = { questionId: '31', type: 'single', difficulty: 'easy', options: [], answer: [] };
    const rules: any = [{ type: 'single', count: 1, scoreCents: 12000 }];
    expect(service.draw([candidate], rules, 'easy', undefined, 'question', 12000)[0].scoreCents).toBe(12000);
    expect(() => service.draw([candidate], rules, 'easy')).toThrow();
  });
});
