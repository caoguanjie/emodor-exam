import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mounted = [];
const originalGlobals = new Map();
let dom;
let vite;
let vue;
let components;
let ElButton;
let ElForm;
let ElFormItem;

before(async () => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'MouseEvent', 'Event']) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
  vue = await import('vue');
  ({ ElButton, ElForm, ElFormItem } = await import('element-plus'));
  vite = await createServer({
    root: webRoot,
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  });
  components = await vite.ssrLoadModule('/src/components/FitsTable/index.ts');
  const style = document.createElement('style');
  style.textContent = [
    await readFile(resolve(webRoot, 'node_modules/element-plus/theme-chalk/el-button.css'), 'utf8'),
    await readFile(resolve(webRoot, 'src/style.css'), 'utf8'),
    await readFile(resolve(webRoot, 'src/components/FitsTable/style.css'), 'utf8'),
  ].join('\n');
  document.head.append(style);
});

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  document.body.replaceChildren();
});

after(async () => {
  await vite?.close();
  dom?.window.close();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

function component(name) {
  assert.ok(components[name], `${name} should be exported by the public table module`);
  return components[name];
}

function mount(render) {
  const root = document.createElement('div');
  document.body.append(root);
  const app = vue.createApp({ render });
  app.component('el-button', ElButton);
  app.component('el-form', ElForm);
  app.component('el-form-item', ElFormItem);
  app.mount(root);
  mounted.push(app);
  return root;
}

test('row action defaults to a focusable primary link and forwards attributes and one click', () => {
  const Action = component('FitsTableAction');
  const events = [];
  const root = mount(() => vue.h(Action, {
    id: 'edit-action',
    class: 'page-action',
    'aria-label': '编辑学员',
    'data-user-id': 'user-1',
    title: '编辑资料',
    link: false,
    text: true,
    bg: true,
    tag: 'a',
    onClick: (event) => events.push(event),
  }, { default: () => '编辑' }));
  const button = root.querySelector('button');
  assert.ok(button, 'actions retain native button semantics even if an anchor tag is requested');
  assert.equal(button.type, 'button');
  assert.equal(button.tabIndex, 0);
  assert.equal(button.textContent, '编辑');
  assert.ok(button.classList.contains('el-button--primary'));
  assert.ok(button.classList.contains('is-link'));
  assert.ok(button.classList.contains('page-action'));
  assert.equal(button.classList.contains('is-text'), false);
  assert.equal(button.classList.contains('is-has-bg'), false);
  assert.equal(button.id, 'edit-action');
  assert.equal(button.getAttribute('aria-label'), '编辑学员');
  assert.equal(button.dataset.userId, 'user-1');
  assert.equal(button.title, '编辑资料');
  button.focus();
  assert.equal(document.activeElement, button);
  button.click();
  assert.equal(events.length, 1);
  assert.ok(events[0] instanceof MouseEvent);
});

test('row actions retain warning and danger colors and custom icon slots', () => {
  const Action = component('FitsTableAction');
  const root = mount(() => vue.h('div', [
    vue.h(Action, { type: 'warning' }, { default: () => '停用' }),
    vue.h(Action, { type: 'danger', size: 'small' }, {
      default: () => '重置密码',
      icon: () => vue.h('span', { 'data-icon': 'reset' }),
    }),
  ]));
  const [warning, danger] = root.querySelectorAll('button');
  assert.ok(warning.classList.contains('el-button--warning'));
  assert.ok(danger.classList.contains('el-button--danger'));
  assert.ok(danger.classList.contains('el-button--small'));
  assert.ok(danger.querySelector('[data-icon="reset"]'));
});

test('disabled and loading updates suppress clicks and preserve the loading slot', async () => {
  const Action = component('FitsTableAction');
  const disabled = vue.ref(true);
  const loading = vue.ref(false);
  let clicks = 0;
  let bubbled = 0;
  const root = mount(() => vue.h('div', { onClick: () => bubbled++ }, [
    vue.h(Action, { disabled: disabled.value, loading: loading.value, onClick: () => clicks++ }, {
      default: () => '保存',
      loading: () => vue.h('span', { 'data-loading': 'pending' }, '处理中'),
    }),
  ]));
  const button = root.querySelector('button');
  assert.equal(button.disabled, true);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(clicks, 0);
  assert.equal(bubbled, 0);

  disabled.value = false;
  loading.value = true;
  await vue.nextTick();
  assert.equal(button.disabled, true);
  assert.ok(button.classList.contains('is-loading'));
  assert.ok(button.querySelector('[data-loading="pending"]'));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(clicks, 0);
  assert.equal(bubbled, 0);

  loading.value = false;
  await vue.nextTick();
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(clicks, 1);
  assert.equal(bubbled, 1);
});

test('row group wraps compact actions without changing ordinary button spacing', () => {
  const Actions = component('FitsTableActions');
  const Action = component('FitsTableAction');
  const root = mount(() => vue.h('div', [
    vue.h(Actions, { class: 'page-actions', 'data-row-id': 'row-1' }, { default: () => [
      vue.h(Action, null, { default: () => '编辑' }),
      vue.h(Action, { type: 'warning' }, { default: () => '停用' }),
    ] }),
    vue.h('div', { id: 'ordinary-actions' }, [
      vue.h(ElButton, null, { default: () => '新增' }),
      vue.h(ElButton, null, { default: () => '查询' }),
    ]),
  ]));
  const group = root.querySelector('[aria-label="行操作"]');
  assert.ok(group);
  assert.equal(group.getAttribute('role'), 'group');
  assert.ok(group.classList.contains('page-actions'));
  assert.equal(group.dataset.rowId, 'row-1');
  const groupStyle = dom.window.getComputedStyle(group);
  assert.equal(groupStyle.display, 'flex');
  assert.equal(groupStyle.flexWrap, 'wrap');
  assert.equal(groupStyle.alignItems, 'center');
  assert.equal(groupStyle.gap, '10px');
  const [first, second] = group.querySelectorAll('button');
  for (const button of [first, second]) {
    const style = dom.window.getComputedStyle(button);
    assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)');
    assert.equal(style.borderTopWidth, '0px');
    assert.equal(style.paddingLeft, '4px');
    assert.equal(style.paddingRight, '4px');
    assert.equal(style.fontSize, '14px');
    assert.equal(style.textDecoration, 'underline');
  }
  assert.equal(dom.window.getComputedStyle(second).marginLeft, '0px');
  const ordinary = root.querySelectorAll('#ordinary-actions button');
  assert.equal(dom.window.getComputedStyle(ordinary[1]).marginLeft, '12px');
  assert.equal(dom.window.getComputedStyle(ordinary[0]).paddingLeft, '15px');
});

for (const state of ['rest', 'hover', 'active']) {
  test(`row actions suppress primary button shadows and movement during ${state}`, () => {
    const Action = component('FitsTableAction');
    const root = mount(() => vue.h('div', [
      vue.h(Action, null, { default: () => '编辑' }),
      vue.h(ElButton, { type: 'primary' }, { default: () => '新增' }),
    ]));
    const [action, ordinary] = root.querySelectorAll('button');
    function applyState(button) {
      if (state === 'hover') button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      if (state === 'active') button.focus();
      // Invalidate jsdom's computed-style cache after changing the interaction state.
      button.setAttribute('data-interaction', state);
      if (state !== 'rest') assert.ok(button.matches(`:${state}`));
    }

    applyState(action);
    const actionStyle = dom.window.getComputedStyle(action);
    assert.equal(actionStyle.boxShadow, 'none');
    assert.equal(actionStyle.transform, 'none');
    action.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

    applyState(ordinary);
    const ordinaryStyle = dom.window.getComputedStyle(ordinary);
    assert.notEqual(ordinaryStyle.boxShadow, 'none', 'ordinary primary buttons retain their global shadow');
    if (state === 'hover') assert.equal(ordinaryStyle.transform, 'translateY(-1px)');
    if (state === 'active') assert.equal(ordinaryStyle.transform, 'translateY(0)');
  });
}

test('permission-hidden row actions leave no empty group and reappear reactively', async () => {
  const Actions = component('FitsTableActions');
  const Action = component('FitsTableAction');
  const visible = vue.ref(false);
  const root = mount(() => vue.h(Actions, null, { default: () => [
    vue.h(vue.Fragment, null, [vue.h(vue.Comment), vue.createTextVNode('  ')]),
    visible.value ? vue.h(Action, null, { default: () => '编辑' }) : vue.h(vue.Comment),
  ] }));
  assert.equal(root.querySelector('[aria-label="行操作"]'), null);
  visible.value = true;
  await vue.nextTick();
  assert.equal(root.querySelector('[aria-label="行操作"] button')?.textContent, '编辑');
  visible.value = false;
  await vue.nextTick();
  assert.equal(root.querySelector('[aria-label="行操作"]'), null);
});

test('existing table strips still omit hidden slots and search forms prevent navigation', () => {
  const { FitsTable, FitsListSearch } = components;
  const root = mount(() => vue.h(FitsTable, { 'data-list': 'learners' }, {
    search: () => vue.h(FitsListSearch, { labelWidth: '100px', 'data-search': 'learners' }, {
      default: () => vue.h(ElFormItem, { label: '姓名' }, { default: () => vue.h('input') }),
      actions: () => vue.h(vue.Comment),
    }),
    actions: () => vue.h(vue.Comment),
    default: () => vue.h('table'),
    pagination: () => vue.h(vue.Comment),
  }));
  assert.equal(root.querySelector('.fits-table').dataset.list, 'learners');
  assert.ok(root.querySelector('.fits-table__search form'));
  assert.ok(root.querySelector('.fits-table__body table'));
  assert.equal(root.querySelector('.fits-table__actions'), null);
  assert.equal(root.querySelector('.fits-table__pagination'), null);
  assert.equal(root.querySelector('.fits-list-search__actions'), null);
  const form = root.querySelector('form');
  assert.equal(form.dataset.search, 'learners');
  const submit = new Event('submit', { cancelable: true });
  assert.equal(form.dispatchEvent(submit), false);
  assert.equal(submit.defaultPrevented, true);
});
