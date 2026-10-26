import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import PaperDesigner from '../PaperDesigner.vue';
import QuestionDocumentEditor from '../QuestionDocumentEditor.vue';
import TemplateSetting from '../../Tiptap/components/TemplateSetting.vue';
import { TemplateSetting as TemplateSettingModel } from '../../Tiptap/type';
import { paperFixture, blankPaper, copy } from './paper-designer-fixtures';
import { toAuthoringBundle } from '../paper-designer-state';
import type { PaperDesignerValue } from '../contracts';

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
async function show(value = paperFixture(), extra: Record<string, unknown> = {}) {
  const wrapper = mount(PaperDesigner, { props: { modelValue: value, categories: [{ id: '10', name: '安全培训' }],
    saveDraft: async (next) => ({ status: 'saved', value: next }), ...extra }, global: { plugins: [ElementPlus] } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
function latest(wrapper: VueWrapper) { return wrapper.emitted('update:modelValue')!.at(-1)![0] as PaperDesignerValue; }
function button(wrapper: VueWrapper, text: string) { return wrapper.findAll('button').find((entry) => entry.text() === text)!; }

describe('main complete paper kernel', () => {
  it('makes paper margins dirty and restores them after save and reopening', async () => {
    const wrapper = await show();
    await wrapper.get('[role="tab"][id$="-template"]').trigger('click');
    const margin = wrapper.get('.template-setting input[aria-label="上边距"]');
    await margin.setValue('23'); await flushPromises();
    expect(latest(wrapper).paper_layout?.settings.pageSizeReduce.top).toBe(23);
    expect(wrapper.get('[role="status"]').text()).toBe('未保存');
    await button(wrapper, '保存').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('已保存');
    const reopened = await show(copy(latest(wrapper)));
    expect((reopened.get('.designer-sheet').element as HTMLElement).style.paddingTop).toBe('23mm');
  });

  it('keeps the same main Tiptap instance for a 100-question paper and blocks a 101st', async () => {
    const value = paperFixture(); value.document.content.content = []; value.document.questions = {}; value.bindings = {};
    for (let index = 0; index < 100; index += 1) {
      const part = paperFixture('100', '10', `question_${index}`);
      value.document.content.content!.push(part.document.content.content![0]!);
      value.document.questions[`question_${index}`] = { ...part.document.questions[`question_${index}`]!, concept_id: null, score_cents: 100 };
      value.bindings[`question_${index}`] = { kind: 'new' };
    }
    const wrapper = await show(value);
    const editor = wrapper.findComponent(QuestionDocumentEditor).vm.getEditor()!;
    expect(wrapper.findAll('.paper-designer__canvas .ProseMirror')).toHaveLength(1);
    expect(wrapper.findAll('.paper-designer__canvas [data-question-block]')).toHaveLength(100);
    wrapper.vm.addQuestion('single'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('最多 100 题');
    expect(wrapper.findComponent(QuestionDocumentEditor).vm.getEditor()).toBe(editor);
    expect(editor.state.doc.childCount).toBe(100);
  });

  it('retries a failed image upload at its original cursor while retaining pending leave protection', async () => {
    let attempts = 0;
    const wrapper = await show(paperFixture(), { mediaAdapter: { upload: async () => { attempts += 1; if (attempts === 1) throw new Error('上传失败'); return { asset_id: '88' }; } } });
    const editor = wrapper.findComponent(QuestionDocumentEditor).vm.getEditor()!;
    editor.commands.setTextSelection(3);
    await button(wrapper, '插入图片').trigger('click');
    const input = wrapper.get('input[aria-label="选择题目图片"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['x'], 'image.png', { type: 'image/png' })] });
    await input.trigger('change'); await flushPromises();
    expect(wrapper.text()).toContain('图片上传失败，可在原位置重试');
    expect(wrapper.emitted('dirty-change')!.at(-1)).toEqual([true]);
    await button(wrapper, '重试上传').trigger('click'); await flushPromises();
    expect(latest(wrapper).document.content.content![0]!.content![0]!.content![0]!.content![0]).toMatchObject({ type: 'mediaImage', attrs: { asset_id: '88' } });
    expect(wrapper.text()).not.toContain('可在原位置重试');
  });

  it('switches question type without retaining legacy concept metadata', async () => {
    const wrapper = await show();
    wrapper.findComponent({ name: 'QuestionProperties' }).vm.$emit('type-change', 'multiple'); await flushPromises();
    expect(latest(wrapper).document.questions.question_one).toMatchObject({ type: 'multiple' });
    expect(latest(wrapper).document.questions.question_one).not.toHaveProperty('concept_id');
    expect(wrapper.text()).not.toContain('重新选择考点');
  });

  it('offers an analysis image action and keeps a failed image retryable', async () => {
    let calls = 0;
    const wrapper = await show(paperFixture(), { mediaAdapter: { upload: async () => { calls += 1; if (calls === 1) throw new Error('解析上传暂不可用'); return { asset_id: '89' }; } } });
    await button(wrapper, '插入解析图片').trigger('click');
    const input = wrapper.get('input[aria-label="解析图片"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['x'], 'analysis.png', { type: 'image/png' })] });
    await input.trigger('change'); await flushPromises();
    expect(wrapper.text()).toContain('解析上传暂不可用');
    await button(wrapper, '重试解析图片').trigger('click'); await flushPromises();
    expect(latest(wrapper).document.questions.question_one!.analysis.content![0]!.content![0]).toMatchObject({ type: 'mediaImage', attrs: { asset_id: '89' } });
    expect(wrapper.text()).not.toContain('解析上传暂不可用');
  });

  it('blocks formatting shortcuts and a queued layout change after switching to readonly', async () => {
    const wrapper = await show();
    await wrapper.get('[role="tab"][id$="-template"]').trigger('click'); await flushPromises();
    await wrapper.setProps({ mode: 'readonly' }); await flushPromises();
    const editor = wrapper.findComponent(QuestionDocumentEditor).vm.getEditor()!;
    const original = editor.getJSON();
    editor.commands.setTextSelection({ from: 3, to: 5 });
    for (const key of ['b', 'z', 'y']) editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
    editor.commands.toggleBold();
    wrapper.findComponent(TemplateSetting).vm.$emit('update:modelValue', new TemplateSettingModel({ pageSizeReduce: { top: 77 } }));
    await flushPromises();
    expect(editor.getJSON()).toEqual(original);
    expect((wrapper.get('.designer-sheet').element as HTMLElement).style.paddingTop).toBe('15mm');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('retains stable A/B mappings when library insertion generates new local option IDs', async () => {
    const source = paperFixture();
    const session = { option_ids: { question_one: { question_one_a: 'A', question_one_b: 'B' } },
      identities: { question_one: { question_id: '40', expected_version_id: '50', expected_enabled: true } }, layouts: {} };
    const wrapper = await show(blankPaper(), { questionLibrarySource: {
      list: async () => ({ items: [{ id: '40', stem: '库中短ID题目', type: 'single', difficulty: 'easy', category_id: '10' }], total: 1, page: 1, page_size: 20 }),
      get: async () => ({ document: source.document, binding: source.bindings.question_one, session }),
    } });
    await button(wrapper, '加入试卷').trigger('click'); await flushPromises();
    const result = latest(wrapper);
    const id = Object.keys(result.document.questions)[0]!;
    expect(result.session).toBeDefined();
    const bundle = toAuthoringBundle(result.document, result.session!);
    expect(Object.values(bundle.option_ids[id]!)).toEqual(['A', 'B']);
    expect(bundle.identities).toEqual({});
    expect(result.bindings[id]).toMatchObject({ kind: 'bound', question_version_id: '50' });
  });
});
