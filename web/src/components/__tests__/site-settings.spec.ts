import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent } from '@tiptap/vue-3';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus from 'element-plus';
import SiteSettings from '../../views/admin/SiteSettings.vue';
import TiptapEditor from '../Tiptap/index.vue';
import { parseRichDocV3 } from '../../../../server/src/modules/questions/question-content-v3';
import { normalizeSiteAbout } from '../../../../server/src/modules/system/site-about-config';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), put: vi.fn(), confirm: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
  writable: true,
}));
vi.mock('../../api/http', () => ({ default: { get: mocks.get, put: mocks.put } }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => mocks.writable }) }));
vi.mock('element-plus', async original => ({
  ...await original<typeof import('element-plus')>(),
  ElMessage: { success: mocks.success, warning: mocks.warning, error: mocks.error },
  ElMessageBox: { confirm: mocks.confirm },
}));

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const terms = (): JSONContent => ({ type: 'doc', content: [paragraph('请妥善保管账号。')] });
const about = () => ({
  institution_name: '测试培训中心', platform_subtitle: '培训与考试平台', version: '2.0.0',
  contact_email: '', wechat_account: '', contact_phone: '', service_terms: terms(),
});
const config = () => ({ logo_asset_id: '10', banners: [{ asset_id: '20', sort: 10 }], about: about() });
const wrappers: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writable = true;
  mocks.get.mockResolvedValue(config());
  mocks.put.mockImplementation(async (_path, payload) => ({ ...config(), ...JSON.parse(JSON.stringify(payload)) }));
  mocks.confirm.mockResolvedValue('confirm');
});
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  window.getSelection()?.removeAllRanges();
});

async function render(openAbout = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: SiteSettings }] });
  await router.push('/admin/site-settings');
  await router.isReady();
  const subject = defineComponent({ template: '<router-view />' });
  const wrapper = mount(subject, { attachTo: document.body, global: { plugins: [router, ElementPlus] } });
  wrappers.push(wrapper);
  await flushPromises();
  if (openAbout && wrapper.find('#tab-about').exists()) {
    await wrapper.get('#tab-about').trigger('click');
    await flushPromises();
  }
  return wrapper;
}
function button(wrapper: VueWrapper, text: string, card = 'about-setting') {
  const found = wrapper.get(`.${card}`).findAll('button').find(candidate => candidate.text() === text);
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found;
}
function editor(wrapper: VueWrapper): Editor {
  return wrapper.getComponent(EditorContent).props('editor') as Editor;
}
function aboutState(wrapper: VueWrapper) {
  return (wrapper.getComponent(SiteSettings).vm.$ as unknown as { setupState: {
    aboutForm: ReturnType<typeof about> & Record<string, unknown>;
    aboutSaved: ReturnType<typeof about> & Record<string, unknown>;
    load: (part: 'about') => Promise<void>;
  } }).setupState;
}

describe('site about settings', () => {
  it('uses the import-page layout with two tabs inside one white card and keeps both clean after loading', async () => {
    const wrapper = await render(false);
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    const cards = wrapper.findAll('.page-card');
    expect(cards).toHaveLength(1);
    expect(wrapper.find('.page-card > .el-tabs').exists()).toBe(true);
    expect(wrapper.find('.page-card .page-card').exists()).toBe(false);
    expect(wrapper.get('.branding-setting').text()).toContain('学员端首页轮播图');
    expect(wrapper.findAll('.about-setting input')).toHaveLength(6);
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toEqual(['品牌展示', '关于我们']);
    expect(wrapper.findAll('h3').map(title => title.text())).toEqual(['网站 Logo', '学员端首页轮播图']);
    expect(wrapper.get('#tab-branding').attributes('aria-selected')).toBe('true');
    expect(wrapper.findAll('.logo-uploader')).toHaveLength(1);
    expect(wrapper.get('input[aria-label="机构名称"]').element).toHaveProperty('value', '测试培训中心');
    expect(wrapper.getComponent(TiptapEditor).props()).toMatchObject({ profile: 'rich', showPanels: false, presentation: 'inline' });
    expect(editor(wrapper).getText()).toBe('请妥善保管账号。');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '撤销修改').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '保存并发布', 'branding-setting').attributes('disabled')).toBeDefined();
  });

  it('preserves both drafts and the same editor across tab switches without an unsaved prompt', async () => {
    const wrapper = await render();
    expect(wrapper.find('#tab-about').exists()).toBe(true);
    const originalEditor = editor(wrapper);
    await wrapper.get('input[aria-label="机构名称"]').setValue('未发布机构');
    originalEditor.commands.insertContent('未发布条款');
    await wrapper.get('#tab-branding').trigger('click');
    await wrapper.get('.logo-uploader .el-upload-list__item-delete').trigger('click');
    await wrapper.get('#tab-about').trigger('click');
    await flushPromises();
    expect(editor(wrapper)).toBe(originalEditor);
    expect(editor(wrapper).getText()).toContain('未发布条款');
    expect(wrapper.get('input[aria-label="机构名称"]').element).toHaveProperty('value', '未发布机构');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeUndefined();
    await wrapper.get('#tab-branding').trigger('click');
    expect(wrapper.findAll('.logo-uploader .el-upload-list__item')).toHaveLength(0);
    expect(button(wrapper, '保存并发布', 'branding-setting').attributes('disabled')).toBeUndefined();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('uses the existing H5 defaults when an older GET has no about without marking the form dirty', async () => {
    mocks.get.mockResolvedValue({ logo_asset_id: null, banners: [] });
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    expect(wrapper.get('input[aria-label="机构名称"]').element).toHaveProperty('value', '海珠区安全教育培训中心');
    expect(wrapper.get('input[aria-label="平台简介"]').element).toHaveProperty('value', '安全教育培训与考试平台');
    expect(wrapper.get('input[aria-label="版本号"]').element).toHaveProperty('value', '1.2.0');
    expect(editor(wrapper).getText()).toContain('海珠区安全教育培训中心服务使用协议');
    expect(wrapper.get('input[aria-label="联系邮箱"]').element).toHaveProperty('value', '');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
  });

  it('saves only the seven about fields and sends compatible JSON while keeping linked text', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    await wrapper.get('input[aria-label="机构名称"]').setValue(' 新机构 ');
    await wrapper.get('input[aria-label="联系邮箱"]').setValue('support@example.com');
    await wrapper.get('input[aria-label="微信公众号"]').setValue('training-center');
    await wrapper.get('input[aria-label="联系电话"]').setValue('+86 (020) 1234-5678');
    editor(wrapper).commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{
      type: 'text', text: '账号使用说明', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }],
    }] }] });
    await flushPromises();
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put).toHaveBeenCalledTimes(1);
    const [path, sent] = mocks.put.mock.calls[0]!;
    expect(path).toBe('/admin/site-settings');
    expect(Object.keys(sent)).toEqual(['about']);
    expect(sent).toMatchObject({ about: {
      institution_name: '新机构', platform_subtitle: '培训与考试平台', version: '2.0.0',
      contact_email: 'support@example.com', wechat_account: 'training-center', contact_phone: '+86 (020) 1234-5678',
    } });
    expect(JSON.stringify(sent.about.service_terms)).not.toContain('href');
    expect(parseRichDocV3(sent.about.service_terms).content[0]).toMatchObject({ content: [{ type: 'text', text: '账号使用说明', marks: [{ type: 'bold' }] }] });
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
  });

  it('projects a legacy GET without contact_phone and publishes the new phone with only supported fields', async () => {
    const legacyAbout: Partial<ReturnType<typeof about>> & Record<string, unknown> = {
      ...about(), qq_group: '123456', obsolete_field: 'old value',
    };
    delete legacyAbout.contact_phone;
    mocks.get.mockResolvedValue({ ...config(), about: legacyAbout });
    mocks.put.mockImplementation(async (_path, payload) => ({ ...config(), about: normalizeSiteAbout(payload.about) }));
    const wrapper = await render();
    expect(wrapper.get('input[aria-label="联系电话"]').element).toHaveProperty('value', '');
    await wrapper.get('input[aria-label="联系电话"]').setValue('400-004-0686');
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(Object.keys(mocks.put.mock.calls[0]![1].about).sort()).toEqual([
      'contact_email', 'contact_phone', 'institution_name', 'platform_subtitle', 'service_terms', 'version', 'wechat_account',
    ]);
    expect(wrapper.get('input[aria-label="联系电话"]').element).toHaveProperty('value', '400-004-0686');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    expect(aboutState(wrapper).aboutForm).not.toHaveProperty('qq_group');
    expect(aboutState(wrapper).aboutSaved).not.toHaveProperty('obsolete_field');
  });

  it('ignores obsolete draft fields and removes them on save, discard and reload while retaining branding edits', async () => {
    const wrapper = await render();
    const state = aboutState(wrapper);
    Object.assign(state.aboutForm, { qq_group: '123456', obsolete_field: 'HMR draft' });
    await flushPromises();
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    mocks.put.mockImplementation(async (_path, payload) => ({ ...config(), about: normalizeSiteAbout(payload.about) }));
    await wrapper.get('input[aria-label="联系电话"]').setValue('400-004-0686');
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put.mock.calls[0]![1].about).not.toHaveProperty('qq_group');
    expect(mocks.put.mock.calls[0]![1].about).not.toHaveProperty('obsolete_field');
    expect(state.aboutForm).not.toHaveProperty('qq_group');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    expect(wrapper.get('input[aria-label="联系电话"]').element).toHaveProperty('value', '400-004-0686');

    Object.assign(state.aboutSaved, { qq_group: 'old saved value' });
    Object.assign(state.aboutForm, { qq_group: 'old draft value', obsolete_field: 'HMR draft' });
    await wrapper.get('input[aria-label="联系电话"]').setValue('020-12345678');
    await wrapper.get('.logo-uploader .el-upload-list__item-delete').trigger('click');
    await button(wrapper, '撤销修改').trigger('click');
    await flushPromises();
    expect(state.aboutSaved).not.toHaveProperty('qq_group');
    expect(state.aboutForm).not.toHaveProperty('qq_group');
    expect(state.aboutForm).not.toHaveProperty('obsolete_field');
    expect(wrapper.get('input[aria-label="联系电话"]').element).toHaveProperty('value', '400-004-0686');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('.logo-uploader .el-upload-list__item')).toHaveLength(0);
    expect(button(wrapper, '保存并发布', 'branding-setting').attributes('disabled')).toBeUndefined();

    Object.assign(state.aboutSaved, { qq_group: 'old saved value' });
    Object.assign(state.aboutForm, { qq_group: 'old draft value', obsolete_field: 'HMR draft' });
    mocks.get.mockResolvedValue({ ...config(), about: { ...about(), contact_phone: '400-004-0686', qq_group: 'old response' } });
    await state.load('about');
    await flushPromises();
    expect(state.aboutSaved).not.toHaveProperty('qq_group');
    expect(state.aboutForm).not.toHaveProperty('qq_group');
    expect(state.aboutForm).not.toHaveProperty('obsolete_field');
    expect(wrapper.get('input[aria-label="联系电话"]').element).toHaveProperty('value', '400-004-0686');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('.logo-uploader .el-upload-list__item')).toHaveLength(0);
    expect(button(wrapper, '保存并发布', 'branding-setting').attributes('disabled')).toBeUndefined();
  });

  it('keeps rich toolbar formatting and table output compatible with the service terms parser', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    const instance = editor(wrapper);
    instance.commands.selectAll();
    instance.chain().setFontFamily('SimSun').setFontSize('16pt').setColor('rgb(41, 114, 245)').setHighlight({ color: '#ffff00' }).setTextAlign('center').setLineHeight('1.5').run();
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
    instance.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    await flushPromises();
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    const doc = mocks.put.mock.calls[0]?.[1].about.service_terms;
    expect(doc).toBeTruthy();
    const parsed = parseRichDocV3(doc);
    expect(parsed.content.some(node => node.type === 'table')).toBe(true);
    expect(JSON.stringify(parsed)).toContain('16pt');
    expect(JSON.stringify(parsed)).toContain('rgb(41, 114, 245)');
  });

  it('keeps the caret and typed order after setting only color and typing across Vue updates', async () => {
    const wrapper = await render();
    const instance = editor(wrapper);
    instance.commands.setTextSelection(1);
    instance.commands.setColor('#2972f5');
    instance.commands.insertContent('甲');
    await flushPromises();
    expect(instance.state.selection.from).toBe(2);
    instance.commands.insertContent('乙');
    await flushPromises();
    expect(instance.getText()).toBe('甲乙请妥善保管账号。');
    expect(instance.state.selection.from).toBe(3);
  });

  it('restores the last saved fields and terms after confirming discard', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    await wrapper.get('input[aria-label="机构名称"]').setValue('未保存机构');
    editor(wrapper).commands.insertContent('未保存条款');
    await flushPromises();
    await button(wrapper, '撤销修改').trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(wrapper.get('input[aria-label="机构名称"]').element).toHaveProperty('value', '测试培训中心');
    expect(editor(wrapper).getText()).toBe('请妥善保管账号。');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('keeps brand edits dirty when only about is published even if the response includes old branding', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    await wrapper.get('.logo-uploader .el-upload-list__item-delete').trigger('click');
    await wrapper.get('input[aria-label="机构名称"]').setValue('已发布机构');
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(Object.keys(mocks.put.mock.calls[0]![1])).toEqual(['about']);
    expect(wrapper.findAll('.logo-uploader .el-upload-list__item')).toHaveLength(0);
    expect(button(wrapper, '保存并发布', 'branding-setting').attributes('disabled')).toBeUndefined();
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
    await button(wrapper, '保存并发布', 'branding-setting').trigger('click');
    await flushPromises();
    expect(mocks.put.mock.calls[1]![1]).toEqual({ logo_asset_id: null, banners: [{ asset_id: '20', sort: 10 }] });
    expect(wrapper.get('input[aria-label="机构名称"]').element).toHaveProperty('value', '已发布机构');
  });

  it('keeps about edits and terms dirty when only branding is published', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    await wrapper.get('input[aria-label="机构名称"]').setValue('未发布机构');
    editor(wrapper).commands.insertContent('未发布条款');
    await wrapper.get('.logo-uploader .el-upload-list__item-delete').trigger('click');
    await button(wrapper, '保存并发布', 'branding-setting').trigger('click');
    await flushPromises();
    expect(mocks.put.mock.calls[0]![1]).toEqual({ logo_asset_id: null, banners: [{ asset_id: '20', sort: 10 }] });
    expect(wrapper.get('input[aria-label="机构名称"]').element).toHaveProperty('value', '未发布机构');
    expect(editor(wrapper).getText()).toContain('未发布条款');
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeUndefined();
    expect(button(wrapper, '保存并发布', 'branding-setting').attributes('disabled')).toBeDefined();
  });

  it('discards only the requested card and still warns before leaving with the other dirty card', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    await wrapper.get('input[aria-label="机构名称"]').setValue('未发布机构');
    await wrapper.get('.logo-uploader .el-upload-list__item-delete').trigger('click');
    await button(wrapper, '撤销修改').trigger('click');
    await flushPromises();
    expect(wrapper.get('input[aria-label="机构名称"]').element).toHaveProperty('value', '测试培训中心');
    expect(wrapper.findAll('.logo-uploader .el-upload-list__item')).toHaveLength(0);
    expect(button(wrapper, '撤销修改', 'branding-setting').attributes('disabled')).toBeUndefined();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await button(wrapper, '撤销修改', 'branding-setting').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.logo-uploader .el-upload-list__item')).toHaveLength(1);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it('shows saving only on the active card and keeps the other card editable', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    await wrapper.get('input[aria-label="机构名称"]').setValue('待发布机构');
    let finish!: (result: ReturnType<typeof config>) => void;
    mocks.put.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await button(wrapper, '保存并发布').trigger('click');
    expect(button(wrapper, '保存并发布').classes()).toContain('is-loading');
    expect(button(wrapper, '保存并发布', 'branding-setting').classes()).not.toContain('is-loading');
    await wrapper.get('.logo-uploader .el-upload-list__item-delete').trigger('click');
    expect(button(wrapper, '保存并发布', 'branding-setting').attributes('disabled')).toBeUndefined();
    finish(config());
    await flushPromises();
    expect(wrapper.findAll('.logo-uploader .el-upload-list__item')).toHaveLength(0);
  });

  it.each([
    ['机构名称', '   ', '机构名称'],
    ['机构名称', '😀'.repeat(65), '机构名称'],
    ['平台简介', 'x'.repeat(201), '平台简介'],
    ['版本号', '', '版本号'],
    ['联系邮箱', 'not-an-email', '邮箱'],
    ['联系电话', '123abc', '联系电话格式不正确'],
    ['联系电话', 'https://example.com', '联系电话格式不正确'],
  ])('does not publish an invalid %s field', async (label, value, message) => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    await wrapper.get(`input[aria-label="${label}"]`).setValue(value);
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(wrapper.get('.about-setting').text()).toContain(message);
    expect(wrapper.find('.el-form-item__error').exists() || wrapper.find('.about-error').exists()).toBe(true);
  });

  it.each(['13800138000', '020-12345678', '+1 (415) 555-0123', ''])('accepts optional mobile, landline and international phone %s', async phone => {
    const wrapper = await render();
    expect(wrapper.find('input[aria-label="联系电话"]').exists()).toBe(true);
    await wrapper.get('input[aria-label="机构名称"]').setValue('新机构');
    await wrapper.get('input[aria-label="联系电话"]').setValue(phone);
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put.mock.calls[0]![1].about.contact_phone).toBe(phone);
    expect(mocks.put.mock.calls[0]![1].about).not.toHaveProperty('qq_group');
  });

  it('blocks media and oversized UTF-8 terms with a visible error until the editor is corrected', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    editor(wrapper).commands.insertMediaImage({ asset_id: '42' });
    await flushPromises();
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(wrapper.get('.about-setting').text()).toMatch(/不支持.*图片|图片.*不支持|不能.*图片/);
    editor(wrapper).commands.setContent({ type: 'doc', content: [paragraph('中'.repeat(34000))] });
    await flushPromises();
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(wrapper.get('.about-setting').text()).toContain('100000');
    editor(wrapper).commands.setContent({ type: 'doc', content: [paragraph('修正后的条款')] });
    await flushPromises();
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });

  it('publishes a blank editor as null so the learner terms entry can be hidden', async () => {
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    editor(wrapper).commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }] });
    await flushPromises();
    await button(wrapper, '保存并发布').trigger('click');
    await flushPromises();
    expect(mocks.put.mock.calls[0]?.[1].about.service_terms).toBeNull();
    expect(button(wrapper, '保存并发布').attributes('disabled')).toBeDefined();
  });

  it('keeps all about controls readonly and clean without write permission', async () => {
    mocks.writable = false;
    const wrapper = await render();
    expect(wrapper.find('.about-setting').exists()).toBe(true);
    expect(wrapper.findAll('.about-setting input').every(input => input.attributes('disabled') !== undefined)).toBe(true);
    expect(wrapper.getComponent(TiptapEditor).props('mode')).toBe('preview');
    expect(editor(wrapper).isEditable).toBe(false);
    editor(wrapper).commands.insertContent('不应写入');
    await flushPromises();
    expect(editor(wrapper).getText()).toBe('请妥善保管账号。');
    expect(button(wrapper, '撤销修改').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('button').some(candidate => candidate.text() === '保存并发布')).toBe(false);
  });
});
