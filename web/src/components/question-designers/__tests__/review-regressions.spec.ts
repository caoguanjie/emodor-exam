import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { EditorContent, type Editor } from '@tiptap/vue-3';
import ElementPlus from 'element-plus';
import PaperDesigner from '../PaperDesigner.vue';
import QuestionProperties from '../QuestionProperties.vue';
import QuestionDocumentEditor from '../QuestionDocumentEditor.vue';
import TemplateSetting from '../../Tiptap/components/TemplateSetting.vue';
import type { DesignerMediaAdapter, PaperDesignerValue, PaperLibrarySource } from '../contracts';
import { copy, deferred, paperFixture } from './paper-designer-fixtures';

const wrappers: VueWrapper[] = [];
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeAll(() => {
  // jsdom has no layout engine; ProseMirror focus still needs the browser geometry API.
  if (!rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  if (!rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterAll(() => {
  if (!rangeRects) Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (!rangeBounds) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); window.getSelection()?.removeAllRanges(); document.body.innerHTML = ''; });
async function show(value = paperFixture(), extra: { mediaAdapter?: DesignerMediaAdapter; paperLibrarySource?: PaperLibrarySource } = {}) {
  const wrapper = mount(PaperDesigner, { attachTo: document.body, props: { modelValue: value,
    categories: [{ id: '10', name: '安全培训' }], saveDraft: async (next) => ({ status: 'saved', value: next }), ...extra },
  global: { plugins: [ElementPlus] } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
function button(text: string) { return new DOMWrapper(document.body).findAll('button,[role="tab"]').find((entry) => (entry.text() === text || entry.attributes('aria-label') === text) && entry.isVisible())!; }
function latest(wrapper: VueWrapper) { return wrapper.emitted('update:modelValue')!.at(-1)![0] as PaperDesignerValue; }
function analysisEditor(wrapper: VueWrapper) { return wrapper.findComponent(QuestionProperties).findComponent(EditorContent).props('editor') as Editor; }
async function chooseAnalysis(wrapper: VueWrapper) {
  await button('插入解析图片').trigger('click');
  const input = wrapper.get('input[aria-label="解析图片"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['x'], 'analysis.png', { type: 'image/png' })] });
  await input.trigger('change'); await flushPromises();
}
function customLayout() {
  const value = paperFixture();
  value.paper_layout = { schema_version: 1, settings: { templateName: value.paper.title, pageSize: 'A5', pageOrientation: 2,
    pageSizeReduce: { top: 42, bottom: 42, left: 42, right: 42 } } };
  return value;
}
function expectDefaultSheet(wrapper: VueWrapper, title: string) {
  const style = (wrapper.get('.designer-sheet').element as HTMLElement).style;
  expect(style.width).toBe('210mm'); expect(style.minHeight).toBe('297mm');
  for (const side of ['Top', 'Bottom', 'Left', 'Right'] as const) expect(style[`padding${side}`]).toBe('15mm');
  expect(wrapper.findComponent(TemplateSetting).props('modelValue')).toMatchObject({ templateName: title, pageSize: 'A4', pageOrientation: 1 });
}

describe('reviewed paper designer regressions', () => {
  it('uses the compact analysis toolbar without submitting the properties form', async () => {
    const wrapper = await show();
    const form = wrapper.get('form.question-properties').element;
    (form as HTMLFormElement).noValidate = true;
    let submissions = 0;
    form.addEventListener('submit', (event) => { submissions += 1; event.preventDefault(); });
    const toolbar = wrapper.get('[aria-label="解析格式"]');
    const bold = toolbar.get('[aria-label="解析加粗"]');
    expect((bold.element as HTMLButtonElement).form).toBe(form);
    (bold.element as HTMLButtonElement).click(); await flushPromises();
    expect(submissions).toBe(0);
    expect(toolbar.findAll('button').every((entry) => (entry.element as HTMLButtonElement).type === 'button')).toBe(true);
    expect(wrapper.find('.question-properties__rich .menu-btn-groups').exists()).toBe(false);
  });

  it('prevents an implicit native submit from navigating away from question properties', async () => {
    const wrapper = await show();
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    expect(wrapper.get('form.question-properties').element.dispatchEvent(submit)).toBe(false);
    expect(submit.defaultPrevented).toBe(true);
  });

  it('retains failed analysis uploads in dirty, save and close protection until explicit cancellation', async () => {
    const wrapper = await show(paperFixture(), { mediaAdapter: { upload: async () => { throw new Error('解析图片失败'); } } });
    await chooseAnalysis(wrapper);
    expect(wrapper.text()).toContain('解析图片失败');
    expect(wrapper.emitted('dirty-change')!.at(-1)).toEqual([true]);
    expect((button('保存').element as HTMLButtonElement).disabled).toBe(true);
    const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await button('关闭').trigger('click'); await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(document.body.textContent).toContain('图片尚未上传完成');
    await button('取消').trigger('click'); await flushPromises();
    await button('取消待上传').trigger('click'); await flushPromises();
    expect(wrapper.emitted('dirty-change')!.at(-1)).toEqual([false]);
    expect((button('保存').element as HTMLButtonElement).disabled).toBe(false);
    const cleanLeaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(cleanLeaving);
    expect(cleanLeaving.defaultPrevented).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('maps an analysis image cursor through concurrent edits instead of appending to the last paragraph', async () => {
    const value = paperFixture();
    value.document.questions.question_one!.analysis = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '甲乙丙' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '末段' }] },
    ] };
    const upload = deferred<{ asset_id: string }>();
    const wrapper = await show(value, { mediaAdapter: { upload: () => upload.promise } });
    const editor = analysisEditor(wrapper); editor.commands.setTextSelection(2);
    await chooseAnalysis(wrapper);
    editor.commands.insertContentAt(1, '前'); await flushPromises();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    upload.resolve({ asset_id: '89' }); await flushPromises();
    const paragraphs = latest(wrapper).document.questions.question_one!.analysis.content!;
    expect(paragraphs[0]!.content!.map((node) => node.type === 'mediaImage' ? node.attrs!.asset_id : node.text)).toEqual(['前甲', '89', '乙丙']);
    expect(paragraphs[1]!.content).toEqual([{ type: 'text', text: '末段' }]);
    expect((button('保存').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps a pending analysis upload when visiting paper settings and completes it on return', async () => {
    const upload = deferred<{ asset_id: string }>();
    const wrapper = await show(paperFixture(), { mediaAdapter: { upload: () => upload.promise } });
    await chooseAnalysis(wrapper);
    await button('试卷设置').trigger('click'); await flushPromises();
    expect((button('保存').element as HTMLButtonElement).disabled).toBe(true);
    upload.resolve({ asset_id: '91' }); await flushPromises();
    await button('题目属性').trigger('click'); await flushPromises();
    expect(latest(wrapper).document.questions.question_one!.analysis.content![0]!.content![0]).toMatchObject({ type: 'mediaImage', attrs: { asset_id: '91' } });
  });

  it('invalidates an old analysis upload when selecting another question without inserting into either question', async () => {
    const value = paperFixture(); const other = paperFixture('100', '10', 'question_two');
    value.document.content.content!.push(other.document.content.content![0]!);
    Object.assign(value.document.questions, other.document.questions); Object.assign(value.bindings, other.bindings);
    const upload = deferred<{ asset_id: string }>();
    const wrapper = await show(value, { mediaAdapter: { upload: () => upload.promise } });
    await chooseAnalysis(wrapper);
    const editor = wrapper.findComponent(QuestionDocumentEditor).vm.getEditor()!;
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 3); await flushPromises();
    expect(wrapper.findComponent(QuestionProperties).props('clientId')).toBe('question_two');
    upload.resolve({ asset_id: '90' }); await flushPromises();
    expect(analysisEditor(wrapper).getJSON()).not.toHaveProperty('content.0.content.0.attrs.asset_id');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('dirty-change')!.at(-1)).toEqual([false]);
    expect((button('保存').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('resets a controlled custom layout to legacy defaults without writing back or marking dirty', async () => {
    const wrapper = await show(customLayout());
    const legacy = paperFixture('200');
    await wrapper.setProps({ modelValue: legacy }); await flushPromises();
    await button('模板设置').trigger('click'); await flushPromises();
    expectDefaultSheet(wrapper, '试卷 200');
    expect(wrapper.get('.paper-designer__status').text()).toBe('已保存');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('dirty-change')!.at(-1)).toEqual([false]);
  });

  it('resets custom layout on a real whole-paper replacement with a legacy paper', async () => {
    const source = paperFixture('200', '10', 'library_question');
    const wrapper = await show(customLayout(), { paperLibrarySource: {
      list: async () => ({ items: [{ id: '200', title: source.paper.title, category_id: '10', question_count: 1 }], total: 1, page: 1, page_size: 20 }),
      get: async () => copy(source),
    } });
    await button('试卷库').trigger('click'); await flushPromises();
    await button('使用整卷').trigger('click'); await flushPromises();
    await button('整卷替换').trigger('click'); await flushPromises();
    await button('模板设置').trigger('click'); await flushPromises();
    expectDefaultSheet(wrapper, '试卷 200');
    expect(latest(wrapper).paper_layout).toBeUndefined();
    expect(wrapper.get('.paper-designer__status').text()).toBe('未保存');
  });
});
