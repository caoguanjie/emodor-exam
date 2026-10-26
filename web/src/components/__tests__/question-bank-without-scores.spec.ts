import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Questions from '../../views/admin/Questions.vue';
import QuestionEditor from '../QuestionEditor.vue';
import ManualQuestionEditor from '../ManualQuestionEditor.vue';
import QuestionPreview from '../QuestionPreview.vue';
import { questionDraftFromView, questionDraftWithContent } from '../../api/training-types';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../api/http', () => ({ default: api }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => permission !== 'media:write' }) }));
const wrappers: VueWrapper[] = [];
const draft = () => ({ category_id: '7', difficulty: 'easy' as const, type: 'single' as const, stem: '先做什么？',
  options: [{ key: 'A', text: '检查' }, { key: 'B', text: '作业' }], answer: [0], analysis: '' });
const row = () => ({ ...draft(), id: 40, question_id: '40', current_version_id: '50', revision: 1,
  concept_id: '9', enabled: true, source: 'manual', score: 17 });
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path: string) => {
    if (path === '/admin/questions/authoring-options') return { difficulties: [{ code: 'easy', label: '简单', enabled: true, sort: 1 }] };
    if (path === '/ai/question-category-options') return { items: [{ id: '7', name: '安全培训' }] };
    if (path === '/ai/question-concept-options') return { items: [{ id: '9', name: '作业准备' }], total: 1, page: 1, page_size: 20 };
    if (path === '/ai/questions') return { list: [row()], total: 1 };
    if (path.endsWith('/history')) return { items: [], total: 0, page: 1, page_size: 20 };
    throw new Error(`Unexpected GET ${path}`);
  });
  api.post.mockResolvedValue({ question_id: '41', saved_version_id: '51' });
  api.put.mockResolvedValue({ question_id: '40', saved_version_id: '52' });
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.restoreAllMocks(); });
function editor(value = draft()) {
  const wrapper = mount(QuestionEditor, { props: { modelValue: value,
    categories: [{ id: '7', name: '安全培训' }], difficultyOptions: [{ value: 'easy', label: '简单' }] },
    global: { plugins: [ElementPlus], stubs: { MediaUpload: true } } });
  wrappers.push(wrapper); return wrapper;
}
async function show() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Questions },
    { path: '/other', component: { render: () => h('p', '其他页面') } }] });
  await router.push('/'); await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [ElementPlus, router], stubs: { MediaUpload: true, transition: false } } });
  wrappers.push(wrapper); await flushPromises(); return { wrapper, router };
}
async function click(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === label)
    || new DOMWrapper(document.body).findAll('button').find((item) => item.text() === label);
  expect(button, label).toBeDefined(); await button!.trigger('click'); await flushPromises();
}
function editorDialog() { return new DOMWrapper(document.body).get('.el-dialog.re-form-dialog'); }
async function changeRichStem(form: { vm: unknown }, text: string, image = false) {
  const instance = (form.vm as any).getEditor();
  const document = instance.getJSON();
  document.content[0].content[0].content = [{ type: 'paragraph', content: [
    { type: 'text', text, marks: [{ type: 'bold' }] },
    ...(image ? [{ type: 'mediaImage', attrs: { asset_id: '44' } }] : []),
  ] }];
  instance.commands.setContent(document);
  await flushPromises();
}

describe('question bank has no scores', () => {
  it('makes re-enabling explicit when revising a disabled question and preserves its CAS baseline', async () => {
    const previous = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string, ...args: unknown[]) => path === '/ai/questions'
      ? { list: [{ ...row(), enabled: false }], total: 1 } : previous(path, ...args));
    const { wrapper } = await show();
    await click(wrapper, '修改');
    expect(editorDialog().text()).toContain('该题当前已停用，保存本次修订后将启用。');
    await click(wrapper, '保存并启用');
    expect(api.put.mock.calls[0]).toEqual(['/ai/questions/40', expect.objectContaining({
      expected_version_id: '50', expected_enabled: false,
    })]);
  });
  it.each(['人工录题', '修改'])('keeps the %s overlay inside the current page content', async (action) => {
    const { wrapper } = await show();
    const page = wrapper.get('.question-page').element as HTMLElement;
    page.classList.add('page-enter');
    page.style.transform = 'matrix(1, 0, 0, 1, 0, 0)';
    await click(wrapper, action);
    const dialog = editorDialog().element;
    const overlay = dialog.closest('.el-overlay');
    expect(overlay?.parentElement).toBe(page);
    expect(page.contains(dialog)).toBe(true);
    expect(dialog.querySelector('.el-dialog__header')).not.toBeNull();
    expect(dialog.querySelector('.el-dialog__footer')).not.toBeNull();
  });
  it('renders only type, category and difficulty in the top row and no score input', () => {
    const wrapper = editor();
    expect(wrapper.get('.question-editor__grid').findAll('.el-form-item__label').map((item) => item.text()))
      .toEqual(['题型', '培训类别', '难度']);
    expect(wrapper.text()).not.toMatch(/分值|建议分|默认分/);
    expect(wrapper.find('[role="spinbutton"]').exists()).toBe(false);
  });

  it('collapses empty analysis, expands existing analysis and retains it when collapsed', async () => {
    const empty = editor();
    expect(empty.findAll('details')).toHaveLength(1);
    expect(empty.findAll('details').every((item) => !(item.element as HTMLDetailsElement).open)).toBe(true);
    const wrapper = editor({ ...draft(), concept_id: '9', analysis: '先检查' } as any);
    expect(wrapper.findAll('details').every((item) => (item.element as HTMLDetailsElement).open)).toBe(true);
    for (const item of wrapper.findAll('details')) {
      (item.element as HTMLDetailsElement).open = false; await item.trigger('toggle');
    }
    const analysis = wrapper.findAll('textarea').at(-1)!;
    expect((analysis.element as HTMLTextAreaElement).value).toBe('先检查');
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
    const changed = wrapper.emitted('update:modelValue')!.at(-1)![0] as any;
    expect(changed).toMatchObject({ concept_id: '9', analysis: '先检查', answer: [1] });
  });

  it('keeps the chosen analysis expansion while ordinary v-model edits return through the page', async () => {
    const { wrapper } = await show();
    await click(wrapper, '人工录题');
    const form = wrapper.getComponent(ManualQuestionEditor);
    const optional = form.get('details');
    const details = optional.element as HTMLDetailsElement;
    details.open = true; await optional.trigger('toggle');
    await changeRichStem(form, '修改题干');
    await flushPromises();
    expect(details.open).toBe(true);
    await form.findAll('.question-option__toggle')[1]!.trigger('click');
    await flushPromises();
    expect(details.open).toBe(true);
    (form.vm as any).getAnalysisEditor().commands.insertContent('补充解析');
    await flushPromises();
    details.open = false; await optional.trigger('toggle');
    await changeRichStem(form, '再次修改题干');
    await flushPromises();
    expect(details.open).toBe(false);
    expect((form.vm as any).getAnalysisEditor().getText()).toBe('补充解析');
  });

  it.each([1, 2, 3] as const)('does not copy an old score into schema %s drafts or outgoing content', (schema) => {
    const content = { stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '题干' }] }] },
      options: ['A', 'B'].map((id) => ({ id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] } })),
      analysis: null, answer_option_ids: ['A'] };
    const value = questionDraftFromView({ ...row(), content_schema_version: schema, content_json: schema === 1 ? null : content } as any);
    expect(value).not.toHaveProperty('score');
    expect(questionDraftWithContent({ ...value, score: 17 } as any)).not.toHaveProperty('score');
  });

  it('hides legacy bank scores by default but can explicitly show frozen paper scores', async () => {
    const wrapper = mount(QuestionPreview, { props: { question: { ...draft(), score: 17 } }, global: { plugins: [ElementPlus] } });
    wrappers.push(wrapper); await flushPromises();
    expect(wrapper.text()).not.toContain('17 分');
    await wrapper.setProps({ showScore: true } as any);
    expect(wrapper.text()).toContain('17 分');
    await wrapper.setProps({ question: { ...draft() } });
    expect(wrapper.text()).not.toContain('0 分');
  });

  it('omits bank scores, authoring concept/source fields and concept option requests, without list concept filters', async () => {
    const { wrapper } = await show();
    expect(wrapper.text()).not.toMatch(/建议分|默认分/);
    expect(wrapper.text()).not.toContain('考点组');
    await click(wrapper, '修改');
    expect(editorDialog().text()).not.toMatch(/考点|资料来源|分值/);
    expect(api.get.mock.calls.some(([path]) => path === '/ai/question-concept-options')).toBe(false);
    expect(wrapper.findComponent(ManualQuestionEditor).props('modelValue')).not.toHaveProperty('concept_id');
    expect(editorDialog().text()).toContain('保存会生成新版本并启用');
  });

  it('shows answer summary and dirty state and protects cancel and route leave without saving', async () => {
    const { wrapper, router } = await show();
    await click(wrapper, '人工录题');
    const form = wrapper.getComponent(ManualQuestionEditor);
    await form.findAll('.question-option__toggle')[1]!.trigger('click');
    await changeRichStem(form, '修改的题干');
    expect(editorDialog().get('.editor-summary__answers').attributes('aria-label')).toBe('正确答案：B');
    expect(editorDialog().get('.editor-summary__answer').text()).toBe('B');
    expect(editorDialog().get('.el-dialog__footer').text()).toContain('有未保存修改');
    expect(editorDialog().get('.el-dialog__footer').text()).not.toMatch(/分值|自动保存/);
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('继续编辑'));
    await click(wrapper, '取消');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((form.vm as any).getEditor().getText()).toContain('修改的题干');
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/');
    expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });

  it.each(['create', 'edit'] as const)('%s submits controlled content without a score, retaining version semantics', async (mode) => {
    const { wrapper } = await show();
    await click(wrapper, mode === 'create' ? '人工录题' : '修改');
    const form = wrapper.getComponent(ManualQuestionEditor);
    await changeRichStem(form, '已改题干', true);
    const instance = (form.vm as any).getEditor();
    const document = instance.getJSON();
    document.content[0].content.slice(1).forEach((node: any, index: number) => {
      node.content = [{ type: 'paragraph', content: [{ type: 'text', text: ['检查', '作业'][index] }] }];
    });
    instance.commands.setContent(document);
    await flushPromises();
    await click(wrapper, '保存');
    const request = (mode === 'create' ? api.post : api.put).mock.calls.at(-1)!;
    expect(request[0]).toBe(mode === 'create' ? '/ai/questions' : '/ai/questions/40');
    expect(request[1]).not.toHaveProperty('score');
    expect(request[1].content_schema_version).toBe(3);
    expect(JSON.stringify(request[1].content_json)).toContain('"type":"bold"');
    expect(JSON.stringify(request[1].content_json)).toContain('"asset_id":"44"');
    expect(request[1]).not.toHaveProperty('concept_id');
    if (mode === 'edit') {
      expect(request[1].expected_version_id).toBe('50');
      expect(request[1].expected_enabled).toBe(true);
    }
  });

  it('saves an untouched legacy rich question as canonical schema 3 without making open dirty', async () => {
    const normalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string) => path === '/ai/questions'
      ? { list: [{ ...row(), stem: '<p><strong>原有加粗题干</strong></p>', analysis: '<p><em>原有斜体解析</em></p>' }], total: 1 }
      : normalGet(path));
    const { wrapper } = await show();
    await click(wrapper, '修改');
    expect(editorDialog().get('.el-dialog__footer').text()).toContain('暂无未保存修改');
    await click(wrapper, '保存');
    const body = api.put.mock.calls.at(-1)![1];
    expect(body.content_schema_version).toBe(3);
    expect(body.content_json.stem.content[0].content[0].marks).toEqual([{ type: 'bold' }]);
    expect(body.content_json.analysis.content[0].content[0].marks).toEqual([{ type: 'italic' }]);
    expect(body.expected_version_id).toBe('50');
    expect(body.expected_enabled).toBe(true);
  });

  it.each(['question', 'analysis'])('protects an invalid first %s edit on cancel and route leave', async (target) => {
    const { wrapper, router } = await show();
    await click(wrapper, '修改');
    const form = wrapper.getComponent(ManualQuestionEditor);
    const instance = target === 'question' ? form.vm.getEditor()! : form.vm.getAnalysisEditor()!;
    instance.commands.setTextSelection(target === 'question' ? 3 : 1);
    instance.commands.insertContent('<p><a href="https://example.invalid">首次粘贴的新文字</a></p>');
    await flushPromises();
    expect(instance.getText()).toContain('首次粘贴的新文字');
    expect(form.vm.validate()).toBeTruthy();
    expect(editorDialog().get('.el-dialog__footer').text()).toContain('有未保存修改');
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('继续编辑'));
    await click(wrapper, '取消');
    expect(confirm).toHaveBeenCalledOnce();
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/');
    expect(instance.getText()).toContain('首次粘贴的新文字');
    expect(api.put).not.toHaveBeenCalled();
  });
});
