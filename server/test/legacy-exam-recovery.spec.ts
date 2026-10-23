import { describe, expect, it, vi } from 'vitest';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { ExamAnswer } from '../src/entities/exam-answer.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { Question } from '../src/entities/question.entity';
import { ExamService } from '../src/modules/exams/exam.service';
import { ShuffleService } from '../src/modules/exams/shuffle.service';

function fixture(userId = '9', singleConnection = false) {
  const record: any = { id: '41', paperId: '11', regulationId: '2', userId, assignmentId: null, status: 'in_progress', score: null, gradingState: 'not_submitted', submittedAt: null, deadlineAt: new Date(Date.now() - 60_000), draftRevision: 5, draftPayloadHash: 'old', draftSavedAt: new Date(), activeAssignmentId: null };
  const answers: any[] = [{ examRecordId: '41', selected: [0] }];
  const events: string[] = [];
  let inTransaction = false;
  const recordRepo = { findOne: vi.fn(async ({ lock }: any) => { if (lock) events.push('record-lock'); return record; }), save: vi.fn(async (value: any) => { events.push('save-timeout'); return Object.assign(record, value); }) };
  const answerRepo = { delete: vi.fn(async () => { answers.splice(0); }) };
  const paper = { id: '11', title: '旧卷', totalScore: '100', passScore: '60', durationMinutes: 30 };
  const paperQuestions = [{ paperId: '11', questionId: '101', score: '100' }];
  const questions = [{ id: '101', type: 'single', stem: '旧题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] }];
  const noExtraConnection = () => { if (singleConnection && inTransaction) throw new Error('transaction attempted a second database connection'); };
  const paperRepo: any = { findOne: vi.fn(async () => { noExtraConnection(); return paper; }) };
  const pqRepo: any = { find: vi.fn(async () => { noExtraConnection(); return paperQuestions; }) };
  const questionRepo: any = { find: vi.fn(async () => { noExtraConnection(); return questions; }) };
  const transactional = new Map<any, any>([[ExamRecord, recordRepo], [ExamAnswer, answerRepo], [ExamPaper, { findOne: async () => paper }], [PaperQuestion, { find: async () => paperQuestions }], [Question, { find: async () => questions }]]);
  const manager: any = { getRepository: (entity: any) => transactional.get(entity) };
  const dataSource: any = { transaction: vi.fn(async (work: any) => { events.push('transaction'); inTransaction = true; try { return await work(manager); } finally { inTransaction = false; } }) };
  const redis: any = { hgetall: vi.fn(async () => ({ '101': '[0]' })), del: vi.fn(async () => undefined) };
  const service = new ExamService(recordRepo as any, answerRepo as any, paperRepo, pqRepo, questionRepo, {} as any, {} as any, {} as any, new ShuffleService({ examShuffleSecret: 'recovery-test-seed' } as any), {} as any, redis, {} as any, {} as any, {} as any, {} as any, dataSource, {} as any, {} as any, {} as any);
  return { service, record, answers, recordRepo, events, dataSource, questionRepo, redis };
}

describe('legacy no-assignment deadline recovery', () => {
  it('recovers an unexpired attempt using only the transaction connection for all paper and question reads', async () => {
    const f = fixture('9', true);
    f.record.deadlineAt = new Date(Date.now() + 60_000);
    const response = await f.service.recover('41', 9);
    expect(response).toMatchObject({ exam_record_id: 41, status: 'in_progress', questions: [{ question_id: 101, stem: '旧题干' }], saved_answers: { '101': [0] } });
    expect(f.events).toEqual(['transaction', 'record-lock']);
    expect(f.record.status).toBe('in_progress');
  });

  it('closes a record expired for 60 seconds under its write lock without returning questions or cached answers', async () => {
    const f = fixture();
    const response = await f.service.recover('41', 9);
    expect(response).toMatchObject({ exam_record_id: 41, status: 'timeout', score: 0, finished: true });
    expect(response).not.toHaveProperty('questions');
    expect(response).not.toHaveProperty('saved_answers');
    expect(f.record).toMatchObject({ status: 'timeout', score: '0.00', submittedAt: null, submissionMethod: null, gradingState: 'not_submitted', draftRevision: 0, draftPayloadHash: null, draftSavedAt: null });
    expect(f.answers).toEqual([]);
    expect(f.events).toEqual(['transaction', 'record-lock', 'save-timeout']);
    expect(f.questionRepo.find).not.toHaveBeenCalled();
    expect(f.redis.hgetall).not.toHaveBeenCalled();
  });

  it('rejects another owner before entering a timeout transaction', async () => {
    const f = fixture('10');
    await expect(f.service.recover('41', 9)).rejects.toMatchObject({ code: 40302 });
    expect(f.dataSource.transaction).not.toHaveBeenCalled();
    expect(f.record.status).toBe('in_progress');
    expect(f.answers).toHaveLength(1);
  });
});
