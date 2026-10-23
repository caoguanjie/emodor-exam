import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import PaperLibrarySidebar from '../PaperLibrarySidebar.vue';
import ElementPlus from 'element-plus';
import type { LibraryPage, QuestionLibrarySource, QuestionLibrarySummary, PaperLibrarySource } from '../contracts';
import { deferred, paperFixture } from './paper-designer-fixtures';

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function button(wrapper: VueWrapper, text: string) { return wrapper.findAll('button,[role="tab"]').find((item) => item.text() === (text === '插入' ? '加入试卷' : text))!; }
const questionItem = { id: '40', stem: '受限空间检测', type: 'single' as const, difficulty: 'easy' as const, category_id: '10' };
function sources() {
  const queries: unknown[] = []; const gets: string[] = [];
  const paperQueries: unknown[] = [];
  const questionSource: QuestionLibrarySource = {
    list: async (input) => { queries.push(input); return { items: [questionItem], total: 41, page: input.page, page_size: input.page_size }; },
    get: async (id) => { gets.push(id); const value = paperFixture(); return { document: value.document, binding: value.bindings.question_one as Extract<typeof value.bindings.question_one, { kind: 'bound' }> }; },
  };
  const paperSource: PaperLibrarySource = {
    list: async (input) => { paperQueries.push(input); return { items: [{ id: '200', title: '来源完整卷', category_id: '10', question_count: 1 }], total: 21, page: input.page, page_size: input.page_size }; },
    get: async () => paperFixture('200'),
  };
  return { questionSource, paperSource, queries, paperQueries, gets };
}

describe('paper library sidebar', () => {
  it('keeps independent search/page state and sends category-scoped backend requests', async () => {
    const data = sources();
    const wrapper = mount(PaperLibrarySidebar, { global: { plugins: [ElementPlus] }, props: { ...data, categoryId: '10' } }); wrappers.push(wrapper); await flushPromises();
    expect(data.queries).toEqual([{ category_id: '10', keyword: undefined, page: 1, page_size: 20 }]);
    await wrapper.get('input[aria-label="试题库关键词"]').setValue('检测');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    await wrapper.get('.paper-library__pagination .btn-next').trigger('click'); await flushPromises();
    expect(data.queries.at(-1)).toEqual({ category_id: '10', keyword: '检测', page: 2, page_size: 20 });
    await button(wrapper, '试卷库').trigger('click'); await flushPromises();
    await wrapper.get('input[aria-label="试卷库关键词"]').setValue('整卷');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(data.paperQueries.at(-1)).toEqual({ keyword: '整卷', page: 1, page_size: 20 });
    await button(wrapper, '试题库').trigger('click'); await flushPromises();
    expect((wrapper.get('input[aria-label="试题库关键词"]').element as HTMLInputElement).value).toBe('检测');
    expect(wrapper.get('.paper-library__pagination .number.is-active').text()).toBe('2');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(data.queries.at(-1)).toEqual({ category_id: '10', keyword: '检测', page: 1, page_size: 20 });
  });

  it('fetches full question JSON only after explicit insertion', async () => {
    const data = sources();
    const wrapper = mount(PaperLibrarySidebar, { global: { plugins: [ElementPlus] }, props: { ...data, categoryId: '10' } }); wrappers.push(wrapper); await flushPromises();
    await button(wrapper, '受限空间检测').trigger('click'); await flushPromises();
    expect(data.gets).toEqual([]); expect(wrapper.emitted('insert-question')).toBeUndefined();
    await button(wrapper, '插入').trigger('click'); await flushPromises();
    expect(data.gets).toEqual(['40']);
    expect(wrapper.emitted('insert-question')?.[0]?.[0]).toMatchObject({ binding: { question_version_id: '50' } });
  });

  it('shows a category prerequisite, loading, retry and empty states', async () => {
    const response = deferred<LibraryPage<QuestionLibrarySummary>>(); let calls = 0;
    const data = sources();
    data.questionSource.list = async () => { calls += 1; if (calls === 1) throw new Error('题库暂不可用'); return response.promise; };
    const wrapper = mount(PaperLibrarySidebar, { global: { plugins: [ElementPlus] }, props: { ...data } }); wrappers.push(wrapper); await flushPromises();
    expect(wrapper.text()).toContain('请先选择培训类别'); expect(calls).toBe(0);
    await wrapper.setProps({ categoryId: '10' }); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('题库暂不可用');
    await button(wrapper, '重试').trigger('click'); await flushPromises();
    expect(wrapper.find('.el-skeleton').exists()).toBe(true);
    response.resolve({ items: [], total: 0, page: 1, page_size: 20 }); await flushPromises();
    expect(wrapper.text()).toContain('暂无试题');
  });

  it('ignores an old list response after changing category', async () => {
    const old = deferred<LibraryPage<QuestionLibrarySummary>>(); const data = sources();
    data.questionSource.list = async (input) => input.category_id === '10' ? old.promise : { items: [{ ...questionItem, id: '41', stem: '新类别题目', category_id: '11' }], total: 1, page: 1, page_size: 20 };
    const wrapper = mount(PaperLibrarySidebar, { global: { plugins: [ElementPlus] }, props: { ...data, categoryId: '10' } }); wrappers.push(wrapper);
    await wrapper.setProps({ categoryId: '11' }); await flushPromises();
    old.resolve({ items: [questionItem], total: 1, page: 1, page_size: 20 }); await flushPromises();
    expect(wrapper.text()).toContain('新类别题目'); expect(wrapper.text()).not.toContain('受限空间检测');
  });

  it('drops a late question detail after category changes', async () => {
    const data = sources();
    const pending = deferred<Awaited<ReturnType<QuestionLibrarySource['get']>>>();
    data.questionSource.get = () => pending.promise;
    const wrapper = mount(PaperLibrarySidebar, { global: { plugins: [ElementPlus] }, props: { ...data, categoryId: '10' } }); wrappers.push(wrapper); await flushPromises();
    await button(wrapper, '插入').trigger('click');
    await wrapper.setProps({ categoryId: '11' });
    const source = paperFixture(); pending.resolve({ document: source.document, binding: source.bindings.question_one as Extract<typeof source.bindings.question_one, { kind: 'bound' }> });
    await flushPromises();
    expect(wrapper.emitted('insert-question')).toBeUndefined();
  });

  it('hides all mutating actions when readonly', async () => {
    const wrapper = mount(PaperLibrarySidebar, { global: { plugins: [ElementPlus] }, props: { ...sources(), categoryId: '10', readonly: true } }); wrappers.push(wrapper); await flushPromises();
    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain('新增单选题');
    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain('插入');
    await button(wrapper, '试卷库').trigger('click'); await flushPromises();
    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain('使用整卷');
  });

  it('disables an empty paper before requesting its detail', async () => {
    const data = sources(); let detailCalls = 0;
    data.paperSource.list = async (input) => ({ items: [{ id: '201', title: '空白试卷', category_id: '10', question_count: 0 }], total: 1, page: input.page, page_size: input.page_size });
    data.paperSource.get = async () => { detailCalls += 1; return paperFixture('201'); };
    const wrapper = mount(PaperLibrarySidebar, { global: { plugins: [ElementPlus] }, props: { ...data, categoryId: '10' } }); wrappers.push(wrapper); await flushPromises();
    await button(wrapper, '试卷库').trigger('click'); await flushPromises();
    const usePaper = button(wrapper, '使用整卷');
    expect(usePaper.attributes('disabled')).toBeDefined();
    await usePaper.trigger('click'); await flushPromises();
    expect(detailCalls).toBe(0);
  });
});
