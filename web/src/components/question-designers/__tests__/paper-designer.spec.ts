import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, DOMWrapper, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElSelect, ElSwitch } from 'element-plus';
import type { QuestionRegulationOption } from '../../Tiptap/components/QuestionSetting.vue';
import PaperDesigner from '../PaperDesigner.vue';
import PaperLibrarySidebar from '../PaperLibrarySidebar.vue';
import QuestionEditor from '../../question-designers/QuestionDocumentEditor.vue';
import QuestionProperties from '../QuestionProperties.vue';
import PaperProperties from '../PaperProperties.vue';
import type { DesignerMediaAdapter, PaperDesignerValue, PaperLibrarySource, SavePaperDraft } from '../contracts';
import { planPaperSave, questionFingerprint, validatePaperStructure } from '../paper-designer-state';
import { blankPaper, copy, deferred, paperFixture } from './paper-designer-fixtures';

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function button(wrapper: VueWrapper, text: string) {
  const label = ({ '新增单选题': '单选题', '添加多选题': '多选题', '添加判断题': '判断题' } as Record<string, string>)[text] || text;
  return [...wrapper.findAll('button,[role="tab"]'), ...new DOMWrapper(document.body).findAll('button')].find((item) => item.text() === label && item.isVisible())!;
}
function dialog() { return new DOMWrapper(document.body).findAll('[role="dialog"]').find((item) => item.isVisible()) || new DOMWrapper(document.body).find('[data-no-visible-dialog]'); }
function latest(wrapper: VueWrapper) { return wrapper.emitted('update:modelValue')!.at(-1)![0] as PaperDesignerValue; }
async function show(value = paperFixture(), options: { mode?: 'create' | 'edit' | 'readonly'; saveDraft?: SavePaperDraft; source?: PaperDesignerValue; mediaAdapter?: DesignerMediaAdapter;
  regulations?: QuestionRegulationOption[]; courses?: Array<{ id: string; title: string; category_id?: string }> } = {}) {
  const source = options.source || paperFixture('200', '10', 'library_question');
  const paperLibrarySource: PaperLibrarySource = {
    list: async (input) => ({ items: [{ id: source.paper.id, title: source.paper.title, category_id: source.paper.category_id!, question_count: 1 }], total: 1, page: input.page, page_size: input.page_size }),
    get: async () => copy(source),
  };
  const wrapper = mount(PaperDesigner, { props: { modelValue: value, categories: [{ id: '10', name: '安全培训' }, { id: '11', name: '另一类别' }],
    paperLibrarySource, regulations: options.regulations, courses: options.courses,
    mediaAdapter: options.mediaAdapter, mode: options.mode || 'create', saveDraft: options.saveDraft || (async (next) => ({ status: 'saved', value: next })) },
  global: { plugins: [ElementPlus] } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
async function useSource(wrapper: VueWrapper) {
  await button(wrapper, '试卷库').trigger('click'); await flushPromises();
  await button(wrapper, '使用整卷').trigger('click'); await flushPromises();
}

describe('public paper designer', () => {
  it('shows current paper operation information in template settings after replacing from another paper', async () => {
    const current = paperFixture(); Object.assign(current.paper, { created_by_name:'当前创建人', updated_by_name:'当前更新人', created_at:'2025-07-21T16:45:00' });
    const source = paperFixture('200', '10', 'library_question'); Object.assign(source.paper, {created_by_name:'来源创建人',updated_by_name:'来源更新人'});
    const wrapper = await show(current, {source});
    await useSource(wrapper);
    await button(wrapper, '整卷替换').trigger('click'); await flushPromises();
    await button(wrapper, '模板设置').trigger('click'); await flushPromises();
    const info = wrapper.get('[aria-label="操作信息"]');
    expect(info.text()).toContain('当前创建人');
    expect(info.text()).toContain('当前更新人');
    expect(info.text()).not.toContain('来源创建人');
  });

  it('keeps trusted question provenance readonly and rejects queued source writes', async () => {
    const value = paperFixture(); value.document.questions.question_one!.regulation_id = '31';
    value.document.questions.question_one!.regulation_version_id = '311';
    const wrapper = await show(value, { regulations: [{ id: '31', title: '入场资料', category_id: '10' }] });
    const properties = wrapper.findComponent(QuestionProperties);
    expect(properties.text()).toContain('资料来源'); expect(properties.text()).toContain('入场资料');
    properties.vm.$emit('change', { regulation_id: '32', regulation_version_id: '321' }); await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(value.document.questions.question_one).toMatchObject({ regulation_id: '31', regulation_version_id: '311' });
  });

  it('edits required learning courses while preserving hidden material filters and question provenance', async () => {
    const value = paperFixture(); value.document.questions.question_one!.regulation_id = '31';
    value.document.questions.question_one!.regulation_version_id = '311';
    value.paper.regulation_ids = ['31'];
    const wrapper = await show(value, { regulations: [{ id: '31', title: '入场资料', category_id: '10' }, { id: '32', title: '作业资料', category_id: '10' }],
      courses: [{ id: '41', title: '课程', category_id: '10' }] });
    await button(wrapper, '试卷设置').trigger('click'); await flushPromises();
    const properties = wrapper.findComponent(PaperProperties);
    properties.getComponent(ElSwitch).vm.$emit('update:modelValue', true); await flushPromises();
    properties.findAllComponents(ElSelect).find((item) => item.props('ariaLabel') === '试卷关联课程')!.vm.$emit('update:modelValue', ['41']); await flushPromises();
    expect(latest(wrapper).paper).toMatchObject({ regulation_ids: ['31'], course_ids: ['41'], requires_learning: true });
    expect(latest(wrapper).document.questions.question_one).toMatchObject({ regulation_id: '31', regulation_version_id: '311' });
  });

  it('keeps learning controls readonly and rejects queued selection events', async () => {
    const value = paperFixture(); Object.assign(value.paper, { requires_learning: true, course_ids: ['41'], required_learning_minutes: 15 });
    const wrapper = await show(value, { mode: 'readonly' });
    await button(wrapper, '试卷设置').trigger('click'); await flushPromises();
    const selects = wrapper.findComponent(PaperProperties).findAllComponents(ElSelect);
    expect(selects.every((item) => item.props('disabled'))).toBe(true);
    selects.find((item) => item.props('ariaLabel') === '试卷关联课程')!.vm.$emit('update:modelValue', ['42']);
    wrapper.findComponent(PaperProperties).getComponent(ElSwitch).vm.$emit('update:modelValue', false); await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('keeps cleared numeric settings visibly empty and preserves fractional typing', async () => {
    const wrapper = await show();
    await button(wrapper, '试卷设置').trigger('click'); await flushPromises();
    await wrapper.get('input[aria-label="考试限时"]').setValue(''); await flushPromises();
    expect((wrapper.get('input[aria-label="考试限时"]').element as HTMLInputElement).value).toBe('');
    await wrapper.get('input[aria-label="及格分数"]').setValue('0.5'); await flushPromises();
    expect(latest(wrapper).paper.pass_score).toBe(0.5);
  });

  it('renders one paper canvas between the library and properties, with a title in the paper', async () => {
    const wrapper = await show();
    expect((wrapper.get('input[aria-label="顶部试卷标题"]').element as HTMLInputElement).value).toBe('试卷 100');
    expect(wrapper.find('.paper-designer__library').exists()).toBe(true);
    expect(wrapper.find('.paper-designer__properties').exists()).toBe(true);
    expect(wrapper.findAllComponents(QuestionEditor)).toHaveLength(1);
    expect(wrapper.findAll('.paper-designer__canvas .ProseMirror')).toHaveLength(1);
    expect((wrapper.get('input[aria-label="试卷标题"]').element as HTMLInputElement).value).toBe('试卷 100');
    expect(wrapper.find('.question-editor__actions').exists()).toBe(false);
    expect(wrapper.find('.question-editor__media').exists()).toBe(false);
    expect(wrapper.findComponent(QuestionProperties).props('categoryReadonly')).toBe(true);
  });

  it('adds all three question types through real structure commands and keeps bindings synchronized', async () => {
    const wrapper = await show(blankPaper());
    for (const label of ['新增单选题', '添加多选题', '添加判断题']) { await button(wrapper, label).trigger('click'); await flushPromises(); }
    const value = latest(wrapper);
    expect(Object.values(value.document.questions).map((meta) => meta.type)).toEqual(['single', 'multiple', 'judgment']);
    expect(Object.values(value.document.questions).map((meta) => meta.category_id)).toEqual(['10', '10', '10']);
    expect(Object.values(value.bindings)).toEqual([{ kind: 'new' }, { kind: 'new' }, { kind: 'new' }]);
    expect(validatePaperStructure(value)).toEqual([]);
    expect(wrapper.emitted('dirty-change')?.at(-1)).toEqual([true]);
  });

  it('edits paper options in the single editor while preserving question identities, metadata, and bindings', async () => {
    const source = paperFixture();
    const wrapper = await show(source);
    const core = wrapper.findComponent(QuestionEditor).vm.getEditor();
    expect(wrapper.find('button[aria-label="添加选项"]').exists()).toBe(true);
    await wrapper.get('button[aria-label="添加选项"]').trigger('click'); await flushPromises();
    await wrapper.get('button[aria-label="添加选项"]').trigger('click'); await flushPromises();
    const changed = latest(wrapper);
    expect(changed.document.content.content![0]!.content!.slice(1)).toHaveLength(4);
    expect(changed.document.content.content!.map((node) => node.attrs!.client_id)).toEqual(['question_one']);
    expect(Object.keys(changed.document.questions)).toEqual(['question_one']);
    expect(Object.keys(changed.bindings)).toEqual(['question_one']);
    expect(changed.document.questions).toEqual(source.document.questions);
    expect(changed.bindings).toEqual(source.bindings);
    expect(validatePaperStructure(changed)).toEqual([]);
    expect(wrapper.findComponent(QuestionEditor).vm.getEditor()).toBe(core);
    await wrapper.get('button[aria-label="删除选项 D"]').trigger('click'); await flushPromises();
    expect(latest(wrapper).document.content.content![0]!.content!.slice(1)).toHaveLength(3);
    expect(latest(wrapper).bindings).toEqual(source.bindings);
  });

  it('loads a source paper into a pristine empty draft while retaining its persisted ID', async () => {
    const wrapper = await show(blankPaper());
    await useSource(wrapper);
    expect(dialog().exists()).toBe(false);
    expect(latest(wrapper).paper).toMatchObject({ id: '100', title: '试卷 200' });
    expect(Object.keys(latest(wrapper).document.questions)[0]).not.toBe('library_question');
    expect(Object.values(latest(wrapper).bindings)[0]).toMatchObject({ question_version_id: '50' });
  });

  it('directly loads a four-question source into an empty draft after editing title, relations and exam settings', async () => {
    const source = blankPaper(); source.paper.id = '200'; source.paper.title = '四题来源试卷';
    for (let index = 0; index < 4; index += 1) {
      const id = `library_${index}`; const item = paperFixture('200', '10', id);
      item.document.questions[id]!.concept_id = String(20 + index); item.document.questions[id]!.score_cents = 2500;
      source.document.content.content!.push(item.document.content.content![0]!);
      source.document.questions[id] = item.document.questions[id]!;
      source.bindings[id] = { kind: 'bound', question_id: String(40 + index), question_version_id: String(50 + index), revision: 1,
        baseline_fingerprint: questionFingerprint(item.document, id) };
    }
    const wrapper = await show(blankPaper(), { source, regulations: [{ id: '31', title: '已选制度', category_id: '10' }], courses: [{ id: '41', title: '已选课程', category_id: '10' }] });
    await wrapper.get('input[aria-label="试卷标题"]').setValue('自定义标题');
    wrapper.findComponent(PaperProperties).getComponent(ElSwitch).vm.$emit('update:modelValue', true); await flushPromises();
    wrapper.findComponent(PaperProperties).findAllComponents(ElSelect).find((item) => item.props('ariaLabel') === '试卷关联课程')!.vm.$emit('update:modelValue', ['41']); await flushPromises();
    for (const [label, number] of [['及格分数', '80'], ['考试限时', '90'], ['试卷排序', '8']]) {
      await wrapper.get(`input[aria-label="${label}"]`).setValue(number);
    }
    await wrapper.get('input[aria-label="累计学习时长（分钟）"]').setValue('15'); await flushPromises();
    expect(latest(wrapper).paper).toMatchObject({ title: '自定义标题', regulation_ids: [], course_ids: ['41'], required_learning_minutes: 15, pass_score: 80,
      duration_minutes: 90, sort_order: 8, requires_learning: true });
    await useSource(wrapper);
    expect(dialog().exists()).toBe(false);
    expect(latest(wrapper).paper).toEqual({ ...source.paper, id: '100' });
    expect(Object.keys(latest(wrapper).document.questions)).toHaveLength(4);
    expect(wrapper.findAll('.paper-designer__canvas [data-question-block]')).toHaveLength(4);
    expect(validatePaperStructure(latest(wrapper))).toEqual([]);
  });

  it('rejects a conflicting source on an empty paper without showing the populated-paper chooser', async () => {
    const source = paperFixture('200', '10', 'library_one');
    const second = paperFixture('200', '10', 'library_two');
    source.document.content.content!.push(second.document.content.content![0]!);
    source.document.questions.library_two = second.document.questions.library_two!;
    source.bindings.library_two = { kind: 'bound', question_id: '40', question_version_id: '51', revision: 1,
      baseline_fingerprint: questionFingerprint(second.document, 'library_two') };
    const wrapper = await show(blankPaper(), { source });
    await useSource(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toMatch(/同一道题.*重复/);
    expect(dialog().exists()).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.findAll('.paper-designer__canvas [data-question-block]')).toHaveLength(0);
  });

  it('offers append/replace/cancel for a populated draft and replaces across categories without changing ID', async () => {
    const source = paperFixture('200', '11', 'library_question');
    const wrapper = await show(paperFixture(), { source });
    await useSource(wrapper);
    const chooser = dialog();
    expect(chooser.findAll('button').map((item) => item.text())).toEqual(['追加到末尾', '整卷替换', '取消']);
    await button(wrapper, '取消').trigger('click'); await flushPromises();
    expect(dialog().exists()).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.findAll('.paper-designer__canvas [data-question-block]')).toHaveLength(1);
    await useSource(wrapper);
    await button(wrapper, '整卷替换').trigger('click'); await flushPromises();
    expect(latest(wrapper).paper).toMatchObject({ id: '100', category_id: '11', title: '试卷 200' });
    expect(validatePaperStructure(latest(wrapper))).toEqual([]);
  });

  it('rejects a conflicting append without changing the current draft', async () => {
    const wrapper = await show();
    await useSource(wrapper);
    await button(wrapper, '追加到末尾').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toMatch(/重复|同一/);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.findAll('.paper-designer__canvas [data-question-block]')).toHaveLength(1);
  });

  it('appends a nonconflicting paper and selects its first appended question', async () => {
    const source = paperFixture('200', '10', 'library_question');
    source.document.questions.library_question!.concept_id = '21';
    source.bindings.library_question = { kind: 'bound', question_id: '41', question_version_id: '51', revision: 1,
      baseline_fingerprint: questionFingerprint(source.document, 'library_question') };
    const wrapper = await show(paperFixture(), { source });
    await useSource(wrapper); await button(wrapper, '追加到末尾').trigger('click'); await flushPromises();
    const value = latest(wrapper); const ids = value.document.content.content!.map((node) => String(node.attrs!.client_id));
    expect(ids).toHaveLength(2); expect(ids[0]).toBe('question_one');
    expect(value.paper.title).toBe('试卷 100');
    expect(wrapper.findComponent(QuestionProperties).props('clientId')).toBe(ids[1]);
    expect(validatePaperStructure(value)).toEqual([]);
  });

  it('keeps one main editor and reuses bound versions when reordering 100 mixed questions', async () => {
    const value = blankPaper();
    for (let index = 0; index < 100; index += 1) {
      const id = `question_${index}`; const source = paperFixture('100', '10', id);
      const meta = source.document.questions[id]!; meta.type = (['single', 'multiple', 'judgment'] as const)[index % 3]!;
      meta.concept_id = null; meta.score_cents = 100;
      const options = source.document.content.content![0]!.content!.slice(1);
      if (meta.type === 'multiple') options[1]!.attrs!.checked = true;
      if (meta.type === 'judgment') { options[0]!.content![0]!.content![0]!.text = '正确'; options[1]!.content![0]!.content![0]!.text = '错误'; }
      value.document.content.content!.push(source.document.content.content![0]!);
      value.document.questions[id] = meta;
      value.bindings[id] = { kind: 'bound', question_id: String(2000 + index), question_version_id: String(1000 + index), revision: 1,
        baseline_fingerprint: questionFingerprint(source.document, id) };
    }
    const wrapper = await show(value);
    const core = wrapper.findComponent(QuestionEditor).vm.getEditor();
    (wrapper.vm as unknown as { moveQuestion: (id: string, index: number) => void }).moveQuestion('question_99', 0);
    await flushPromises();
    const moved = latest(wrapper);
    expect(moved.document.content.content![0]!.attrs!.client_id).toBe('question_99');
    expect(wrapper.findComponent(QuestionEditor).vm.getEditor()).toBe(core);
    expect(wrapper.findAll('.paper-designer__canvas .ProseMirror')).toHaveLength(1);
    expect(validatePaperStructure(moved)).toEqual([]);
    expect(planPaperSave(moved).reuse).toHaveLength(100);
  }, 20000);

  it('removes a question only after confirmation and atomically removes its binding', async () => {
    const wrapper = await show();
    await wrapper.get('[data-question-remove]').trigger('click');
    expect(wrapper.findAll('.paper-designer__canvas [data-question-block]')).toHaveLength(1);
    await button(wrapper, '删除题目').trigger('click'); await flushPromises();
    expect(latest(wrapper).document.questions).toEqual({}); expect(latest(wrapper).bindings).toEqual({});
    expect(validatePaperStructure(latest(wrapper))).toEqual([]);
  });

  it('freezes unknown save outcomes and only offers continuing the original request', async () => {
    const requests: string[] = [];
    const wrapper = await show(paperFixture(), { saveDraft: async (value, context) => {
      requests.push(context.request_id); return { status: 'incomplete', value, message: '提交结果未知，请继续查询', can_abandon: false };
    } });
    await button(wrapper, '保存').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('提交结果未知');
    expect(button(wrapper, '继续保存')).toBeDefined(); expect(button(wrapper, '放弃本次保存')).toBeUndefined();
    expect(wrapper.findComponent(QuestionEditor).props('disabled')).toBe(true);
    expect((wrapper.get('input[aria-label="试卷标题"]').element as HTMLInputElement).disabled).toBe(true);
    await button(wrapper, '关闭').trigger('click'); await flushPromises();
    expect(dialog().exists()).toBe(false);
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toContain('保存结果尚未确认');
    await button(wrapper, '继续保存').trigger('click'); await flushPromises();
    expect(requests).toHaveLength(2); expect(requests[1]).toBe(requests[0]);
  });

  it('allows abandoning a confirmed partial save while retaining returned bindings', async () => {
    const wrapper = await show(paperFixture(), { saveDraft: async (value) => ({ status: 'incomplete', value, message: '题目已入库，试卷尚未保存', can_abandon: true }) });
    await button(wrapper, '保存').trigger('click'); await flushPromises();
    await button(wrapper, '放弃本次保存').trigger('click'); await flushPromises();
    expect(wrapper.findComponent(QuestionEditor).props('disabled')).toBe(false);
    expect(latest(wrapper).bindings.question_one).toMatchObject({ question_version_id: '50' });
    expect(wrapper.get('[role="status"]').text()).toBe('未保存');
  });

  it('hides authoring actions and locks title/properties in readonly mode', async () => {
    const wrapper = await show(paperFixture(), { mode: 'readonly' });
    expect(button(wrapper, '保存')).toBeUndefined(); expect(button(wrapper, '新增单选题')).toBeUndefined();
    expect(button(wrapper, '插入图片')).toBeUndefined();
    expect(wrapper.findComponent(QuestionEditor).props('disabled')).toBe(true);
    expect(wrapper.findComponent(QuestionProperties).props('readonly')).toBe(true);
    expect((wrapper.get('input[aria-label="试卷标题"]').element as HTMLInputElement).disabled).toBe(true);
  });

  it('uploads at the main editor cursor and blocks saving until the controlled asset is inserted', async () => {
    const upload = deferred<{ asset_id: string }>();
    const wrapper = await show(paperFixture(), { mediaAdapter: { upload: () => upload.promise } });
    const core = wrapper.findComponent(QuestionEditor).vm.getEditor()!;
    core.commands.setTextSelection(3);
    await button(wrapper, '插入图片').trigger('click');
    const input = wrapper.get('input[aria-label="选择题目图片"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['image'], 'option.png', { type: 'image/png' })] });
    await input.trigger('change'); await flushPromises();
    expect(button(wrapper, '保存').attributes('disabled')).toBeDefined();
    upload.resolve({ asset_id: '88' }); await flushPromises();
    expect(JSON.stringify(latest(wrapper).document.content)).toContain('"asset_id":"88"');
    expect(JSON.stringify(latest(wrapper).document.content)).not.toContain('blob:');
    expect(button(wrapper, '保存').attributes('disabled')).toBeUndefined();
  });

  it('uses the property editor upload state to disable saving', async () => {
    const upload = deferred<{ asset_id: string }>();
    const wrapper = await show(paperFixture(), { mediaAdapter: { upload: () => upload.promise } });
    const properties = wrapper.findComponent(QuestionProperties);
    expect(properties.props('mediaAdapter')).toBeDefined();
    properties.vm.$emit('upload-state-change', { pending: true }); await flushPromises();
    expect(button(wrapper, '保存').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('dirty-change')?.at(-1)).toEqual([true]);
    properties.vm.$emit('upload-state-change', { pending: false }); await flushPromises();
    expect(button(wrapper, '保存').attributes('disabled')).toBeUndefined();
  });
});
