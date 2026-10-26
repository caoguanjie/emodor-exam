import { EditorContent } from '@tiptap/vue-3';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElSelect } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuestionDraftPayload } from '../../api/training-types';
import ManualQuestionEditor from '../ManualQuestionEditor.vue';
import TiptapEditor from '../Tiptap/index.vue';
import { uploadMedia } from '../../api/media';

vi.mock('../../api/media', () => ({ uploadMedia: vi.fn(), getMediaImageContent: vi.fn(async () => new Blob(['image'], { type: 'image/png' })) }));
const wrappers: VueWrapper[] = [];
const doc = (text: string): any => ({ type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] });
function draft(): QuestionDraftPayload {
  return { category_id: '10', difficulty: 'easy', type: 'single', stem: 'stale HTML', options: [], answer: [], analysis: null,
    content_schema_version: 3, content_json: { stem: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '题干', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '42' } }] },
    ] }, options: [{ id: 'option_a', content: doc('甲乙') }, { id: 'option_b', content: doc('丙丁') }, { id: 'option_c', content: doc('戊己') }],
    answer_option_ids: ['option_b'], analysis: null } };
}
async function show(value = draft(), extra: Record<string, unknown> = {}, attachTo?: Element) {
  const wrapper = mount(ManualQuestionEditor, { attachTo, props: { modelValue: value, categories: [{ id: '10', name: '安全培训' }],
    difficultyOptions: [{ value: 'easy', label: '简单' }, { value: 'hard', label: '困难' }], ...extra }, global: { plugins: [ElementPlus] } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
function latest(wrapper: VueWrapper) { return wrapper.emitted('update:modelValue')!.at(-1)![0] as QuestionDraftPayload; }
function button(wrapper: VueWrapper, label: string) { return wrapper.findAll('button').find((node) => node.attributes('aria-label') === label || node.text() === label)!; }
async function chooseType(wrapper: VueWrapper, type: string) { wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', type); await flushPromises(); }
async function chooseImage(wrapper: VueWrapper, label = '插入题目图片') {
  await button(wrapper, label).trigger('click');
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['x'], 'test.png', { type: 'image/png' })] });
  await input.trigger('change'); await flushPromises();
}
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.clearAllMocks(); });

describe('manual question Tiptap editor', () => {
  it('provides a canonical clone of untouched legacy rich content for saving without dirty hydration', async () => {
    const legacy: QuestionDraftPayload = { category_id: '10', difficulty: 'easy', type: 'single',
      stem: '<p><strong>旧题加粗</strong><em>旧题斜体</em></p>',
      options: [{ key: 'old_a', text: '<p><u>选项甲</u></p>' }, { key: 'old_b', text: '<p>选项乙</p>' }], answer: [1], analysis: '<p><em>旧解析</em></p>' };
    const wrapper = await show(legacy);
    expect(typeof wrapper.vm.getDraft).toBe('function');
    const value = wrapper.vm.getDraft();
    expect(value.content_schema_version).toBe(3);
    expect(value.content_json!.stem.content[0]).toMatchObject({ content: [
      { type: 'text', text: '旧题加粗', marks: [{ type: 'bold' }] },
      { type: 'text', text: '旧题斜体', marks: [{ type: 'italic' }] },
    ] });
    expect(value.options[0]!.text).toBe('<p><u>选项甲</u></p>');
    expect(value.content_json!.answer_option_ids).toEqual(['old_b']); expect(value.analysis).toBe('<p><em>旧解析</em></p>');
    (value.content_json!.stem.content[0] as any).content[0].text = '调用方临时修改';
    expect(wrapper.vm.getDraft().stem).toContain('旧题加粗');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('uncommitted-change')).toBeUndefined();
    expect(wrapper.emitted('error')?.at(-1)).toEqual(['']);
  });

  it.each(['question', 'analysis'] as const)('protects a first rejected %s edit until undo restores a valid draft', async (target) => {
    const wrapper = await show(); const core = target === 'question' ? wrapper.vm.getEditor()! : wrapper.vm.getAnalysisEditor()!;
    if (target === 'question') {
      core.commands.setTextSelection({ from: 3, to: 5 }); core.commands.setLink({ href: 'https://example.com' });
    } else core.commands.insertContent('<p><a href="https://example.com">保留被拒解析</a></p>');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('uncommitted-change')?.at(-1)).toEqual([true]);
    expect(JSON.stringify(core.getJSON())).toContain('https://example.com');
    expect(() => wrapper.vm.getDraft()).toThrow();
    expect(core.commands.undo()).toBe(true); await flushPromises();
    expect(wrapper.emitted('uncommitted-change')?.at(-1)).toEqual([false]);
    expect(wrapper.vm.validate()).toBe(''); expect(wrapper.vm.getDraft().content_schema_version).toBe(3);
    expect(wrapper.emitted('error')?.at(-1)).toEqual(['']);
  });

  it('sets the correct answer from a manual letter while keeping stable option identity', async () => {
    const wrapper = await show();
    expect(wrapper.text()).toContain('点击选项字母或右侧“设为答案”修改正确答案');
    const optionLetter = wrapper.get('[data-option-id="option_a"] [data-option-letter]');
    expect(optionLetter.element.tagName).toBe('BUTTON');
    expect(getComputedStyle(optionLetter.element).display).toBe('inline-flex');
    expect(getComputedStyle(optionLetter.element).alignItems).toBe('center');
    expect(getComputedStyle(optionLetter.element).justifyContent).toBe('center');
    expect(wrapper.get('[data-option-id="option_b"] [data-answer-label]').text()).toBe('✓ 正确答案');
    expect(wrapper.find('[data-option-id="option_a"] [data-answer-label]').exists()).toBe(false);
    await button(wrapper, '上移选项 B').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-option-id="option_b"] [data-answer-label]').text()).toBe('✓ 正确答案');
    await wrapper.get('[data-option-id="option_a"] .question-option__toggle').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-option-id="option_a"] [data-answer-label]').text()).toBe('✓ 正确答案');
    expect(wrapper.find('[data-option-id="option_b"] [data-answer-label]').exists()).toBe(false);
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_a']);
    const ordinary = mount(TiptapEditor, { props: { modelValue: wrapper.vm.getEditor()!.getJSON(), showPanels: false, showToolbar: false,
      displayMeta: { manual_question: { type: 'single' } } }, global: { plugins: [ElementPlus] } });
    wrappers.push(ordinary); await flushPromises();
    expect(ordinary.find('[data-answer-label]').exists()).toBe(false);
    expect(ordinary.find('[data-set-answer]').exists()).toBe(false);
    expect(ordinary.get('.question-option__remove').text()).toBe('删除');
  });

  it('changes a single answer from either the letter or explicit right action and deletes by stable identity with a two-option floor', async () => {
    const wrapper = await show();
    await wrapper.get('[data-option-id="option_c"] [data-set-answer]').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_c']);
    expect(wrapper.get('[data-option-id="option_c"] [data-answer-label]').text()).toBe('✓ 正确答案');
    expect(wrapper.find('[data-option-id="option_c"] [data-set-answer]').exists()).toBe(false);
    await wrapper.get('[data-option-id="option_b"] .question-option__toggle').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_b']);
    expect(wrapper.get('[data-option-id="option_b"] [data-answer-label]').text()).toBe('✓ 正确答案');
    expect(wrapper.get('[data-option-id="option_c"] [data-set-answer]').text()).toBe('设为答案');
    await wrapper.get('[data-option-id="option_c"] [data-set-answer]').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_c']);
    expect(wrapper.get('[data-option-id="option_c"] [data-answer-label]').text()).toBe('✓ 正确答案');
    await button(wrapper, '上移选项 B').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-option-id="option_b"] .question-option__remove').text()).toBe('×');
    expect(wrapper.get('[data-option-id="option_b"] .question-option__remove').attributes('aria-label')).toBe('删除选项 A');
    await wrapper.get('[data-option-id="option_a"] .question-option__remove').trigger('click'); await flushPromises();
    expect(latest(wrapper).options.map((option) => option.key)).toEqual(['option_b', 'option_c']);
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_c']);
    expect(latest(wrapper).answer).toEqual([1]);
    expect(wrapper.find('.question-option__remove').exists()).toBe(false);
    const before = wrapper.vm.getEditor()!.getJSON();
    expect(wrapper.vm.getEditor()!.commands.removeQuestionOption('option_c')).toBe(false);
    expect(wrapper.vm.getEditor()!.getJSON()).toEqual(before);
  });

  it('adds and removes multiple answers from letters and explicit right-side actions', async () => {
    const value = draft(); value.type = 'multiple'; const wrapper = await show(value);
    await wrapper.get('[data-option-id="option_a"] [data-set-answer]').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_a', 'option_b']);
    expect(wrapper.findAll('[data-answer-label]')).toHaveLength(2);
    await wrapper.get('[data-option-id="option_b"] .question-option__toggle').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_a']);
    expect(wrapper.get('[data-option-id="option_b"] [data-set-answer]').text()).toBe('设为答案');
    await wrapper.get('[data-option-id="option_b"] [data-set-answer]').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_a', 'option_b']);
    await wrapper.get('[data-option-id="option_b"] [data-unset-answer]').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_a']);
    expect(wrapper.get('[data-option-id="option_b"] [data-set-answer]').text()).toBe('设为答案');
    await wrapper.get('[data-option-id="option_a"] .question-option__remove').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual([]);
    expect(latest(wrapper).options.map((option) => option.key)).toEqual(['option_b', 'option_c']);
  });

  it('updates difficulty from its radio control without a legacy combobox selector', async () => {
    const wrapper = await show();
    await wrapper.get('[role="radiogroup"][aria-label="难度"] input[value="hard"]').setValue(true); await flushPromises();
    expect(latest(wrapper).difficulty).toBe('hard');
    expect(wrapper.find('[role="combobox"][aria-label="难度"]').exists()).toBe(false);
  });

  it('hydrates one question block without dirty emissions and keeps untouched schema3 fields exact on answer edits', async () => {
    const value = draft(); const wrapper = await show(value);
    expect(wrapper.findAll('[data-question-block]')).toHaveLength(1);
    expect(wrapper.findAll('.ProseMirror')).toHaveLength(2);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.text()).not.toMatch(/分值|考点|资料来源/);
    expect(wrapper.find('details').element.open).toBe(false);
    const core = wrapper.vm.getEditor()!;
    expect(core).toBe(wrapper.findAllComponents(EditorContent)[0]!.props('editor'));
    expect(core.commands.setQuestionOptionChecked('option_a', true)).toBe(true); await flushPromises();
    const next = latest(wrapper);
    expect(next.content_schema_version).toBe(3);
    expect(next.content_json).toEqual({ ...value.content_json, answer_option_ids: ['option_a'] });
    expect(next.answer).toEqual([0]); expect(next.stem).toContain('<strong>题干</strong>');
    expect(next.options.map((option) => option.key)).toEqual(['option_a', 'option_b', 'option_c']);
    expect(next).not.toHaveProperty('score'); expect(next).not.toHaveProperty('score_cents'); expect(next).not.toHaveProperty('concept_id');
    expect(next).not.toHaveProperty('source');
    await wrapper.setProps({ modelValue: next }); await flushPromises();
    const count = wrapper.emitted('update:modelValue')!.length;
    await wrapper.setProps({ modelValue: { ...next, category_id: '20' } }); await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toHaveLength(count);
  });

  it('adds a blank option and focuses its caret so typing needs no removal of sample text', async () => {
    const wrapper = await show(draft(), {}, document.body);
    const core = wrapper.vm.getEditor()!;
    // jsdom has no text layout; exercise real focus without measuring scroll geometry.
    core.view.setProps({ handleScrollToSelection: () => true });
    const add = button(wrapper, '添加选项');
    (add.element as HTMLButtonElement).focus();
    await add.trigger('click'); await flushPromises();
    const added = core.state.doc.firstChild!.lastChild!;
    expect.soft(added.textContent).toBe('');
    expect(core.state.selection.$from.node(-1).attrs.option_id).toBe(added.attrs.option_id);
    await vi.waitFor(() => expect(document.activeElement === core.view.dom).toBe(true));
    core.commands.insertContent('新输入的内容'); await flushPromises();
    expect(core.state.doc.firstChild!.lastChild!.textContent).toBe('新输入的内容');
    expect(latest(wrapper).options[3]!.text).toBe('<p>新输入的内容</p>');
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_b']);
  });

  it('supports option buttons, keyboard sorting and dragging while answers follow stable identities', async () => {
    const wrapper = await show();
    await button(wrapper, '上移选项 B').trigger('click'); await flushPromises();
    expect(latest(wrapper).options.map((option) => option.key)).toEqual(['option_b', 'option_a', 'option_c']);
    expect(latest(wrapper).answer).toEqual([0]);
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_b']);
    const transfer = { data: '', setData(_type: string, value: string) { this.data = value; }, getData() { return this.data; }, effectAllowed: '' };
    await wrapper.get('[data-option-id="option_b"] [data-option-drag-handle]').trigger('dragstart', { dataTransfer: transfer });
    await wrapper.get('[data-option-id="option_c"]').trigger('drop', { dataTransfer: transfer }); await flushPromises();
    expect(latest(wrapper).options.map((option) => option.key)).toEqual(['option_a', 'option_c', 'option_b']);
    expect(latest(wrapper).answer).toEqual([2]);
    await button(wrapper, '添加选项').trigger('click'); await flushPromises();
    const added = latest(wrapper).options[3]!.key;
    expect(added).not.toBe('option_c'); expect(added).not.toBe('D');
    await button(wrapper, '删除选项 A').trigger('click'); await flushPromises();
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_b']);
    expect(latest(wrapper).answer).toEqual([1]);
  });

  it('retains multiple answers until resolved and confirms destructive judgment conversion preserving the stem', async () => {
    const value = draft(); value.type = 'multiple'; value.content_json!.answer_option_ids = ['option_a', 'option_b'];
    const wrapper = await show(value);
    await chooseType(wrapper, 'single');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined(); expect(wrapper.text()).toContain('多个正确答案');
    await chooseType(wrapper, 'judgment'); expect(wrapper.get('[role="alertdialog"]').text()).toContain('替换现有选项');
    await button(wrapper, '取消转换').trigger('click'); expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await chooseType(wrapper, 'judgment'); await button(wrapper, '确认转换').trigger('click'); await flushPromises();
    const next = latest(wrapper); expect(next.type).toBe('judgment'); expect(next.content_json!.stem).toEqual(value.content_json!.stem);
    expect(next.options.map((option) => option.text)).toEqual(['<p>正确</p>', '<p>错误</p>']);
    expect(next.answer).toEqual([]); expect(button(wrapper, '添加选项')).toBeUndefined();
    expect(wrapper.find('[data-option-drag-handle]').exists()).toBe(false);
    await wrapper.get('[data-question-option] .question-option__toggle').trigger('click'); await flushPromises();
    expect(latest(wrapper).answer).toEqual([0]);
    await wrapper.findAll('[data-question-option]')[1]!.get('[data-set-answer]').trigger('click'); await flushPromises();
    expect(latest(wrapper).answer).toEqual([1]);
    const core = wrapper.vm.getEditor()!; const before = core.getJSON();
    const optionPosition: number[] = []; core.state.doc.descendants((node: any, pos: number) => { if (node.type.name === 'questionOption') optionPosition.push(pos + 2); });
    core.commands.insertContentAt(optionPosition[0]!, '不能修改'); expect(core.getJSON()).toEqual(before);
  });

  it('edits real rich text in stem, option and analysis, and keeps a chosen collapsed state across ordinary changes', async () => {
    const wrapper = await show(); const core = wrapper.vm.getEditor()!;
    core.commands.setTextSelection({ from: 3, to: 5 });
    await button(wrapper, '斜体').trigger('click'); await flushPromises();
    expect((latest(wrapper).content_json!.stem.content[0] as any).content[0].marks).toContainEqual({ type: 'italic' });
    expect(latest(wrapper).stem).toContain('<em>');
    const positions: number[] = []; core.state.doc.descendants((node: any, pos: number) => { if (node.type.name === 'questionOption') positions.push(pos + 2); });
    core.commands.setTextSelection({ from: positions[0], to: positions[0]! + 2 });
    await button(wrapper, '下划线').trigger('click'); await flushPromises();
    expect(latest(wrapper).options[0]!.text).toContain('<u>甲乙</u>');
    const details = wrapper.get('details'); details.element.open = true; await details.trigger('toggle');
    const analysis = wrapper.vm.getAnalysisEditor()!; analysis.commands.setTextSelection(1); analysis.commands.insertContent('解析文本'); await flushPromises();
    expect(latest(wrapper).analysis).toContain('解析文本');
    details.element.open = false; await details.trigger('toggle');
    core.commands.setQuestionOptionChecked('option_c', true); await flushPromises();
    expect(details.element.open).toBe(false);
    const reopened = await show(latest(wrapper)); expect(reopened.get('details').element.open).toBe(true);
  });

  it('keeps failed uploads pending for retry and inserts at the original mapped option position', async () => {
    vi.mocked(uploadMedia).mockRejectedValueOnce(new Error('网络失败')).mockResolvedValueOnce({ asset_id: '88', status: 'ready', duration_ms: null });
    const wrapper = await show(draft(), { canUploadMedia: true }); const core = wrapper.vm.getEditor()!;
    let position = 0; core.state.doc.descendants((node: any, pos: number) => { if (node.attrs.option_id === 'option_a') position = pos + 3; });
    core.commands.setTextSelection(position); await chooseImage(wrapper);
    expect(wrapper.emitted('upload-state-change')!.at(-1)).toEqual([{ pending: true }]);
    core.commands.setTextSelection(3); core.commands.insertContent('新'); await flushPromises();
    await button(wrapper, '重试上传').trigger('click'); await flushPromises();
    expect((latest(wrapper).content_json!.options[0]!.content.content[0] as any).content).toEqual([
      { type: 'text', text: '甲' }, { type: 'image', attrs: { asset_id: '88' } }, { type: 'text', text: '乙' },
    ]);
    expect(wrapper.emitted('upload-state-change')!.at(-1)).toEqual([{ pending: false }]);
    expect(JSON.stringify(latest(wrapper))).not.toMatch(/blob:|uploadToken|test.png/);
  });

  it('ignores late image results after external hydration or unmount', async () => {
    let resolve!: (value: any) => void; vi.mocked(uploadMedia).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const wrapper = await show(draft(), { canUploadMedia: true }); wrapper.vm.getEditor()!.commands.setTextSelection(3);
    await chooseImage(wrapper); const replacement = draft(); replacement.content_json!.stem = doc('另一题');
    await wrapper.setProps({ modelValue: replacement }); await flushPromises(); resolve({ asset_id: '89', status: 'ready', duration_ms: null }); await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined(); expect(wrapper.text()).toContain('另一题');
    await chooseImage(wrapper); const count = wrapper.emitted('update:modelValue')?.length ?? 0;
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1);
    resolve({ asset_id: '90', status: 'ready', duration_ms: null }); await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.length ?? 0).toBe(count);
  });

  it('blocks unsupported schema3 without emitting a lossy draft and respects disabled media permissions', async () => {
    const value = draft(); (value.content_json!.stem.content as any[]).push({ type: 'unknownWidget', attrs: { value: '保留' } });
    const invalid = await show(value); expect(invalid.text()).toContain('无法'); expect(invalid.emitted('error')?.length).toBeGreaterThan(0);
    expect(invalid.emitted('update:modelValue')).toBeUndefined();
    const wrapper = await show(draft(), { disabled: true, canUploadMedia: true });
    const before = wrapper.vm.getEditor()!.getJSON(); wrapper.vm.getEditor()!.commands.setQuestionOptionChecked('option_a', true);
    expect(wrapper.vm.getEditor()!.getJSON()).toEqual(before); expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(button(wrapper, '插入题目图片')).toBeUndefined();
  });

  it('keeps an unsupported stem edit blocked when analysis or metadata changes, until the stem itself is repaired', async () => {
    const wrapper = await show(); const core = wrapper.vm.getEditor()!;
    core.commands.setTextSelection({ from: 3, to: 5 }); core.commands.setLink({ href: 'https://example.com' }); await flushPromises();
    expect(wrapper.vm.validate()).not.toBe('');
    wrapper.vm.getAnalysisEditor()!.commands.insertContent('有效解析'); await flushPromises();
    expect(wrapper.vm.validate()).not.toBe('');
    expect(wrapper.emitted('uncommitted-change')?.at(-1)).toEqual([true]);
    expect(wrapper.emitted('error')?.at(-1)?.[0]).not.toBe('');
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', '10'); await flushPromises();
    expect(wrapper.vm.validate()).not.toBe('');
    core.commands.setTextSelection({ from: 3, to: 5 }); core.commands.unsetLink(); await flushPromises();
    expect(wrapper.vm.validate()).toBe(''); expect(latest(wrapper).analysis).toContain('有效解析');
    expect(wrapper.emitted('error')?.at(-1)).toEqual(['']);
  });

  it('anchors an analysis upload while typing and retains an option anchor through option sorting', async () => {
    let resolve!: (value: any) => void; vi.mocked(uploadMedia).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const wrapper = await show(draft(), { canUploadMedia: true });
    const details = wrapper.get('details'); details.element.open = true; await details.trigger('toggle');
    const analysis = wrapper.vm.getAnalysisEditor()!; analysis.commands.insertContent('甲乙'); analysis.commands.setTextSelection(2);
    await chooseImage(wrapper, '插入解析图片'); analysis.commands.setTextSelection(1); analysis.commands.insertContent('新'); await flushPromises();
    resolve({ asset_id: '91', status: 'ready', duration_ms: null }); await flushPromises();
    expect(latest(wrapper).analysis).toBe('<p>新甲<img data-media-id="91">乙</p>');
    const core = wrapper.vm.getEditor()!; let position = 0;
    core.state.doc.descendants((node: any, pos: number) => { if (node.attrs.option_id === 'option_a') position = pos + 3; });
    core.commands.setTextSelection(position); await chooseImage(wrapper);
    await button(wrapper, '下移选项 A').trigger('click'); await flushPromises();
    resolve({ asset_id: '92', status: 'ready', duration_ms: null }); await flushPromises();
    expect(latest(wrapper).options[1]).toEqual({ key: 'option_a', text: '<p>甲<img data-media-id="92">乙</p>' });
    expect(latest(wrapper).content_json!.answer_option_ids).toEqual(['option_b']);
  });
});
