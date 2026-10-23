import { describe, expect, it, vi } from 'vitest';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { PaperReleaseService } from '../src/modules/exams/paper-release.service';
import { PaperService } from '../src/modules/ai/paper.service';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';
import { SamplingService } from '../src/modules/exams/sampling.service';
import { buildRankingRows } from '../src/modules/statistics/ranking';

const rule = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }] } as const;

function fixedFixture(difficulty: string | null = 'medium') {
  const paper: any = { id: '1', title: '历史试卷', businessScope: 'training', mode: 'fixed', status: 'draft', categoryId: '7', regulationIds: [], totalScore: 100, passScore: 60, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5 };
  const version: any = { id: '101', questionId: '10', categoryId: '7', difficulty, revision: 1, status: 'approved', type: 'single', stem: '历史题', options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0], analysis: '历史解析', scoreCents: 10000, source: 'manual' };
  const question: any = { ...version, id: '10', currentVersionId: '101' };
  const rows: any[] = [{ id: '21', paperId: '1', questionId: '10', questionVersionId: '101', sort: 0, score: '100.00' }];
  const writes: any[] = [];
  const paperRepo = { findOne: async () => paper, create: (value: any) => value, save: async (value: any) => { writes.push(value); return value; } };
  const pqRepo = { find: async () => rows, create: (value: any) => value, delete: async () => { writes.push('delete'); }, save: async (value: any) => { writes.push(value); return value; } };
  const versionRepo = { findBy: async () => [version], find: async () => [version], findOne: async () => version, save: async (value: any) => { writes.push(value); return value; } };
  const questionRepo = { findBy: async () => [question], findOne: async () => question, save: async (value: any) => { writes.push(value); return value; } };
  const repos = new Map<any, any>([[ExamPaper, paperRepo], [PaperQuestion, pqRepo], [QuestionVersion, versionRepo], [Question, questionRepo]]);
  const manager = { getRepository: (entity: any) => { const repo = repos.get(entity); if (!repo) throw new Error(`unexpected ${entity.name}`); return repo; } };
  const release = Object.create(PaperReleaseService.prototype);
  Object.assign(release, { paperRepo, releaseRepo: { findOne: async () => null }, dataSource: { transaction: async (fn: any) => fn(manager) }, categories: { lockActive: async () => undefined }, sampling: new SamplingService() });
  const service = Object.create(PaperService.prototype);
  Object.assign(service, { paperRepo, pqRepo, versionRepo, questionRepo, releaseRepo: release.releaseRepo, dataSource: release.dataSource, categories: release.categories, audit: { log: vi.fn() } });
  return { paper, version, question, rows, writes, manager, release, service, versionRepo, questionRepo };
}

describe('disabled and unknown difficulty compatibility', () => {
  it.each(['medium', null])('retains %s in an existing fixed draft GET', async (difficulty) => {
    const fixture = fixedFixture(difficulty);
    const result = await fixture.service.trainingDetail('1');
    expect(result.questions).toEqual([expect.objectContaining({ question_version_id: '101', difficulty })]);
    expect(fixture.writes).toEqual([]);
  });

  it('previews an existing medium fixed draft without removing or reclassifying the question', async () => {
    const fixture = fixedFixture();
    const result = await fixture.release.preview('1');
    expect(result.questions).toEqual([expect.objectContaining({ questionId: '10', versionId: '101', difficulty: 'medium', scoreCents: 10000 })]);
    expect(fixture.version.difficulty).toBe('medium');
    expect(fixture.writes).toEqual([]);
  });

  it.each(['medium', null])('rejects %s in a new fixed selection before replacing its saved rows', async (difficulty) => {
    const fixture = fixedFixture(difficulty);
    await expect(fixture.service.setTrainingQuestions('1', [{ question_version_id: '101', score_cents: 10000 }], { id: '1', name: 'admin' }, null))
      .rejects.toMatchObject({ code: 40001 });
    expect(fixture.writes).toEqual([]);
    expect(fixture.version.difficulty).toBe(difficulty);
    expect(fixture.rows).toHaveLength(1);
  });

  it.each(['medium', null])('rejects new publication of a draft containing %s and locates its question', async (difficulty) => {
    const fixture = fixedFixture(difficulty);
    await expect(fixture.release.fixedPool(fixture.manager, fixture.paper)).rejects.toThrow(/10.*101.*难度/);
    expect(fixture.writes).toEqual([]);
    expect(fixture.version.difficulty).toBe(difficulty);
  });

  it.each(['medium', null])('rejects a new regulation release containing %s without changing the saved draft', async (difficulty) => {
    const fixture = fixedFixture(difficulty);
    fixture.paper.businessScope = 'regulation'; fixture.paper.regulationId = '9';
    fixture.version.regulationId = '9';
    fixture.release.questions = { currentOrCaptureForRelease: async () => fixture.version };
    await expect(fixture.release.regulationFixedPool(fixture.manager, fixture.paper)).rejects.toThrow(/10.*101.*难度/);
    expect(fixture.writes).toEqual([]);
  });

  it.each(['medium', null])('refuses to copy %s into a new training draft before creating the copy', async (difficulty) => {
    const fixture = fixedFixture(difficulty);
    await expect(fixture.service.copyTraining('1', { id: '1', name: 'admin' }, null)).rejects.toMatchObject({ code: 40001 });
    expect(fixture.writes).toEqual([]);
    expect(fixture.rows[0].paperId).toBe('1');
  });

  it.each(['medium', 'unknown'])('keeps a frozen %s legacy release readable but refuses to copy its selected questions', async (difficulty) => {
    const fixture = fixedFixture();
    fixture.paper.businessScope = 'regulation';
    fixture.service.releaseService = { latestForPaper: async () => ({ businessScope: 'regulation', pool: [{ ...fixture.version, difficulty }], rule, requiresLearning: true }) };
    await expect(fixture.service.copy('1', { id: 1, name: 'admin' }, null)).rejects.toMatchObject({ code: 40001 });
    expect(fixture.writes).toEqual([]);
  });

  it('rejects approval of a disabled current revision before changing its state', async () => {
    const fixture = fixedFixture();
    fixture.version.status = 'pending'; fixture.question.status = 'pending';
    const service = Object.create(QuestionVersionService.prototype);
    service.dataSource = fixture.release.dataSource;
    await expect(service.reviewCurrent('10', '101', 'approved', '1')).rejects.toMatchObject({ code: 40001 });
    expect(fixture.version.status).toBe('pending');
    expect(fixture.question.status).toBe('pending');
    expect(fixture.writes).toEqual([]);
  });

  it.each(['medium', 'unknown'])('reads a frozen %s release with its original content and score', async (difficulty) => {
    const fixture = fixedFixture();
    const snapshot = { ...fixture.version, questionId: '10', versionId: '101', difficulty, scoreCents: 10000 };
    fixture.release.releaseRepo = { findOne: async () => ({ id: '5', paperId: '1', categoryId: '7', businessScope: 'training', mode: 'fixed', ruleSnapshot: rule, requiresLearning: false }) };
    fixture.release.releaseQuestionRepo = { find: async () => [{ snapshotJson: snapshot, difficulty, scoreCents: 10000 }] };
    const before = structuredClone(snapshot);
    const result = await fixture.release.get('5');
    expect(result.pool).toEqual([before]);
    expect(snapshot).toEqual(before);
    expect(fixture.writes).toEqual([]);
  });

  it('does not substitute easy questions when the required hard pool is empty', async () => {
    const fixture = fixedFixture('easy');
    fixture.paper.mode = 'random'; fixture.paper.ruleConfig = rule;
    fixture.release.questions = { approvedCandidates: async ({ difficulty }: any) => difficulty === 'easy' ? [{ ...fixture.version, questionId: '10', versionId: '101' }] : [] };
    await expect(fixture.release.randomPool(undefined, fixture.paper)).rejects.toMatchObject({ code: 40971 });
    expect(fixture.writes).toEqual([]);
  });

  it('rejects medium revision without changing the existing version or opening a write transaction', async () => {
    const fixture = fixedFixture();
    const service = Object.create(QuestionVersionService.prototype);
    service.questionRepo = { findOne: async () => fixture.question };
    service.versionRepo = { findOne: async () => fixture.version };
    service.dataSource = { transaction: () => { throw new Error('unexpected write transaction'); } };
    service.assertSource = async () => undefined;
    await expect(service.revise('10', { categoryId: '7', difficulty: 'medium', source: 'manual', type: 'single', stem: '修订题', options: fixture.version.options, answer: [0], analysis: '解析', scoreCents: 10000 }, '1', '101'))
      .rejects.toMatchObject({ code: 40001 });
    expect(fixture.version.difficulty).toBe('medium');
    expect(fixture.version.stem).toBe('历史题');
  });

  it.each(['medium', 'unknown'] as const)('keeps a finalized %s score in its own historical ranking', (difficulty) => {
    const record: any = { id: '9', paperId: '1', releaseId: '5', userId: '3', categoryId: '7', source: 'institution', difficulty, ruleSnapshot: rule, status: 'passed', gradingState: 'finalized', score: 86, startedAt: new Date('2026-10-21T00:00:00Z'), submittedAt: new Date('2026-10-21T00:05:00Z'), deadlineAt: new Date('2026-10-21T00:30:00Z'), submissionMethod: 'manual', gradedAt: new Date('2026-10-21T00:05:00Z') };
    const result = buildRankingRows([record], new Map([['3', '历史学员']]), difficulty, '5', rule as any);
    expect(result).toEqual([{ rank: 1, user_id: '3', name: '历史学员', gender: null, source: 'institution', difficulty, score: 86, duration_seconds: 300, record_id: '9' }]);
    expect(record.difficulty).toBe(difficulty);
  });
});
