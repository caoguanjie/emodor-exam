import { afterEach, describe, expect, it } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import RoleSelect from '../RoleSelect.vue';

const options = [
  { id: 'role-1', name: '教学管理员', code: 'r_AbC123' },
  { id: 'role-2', name: 'Operations', code: 'Ops_Editor' },
  { id: 'role-3', name: '历史角色', code: 'legacy_role', unavailable: true },
];
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function render(props: Partial<InstanceType<typeof RoleSelect>['$props']> = {}) {
  const wrapper = mount(RoleSelect, {
    attachTo: document.body,
    props: {
      modelValue: [], options, ...props,
      'onUpdate:modelValue': (value: string[]) => { void wrapper.setProps({ modelValue: value }); },
    },
    global: { plugins: [ElementPlus] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

function visibleOptions() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    .map((element) => new DOMWrapper(element)).filter((option) => option.isVisible());
}
function tagNames(wrapper: VueWrapper) { return wrapper.findAll('.el-tag__content').map((tag) => tag.text()); }
async function open(wrapper: VueWrapper) {
  await wrapper.get('[role="combobox"]').trigger('click');
  await flushPromises();
}
async function search(wrapper: VueWrapper, query: string) {
  await wrapper.get('input[role="combobox"]').setValue(query);
  await flushPromises();
}
async function choose(name: string) {
  const option = visibleOptions().find((item) => item.text().includes(name));
  expect(option, `visible role ${name}`).toBeDefined();
  await option!.trigger('click');
  await flushPromises();
}
function bulkButton(label: string, visible = true) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.el-select-dropdown__header button'))
    .map((element) => new DOMWrapper(element));
  const button = buttons.find((item) => item.text() === label && (!visible || item.isVisible()));
  expect(button, `bulk action ${label}`).toBeDefined();
  return button!;
}
async function bulk(label: string) {
  const button = bulkButton(label);
  await button.trigger('mousedown');
  await button.trigger('click');
  await flushPromises();
}

describe('searchable role multi-select', () => {
  it('emits selected IDs and displays native role-name tags without internal codes', async () => {
    const wrapper = await render();
    await open(wrapper);
    await choose('教学管理员');
    await choose('Operations');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1', 'role-2']]);
    expect(tagNames(wrapper)).toEqual(['教学管理员', 'Operations']);
    expect(document.body.textContent).not.toMatch(/r_AbC123|Ops_Editor|legacy_role/);
    expect(wrapper.get('[role="combobox"]').attributes('aria-label')).toBe('角色');
  });

  it('filters trimmed names and internal codes without case sensitivity', async () => {
    const wrapper = await render();
    await open(wrapper);
    await search(wrapper, '  operATIONS  ');
    expect(visibleOptions().map((option) => option.text())).toEqual(['Operations']);
    await search(wrapper, ' R_aBc123 ');
    expect(visibleOptions().map((option) => option.text())).toEqual(['教学管理员']);
    await search(wrapper, '教学');
    expect(visibleOptions().map((option) => option.text())).toEqual(['教学管理员']);
  });

  it('keeps selected role labels while filtering hides their options and adds another selection', async () => {
    const wrapper = await render({ modelValue: ['role-1'] });
    await open(wrapper);
    await search(wrapper, 'OPS_');
    expect(visibleOptions().map((option) => option.text())).toEqual(['Operations']);
    expect(tagNames(wrapper)).toEqual(['教学管理员']);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await choose('Operations');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1', 'role-2']]);
    expect(tagNames(wrapper)).toEqual(['教学管理员', 'Operations']);
    expect(wrapper.get<HTMLInputElement>('[role="combobox"]').element.value).toBe('');
    expect(visibleOptions()).toHaveLength(3);
  });

  it('removes an individual native tag and clears the remaining selections', async () => {
    const wrapper = await render({ modelValue: ['role-1', 'role-2'] });
    await wrapper.findAll('.el-tag__close')[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-2']]);
    expect(tagNames(wrapper)).toEqual(['Operations']);
    await wrapper.get('.el-select').trigger('mouseenter');
    await wrapper.get('.el-select__clear').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);
    expect(tagNames(wrapper)).toEqual([]);
  });

  it('blocks native selection and tag removal while disabled, then allows interaction when enabled', async () => {
    const wrapper = await render({ modelValue: ['role-1'], disabled: true });
    expect(wrapper.get<HTMLInputElement>('[role="combobox"]').element.disabled).toBe(true);
    expect(wrapper.find('.el-tag__close').exists()).toBe(false);
    await open(wrapper);
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('false');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.setProps({ disabled: false });
    await open(wrapper);
    await choose('Operations');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1', 'role-2']]);
  });

  it('shows loading feedback and offers loaded roles without changing the current selection', async () => {
    const wrapper = await render({ options: [], loading: true });
    await open(wrapper);
    expect(document.body.textContent).toContain('正在加载角色');
    expect(visibleOptions()).toEqual([]);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.setProps({ options, loading: false });
    await flushPromises();
    expect(visibleOptions().map((option) => option.text())).toEqual(['教学管理员', 'Operations', '历史角色已停用']);
    expect(document.body.textContent).not.toContain('正在加载角色');
  });

  it.each([
    { emptyText: undefined, expected: '暂无可用业务角色' },
    { emptyText: '请先创建业务角色', expected: '请先创建业务角色' },
  ])('shows a friendly empty list message: $expected', async ({ emptyText, expected }) => {
    const wrapper = await render({ options: [], ...(emptyText ? { emptyText } : {}) });
    await open(wrapper);
    expect(document.body.textContent).toContain(expected);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('distinguishes no search matches from an empty role catalog while keeping selected tags', async () => {
    const wrapper = await render({ modelValue: ['role-1'] });
    await open(wrapper);
    await search(wrapper, '不存在的角色');
    expect(visibleOptions()).toEqual([]);
    expect(document.body.textContent).toContain('未找到匹配角色');
    expect(document.body.textContent).not.toContain('暂无可用业务角色');
    expect(tagNames(wrapper)).toEqual(['教学管理员']);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await search(wrapper, '   ');
    expect(visibleOptions()).toHaveLength(3);
  });

  it('retains, removes, and reselects an unavailable historical role without disabling the option', async () => {
    const wrapper = await render({ modelValue: ['role-3'] });
    expect(tagNames(wrapper)).toEqual(['历史角色']);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await open(wrapper);
    const historical = visibleOptions().find((option) => option.text().includes('历史角色'))!;
    expect(historical.text()).toBe('历史角色已停用');
    expect(historical.attributes('aria-disabled')).not.toBe('true');
    await choose('历史角色');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);
    await choose('历史角色');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-3']]);
    expect(tagNames(wrapper)).toEqual(['历史角色']);
  });

  it('resets the search query when the native dropdown closes and reopens', async () => {
    const wrapper = await render({ modelValue: ['role-1'] });
    await open(wrapper);
    await search(wrapper, 'Operations');
    expect(visibleOptions()).toHaveLength(1);
    await wrapper.get('.el-select__suffix').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('false');
    await open(wrapper);
    expect(wrapper.get<HTMLInputElement>('[role="combobox"]').element.value).toBe('');
    expect(visibleOptions()).toHaveLength(3);
    expect(tagNames(wrapper)).toEqual(['教学管理员']);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('uses native keyboard navigation and configurable field labeling', async () => {
    const wrapper = await render({ ariaLabel: '管理员业务角色', placeholder: '请选择业务角色' });
    const input = wrapper.get('[role="combobox"]');
    expect(input.attributes('aria-label')).toBe('管理员业务角色');
    expect(wrapper.text()).toContain('请选择业务角色');
    await open(wrapper);
    await search(wrapper, 'Ops_Editor');
    await input.trigger('keydown', { key: 'ArrowDown', code: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter', code: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-2']]);
    expect(tagNames(wrapper)).toEqual(['Operations']);
  });
});

describe('role multi-select bulk actions', () => {
  it.each(['全选', '反选'])('keeps every new tag name when %s starts from an empty selection after searching', async (action) => {
    const wrapper = await render({ modelValue: [] });
    await open(wrapper);
    await search(wrapper, '教学');
    expect(visibleOptions().map((option) => option.text())).toEqual(['教学管理员']);
    await bulk(action);
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1', 'role-2']]);
    expect(tagNames(wrapper)).toEqual(['教学管理员', 'Operations']);
    expect(wrapper.get<HTMLInputElement>('[role="combobox"]').element.value).toBe('教学');
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('true');
    await wrapper.setProps({ disabled: true });
    expect(wrapper.find('.el-tag__close').exists()).toBe(false);
    await wrapper.setProps({ disabled: false });
    await wrapper.findAll('.el-tag__close')[1]!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1']]);
    expect(tagNames(wrapper)).toEqual(['教学管理员']);
  });

  it('selects every available role regardless of the search and preserves selected unavailable and unknown IDs', async () => {
    const model = ['role-3', 'unknown-role'];
    const suppliedOptions = options.map((option) => ({ ...option }));
    Object.freeze(model);
    Object.freeze(suppliedOptions);
    const wrapper = await render({ modelValue: model, options: suppliedOptions });
    await open(wrapper);
    await search(wrapper, 'Operations');
    await bulk('全选');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-3', 'unknown-role', 'role-1', 'role-2']]);
    expect(document.body.textContent).toContain('已选 4 项');
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get<HTMLInputElement>('[role="combobox"]').element.value).toBe('Operations');
    expect(model).toEqual(['role-3', 'unknown-role']);
    expect(suppliedOptions).toEqual(options);
  });

  it('selects and cancels only available search results while retaining every other selection and the query', async () => {
    const wrapper = await render({ modelValue: ['role-1', 'role-3', 'unknown-role'] });
    await open(wrapper);
    await search(wrapper, ' Ops_Editor ');
    expect(document.body.textContent).toContain('结果 1 项');
    await bulk('选中搜索结果');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1', 'role-3', 'unknown-role', 'role-2']]);
    expect(bulkButton('选中搜索结果').element.disabled).toBe(true);
    await bulk('取消搜索结果');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1', 'role-3', 'unknown-role']]);
    expect(bulkButton('取消搜索结果').element.disabled).toBe(true);
    expect(wrapper.get<HTMLInputElement>('[role="combobox"]').element.value).toBe(' Ops_Editor ');
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('true');
    expect(visibleOptions().map((option) => option.text())).toEqual(['Operations']);
  });

  it('inverts the complete available catalog rather than the search results', async () => {
    const wrapper = await render({ modelValue: ['role-1', 'role-3', 'unknown-role'] });
    await open(wrapper);
    await search(wrapper, 'Operations');
    await bulk('反选');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-3', 'unknown-role', 'role-2']]);
    await bulk('反选');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-3', 'unknown-role', 'role-1']]);
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('true');
  });

  it('never re-adds a manually removed unavailable historical role through bulk actions', async () => {
    const wrapper = await render({ modelValue: ['role-1', 'role-3'] });
    await open(wrapper);
    await choose('历史角色');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1']]);
    await bulk('全选');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-1', 'role-2']]);
    await bulk('反选');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);
    await search(wrapper, 'legacy_role');
    expect(document.body.textContent).toContain('结果 1 项');
    expect(bulkButton('选中搜索结果').element.disabled).toBe(true);
    expect(bulkButton('取消搜索结果').element.disabled).toBe(true);
  });

  it('clears every ID including unavailable and unknown selections without closing the dropdown or clearing the query', async () => {
    const wrapper = await render({ modelValue: ['role-1', 'role-3', 'unknown-role'] });
    await open(wrapper);
    await search(wrapper, 'Operations');
    await bulk('清空');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);
    expect(tagNames(wrapper)).toEqual([]);
    expect(document.body.textContent).toContain('已选 0 项');
    expect(bulkButton('清空').element.disabled).toBe(true);
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get<HTMLInputElement>('[role="combobox"]').element.value).toBe('Operations');
  });

  for (const blocked of ['disabled', 'loading'] as const) {
    it(`blocks all bulk buttons and direct action methods while ${blocked}`, async () => {
      const wrapper = await render({ modelValue: ['role-1'] });
      await open(wrapper);
      await search(wrapper, 'Operations');
      await wrapper.setProps({ [blocked]: true });
      await flushPromises();
      for (const label of ['全选', '反选', '清空', '选中搜索结果', '取消搜索结果']) {
        expect(bulkButton(label, false).element.disabled).toBe(true);
      }
      const state = (wrapper.vm.$ as any).setupState;
      await state.selectAll();
      await state.invertSelection();
      await state.clearAll();
      await state.selectSearchResults();
      await state.cancelSearchResults();
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
      expect(tagNames(wrapper)).toEqual(['教学管理员']);
    });
  }

  it('disables empty and already satisfied actions and emits deduplicated IDs', async () => {
    const wrapper = await render({ options: [] });
    await open(wrapper);
    for (const label of ['全选', '反选', '清空']) expect(bulkButton(label).element.disabled).toBe(true);
    expect(bulkButton('全选').text()).toBe('全选');
    await wrapper.setProps({ options, modelValue: ['role-1', 'role-2'] });
    await flushPromises();
    expect(bulkButton('全选').element.disabled).toBe(true);
    const state = (wrapper.vm.$ as any).setupState;
    await state.selectAll();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.setProps({ modelValue: ['role-3', 'role-3', 'unknown-role', 'unknown-role'] });
    await flushPromises();
    await bulk('全选');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['role-3', 'unknown-role', 'role-1', 'role-2']]);
    expect(document.body.textContent).toContain('已选 4 项');
  });
});
