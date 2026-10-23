import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElDialog, ElMessageBox } from 'element-plus';
import Courses from '../../views/admin/Courses.vue';
import MediaUpload from '../MediaUpload.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn(), image: vi.fn(), push: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get, put: mocks.put, post: mocks.post, delete: mocks.delete } }));
vi.mock('../../api/media', () => ({ getMediaImageContent: mocks.image }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => true }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }), useRoute: () => ({ params: { id: '11' } }) }));
vi.mock('../../composables/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({ markClean: vi.fn(), confirmDiscard: vi.fn().mockResolvedValue(true) }),
}));

const course = {
  id: '11', title: '建筑施工安全', category_id: '10', cover_asset_id: '21', status: 'draft',
  required_lesson_count: 2, description: '课程简介', regulation_ids: [], is_recommended: true, sort_order: 17,
  created_at: '2026-10-23T17:05:00', updated_at: '2026-10-23T17:05:00', published_at: null,
  missing_required_lesson_ids: [], chapters: [],
};
let rows: typeof course[];
const wrappers: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [{ ...course }, { ...course, id: '12', title: '消防安全', cover_asset_id: '', is_recommended: false }];
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/admin/courses/category-options') return { items: [{ id: '10', name: '产业工人' }], total: 1, page: 1, page_size: 100 };
    if (url === '/admin/courses') return { items: rows.map(row => ({ ...row })), total: rows.length, page: 1, page_size: 20 };
    if (url === '/admin/courses/11') return { ...course };
    throw new Error(`Unexpected GET ${url}`);
  });
  mocks.put.mockResolvedValue({ ...course });
  mocks.image.mockResolvedValue(new Blob(['cover'], { type: 'image/png' }));
  mocks.createUrl.mockReturnValue('blob:course-cover');
  const BrowserUrl = globalThis.URL;
  vi.stubGlobal('URL', class extends BrowserUrl {
    static createObjectURL = mocks.createUrl;
    static revokeObjectURL = mocks.revokeUrl;
  });
});
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  const wrapper = mount(Courses, { attachTo: document.body, global: { plugins: [ElementPlus], stubs: { MediaUpload: true } } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
function button(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('button').find(item => item.text() === label)!;
}
function formLabels(wrapper: VueWrapper) {
  return wrapper.findAll('.el-form-item__label').map(item => item.text()).filter(Boolean);
}
function activeDialog(wrapper: VueWrapper) {
  return wrapper.findAllComponents(ElDialog).find(dialog => dialog.props('modelValue'))!;
}
function lessonFixture() {
  return { ...course, chapters: [{ id: '31', title: '第一章 班前安全教育', sort_order: 3, lessons: [
    { id: '41', title: '施工现场安全防护', sort_order: 2, lesson_type: 'video', required: true, created_at: '2026-10-23T17:05:00',
      current_version: { version_id: '51', asset_id: '61', duration_ms: 72000 } },
    { id: '42', title: '消防演练', sort_order: 4, lesson_type: 'video', required: false, created_at: null, current_version: null },
  ] }] };
}
function useDetail(detail: ReturnType<typeof lessonFixture>) {
  const existing = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (url: string) => url === '/admin/courses/11' ? structuredClone(detail) : existing(url));
}

describe('course presentation', () => {
  it('shows covers, required lesson counts, explicit homepage recommendation and creation time without sorting controls', async () => {
    const wrapper = await render();
    expect(wrapper.findAll('.el-table__header th').map(item => item.text())).toEqual([
      '课程名称', '课程封面', '培训类别', '必学课时', '首页推荐', '状态', '创建时间', '操作',
    ]);
    const cells = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!.findAll('td');
    expect(cells[0]!.text()).toBe('建筑施工安全');
    expect(cells[1]!.find('img').attributes('src')).toBe('blob:course-cover');
    expect(cells[2]!.text()).toBe('产业工人');
    expect(cells[3]!.text()).toBe('2');
    expect(cells[4]!.text()).toBe('是');
    expect(cells[6]!.text()).toBe('2026-10-23 17:05');
    expect(wrapper.findAll('.el-table__body-wrapper tbody tr')[1]!.findAll('td')[4]!.text()).toBe('否');
    await cells[1]!.find('img').trigger('click');
    expect(document.body.querySelector('.el-image-viewer__wrapper')).not.toBeNull();
  });

  it('orders the create form like the legacy form and saves homepage recommendation without publishing', async () => {
    const wrapper = await render();
    await button(wrapper, '新建课程').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('.el-dialog');
    expect(formLabels(dialog as unknown as VueWrapper)).toEqual(['课程名称', '课程封面', '培训类别', '课程简介', '首页推荐', '排序']);
    await dialog.find('input').setValue('新安全课程');
    await dialog.findAll('input[type="radio"]')[0]!.setValue(true);
    mocks.post.mockResolvedValue({ id: '13' });
    await button(wrapper, '创建草稿').trigger('click');
    await flushPromises();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenLastCalledWith('/admin/courses', {
      title: '新安全课程', cover_asset_id: null, category_id: '10', description: '', is_recommended: true, sort_order: 0,
    });
  });

  it('edits course information in its own dialog without navigation or chapter controls and preserves stored order', async () => {
    const wrapper = await render();
    await button(wrapper, '修改课程').trigger('click');
    await flushPromises();
    const form = wrapper.find('.el-dialog .el-form');
    expect(formLabels(form as unknown as VueWrapper)).toEqual(['课程名称', '课程封面', '培训类别', '课程简介', '首页推荐', '排序']);
    await form.findAll('input[type="radio"]')[1]!.setValue(true);
    await button(wrapper, '保存课程资料').trigger('click');
    await flushPromises();
    expect(wrapper.find('.el-dialog').text()).not.toContain('新增章节');
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenLastCalledWith('/admin/courses/11', {
      title: course.title, cover_asset_id: '21', category_id: '10', description: course.description, is_recommended: false, sort_order: 17,
    });
  });

  it('opens chapters separately and stays on the course list after creating a course', async () => {
    const wrapper = await render();
    await button(wrapper, '章节管理').trigger('click');
    await flushPromises();
    expect(activeDialog(wrapper).text()).toContain('新增章节');
    expect(formLabels(wrapper.find('.el-dialog') as unknown as VueWrapper)).not.toContain('课程名称');
    await button(wrapper, '关闭').trigger('click');
    await flushPromises();
    await button(wrapper, '新建课程').trigger('click');
    await flushPromises();
    await wrapper.find('.el-dialog input').setValue('新课程');
    mocks.post.mockResolvedValue({ id: '11' });
    await button(wrapper, '创建草稿').trigger('click');
    await flushPromises();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(activeDialog(wrapper).text()).toContain('新增章节');
  });

  it('lets the administrator edit course sorting inside the information dialog', async () => {
    const wrapper = await render();
    await button(wrapper, '修改课程').trigger('click');
    await flushPromises();
    const order = activeDialog(wrapper).find('.el-input-number input');
    expect(order.exists()).toBe(true);
    expect((order.element as HTMLInputElement).value).toBe('17');
    await order.setValue('23');
    await button(wrapper, '保存课程资料').trigger('click');
    await flushPromises();
    expect(mocks.put).toHaveBeenLastCalledWith('/admin/courses/11', expect.objectContaining({ sort_order: 23 }));
  });

  it('uses the shared dialog footer for create, information and chapter actions', async () => {
    const wrapper = await render();
    for (const [entry, action, close] of [
      ['新建课程', '创建草稿', '取消'], ['修改课程', '保存课程资料', '取消'], ['章节管理', '关闭', '关闭'],
    ]) {
      await button(wrapper, entry!).trigger('click');
      await flushPromises();
      const dialog = activeDialog(wrapper);
      expect(dialog.find('.el-dialog__footer').text()).toContain(action);
      expect(dialog.find('.el-dialog__body').text()).not.toContain(action);
      await dialog.findAll('.el-dialog__footer button').find(item => item.text() === close)!.trigger('click');
      await flushPromises();
    }
  });

  it('presents aligned lesson columns with chapter.lesson numbering, real creation time and only modify/delete row actions', async () => {
    useDetail(lessonFixture());
    const wrapper = await render();
    await button(wrapper, '章节管理').trigger('click');
    await flushPromises();
    const dialog = activeDialog(wrapper);
    expect(dialog.find('.el-collapse').exists()).toBe(false);
    expect(dialog.find('.chapter-section__header').text()).toContain('编辑章节');
    expect(dialog.find('.chapter-section__header').text()).toContain('新增课时');
    expect(dialog.findAll('.el-table__header th').map(item => item.text())).toEqual(['编号', '课时名称', '要求', '创建时间', '视频状态', '时长', '操作']);
    const lessons = dialog.findAll('.el-table__body-wrapper tbody tr');
    expect(lessons).toHaveLength(2);
    expect(lessons[0]!.text()).toContain('施工现场安全防护');
    for (const field of ['1.1', '必学', '已上传', '1:12', '2026-10-23 17:05']) expect(lessons[0]!.text()).toContain(field);
    for (const field of ['1.2', '选学', '未上传', '—']) expect(lessons[1]!.text()).toContain(field);
    expect(lessons[0]!.findAll('button').map(item => item.text())).toEqual(['修改', '删除']);
    expect(dialog.text()).not.toContain('课件未上传');
    await button(dialog, '修改').trigger('click');
    await flushPromises();
    const lessonDialog = document.body.querySelector('[aria-label="修改课时"]');
    expect(lessonDialog?.textContent).toContain('当前视频');
    const upload = wrapper.findAllComponents(MediaUpload).find(item => item.props('purpose') === 'video')!;
    expect(upload.props('listType')).toBe('drag');
    upload.vm.$emit('pending', true);
    await flushPromises();
    expect(lessonDialog?.querySelector('.el-dialog__footer button.el-button--primary')?.hasAttribute('disabled')).toBe(true);
    upload.vm.$emit('pending', false);
    await flushPromises();
    expect(lessonDialog?.querySelector('.el-dialog__footer button.el-button--primary')?.hasAttribute('disabled')).toBe(false);
    expect(lessonDialog?.textContent).not.toContain('替换视频');
  });

  it('does not delete on cancellation and removes a lesson only after confirmed server success', async () => {
    const detail = lessonFixture();
    useDetail(detail);
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockImplementation(async () => 'confirm' as never);
    mocks.delete.mockImplementation(async () => {
      detail.chapters[0]!.lessons.splice(0, 1);
      return { id: '41', deleted: true };
    });
    const wrapper = await render();
    await button(wrapper, '章节管理').trigger('click');
    await flushPromises();
    await button(activeDialog(wrapper), '删除').trigger('click');
    await flushPromises();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(activeDialog(wrapper).findAll('.el-table__body-wrapper tbody tr')).toHaveLength(2);
    await button(activeDialog(wrapper), '删除').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(mocks.delete).toHaveBeenCalledWith('/admin/courses/11/lessons/41');
    expect(activeDialog(wrapper).findAll('.el-table__body-wrapper tbody tr')).toHaveLength(1);
    expect(activeDialog(wrapper).text()).not.toContain('施工现场安全防护');
  });

  it('keeps lesson rows when deletion fails and hides deletion after publication', async () => {
    const detail = lessonFixture();
    useDetail(detail);
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(async () => 'confirm' as never);
    mocks.delete.mockRejectedValue(new Error('服务器拒绝删除'));
    const wrapper = await render();
    await button(wrapper, '章节管理').trigger('click');
    await flushPromises();
    await button(activeDialog(wrapper), '删除').trigger('click');
    await flushPromises();
    expect(activeDialog(wrapper).findAll('.el-table__body-wrapper tbody tr')).toHaveLength(2);
    expect(document.body.textContent).toContain('重新核对目录');
    await button(activeDialog(wrapper), '关闭').trigger('click');
    await flushPromises();
    detail.status = 'published';
    await button(wrapper, '章节管理').trigger('click');
    await flushPromises();
    expect(activeDialog(wrapper).findAll('.el-table__body-wrapper tbody tr button').map(item => item.text())).toEqual(['修改', '修改']);
  });

  it('reconciles an uncertain deletion through the catalog instead of resending it', async () => {
    const detail = lessonFixture();
    useDetail(detail);
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(async () => 'confirm' as never);
    mocks.delete.mockImplementation(async () => {
      detail.chapters[0]!.lessons.splice(0, 1);
      throw new Error('回执丢失');
    });
    const wrapper = await render();
    await button(wrapper, '章节管理').trigger('click');
    await flushPromises();
    await button(activeDialog(wrapper), '删除').trigger('click');
    await flushPromises();
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(activeDialog(wrapper).text()).not.toContain('施工现场安全防护');
    expect(activeDialog(wrapper).findAll('.el-table__body-wrapper tbody tr')).toHaveLength(1);
  });
});
