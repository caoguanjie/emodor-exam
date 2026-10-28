import { describe, expect, it, vi } from 'vitest';
import { TrainingExamsController } from '../src/modules/exams/training-exams.controller';

const user: any = { id: '9', role: 'employee', client: 'mobile' };

describe('question content capability HTTP boundary', () => {
  // A missing/defaulted header must not silently advertise schema 3 support.
  it.each([[undefined, 2], ['2', 2], ['3', 3]])('passes header %s as capability %s', (header, expected) => {
    const attempts: any = { start: vi.fn() };
    const controller = new TrainingExamsController(attempts, {} as any, {} as any);
    (controller.start as any)('11', user, header);
    expect(attempts.start).toHaveBeenCalledWith('9', '11', true, expected, undefined);
  });

  it.each([[undefined, 2], ['2', 2], ['3', 3]])('passes the expected release together with header %s capability %s', (header, expected) => {
    const attempts: any = { start: vi.fn() };
    const controller = new TrainingExamsController(attempts, {} as any, {} as any);
    (controller.start as any)('11', user, header, { expected_release_id: '21' });
    expect(attempts.start).toHaveBeenCalledWith('9', '11', true, expected, '21');
  });

  it.each(['', '1', '4', '03', ' 3', '3 ', '2,3', 3, ['3'], null])('rejects malformed header %j before invoking start', (header) => {
    const attempts: any = { start: vi.fn() };
    const controller = new TrainingExamsController(attempts, {} as any, {} as any);
    expect(() => (controller.start as any)('11', user, header)).toThrowError(expect.objectContaining({ code: 40001 }));
    expect(attempts.start).not.toHaveBeenCalled();
  });

  it('keeps the mobile employee restriction even when capability 3 is claimed', () => {
    const attempts: any = { start: vi.fn() };
    const controller = new TrainingExamsController(attempts, {} as any, {} as any);
    expect(() => (controller.start as any)('11', { ...user, client: 'pc' }, '3')).toThrowError(expect.objectContaining({ code: 40301 }));
    expect(attempts.start).not.toHaveBeenCalled();
  });

  it('passes capability through every endpoint returning exam content without changing the submit body', () => {
    const attempts: any = { recover: vi.fn() };
    const submissions: any = { submit: vi.fn() };
    const history: any = { result: vi.fn(), wrongItems: vi.fn() };
    const controller = new TrainingExamsController(attempts, submissions, history);
    const body = { record_id: '41', answers: [{ item_id: '501', option_ids: [] }] };
    (controller.recover as any)('41', user, '3');
    (controller.result as any)('41', user, '3');
    (controller.wrongQuestions as any)(user, {}, '3');
    (controller.submit as any)('41', body, user, '3');
    expect(attempts.recover).toHaveBeenCalledWith('9', '41', true, 3);
    expect(history.result).toHaveBeenCalledWith('9', '41', 3);
    expect(history.wrongItems).toHaveBeenCalledWith('9', 1, 20, 3);
    expect(submissions.submit).toHaveBeenCalledWith('9', '41', body, 3);
  });
});
