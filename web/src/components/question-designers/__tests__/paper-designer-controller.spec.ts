import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaperDesignerController } from '../../../composables/paper-designer-controller';
import type { SaveOutcome, PaperDesignerValue } from '../contracts';
import { applyQuestionCommitResult } from '../paper-designer-state';
import { copy, deferred, paperFixture } from './paper-designer-fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('paper designer save controller', () => {
  it('shows a useful save error without sending a request when secure randomness is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    const saveDraft = vi.fn();
    const controller = createPaperDesignerController({ value: paperFixture(), saveDraft });
    expect(await controller.save()).toBe(false);
    expect(controller.error.value).toContain('当前浏览器不支持安全随机数');
    expect(controller.saving.value).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('resumes an existing save request without generating another id', async () => {
    let calls = 0;
    const requests: string[] = [];
    const controller = createPaperDesignerController({ value: paperFixture(), saveDraft: async (value, context) => {
      requests.push(context.request_id);
      return ++calls === 1 ? { status: 'incomplete', value, message: '等待确认', can_abandon: false } : { status: 'saved', value };
    } });
    expect(await controller.save()).toBe(false);
    vi.stubGlobal('crypto', undefined);
    expect(await controller.save()).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
  });

  it('adopts partial receipts, freezes edits and resumes the same logical save', async () => {
    const initial = paperFixture(); initial.bindings.question_one = { kind: 'new' };
    const requests: string[] = [];
    let calls = 0;
    const controller = createPaperDesignerController({ value: initial, saveDraft: async (value, context) => {
      requests.push(context.request_id); calls += 1;
      const refreshed = applyQuestionCommitResult(value, {
        request_id: context.request_id, items: [{ client_id: 'question_one', question_id: '90', version_id: '91', revision: 1 }],
      }, { request_id: context.request_id, client_ids: ['question_one'] });
      return calls === 1 ? { status: 'incomplete', value: refreshed, message: '题目已入库，试卷尚未保存', can_abandon: true } : { status: 'saved', value: refreshed };
    } });
    expect(await controller.save()).toBe(false);
    expect(controller.locked.value).toBe(true);
    expect(controller.dirty.value).toBe(true);
    expect(controller.value.value.bindings.question_one).toMatchObject({ question_version_id: '91' });
    const edit = copy(initial); edit.paper.title = '必须拒绝';
    expect(controller.change(edit)).toBe(false);
    expect(await controller.save()).toBe(true);
    expect(requests).toHaveLength(2); expect(requests[1]).toBe(requests[0]);
    expect(controller.locked.value).toBe(false); expect(controller.dirty.value).toBe(false);
  });

  it('ignores a save response after the host has replaced the controlled paper', async () => {
    const pending = deferred<SaveOutcome<PaperDesignerValue>>();
    const initial = paperFixture();
    const controller = createPaperDesignerController({ value: initial, saveDraft: () => pending.promise });
    const saving = controller.save();
    controller.replace(paperFixture('200'));
    pending.resolve({ status: 'saved', value: initial });
    expect(await saving).toBe(false);
    expect(controller.value.value.paper.id).toBe('200');
    expect(controller.saving.value).toBe(false);
  });

  it('rejects malformed structures and readonly saves without invoking the host', async () => {
    let calls = 0;
    const initial = paperFixture();
    const controller = createPaperDesignerController({ value: initial, mode: 'readonly', saveDraft: async (value) => { calls += 1; return { status: 'saved', value }; } });
    const malformed = copy(initial); malformed.document.content.content = [];
    expect(controller.change(malformed)).toBe(false);
    expect(await controller.save()).toBe(false);
    expect(calls).toBe(0);
    expect(controller.value.value.document.content.content).toHaveLength(1);
  });

  it('does not close if the paper changes while the confirmation is pending', async () => {
    const initial = paperFixture();
    const controller = createPaperDesignerController({ value: initial, saveDraft: async (value) => ({ status: 'saved', value }) });
    const changed = copy(initial); changed.paper.title = '未保存的标题'; controller.change(changed);
    const answer = deferred<boolean>();
    const closing = controller.requestClose(() => answer.promise);
    controller.replace(paperFixture('200'));
    answer.resolve(true);
    expect(await closing).toBe(false);
  });

  it('refuses to close an unknown submission even if discarding edits would be confirmed', async () => {
    const controller = createPaperDesignerController({ value: paperFixture(), saveDraft: async (value) => ({
      status: 'incomplete', value, message: '回执未知', can_abandon: false,
    }) });
    await controller.save();
    expect(await controller.requestClose(async () => true)).toBe(false);
    expect(controller.error.value).toContain('保存结果尚未确认');
  });

  it('keeps the saved baseline clean when a controlled response changes only object key order', async () => {
    const value = paperFixture();
    value.paper_layout = { schema_version: 1, settings: { templateName: '试卷 100', pageSize: 'A4', pageOrientation: 1,
      pageSizeReduce: { top: 15, bottom: 15, left: 15, right: 15 } } };
    const controller = createPaperDesignerController({ value, saveDraft: async (next) => ({ status: 'saved', value: next }) });
    const ordered = copy(value); ordered.paper_layout!.settings = { pageOrientation: 1, pageSize: 'A4', templateName: '试卷 100',
      pageSizeReduce: { left: 15, right: 15, top: 15, bottom: 15 } };
    expect(controller.change(ordered)).toBe(true);
    expect(controller.dirty.value).toBe(false);
  });
});
