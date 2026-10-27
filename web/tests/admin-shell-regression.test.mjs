import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, defineComponent, h, nextTick, ref } from '@vue/runtime-core';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Menu from '../node_modules/element-plus/es/components/menu/src/menu.mjs';
import { MENU_INJECTION_KEY } from '../node_modules/element-plus/es/components/menu/src/tokens.mjs';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));

test('content dialog overlays keep a local containing block even with reduced motion', () => {
  const css = readFileSync(resolve(webRoot, 'src/style.css'), 'utf8');
  assert.match(css, /\.main\s*>\s*\.page-enter\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.main\s*>\s*\.page-enter\s*>\s*\.el-overlay\s*\{[^}]*position:\s*absolute[^}]*inset:\s*-16px/s);
});
const clientIds = {
  layout: '\0a5-main-layout-client-test',
  reading: '\0a5-reading-client-test',
  exam: '\0a5-exam-client-test',
  settings: '\0a5-site-settings-client-test',
  menus: '\0a5-menus-client-test',
  dictionaries: '\0a5-dictionaries-client-test',
  users: '\0a5-users-client-test',
  courses: '\0a5-courses-client-test',
  courseCover: '\0a5-course-cover-client-test',
  trainingCategories: '\0a5-training-categories-client-test',
  administrators: '\0a5-administrators-client-test',
  roleSelect: '\0a5-role-select-client-test',
  roles: '\0a5-roles-client-test',
  aiConfig: '\0a5-ai-config-client-test',
  businessTabs: '\0a5-business-tabs-client-test',
  unsaved: '\0a5-unsaved-client-test',
};
const elementStubId = '\0a5-element-test';
const iconsStubId = '\0a5-icons-test';
const httpStubId = '\0a5-http-test';
const authStubId = '\0a5-auth-test';
const tabsStubId = '\0a5-tabs-test';
const mediaStubId = '\0a5-media-test';
const importPreviewStubId = '\0a5-import-preview-test';
const axiosStubId = '\0a5-axios-test';
const clientCode = new Map();

const testContext = {
  calls: [],
  navigation: [],
  navigationGet: null,
  isAdmin: true,
  confirmDecisions: [],
  confirmCalls: [],
  messages: [],
  learningStarts: 0,
  learningEnds: 0,
  examStarts: 0,
  examQuestions: [],
  settingsReads: 0,
  aiConfigReads: 0,
  aiConfigGet: null,
  logoutCalls: 0,
  tabResetCalls: 0,
  permissions: new Set(['system_settings:read', 'system_settings:write']),
  siteConfig: {
    logo_asset_id: '1001',
    banners: [{ asset_id: 'banner-saved', sort: 10 }],
  },
  profile: {
    real_name: '原姓名',
    phone: '13800000000',
    email: 'old@example.test',
    avatar_id: 'avatar-saved',
    source: 'institution',
    category_id: 'category-1',
  },
};

const elementStubCode = `
  const context = globalThis.__a5ShellTest;
  export const ElSelect = 'el-select';
  export const ElOption = 'el-option';
  export const ElButton = 'el-button';
  export const ElMessage = {
    success(message) { context.messages.push({ type: 'success', message }); },
    warning(message) { context.messages.push({ type: 'warning', message }); },
    error(message) { context.messages.push({ type: 'error', message }); },
  };
  export const ElMessageBox = {
    async confirm(...args) {
      context.confirmCalls.push(args);
      const decision = context.confirmDecisions.length ? context.confirmDecisions.shift() : true;
      const accepted = typeof decision === 'function' ? await decision(...args) : decision;
      if (!accepted) throw 'cancel';
      return 'confirm';
    },
    async alert() { return 'confirm'; },
  };
`;

const iconNames = [
  'AlarmClock', 'ArrowLeft', 'ArrowRight', 'Back', 'Close', 'CollectionTag', 'Cpu', 'DataAnalysis',
  'Document', 'DocumentChecked', 'EditPen', 'Grid', 'House', 'Menu', 'Medal', 'Monitor', 'Plus',
  'MoreFilled', 'Notebook', 'OfficeBuilding', 'Picture', 'Reading', 'Refresh', 'Remove', 'Right', 'Setting',
  'SetUp', 'SwitchButton', 'Tickets', 'User', 'UserFilled',
];
const iconsStubCode = `
  import { h } from 'vue';
  const Icon = { name: 'IconStub', render() { return h('icon-stub'); } };
  ${iconNames.map((name) => `export const ${name} = Icon;`).join('\n')}
`;

const httpStubCode = `
  const context = globalThis.__a5ShellTest;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const copy = (value) => value === undefined ? undefined : clone(value);
  const http = {
    async get(path, options) {
      context.calls.push({ method: 'GET', path, ...(path.startsWith('/admin/administrators') && options?.params ? { params: copy(options.params) } : {}), ...(path === '/admin/roles' && options?.params ? { params: copy(options.params) } : {}) });
      if (path === '/admin/menus/navigation') {
        if (context.navigationGet) return context.navigationGet();
        return clone(context.navigation);
      }
      if (path === '/site-config') return clone(context.siteConfig);
      if (path === '/admin/site-settings') {
        context.settingsReads += 1;
        return clone(context.siteConfig);
      }
      if (path === '/me/profile') return clone(context.profile);
      if (path === '/admin/menus') return clone(context.menus);
      if (path === '/admin/dictionaries') return { items: [], total: 0 };
      if (path === '/admin/students') return { items: clone(context.students), total: context.students.length };
      if (/^\\/admin\\/students\\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split('/').at(-1));
        return clone(context.students.find((item) => String(item.id) === id));
      }
      if (path === '/admin/training-categories') return { items: clone(context.trainingCategories), total: context.trainingCategories.length };
      if (path === '/admin/courses/category-options') return { items: [], total: 0 };
      if (path === '/admin/courses') return { items: [], total: 0 };
      if (path === '/admin/administrators') {
        const params = copy(options?.params || { page: 1, page_size: 10, keyword: '' });
        if (context.administratorsGet) return context.administratorsGet(params);
        const keyword = (params.keyword || '').toLowerCase();
        const filtered = context.administrators.filter((row) => [row.username, row.real_name, row.phone].some((value) => String(value || '').toLowerCase().includes(keyword)));
        return { items: clone(filtered.slice((params.page - 1) * params.page_size, params.page * params.page_size)), total: filtered.length, page: params.page, page_size: params.page_size };
      }
      if (path === '/admin/administrators/assignable-roles') return clone(context.assignableRoles);
      if (/^\\/admin\\/administrators\\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split('/').at(-1));
        if (context.administratorDetailGet) return context.administratorDetailGet(id);
        return clone(context.administrators.find((row) => String(row.id) === id));
      }
      if (path === '/admin/roles') {
        if (!options?.params) return clone(context.roles);
        const params = copy(options.params);
        if (context.rolesGet) return context.rolesGet(params);
        const filtered = context.roles.filter((row) => row.name.includes(params.keyword || ''));
        return { items: clone(filtered.slice((params.page - 1) * params.page_size, params.page * params.page_size)), total: filtered.length, page: params.page, page_size: params.page_size };
      }
      if (path === '/admin/roles/permission-tree') return clone(context.rolePermissionTree);
      if (/^\\/admin\\/roles\\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split('/').at(-1));
        if (context.roleDetailGet) return context.roleDetailGet(id);
        return clone(context.roles.find((row) => String(row.id) === id));
      }
      if (path === '/ai/config') {
        context.aiConfigReads += 1;
        if (context.aiConfigGet) return context.aiConfigGet();
        return { base_url: 'https://ai.example.test/v1', model: 'model-baseline', api_key_masked: '****base' };
      }
      if (path === '/admin/menus/permission-options') {
        return [{ code: 'menus:update', name: '修改菜单' }];
      }
      if (/^\\/admin\\/menus\\/[^/]+$/.test(path)) {
        return clone(context.menus.find((row) => String(row.id) === decodeURIComponent(path.split('/').at(-1))));
      }
      if (path === '/admin/permissions') return [{ code: 'students:read', name: '查看学员' }];
      if (/^\\/regulations\\/[^/]+\\/content$/.test(path)) {
        return { title: '制度', file_type: 'docx', content_html: '<p>content</p>', scroll_segments: 10, required_minutes: 1 };
      }
      if (/^\\/learning\\/records\\//.test(path)) {
        return { total_seconds: 0, required_seconds: 60, max_scroll_percent: 0, scroll_coverage: { total_segments: 10, covered_count: 0 }, is_valid: false, valid_at: null };
      }
      throw new Error('unexpected GET ' + path);
    },
    async post(path, body) {
      context.calls.push({ method: 'POST', path, body: copy(body) });
      if (path === '/learning/sessions/start') {
        context.learningStarts += 1;
        return { session_id: 'session-' + context.learningStarts, progress: { total_seconds: 0, required_seconds: 60, max_scroll_percent: 0, scroll_coverage: { total_segments: 10, covered_count: 0 }, is_valid: false, valid_at: null } };
      }
      if (/^\\/learning\\/sessions\\/[^/]+\\/end$/.test(path)) {
        context.learningEnds += 1;
        return { progress: { total_seconds: 0, required_seconds: 60, max_scroll_percent: 0, scroll_coverage: { total_segments: 10, covered_count: 0 }, is_valid: false, valid_at: null } };
      }
      if (/^\\/exams\\/papers\\/[^/]+\\/start$/.test(path)) {
        context.examStarts += 1;
        return { exam_record_id: 'exam-record-1', paper: { title: '考试', pass_score: 60 }, attempt_no: 1, questions: clone(context.examQuestions), remaining_seconds: 1800, saved_answers: {} };
      }
      if (path === '/admin/administrators') {
        if (context.administratorPost) return context.administratorPost(path, copy(body));
        const created = {
          id: 'admin-created', username: body.username, real_name: body.real_name, system_role: 'employee',
          phone: body.phone, email: '', status: body.status ?? 1, last_login_at: null,
          login_count: 0, last_login_ip: null, created_at: '2026-10-27T00:00:00.000Z',
          role_ids: [...body.role_ids], permissions: [],
        };
        context.administrators.push(created);
        return clone(created);
      }
      if (/^\\/admin\\/administrators\\/[^/]+\\/reset-password$/.test(path) && context.administratorPost) return context.administratorPost(path, copy(body));
      return {};
    },
    async put(path, body) {
      context.calls.push({ method: 'PUT', path, body: copy(body) });
      if (/^\\/admin\\/administrators\\/[^/]+$/.test(path)) {
        if (context.administratorPut) return context.administratorPut(path, copy(body));
        const id = path.split('/')[3];
        const row = context.administrators.find((item) => String(item.id) === id);
        if (row) Object.assign(row, copy(body));
        return clone(row || {});
      }
      if (path === '/admin/site-settings') {
        context.siteConfig = clone(body);
        return clone(body);
      }
      if (path === '/ai/config') return { base_url: body.base_url, model: body.model, api_key_masked: '****saved' };
      return {};
    },
    async patch(path, body) {
      context.calls.push({ method: 'PATCH', path, body: copy(body) });
      if (path === '/me/profile') context.profile = { ...context.profile, ...clone(body) };
      return {};
    },
    async delete(path) {
      context.calls.push({ method: 'DELETE', path });
      if (/^\\/admin\\/administrators\\/[^/]+$/.test(path)) {
        if (context.administratorDelete) return context.administratorDelete(path);
        context.administrators = context.administrators.filter((row) => String(row.id) !== path.split('/').at(-1));
      }
      return {};
    },
  };
  export default http;
  export function publicSiteAssetUrl(assetId) { return '/public/' + assetId; }
  export function download() {}
  export async function upload() { return {}; }
`;

const authStubCode = `
  const context = globalThis.__a5ShellTest;
  const auth = {
    accessToken: 'test-token',
    user: { id: 7, real_name: '测试管理员', role: 'regulation_admin', permissions: [] },
    get isAdmin() { return context.isAdmin; },
    get isSuperAdmin() { return context.isSuperAdmin === true; },
    can(code) { return context.permissions.has(code); },
    async logout() { context.logoutCalls += 1; },
    async fetchProfile() {},
  };
  export function useAuthStore() { return auth; }
`;

const tabsStubCode = `
  import { reactive } from 'vue';
  import { confirmUnsavedRoutes } from '../composables/useUnsavedChanges';
  const context = globalThis.__a5ShellTest;
  const store = reactive({
    tabs: [],
    visit() {},
    async close() { return { closed: false, nextPath: null }; },
    async closeOthers() { return true; },
    async closeAll() { return true; },
    async closePaths(paths) {
      const targets = new Set(paths);
      const closing = store.tabs.filter((tab) => targets.has(tab.path) && tab.closable !== false).map((tab) => tab.path);
      if (!closing.length) return true;
      if (!await confirmUnsavedRoutes(closing)) return false;
      const accepted = new Set(closing);
      store.tabs = store.tabs.filter((tab) => !accepted.has(tab.path) || tab.closable === false);
      return true;
    },
    reset() { context.tabResetCalls += 1; store.tabs = []; },
  });
  context.tabsStore = store;
  export function useTabsStore() { return store; }
`;

const mediaStubCode = `
  import { h } from 'vue';
  export default { name: 'MediaUploadStub', props: ['modelValue'], render() { return h('media-upload'); } };
`;

const importPreviewStubCode = `
  import { h } from 'vue';
  export default { name: 'ImportPreviewStub', render() { return h('import-preview'); } };
`;

const axiosStubCode = `export default { async post() { return { data: {} }; } };`;

function testPlugin() {
  return {
    name: 'a5-shell-regression-stubs',
    enforce: 'pre',
    resolveId(source, _importer, options) {
      if (Object.values(clientIds).includes(source)) return source;
      if (options?.ssr && (source === 'vue' || source === 'vue-router')) return { id: source, external: true };
      if (options?.ssr && (source.includes('/node_modules/.vite/deps/vue-router') || source.includes('/node_modules/vue-router/'))) return { id: 'vue-router', external: true };
      if (options?.ssr && /\/node_modules\/(?:\.vite\/deps\/vue\.js|vue\/dist\/vue\.runtime\.esm-bundler\.js)/.test(source)) return { id: 'vue', external: true };
      if (source === 'element-plus' || source.includes('/node_modules/.vite/deps/element-plus') || source.includes('/node_modules/element-plus/')) return elementStubId;
      if (source === '@element-plus/icons-vue' || source.includes('/node_modules/.vite/deps/@element-plus_icons-vue') || source.includes('/node_modules/@element-plus/icons-vue/')) return iconsStubId;
      if (source === '/@id/__x00__a5-element-test') return elementStubId;
      if (source === '/@id/__x00__a5-icons-test') return iconsStubId;
      if (source === '/@id/__x00__plugin-vue:export-helper') return '\0plugin-vue:export-helper';
      if (source === 'axios') return axiosStubId;
      if (source === '../api/http' || source === '../../api/http' || source === '/src/api/http.ts') return httpStubId;
      if (source === '../stores/auth' || source === '../../stores/auth' || source === '/src/stores/auth.ts') return authStubId;
      if (source === '../stores/tabs' || source === '/src/stores/tabs.ts') return tabsStubId;
      if ((source === '../components/BusinessTabs.vue' || source === '/src/components/BusinessTabs.vue') && clientCode.has(clientIds.businessTabs)) return clientIds.businessTabs;
      if (source === '../components/MediaUpload.vue' || source === '../../components/MediaUpload.vue' || source === '/src/components/MediaUpload.vue') return mediaStubId;
      if ((source === '../../components/CourseCover.vue' || source === '/src/components/CourseCover.vue') && clientCode.has(clientIds.courseCover)) return clientIds.courseCover;
      if ((source === '../../components/RoleSelect.vue' || source === '/src/components/RoleSelect.vue') && clientCode.has(clientIds.roleSelect)) return clientIds.roleSelect;
      if (source === '../../components/ImportPreview.vue' || source === '/src/components/ImportPreview.vue') return importPreviewStubId;
      if ((source === '../composables/useUnsavedChanges' || source === '/src/composables/useUnsavedChanges.ts') && clientCode.has(clientIds.unsaved)) return clientIds.unsaved;
      return undefined;
    },
    load(id) {
      if (clientCode.has(id)) return clientCode.get(id);
      if (id === elementStubId) return elementStubCode;
      if (id === iconsStubId) return iconsStubCode;
      if (id === httpStubId) return httpStubCode;
      if (id === authStubId) return authStubCode;
      if (id === tabsStubId) return tabsStubCode;
      if (id === mediaStubId) return mediaStubCode;
      if (id === importPreviewStubId) return importPreviewStubCode;
      if (id === axiosStubId) return axiosStubCode;
      return undefined;
    },
  };
}

function createHost() {
  return createRenderer({
    patchProp(node, key, _previous, value) { node.props[key] = value; },
    insert(node, parent, anchor = null) {
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, node);
      else parent.children.push(node);
    },
    remove(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
    },
    createElement(type) { return { type, props: {}, children: [], parent: null, text: '' }; },
    createText(text) { return { type: '#text', props: {}, children: [], parent: null, text }; },
    createComment(text) { return { type: '#comment', props: {}, children: [], parent: null, text }; },
    setText(node, text) { node.text = text; },
    setElementText(node, text) { node.text = text; node.children = []; },
    parentNode(node) { return node.parent; },
    nextSibling(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      return index >= 0 ? node.parent.children[index + 1] || null : null;
    },
    querySelector() { return null; },
    setScopeId() {},
    cloneNode(node) { return { ...node, props: { ...node.props }, children: [...node.children] }; },
    insertStaticContent(content, parent, anchor) {
      const node = { type: '#static', props: {}, children: [], parent: null, text: content };
      this.insert(node, parent, anchor);
      return [node, node];
    },
  });
}

function passthrough(type) {
  return {
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(type, attrs, Object.values(slots).flatMap((slot) => slot?.({ row: {}, data: {} }) || []));
    },
  };
}

const elementComponents = [
  'el-alert', 'el-aside', 'el-button', 'el-carousel', 'el-carousel-item', 'el-checkbox',
  'el-checkbox-group', 'el-container', 'el-date-picker', 'el-dialog', 'el-dropdown',
  'el-dropdown-item', 'el-dropdown-menu', 'el-empty', 'el-form', 'el-form-item',
  'el-header', 'el-icon', 'el-image', 'el-image-viewer', 'el-input', 'el-input-number', 'el-main', 'el-menu',
  'el-menu-item', 'el-sub-menu', 'el-option', 'el-pagination', 'el-progress', 'el-radio',
  'el-radio-button', 'el-radio-group', 'el-result', 'el-scrollbar', 'el-select',
  'el-switch', 'el-table', 'el-table-column', 'el-tag', 'el-tree', 'el-tree-select', 'el-upload',
];

function registerUi(app, { realMenu = false } = {}) {
  for (const name of elementComponents) app.component(name, name === 'el-menu' && realMenu ? Menu : passthrough(name));
  app.directive('loading', {});
}

function visitInstances(vnode, visitor, seen = new Set()) {
  if (!vnode || seen.has(vnode)) return null;
  seen.add(vnode);
  const instance = vnode.component;
  if (instance) {
    if (visitor(instance)) return instance;
    const nested = visitInstances(instance.subTree, visitor, seen);
    if (nested) return nested;
  }
  if (vnode.suspense) {
    const active = visitInstances(vnode.suspense.activeBranch, visitor, seen);
    if (active) return active;
  }
  if (Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      const found = visitInstances(child, visitor, seen);
      if (found) return found;
    }
  }
  return null;
}

function findInstance(app, setupKey) {
  const root = app._instance;
  if (root?.setupState && setupKey in root.setupState) return root;
  const found = visitInstances(root?.subTree, (instance) => setupKey in (instance.setupState || {}));
  assert.ok(found, `expected mounted component exposing ${setupKey}`);
  return found;
}

async function flushUpdates(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await nextTick();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
  }
}

async function waitFor(predicate, label, timeoutMs = 1800) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    await nextTick();
  }
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function findHostNode(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const found = findHostNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function findHostNodes(root, predicate, output = []) {
  if (!root) return output;
  if (predicate(root)) output.push(root);
  for (const child of Array.isArray(root.children) ? root.children : []) findHostNodes(child, predicate, output);
  return output;
}

function hostText(node) {
  return `${node?.text || ''}${(node?.children || []).map(hostText).join('')}`;
}

async function clickHost(node) {
  assert.ok(node, 'expected clickable host node');
  assert.notEqual(node.props.disabled, true, 'button should be enabled');
  await node.props.onClick?.();
  await flushUpdates();
}

function demoNavigation() {
  const menu = (id, name, routePath) => ({ id, name, type: 'menu', route_path: routePath, permission_code: null, icon: null, status: 1, children: [] });
  const directory = (id, name, children) => ({ id, name, type: 'directory', route_path: null, permission_code: null, icon: null, status: 1, children });
  return [
    menu('dashboard', '业务首页', '/admin/dashboard'),
    directory('training', '学习管理', [
      menu('categories', '培训类别', '/admin/training-categories'),
      menu('students', '学员管理', '/admin/students'),
      menu('courses', '课程管理', '/admin/courses'),
    ]),
    directory('exam', '考试管理', [
      menu('questions', '试题管理', '/admin/questions'),
      menu('papers', '试卷管理', '/admin/papers'),
      menu('question-import', '试题导入', '/admin/questions/import'),
      menu('records', '考试记录', '/admin/exam-records'),
    ]),
    menu('statistics', '统计分析', '/admin/training-statistics'),
    directory('system', '系统设置', [
      menu('ai-config', 'AI 服务配置', '/admin/ai-config'),
      menu('administrators', '管理员', '/admin/administrators'),
      menu('roles', '角色权限', '/admin/roles'),
      menu('site', '网站配置', '/admin/system/site-settings'),
      menu('dictionaries', '字典配置', '/admin/system/dictionaries'),
      menu('menus', '菜单配置', '/admin/system/menus'),
      menu('sessions', '在线会话', '/admin/sessions'),
      menu('audit', '审计日志', '/admin/system/audit-logs'),
    ]),
  ];
}

let vite;
let MainLayout;
let Reading;
let ExamRoom;
let SiteSettings;
let Menus;
let Dictionaries;
let Users;
let Courses;
let TrainingCategories;
let Administrators;
let Roles;
let AiConfig;
let useUnsavedChanges;
let fakeWindow;
let fakeDocument;
let nextTimerId = 1;
let originalWindow;
let originalDocument;
let originalNavigatorDescriptor;

function fakeEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      const values = listeners.get(type) || new Set();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
  };
}

function installFakeBrowser() {
  originalWindow = globalThis.window;
  originalDocument = globalThis.document;
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const windowEvents = fakeEventTarget();
  const documentEvents = fakeEventTarget();
  fakeWindow = {
    ...windowEvents,
    navigator: { userAgent: 'node-test' },
    activeIntervals: new Set(),
    clearedIntervals: [],
    scrollY: 0,
    onbeforeunload: null,
    setInterval() {
      const id = nextTimerId++;
      this.activeIntervals.add(id);
      return id;
    },
    clearInterval(id) {
      this.activeIntervals.delete(id);
      this.clearedIntervals.push(id);
    },
    setTimeout,
    clearTimeout,
  };
  fakeDocument = {
    ...documentEvents,
    visibilityState: 'visible',
    scrollingElement: { scrollTop: 0, scrollHeight: 100, clientHeight: 100 },
    querySelector() { return null; },
  };
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node-test' } });
}

function restoreBrowser() {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  else delete globalThis.navigator;
}

function stripClientHmr(code) {
  return code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue-router\.js[^"]*"/g, 'from "vue-router"')
    .replace(/from "\/node_modules\/vue\/dist\/vue\.runtime\.esm-bundler\.js(?:\?[^"]*)?"/g, 'from "vue"')
    .replace(/from "\/node_modules\/vue-router\/dist\/vue-router\.mjs(?:\?[^"]*)?"/g, 'from "vue-router"');
}

async function loadClientModule(path, id) {
  const transformed = await vite.transformRequest(path);
  assert.ok(transformed?.code, `Vite should compile ${path}`);
  clientCode.set(id, stripClientHmr(transformed.code));
  return vite.ssrLoadModule(id);
}

async function loadClientSfc(path, id) {
  return (await loadClientModule(path, id)).default;
}

const OtherPage = defineComponent({ name: 'OtherPage', render: () => h('other-page') });
const LoginPage = defineComponent({ name: 'LoginPage', render: () => h('login-page') });

async function mountShell(initialPath, extraChildren = [], options = {}) {
  const routes = [
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: 'read/:id', component: Reading, meta: { title: '在线学习' } },
        { path: 'exam/:paperId', component: ExamRoom, meta: { title: '考试' } },
        { path: 'settings', component: SiteSettings, meta: { title: '网站配置', admin: true, cache: true } },
        { path: 'menus', component: Menus, meta: { title: '菜单配置', admin: true, cache: true } },
        { path: 'dictionaries', component: Dictionaries, meta: { title: '字典配置', admin: true, cache: true } },
        { path: 'admin/students', component: Users, meta: { title: '学员管理', admin: true, cache: true } },
        { path: 'admin/training-categories', component: TrainingCategories, meta: { title: '培训类别', admin: true, cache: true } },
        { path: 'admin/dashboard', component: OtherPage, meta: { title: '业务首页', admin: true, cache: true } },
        { path: 'admin/courses', component: Courses, meta: { title: '课程管理', admin: true, cache: true } },
        { path: 'admin/questions', component: OtherPage, meta: { title: '试题管理', admin: true } },
        { path: 'admin/questions/import', component: OtherPage, meta: { title: '试题导入', admin: true, cache: true } },
        { path: 'admin/papers', component: OtherPage, meta: { title: '试卷管理', admin: true, cache: true } },
        { path: 'admin/exam-records', component: OtherPage, meta: { title: '考试记录', admin: true } },
        { path: 'admin/training-statistics', component: OtherPage, meta: { title: '统计分析', admin: true, cache: true } },
        { path: 'admin/administrators', component: Administrators, meta: { title: '管理员', admin: true, cache: true } },
        { path: 'admin/roles', component: Roles, meta: { title: '角色权限', admin: true, cache: true } },
        { path: 'admin/ai-config', component: AiConfig, meta: { title: 'AI 配置', admin: true, cache: true } },
        { path: 'admin/system/site-settings', component: SiteSettings, meta: { title: '网站配置', admin: true, cache: true } },
        { path: 'admin/system/dictionaries', component: Dictionaries, meta: { title: '字典配置', admin: true, cache: true } },
        { path: 'admin/system/menus', component: Menus, meta: { title: '菜单配置', admin: true, cache: true } },
        { path: 'admin/sessions', component: OtherPage, meta: { title: '在线会话', admin: true, cache: true } },
        { path: 'admin/system/audit-logs', component: OtherPage, meta: { title: '审计日志', admin: true, cache: true } },
        { path: 'other', component: OtherPage, meta: { title: '其它管理页', admin: true, cache: true } },
        ...extraChildren,
      ],
    },
    { path: '/login', component: LoginPage },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(initialPath);
  await router.isReady();
  const host = createHost();
  const rootNode = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const Root = defineComponent({ render: () => h(RouterView) });
  const app = host.createApp(Root);
  app.use(router);
  registerUi(app, options);
  app.mount(rootNode);
  await flushUpdates();
  let active = true;
  const mounted = {
    app,
    router,
    rootNode,
    unmount() {
      if (!active) return;
      active = false;
      app.unmount();
      activeMounts.delete(mounted);
    },
  };
  activeMounts.add(mounted);
  return mounted;
}

const activeMounts = new Set();

before(async () => {
  installFakeBrowser();
  globalThis.__a5ShellTest = testContext;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    ssr: { external: ['vue', 'vue-router'] },
    plugins: [testPlugin()],
  });
  ({ useUnsavedChanges } = await loadClientModule('/src/composables/useUnsavedChanges.ts', clientIds.unsaved));
  await loadClientSfc('/src/components/BusinessTabs.vue', clientIds.businessTabs);
  MainLayout = await loadClientSfc('/src/layouts/MainLayout.vue', clientIds.layout);
  Reading = await loadClientSfc('/src/views/employee/Reading.vue', clientIds.reading);
  ExamRoom = await loadClientSfc('/src/views/employee/ExamRoom.vue', clientIds.exam);
  SiteSettings = await loadClientSfc('/src/views/admin/SiteSettings.vue', clientIds.settings);
  Menus = await loadClientSfc('/src/views/admin/Menus.vue', clientIds.menus);
  Dictionaries = await loadClientSfc('/src/views/admin/Dictionaries.vue', clientIds.dictionaries);
  Users = await loadClientSfc('/src/views/admin/Users.vue', clientIds.users);
  await loadClientSfc('/src/components/CourseCover.vue', clientIds.courseCover);
  Courses = await loadClientSfc('/src/views/admin/Courses.vue', clientIds.courses);
  TrainingCategories = await loadClientSfc('/src/views/admin/TrainingCategories.vue', clientIds.trainingCategories);
  await loadClientSfc('/src/components/RoleSelect.vue', clientIds.roleSelect);
  Administrators = await loadClientSfc('/src/views/admin/Administrators.vue', clientIds.administrators);
  Roles = await loadClientSfc('/src/views/admin/Roles.vue', clientIds.roles);
  AiConfig = await loadClientSfc('/src/views/admin/AiConfig.vue', clientIds.aiConfig);
});

after(async () => {
  delete globalThis.__a5ShellTest;
  await vite?.close();
  restoreBrowser();
});

beforeEach(() => {
  testContext.calls = [];
  testContext.navigation = demoNavigation();
  testContext.navigationGet = null;
  testContext.isAdmin = true;
  testContext.isSuperAdmin = false;
  testContext.confirmDecisions = [];
  testContext.confirmCalls = [];
  testContext.messages = [];
  testContext.learningStarts = 0;
  testContext.learningEnds = 0;
  testContext.examStarts = 0;
  testContext.examQuestions = [];
  testContext.settingsReads = 0;
  testContext.aiConfigReads = 0;
  testContext.aiConfigGet = null;
  testContext.logoutCalls = 0;
  testContext.tabResetCalls = 0;
  if (testContext.tabsStore) testContext.tabsStore.tabs = [];
  testContext.permissions = new Set([
    'system_settings:read', 'system_settings:write', 'students:write',
    'training_categories:write', 'administrators:read', 'administrators:create', 'administrators:update',
    'administrators:delete', 'administrators:reset_password',
    'menus:read', 'menus:create', 'menus:update', 'menus:delete',
    'roles:read', 'roles:create', 'roles:update', 'roles:delete', 'roles:permissions',
    'ai_config:read', 'ai_config:write',
  ]);
  testContext.students = [{ id: 'student-1', username: 'student', real_name: '学员基线', employee_no: '', source: 'institution', category_id: 'category-1', phone: '', email: '', status: 1, avatar_id: 'avatar-old' }];
  testContext.menus = [{ id: 'menu-1', parent_id: null, name: '菜单基线', type: 'menu', route_path: '/admin/system/menus', permission_code: 'menus:read', icon: null, sort: 10, status: 1, children: [] }];
  testContext.trainingCategories = [{ id: 'category-1', name: '类别基线', description: '类别说明', status: 1 }];
  testContext.administrators = [{ id: 'admin-1', username: 'manager', real_name: '管理员', phone: '13800000001', email: '', system_role: 'employee', status: 1, last_login_at: null, login_count: 3, last_login_ip: null, created_at: '2026-10-27T00:01:02.000Z', role_ids: ['role-1'], permissions: [] }];
  testContext.assignableRoles = [
    { id: 'role-1', code: 'role_one', name: '角色一', status: 1, is_system: false },
    { id: 'role-2', code: 'role_two', name: '角色二', status: 1, is_system: false },
  ];
  testContext.administratorsGet = null;
  testContext.administratorDetailGet = null;
  testContext.administratorPost = null;
  testContext.administratorPut = null;
  testContext.administratorDelete = null;
  testContext.roles = [{ id: 'business-role-1', code: 'business_role', name: '角色基线', remark: '备注基线', created_at: '2026-10-27T01:02:03Z', updated_at: '2026-10-27T01:02:03Z', permissions: ['students:read'], status: 1, is_system: false }];
  testContext.rolesGet = null;
  testContext.roleDetailGet = null;
  testContext.rolePermissionTree = {
    menus: [{ id: 'students', parent_id: null, name: '学员管理', type: 'menu', permission_code: 'students:read', sort: 10, status: 1 }],
    permissions: [{ code: 'students:read', name: '查看学员' }, { code: 'roles:read', name: '查看角色' }],
  };
  testContext.siteConfig = { logo_asset_id: '1001', banners: [{ asset_id: 'banner-saved', sort: 10 }] };
  testContext.profile = { real_name: '原姓名', phone: '13800000000', email: 'old@example.test', avatar_id: 'avatar-saved', source: 'institution', category_id: 'category-1' };
  fakeWindow.activeIntervals.clear();
  fakeWindow.clearedIntervals = [];
  fakeWindow.onbeforeunload = null;
  fakeDocument.visibilityState = 'visible';
  for (const values of fakeWindow.listeners.values()) values.clear();
  for (const values of fakeDocument.listeners.values()) values.clear();
});

afterEach(() => {
  for (const mounted of [...activeMounts]) mounted.unmount();
});

test('reading route is remounted after leaving and entering it again', async () => {
  const mounted = await mountShell('/read/reg-1');
  await waitFor(() => testContext.learningStarts === 1, 'first learning session');

  await mounted.router.push('/other');
  await waitFor(() => testContext.learningEnds >= 1, 'learning session close');
  await mounted.router.push('/read/reg-1');
  await waitFor(() => testContext.learningStarts === 2, 'second learning session');

  assert.equal(testContext.learningStarts, 2);
  mounted.unmount();
});

test('refreshing a non-cached reading route remounts its real session component', async () => {
  const mounted = await mountShell('/read/reg-1');
  await waitFor(() => testContext.learningStarts === 1, 'first learning session');
  const shell = findInstance(mounted.app, 'profileVisible');

  await shell.setupState.onTabCommand('refresh');
  await waitFor(() => testContext.learningStarts === 2, 'refreshed learning session');

  assert.ok(testContext.learningEnds >= 1);
  mounted.unmount();
});

test('exam route unmount clears heartbeat timers and browser listeners', async () => {
  const mounted = await mountShell('/exam/paper-1');
  await waitFor(() => testContext.examStarts === 1 && fakeWindow.activeIntervals.size === 2, 'exam timers');
  assert.equal(typeof fakeWindow.onbeforeunload, 'function');

  await mounted.router.push('/other');
  await flushUpdates();

  assert.equal(fakeWindow.activeIntervals.size, 0);
  assert.equal(fakeWindow.onbeforeunload, null);
  assert.equal(fakeWindow.listeners.get('blur')?.size || 0, 0);
  assert.equal(fakeWindow.listeners.get('pagehide')?.size || 0, 0);
  mounted.unmount();
});

test('administrator navigation renders five planned roots with system settings closed and no learner menu', async () => {
  const mounted = await mountShell('/other');
  await waitFor(() => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/menus/navigation'), 'navigation');
  const menu = findHostNode(mounted.rootNode, (node) => node.type === 'el-menu');
  assert.ok(menu);
  assert.deepEqual(menu.props.defaultOpeneds ?? menu.props['default-openeds'], ['training', 'exam']);
  assert.equal(findHostNodes(menu, (node) => node.type === 'el-sub-menu').length, 3);
  assert.deepEqual(
    findHostNodes(menu, (node) => node.type === 'el-menu-item').map((node) => node.props.index).filter((value) => String(value).startsWith('/admin/')).sort(),
    [
      '/admin/administrators', '/admin/ai-config', '/admin/courses', '/admin/dashboard', '/admin/exam-records',
      '/admin/papers', '/admin/questions', '/admin/questions/import', '/admin/roles', '/admin/sessions', '/admin/students',
      '/admin/system/audit-logs', '/admin/system/dictionaries', '/admin/system/menus', '/admin/system/site-settings',
      '/admin/training-categories', '/admin/training-statistics',
    ].sort(),
  );
  assert.equal(hostText(menu).includes('我的学习'), false);
  const examMenu = findHostNode(menu, (node) => node.type === 'el-sub-menu' && node.props.index === 'exam');
  assert.deepEqual(findHostNodes(examMenu, (node) => node.type === 'el-menu-item').map((node) => hostText(findHostNode(node, (child) => child.type === 'span'))),
    ['试题管理', '试卷管理', '试题导入', '考试记录']);
  mounted.unmount();
});

test('legacy exam navigation is normalized to include the separate question import entry', async () => {
  testContext.navigation = demoNavigation().map((root) => root.id === 'exam'
    ? {
        ...root,
        children: root.children
          .filter((item) => item.route_path !== '/admin/questions/import')
          .map((item) => item.route_path === '/admin/questions' ? { ...item, name: '题库管理' } : item),
      }
    : root);

  const mounted = await mountShell('/admin/questions');
  await waitFor(() => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/menus/navigation'), 'legacy navigation');
  const menu = findHostNode(mounted.rootNode, (node) => node.type === 'el-menu');
  const examMenu = findHostNode(menu, (node) => node.type === 'el-sub-menu' && node.props.index === 'exam');

  assert.deepEqual(
    findHostNodes(examMenu, (node) => node.type === 'el-menu-item').map((node) => ({
      path: node.props.index,
      label: hostText(findHostNode(node, (child) => child.type === 'span')),
    })),
    [
      { path: '/admin/questions', label: '试题管理' },
      { path: '/admin/papers', label: '试卷管理' },
      { path: '/admin/questions/import', label: '试题导入' },
      { path: '/admin/exam-records', label: '考试记录' },
    ],
  );
  mounted.unmount();
});

test('asynchronous navigation initializes the real menu with learning and exam expanded but settings closed', async () => {
  const mounted = await mountShell('/admin/dashboard', [], { realMenu: true });
  const menu = visitInstances(mounted.app._instance.subTree, (instance) => instance.type.name === 'ElMenu');
  assert.ok(menu, 'the real menu should mount after navigation loads');
  const opened = menu.provides[MENU_INJECTION_KEY].openedMenus;
  assert.deepEqual([...opened], ['training', 'exam']);
  assert.equal(opened.includes('system'), false);
  mounted.unmount();
});

for (const olderResult of ['success', 'failure']) {
  test(`navigation keeps the newer event refresh when an older request completes with ${olderResult}`, async () => {
    const older = deferred();
    const newer = deferred();
    const requests = [older.promise, newer.promise];
    testContext.navigationGet = () => requests.shift();
    const mounted = await mountShell('/other');
    const shell = findInstance(mounted.app, 'adminGroups');
    fakeWindow.dispatch('re:admin-menus-changed');
    await flushUpdates();
    assert.equal(testContext.calls.filter((call) => call.path === '/admin/menus/navigation').length, 2);
    newer.resolve([{ ...demoNavigation()[0], name: '当前导航' }]);
    await flushUpdates();
    assert.deepEqual(shell.setupState.adminGroups.map((group) => group.name), ['当前导航']);
    if (olderResult === 'success') older.resolve([{ ...demoNavigation()[0], name: '迟到导航' }]);
    else older.reject(new Error('older navigation failed'));
    await flushUpdates();
    assert.deepEqual(shell.setupState.adminGroups.map((group) => group.name), ['当前导航']);
    const menu = findHostNode(mounted.rootNode, (node) => node.type === 'el-menu');
    assert.equal(hostText(menu).includes('当前导航'), true);
    assert.equal(hostText(menu).includes('迟到导航'), false);
    mounted.unmount();
  });
}

test('navigation ignores an admin response after admin access is removed', async () => {
  const pending = deferred();
  testContext.navigationGet = () => pending.promise;
  const mounted = await mountShell('/other');
  const shell = findInstance(mounted.app, 'adminGroups');
  testContext.isAdmin = false;
  pending.resolve(demoNavigation());
  await flushUpdates();
  assert.deepEqual([...shell.setupState.adminGroups], []);
  mounted.unmount();
});

test('navigation invalidates an older admin request when loading as a learner', async () => {
  const pending = deferred();
  testContext.navigationGet = () => pending.promise;
  const mounted = await mountShell('/other');
  const shell = findInstance(mounted.app, 'adminGroups');
  testContext.isAdmin = false;
  await shell.setupState.loadNavigation();
  testContext.isAdmin = true;
  pending.resolve(demoNavigation());
  await flushUpdates();
  assert.deepEqual([...shell.setupState.adminGroups], []);
  assert.equal(testContext.calls.filter((call) => call.path === '/admin/menus/navigation').length, 1);
  mounted.unmount();
});

for (const result of ['success', 'failure']) {
  test(`navigation ignores a ${result} response and menu events after shell unmount`, async () => {
    const mounted = await mountShell('/other');
    const shell = findInstance(mounted.app, 'adminGroups');
    const baseline = JSON.parse(JSON.stringify(shell.setupState.adminGroups));
    const pending = deferred();
    testContext.navigationGet = () => pending.promise;
    const refreshing = shell.setupState.loadNavigation();
    const reads = testContext.calls.filter((call) => call.path === '/admin/menus/navigation').length;
    mounted.unmount();
    fakeWindow.dispatch('re:admin-menus-changed');
    if (result === 'success') pending.resolve([{ ...demoNavigation()[0], name: '卸载后导航' }]);
    else pending.reject(new Error('navigation failed after unmount'));
    await refreshing;
    await flushUpdates();
    assert.deepEqual(JSON.parse(JSON.stringify(shell.setupState.adminGroups)), baseline);
    assert.equal(testContext.calls.filter((call) => call.path === '/admin/menus/navigation').length, reads);
    assert.equal(fakeWindow.listeners.get('re:admin-menus-changed')?.size || 0, 0);
  });
}

test('the shell toggle collapses the sidebar while keeping the current page title beside it', async () => {
  const mounted = await mountShell('/admin/courses');
  const header = findHostNode(mounted.rootNode, (node) => node.type === 'el-header');
  const aside = findHostNode(mounted.rootNode, (node) => node.type === 'el-aside');
  const menu = findHostNode(mounted.rootNode, (node) => node.type === 'el-menu');
  assert.ok(header && aside && menu);
  const headerStart = findHostNode(header, (node) => String(node.props.class || '').includes('header-start'));
  assert.ok(headerStart, 'the toggle and page title share one vertically centered header group');
  assert.ok(findHostNode(headerStart, (node) => node.type === 'button' && node.props['aria-label'] === '收起侧边栏'));
  assert.ok(findHostNode(headerStart, (node) => String(node.props.class || '').includes('page-title') && hostText(node).includes('课程管理')));
  assert.equal(aside.props.width, '232px');
  assert.equal(menu.props.collapse, false);
  assert.match(hostText(header), /课程管理/);

  const collapse = findHostNode(header, (node) => node.type === 'button' && node.props['aria-label'] === '收起侧边栏');
  await clickHost(collapse);
  assert.equal(aside.props.width, '68px');
  assert.equal(menu.props.collapse, true);
  assert.match(String(aside.props.class || ''), /is-collapsed/);
  for (const item of findHostNodes(menu, (node) => node.type === 'el-menu-item')) {
    assert.ok(findHostNode(item, (node) => node.type === 'span'), 'menu text must be wrapped so Element Plus can hide it when collapsed');
  }
  assert.match(hostText(header), /课程管理/);
  assert.ok(findHostNode(header, (node) => node.type === 'button' && node.props['aria-label'] === '展开侧边栏'));
  mounted.unmount();
});

test('public business tabs keep a fixed home and expose all page operations', async () => {
  const mounted = await mountShell('/admin/training-categories');
  const shell = findInstance(mounted.app, 'profileVisible');
  shell.setupState.tabs.tabs = [
    { path: '/admin/dashboard', title: '业务首页', closable: false },
    { path: '/admin/students', title: '学员管理', closable: true },
    { path: '/admin/training-categories', title: '培训类别', closable: true },
    { path: '/admin/courses', title: '课程管理', closable: true },
  ];
  await flushUpdates();

  const tabNav = findHostNode(mounted.rootNode, (node) => node.props['aria-label'] === '页面标签');
  assert.ok(tabNav, 'tabs are rendered by the public navigation component');
  const home = findHostNode(tabNav, (node) => node.type === 'button' && node.props['aria-label'] === '首页');
  assert.ok(home, 'home is a fixed non-closeable entry');
  assert.equal(findHostNode(home, (node) => node.props['aria-label'] === '关闭首页'), null);
  assert.ok(findHostNode(tabNav, (node) => node.props['aria-current'] === 'page' && hostText(node).includes('培训类别')));
  const actionsTrigger = findHostNode(tabNav, (node) => node.props['aria-label'] === '标签页操作');
  assert.ok(actionsTrigger);
  const moreIcon = findHostNode(actionsTrigger, (node) => String(node.props.class || '').includes('business-tabs__more-icon'));
  assert.ok(moreIcon, 'the action trigger uses the reference four-square mark instead of a generic grid icon');
  assert.equal(
    findHostNodes(moreIcon, (node) => String(node.props.class || '').includes('business-tabs__more-box')).length,
    2,
    'two rows render the four animated squares through their pseudo elements',
  );
  assert.deepEqual(
    findHostNodes(tabNav, (node) => node.type === 'el-dropdown-item').map(hostText),
    ['刷新', '关闭当前', '关闭其它', '关闭左侧', '关闭右侧', '关闭所有'],
  );

  await shell.setupState.onTabCommand('left');
  assert.deepEqual(shell.setupState.tabs.tabs.map((tab) => tab.path), [
    '/admin/dashboard', '/admin/training-categories', '/admin/courses',
  ]);
  await shell.setupState.onTabCommand('right');
  assert.deepEqual(shell.setupState.tabs.tabs.map((tab) => tab.path), [
    '/admin/dashboard', '/admin/training-categories',
  ]);
  mounted.unmount();
});

test('closing all confirms dirty routes once, stays atomic on cancel, and leaves before cache invalidation', async () => {
  const mounted = await mountShell('/settings');
  const shell = findInstance(mounted.app, 'profileVisible');
  const settings = findInstance(mounted.app, 'saved');
  shell.setupState.tabs.tabs = [
    { path: '/admin/dashboard', title: '业务首页', closable: false },
    { path: '/settings', title: '网站配置', closable: true },
    { path: '/other', title: '其它管理页', closable: true },
  ];
  settings.setupState.form.logo_asset_id = '1002';
  await nextTick();
  const readsBeforeClose = testContext.settingsReads;

  testContext.confirmDecisions.push(false);
  await shell.setupState.onTabCommand('all');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/settings');
  assert.deepEqual(shell.setupState.tabs.tabs.map((tab) => tab.path), ['/admin/dashboard', '/settings', '/other']);
  assert.equal(settings.setupState.form.logo_asset_id, '1002');
  assert.equal(settings.setupState.dirty, true);
  assert.equal(testContext.confirmCalls.length, 1, 'bulk cancellation asks once and changes nothing');

  testContext.confirmDecisions.push(true);
  await shell.setupState.onTabCommand('all');
  await flushUpdates();
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/dashboard');
  assert.deepEqual(shell.setupState.tabs.tabs.map((tab) => tab.path), ['/admin/dashboard']);
  assert.equal(settings.setupState.form.logo_asset_id, '1001');
  assert.equal(settings.setupState.dirty, false);
  assert.equal(testContext.confirmCalls.length, 2, 'the accepted bulk close also asks only once');
  assert.equal(testContext.settingsReads, readsBeforeClose, 'the closing page must not remount before navigation');
  mounted.unmount();
});

test('site settings uses the upload card as the empty carousel state', async () => {
  const previousSiteConfig = testContext.siteConfig;
  testContext.siteConfig = { logo_asset_id: null, banners: [] };
  const siteSettingsSource = readFileSync(resolve(webRoot, 'src/views/admin/SiteSettings.vue'), 'utf8');
  assert.match(siteSettingsSource, /<el-upload[\s\S]*list-type="picture-card"/);
  assert.doesNotMatch(siteSettingsSource, /<el-empty[^>]*暂无轮播图/);
  const mounted = await mountShell('/settings');
  await flushUpdates();
  const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
  assert.ok(main);
  assert.ok(findHostNode(main, (node) => node.type === 'el-upload'), 'carousel upload card should remain visible');
  assert.equal(hostText(main).includes('暂无轮播图'), false, 'the upload card should be the only empty carousel state');
  mounted.unmount();
  testContext.siteConfig = previousSiteConfig;
});

test('site settings previews its single logo without changing the saved binding', async () => {
  const mounted = await mountShell('/settings');
  const settings = findInstance(mounted.app, 'saved');
  const uploader = findHostNode(mounted.rootNode, (node) => node.type === 'el-upload' && String(node.props.class).split(/\s+/).includes('logo-uploader'));
  assert.equal(uploader.props.limit, 1);
  uploader.props['on-preview'](uploader.props['file-list'][0]);
  await flushUpdates();
  const viewer = findHostNode(mounted.rootNode, (node) => node.type === 'el-image-viewer');
  assert.ok(viewer);
  assert.deepEqual([...viewer.props['url-list']], ['/public/logo-saved']);
  assert.equal(viewer.props['initial-index'], 0);
  assert.equal(settings.setupState.form.logo_asset_id, '1001');
  assert.equal(settings.setupState.dirty, false);
});

test('banner preview opens the whole gallery at the clicked image and can close and reopen', async () => {
  testContext.siteConfig.banners = [
    { asset_id: 'banner-1', sort: 10 },
    { asset_id: 'banner-2', sort: 20 },
    { asset_id: 'banner-3', sort: 30 },
  ];
  const mounted = await mountShell('/settings');
  const uploader = findHostNode(mounted.rootNode, (node) => node.type === 'el-upload' && String(node.props.class).split(/\s+/).includes('banner-uploader'));
  const files = uploader.props['file-list'];
  assert.equal(typeof uploader.props['on-preview'], 'function');
  uploader.props['on-preview'](files[1]);
  await flushUpdates();
  let viewer = findHostNode(mounted.rootNode, (node) => node.type === 'el-image-viewer');
  assert.ok(viewer);
  assert.deepEqual([...viewer.props['url-list']], ['/public/banner-1', '/public/banner-2', '/public/banner-3']);
  assert.equal(viewer.props['initial-index'], 1);
  assert.equal(viewer.props.teleported, true);
  viewer.props.onClose();
  await flushUpdates();
  assert.equal(findHostNode(mounted.rootNode, (node) => node.type === 'el-image-viewer'), null);
  uploader.props['on-preview'](files[2]);
  await flushUpdates();
  viewer = findHostNode(mounted.rootNode, (node) => node.type === 'el-image-viewer');
  assert.equal(viewer.props['initial-index'], 2);
  const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
  assert.equal(findHostNode(main, (node) => node.type === 'el-input-number'), null);
});

test('banners retain selection order after out-of-order upload completion and append after deletion', async () => {
  const mounted = await mountShell('/settings');
  const settings = findInstance(mounted.app, 'saved');
  const uploader = findHostNode(mounted.rootNode, (node) => node.type === 'el-upload' && String(node.props.class).split(/\s+/).includes('banner-uploader'));
  const first = { uid: 101, name: 'first.png', status: 'uploading', url: '/first.png' };
  const second = { uid: 102, name: 'second.png', status: 'uploading', url: '/second.png' };
  settings.setupState.bannerFiles = [...settings.setupState.bannerFiles, first, second];
  uploader.props['on-success']({ asset_id: 'second' }, second, settings.setupState.bannerFiles);
  uploader.props['on-success']({ asset_id: 'first' }, first, settings.setupState.bannerFiles);
  assert.deepEqual(settings.setupState.form.banners.map((banner) => banner.asset_id), ['banner-saved', 'first', 'second']);

  const removed = settings.setupState.bannerFiles[1];
  settings.setupState.bannerFiles = settings.setupState.bannerFiles.filter((file) => file.uid !== removed.uid);
  uploader.props['on-remove'](removed, settings.setupState.bannerFiles);
  const replacement = { uid: 103, name: 'replacement.png', status: 'success', url: '/replacement.png' };
  settings.setupState.bannerFiles = [...settings.setupState.bannerFiles, replacement];
  uploader.props['on-success']({ asset_id: 'replacement' }, replacement, settings.setupState.bannerFiles);
  await settings.setupState.save();
  const write = testContext.calls.find((call) => call.method === 'PUT' && call.path === '/admin/site-settings');
  assert.deepEqual(write.body.banners, [
    { asset_id: 'banner-saved', sort: 10 },
    { asset_id: 'second', sort: 20 },
    { asset_id: 'replacement', sort: 30 },
  ]);
});

for (const [path, name, actions] of [
  ['/admin/training-categories', '培训类别', ['查询', '新增类别']],
  ['/admin/students', '学员管理', ['查询', '新增学员', '下载导入模板']],
  ['/admin/administrators', '管理员', ['新增管理员', '查询']],
  ['/admin/roles', '角色权限', ['新增角色', '查询']],
  ['/admin/ai-config', 'AI 服务配置', ['保存配置', '连通性测试']],
  ['/settings', '网站配置', ['撤销修改', '保存并发布']],
  ['/dictionaries', '字典配置', ['新增字典项', '查询', '重置']],
  ['/menus', '菜单配置', ['新增菜单']],
]) {
  test(`administration content omits redundant introductions but keeps actions: ${name}`, async () => {
    const mounted = await mountShell(path);
    const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
    assert.ok(main);
    assert.deepEqual(findHostNodes(main, (node) => node.type === 'h2').map(hostText), [], 'navigation already identifies the page');
    assert.equal(findHostNodes(main, (node) => /(?:^|\s)(?:eyebrow|page-head)(?:\s|$)/.test(String(node.props.class || ''))).length, 0, 'no empty introduction wrapper remains');
    for (const label of actions) {
      assert.ok(findHostNode(main, (node) => node.type === 'el-button' && hostText(node) === label), `${name}: keep ${label}`);
    }
    const header = findHostNode(mounted.rootNode, (node) => node.type === 'el-header');
    assert.ok(header && hostText(header).trim(), 'keep the shell navigation title');
    mounted.unmount();
  });
}

for (const [path, dialogTitle] of [
  ['/admin/training-categories', '新增类别'],
  ['/admin/students', '新增学员'],
  ['/admin/courses', '新建课程'],
  ['/admin/administrators', '新增管理员'],
  ['/admin/roles', '新增角色'],
  ['/dictionaries', '新增字典项'],
  ['/menus', '新增菜单'],
]) {
  test(`form dialogs use the shared FitsAdmin shell: ${dialogTitle}`, async () => {
    const mounted = await mountShell(path);
    const dialog = findHostNode(mounted.rootNode, (node) => node.type === 'el-dialog' && node.props.title === dialogTitle);
    assert.ok(dialog, `${dialogTitle}: form dialog exists`);
    assert.match(String(dialog.props.class || ''), /(?:^|\s)re-form-dialog(?:\s|$)/, `${dialogTitle}: uses the shared form-dialog shell`);
    mounted.unmount();
  });
}

test('PC learner navigation retains learning and scores without an exam entry', async () => {
  testContext.isAdmin = false;
  const mounted = await mountShell('/other');
  const menu = findHostNode(mounted.rootNode, (node) => node.type === 'el-menu');
  assert.ok(menu);
  assert.match(hostText(menu), /我的学习/);
  assert.match(hostText(menu), /我的制度/);
  assert.match(hostText(menu), /我的成绩/);
  assert.doesNotMatch(hostText(menu), /我的考试/);
  assert.equal(findHostNodes(menu, (node) => node.props.index === '/my/exams').length, 0);
  assert.equal(hostText(menu).includes('业务首页'), false);
  mounted.unmount();
});

test('completed PC reading does not expose a learner exam button', async () => {
  const mounted = await mountShell('/read/reg-1');
  await waitFor(() => testContext.learningStarts === 1, 'reading session');
  const reading = findInstance(mounted.app, 'isValid');
  reading.setupState.isValid = true;
  await nextTick();
  assert.equal(findHostNodes(mounted.rootNode, (node) => node.type === 'el-button' && hostText(node).includes('参加考试')).length, 0);
  mounted.unmount();
});

for (const [path, actionLabel, requestPath] of [
  ['/admin/training-categories', '新增类别', '/admin/training-categories'],
  ['/admin/students', '新增学员', '/admin/students'],
  ['/dictionaries', '新增字典项', '/admin/dictionaries'],
]) {
  test(`list queries and business actions stay separate without changing query clicks: ${path}`, async () => {
    const mounted = await mountShell(path);
    const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
    const search = findHostNode(main, (node) => node.props['aria-label'] === '查询条件');
    const actions = findHostNode(main, (node) => node.props['aria-label'] === '列表操作');
    assert.ok(search, 'query fields have a common labelled region');
    assert.ok(actions, 'business operations have their own region');
    assert.ok(findHostNode(search, (node) => node.type === 'el-form-item' && !!node.props.label), 'filters retain visible labels');
    assert.equal(findHostNode(search, (node) => node.type === 'el-button' && hostText(node) === actionLabel), null);
    assert.ok(findHostNode(actions, (node) => node.type === 'el-button' && hostText(node) === actionLabel));
    const before = testContext.calls.filter((call) => call.path === requestPath).length;
    await clickHost(findHostNode(search, (node) => node.type === 'el-button' && hostText(node) === '查询'));
    assert.equal(testContext.calls.filter((call) => call.path === requestPath).length, before + 1, 'one query click still makes one request');
    mounted.unmount();
  });
}

test('role lists expose a name query, create action, and server pagination', async () => {
  const mounted = await mountShell('/admin/roles');
  const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
  const search = findHostNode(main, (node) => node.props['aria-label'] === '查询条件');
  assert.ok(findHostNode(search, (node) => node.type === 'el-form-item' && node.props.label === '角色名称'));
  assert.ok(findHostNode(search, (node) => node.type === 'el-button' && hostText(node) === '查询'));
  const actions = findHostNode(main, (node) => node.props['aria-label'] === '列表操作');
  assert.ok(findHostNode(actions, (node) => node.type === 'el-button' && hostText(node) === '新增角色'));
  assert.ok(findHostNode(main, (node) => node.type === 'el-pagination'));
  assert.ok(testContext.calls.some((call) => call.path === '/admin/roles' && call.params?.page === 1 && call.params?.page_size === 10));
  mounted.unmount();
});

test('the common menu list preserves tree expansion without adding pagination', async () => {
  const mounted = await mountShell('/menus');
  const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
  assert.ok(findHostNode(main, (node) => node.props['aria-label'] === '列表操作'));
  const table = findHostNode(main, (node) => node.type === 'el-table');
  assert.equal(table.props['row-key'] ?? table.props.rowKey, 'id');
  assert.deepEqual(table.props['tree-props'] ?? table.props.treeProps, { children: 'children' });
  assert.notEqual(table.props['default-expand-all'] ?? table.props.defaultExpandAll, false);
  assert.equal(findHostNode(main, (node) => node.type === 'el-pagination'), null);
  mounted.unmount();
});

test('read-only dictionary users keep search but have no empty business operation row', async () => {
  testContext.permissions = new Set(['system_settings:read']);
  const mounted = await mountShell('/dictionaries');
  const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
  assert.ok(findHostNode(main, (node) => node.props['aria-label'] === '查询条件'));
  assert.equal(findHostNode(main, (node) => node.props['aria-label'] === '列表操作'), null);
  assert.equal(findHostNode(main, (node) => node.type === 'el-button' && hostText(node) === '新增字典项'), null);
  mounted.unmount();
});

test('empty list illustrations render inside their tables without a duplicate outside state', async () => {
  testContext.permissions.add('courses:read');
  testContext.permissions.add('courses:write');
  testContext.trainingCategories = [];
  testContext.students = [];
  for (const [path, description] of [
    ['/admin/training-categories', '暂无培训类别'],
    ['/admin/students', '暂无学员'],
    ['/admin/courses', '暂无课程'],
  ]) {
    const mounted = await mountShell(path);
    const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
    const table = findHostNode(main, (node) => node.type === 'el-table');
    assert.ok(table, `${path}: table should render`);
    const emptyStates = findHostNodes(main, (node) => node.type === 'el-empty' && node.props.description === description);
    assert.equal(emptyStates.length, 1, `${path}: render one empty illustration`);
    assert.ok(findHostNode(table, (node) => node === emptyStates[0]), `${path}: empty illustration belongs to the table empty slot`);
    mounted.unmount();
  }
});

test('exam focus changes never call the cancelled switch endpoint', async () => {
  const mounted = await mountShell('/exam/paper-1');
  await waitFor(() => testContext.examStarts === 1, 'exam start');
  fakeWindow.dispatch('blur', {});
  fakeDocument.visibilityState = 'hidden';
  fakeDocument.dispatch('visibilitychange', {});
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 650));
  assert.equal(testContext.calls.some((call) => call.path === '/exams/records/exam-record-1/switch'), false);
  mounted.unmount();
});

test('exam room renders single and judgment as one-choice controls and multiple as checkboxes', async () => {
  testContext.examQuestions = [
    { question_id: 'single-1', type: 'single', stem: '单选', score: 10, options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] },
    { question_id: 'judgment-1', type: 'judgment', stem: '判断', score: 10, options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }] },
    { question_id: 'multiple-1', type: 'multiple', stem: '多选', score: 10, options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] },
  ];
  const mounted = await mountShell('/exam/paper-1');
  await waitFor(() => testContext.examStarts === 1, 'exam start');
  await flushUpdates();
  const radioGroups = findHostNodes(mounted.rootNode, (node) => node.type === 'el-radio-group');
  const checkboxGroups = findHostNodes(mounted.rootNode, (node) => node.type === 'el-checkbox-group');
  assert.equal(radioGroups.length, 2);
  assert.equal(checkboxGroups.length, 1);
  assert.match(hostText(mounted.rootNode), /判断（10 分）/);
  mounted.unmount();
});

test('site settings keeps edits on cancelled leave, then restores the saved baseline on discard and refresh', async () => {
  const mounted = await mountShell('/settings');
  const firstSettings = findInstance(mounted.app, 'saved');
  const firstState = firstSettings.setupState;
  firstState.form.logo_asset_id = '1002';
  await nextTick();
  assert.equal(firstState.dirty, true);

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/settings');
  assert.equal(firstState.form.logo_asset_id, '1002');
  assert.equal(firstState.dirty, true);

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/settings');
  await flushUpdates();
  const restoredSettings = findInstance(mounted.app, 'saved');
  assert.equal(restoredSettings.uid, firstSettings.uid, 'cacheable management page should be reused');
  assert.equal(restoredSettings.setupState.form.logo_asset_id, '1001');
  assert.equal(restoredSettings.setupState.dirty, false);

  const shell = findInstance(mounted.app, 'profileVisible');
  const readsBeforeRefresh = testContext.settingsReads;
  await shell.setupState.onTabCommand('refresh');
  await waitFor(() => testContext.settingsReads > readsBeforeRefresh, 'site settings reload after refresh');
  const refreshedSettings = findInstance(mounted.app, 'saved');
  assert.equal(refreshedSettings.setupState.form.logo_asset_id, '1001');
  assert.equal(refreshedSettings.setupState.dirty, false);

  const confirmationsBeforeCleanLeave = testContext.confirmCalls.length;
  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/other');
  assert.equal(testContext.confirmCalls.length, confirmationsBeforeCleanLeave);
  mounted.unmount();
});

test('profile and business dirty sources coexist; logout cancellation has zero side effects and beforeunload stays native', async () => {
  const mounted = await mountShell('/settings');
  const shell = findInstance(mounted.app, 'profileVisible');
  const settings = findInstance(mounted.app, 'saved');

  await shell.setupState.openProfile();
  settings.setupState.form.logo_asset_id = '1002';
  shell.setupState.profile.real_name = '未保存姓名';
  await nextTick();
  assert.equal(settings.setupState.dirty, true);
  assert.equal(shell.setupState.profileDirty, true);

  const confirmationsBeforeUnload = testContext.confirmCalls.length;
  const event = {
    defaultPrevented: false,
    returnValue: undefined,
    preventDefault() { this.defaultPrevented = true; },
  };
  fakeWindow.dispatch('beforeunload', event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, '');
  assert.equal(testContext.confirmCalls.length, confirmationsBeforeUnload, 'beforeunload must not launch an async dialog');

  testContext.confirmDecisions.push(true, false);
  await shell.setupState.onLogout();
  assert.equal(testContext.logoutCalls, 0);
  assert.equal(testContext.tabResetCalls, 0);
  assert.equal(mounted.router.currentRoute.value.fullPath, '/settings');
  assert.equal(settings.setupState.form.logo_asset_id, '1002');
  assert.equal(shell.setupState.profile.real_name, '未保存姓名');
  assert.equal(settings.setupState.dirty, true);
  assert.equal(shell.setupState.profileDirty, true);

  testContext.confirmDecisions.push(true, true);
  await shell.setupState.onLogout();
  assert.equal(testContext.logoutCalls, 1);
  assert.equal(testContext.tabResetCalls, 1);
  assert.equal(mounted.router.currentRoute.value.fullPath, '/login');
  assert.equal(settings.setupState.form.logo_asset_id, '1001');
  assert.equal(shell.setupState.profile.real_name, '原姓名');
  assert.equal(settings.setupState.dirty, false);
  assert.equal(shell.setupState.profileDirty, false);
  mounted.unmount();
});

test('self profile keeps the verified phone read-only and never submits it back to PATCH', async () => {
  const mounted = await mountShell('/other');
  const shell = findInstance(mounted.app, 'profileVisible');

  await shell.setupState.openProfile();
  shell.setupState.profile.real_name = '更新姓名';
  shell.setupState.profile.email = 'new@example.test';
  await shell.setupState.saveProfile();

  const call = testContext.calls.find((item) => item.method === 'PATCH' && item.path === '/me/profile');
  assert.deepEqual(call?.body, {
    real_name: '更新姓名',
    email: 'new@example.test',
    avatar_id: 'avatar-saved',
  });
  assert.equal('phone' in call.body, false);
  mounted.unmount();
});

test('menu create users load the narrow permission options endpoint without roles read', async () => {
  testContext.permissions = new Set(['menus:read', 'menus:create']);
  const mounted = await mountShell('/menus');
  const menus = findInstance(mounted.app, 'permissionOptions');
  await menus.setupState.openCreate();
  await waitFor(
    () => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/menus/permission-options'),
    'menu permission options',
  );
  assert.equal(testContext.calls.some((call) => call.path === '/admin/permissions'), false);
  assert.deepEqual(
    [...menus.setupState.permissionOptions],
    [{ code: 'menus:update', name: '修改菜单' }],
  );
  mounted.unmount();
});

test('menu read-only users do not request permission options', async () => {
  testContext.permissions = new Set(['menus:read']);
  const mounted = await mountShell('/menus');
  await waitFor(() => testContext.calls.some((call) => call.path === '/admin/menus'), 'menu tree');
  assert.equal(testContext.calls.some((call) => call.path === '/admin/menus/permission-options'), false);
  assert.equal(testContext.calls.some((call) => call.path === '/admin/permissions'), false);
  mounted.unmount();
});

test('menu configuration offers the independent question import route', async () => {
  const mounted = await mountShell('/menus');
  const menus = findInstance(mounted.app, 'permissionOptions');
  await menus.setupState.openCreate();
  await nextTick();
  const options = findHostNodes(mounted.rootNode, (node) => node.type === 'el-option');
  assert.equal(options.some((node) => node.props.value === '/admin/questions/import'), true);
  mounted.unmount();
});

test('menu dialog keeps a cancelled draft and restores its edit baseline after discard', async () => {
  const mounted = await mountShell('/menus');
  const firstMenus = findInstance(mounted.app, 'permissionOptions');
  await firstMenus.setupState.openEdit(testContext.menus[0]);
  await nextTick();
  assert.equal(firstMenus.setupState.dirty, false, 'opening a baseline must not create a false dirty state');
  firstMenus.setupState.form.name = '未保存菜单';
  await nextTick();

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/menus');
  assert.equal(firstMenus.setupState.form.name, '未保存菜单');
  assert.equal(firstMenus.setupState.dirty, true);

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/menus');
  const restoredMenus = findInstance(mounted.app, 'permissionOptions');
  assert.equal(restoredMenus.uid, firstMenus.uid);
  assert.equal(restoredMenus.setupState.form.name, '菜单基线');
  assert.equal(restoredMenus.setupState.dialogVisible, false);
  assert.equal(restoredMenus.setupState.dirty, false);
  mounted.unmount();
});

test('dictionary dialog keeps a cancelled draft and restores its edit baseline after discard', async () => {
  const mounted = await mountShell('/dictionaries');
  const firstDictionaries = findInstance(mounted.app, 'items');
  firstDictionaries.setupState.openEdit({ id: 'dictionary-1', type: 'custom', code: 'alpha', label: '字典基线', sort: 10, status: 1, is_system: false, remark: null });
  await nextTick();
  assert.equal(firstDictionaries.setupState.dirty, false, 'opening a baseline must not create a false dirty state');
  firstDictionaries.setupState.form.label = '未保存字典项';
  await nextTick();

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/dictionaries');
  assert.equal(firstDictionaries.setupState.form.label, '未保存字典项');
  assert.equal(firstDictionaries.setupState.dirty, true);

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/dictionaries');
  const restoredDictionaries = findInstance(mounted.app, 'items');
  assert.equal(restoredDictionaries.uid, firstDictionaries.uid);
  assert.equal(restoredDictionaries.setupState.form.label, '字典基线');
  assert.equal(restoredDictionaries.setupState.dialogVisible, false);
  assert.equal(restoredDictionaries.setupState.dirty, false);
  mounted.unmount();
});

test('student edit restores form and avatar state on discard while preserving the guarded save workflow', async () => {
  const mounted = await mountShell('/admin/students');
  const first = findInstance(mounted.app, 'studentSaveInFlightKey');
  await waitFor(() => first.setupState.students.length === 1, 'student list');
  first.setupState.openStudentEdit(first.setupState.students[0]);
  const versionBeforeEdit = first.setupState.studentAvatarDialogVersion;
  first.setupState.studentForm.real_name = '未保存学员';
  first.setupState.onStudentAvatarChange('avatar-new');
  await nextTick();
  assert.equal(first.setupState.studentDirty, true);
  assert.equal(first.setupState.studentAvatarWritePending, true);
  assert.equal(first.setupState.studentAvatarSync.status, 'pending');

  testContext.confirmDecisions.push(false);
  await first.setupState.cancelStudentDialog();
  assert.equal(first.setupState.studentDialog, true);
  assert.equal(first.setupState.studentForm.avatar_id, 'avatar-new');
  assert.equal(first.setupState.studentAvatarWritePending, true);
  assert.equal(first.setupState.studentAvatarDialogVersion, versionBeforeEdit);

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/students');
  assert.equal(first.setupState.studentForm.real_name, '未保存学员');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/students');
  const restored = findInstance(mounted.app, 'studentSaveInFlightKey');
  assert.equal(restored.uid, first.uid);
  assert.equal(restored.setupState.studentForm.real_name, '学员基线');
  assert.equal(restored.setupState.studentForm.avatar_id, 'avatar-old');
  assert.equal(restored.setupState.studentAvatarOriginalId, 'avatar-old');
  assert.equal(restored.setupState.studentAvatarWritePending, false);
  assert.equal(restored.setupState.studentAvatarSync.status, 'idle');
  assert.equal(restored.setupState.studentDialog, false);
  assert.equal(restored.setupState.studentDirty, false);
  assert.ok(restored.setupState.studentAvatarDialogVersion > versionBeforeEdit, 'discard invalidates late avatar continuations');
  assert.equal(testContext.calls.some((call) => call.path === '/admin/students/student-1/avatar'), false, 'discard must not write an avatar');

  restored.setupState.openStudentEdit(restored.setupState.students[0]);
  restored.setupState.studentForm.real_name = '已保存学员';
  restored.setupState.onStudentAvatarChange('avatar-saved');
  await restored.setupState.saveStudent();
  assert.equal(restored.setupState.studentDirty, false);
  assert.equal(restored.setupState.studentDialog, false);
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/admin/students/student-1' && call.body.real_name === '已保存学员'));
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/admin/students/student-1/avatar' && call.body.avatar_id === 'avatar-saved'));
  mounted.unmount();
});

test('student administration no longer loads or renders department management fields', async () => {
  const mounted = await mountShell('/admin/students');
  await waitFor(() => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/students'), 'student list');
  assert.equal(testContext.calls.some((call) => call.method === 'GET' && call.path === '/departments/tree'), false);
  assert.equal(hostText(mounted.rootNode).includes('部门'), false);
  mounted.unmount();
});

test('training category edit protects dialog and route exits, restores baseline, and clears dirty after save', async () => {
  const mounted = await mountShell('/admin/training-categories');
  const first = findInstance(mounted.app, 'toggleStatus');
  await waitFor(() => first.setupState.items.length === 1, 'training category list');
  first.setupState.openEdit(first.setupState.items[0]);
  first.setupState.form.name = '未保存类别';
  await nextTick();
  assert.equal(first.setupState.dirty, true);

  testContext.confirmDecisions.push(false);
  await first.setupState.closeDialog();
  assert.equal(first.setupState.dialog, true);
  assert.equal(first.setupState.form.name, '未保存类别');

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/training-categories');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/training-categories');
  const restored = findInstance(mounted.app, 'toggleStatus');
  assert.equal(restored.uid, first.uid);
  assert.equal(restored.setupState.form.name, '类别基线');
  assert.equal(restored.setupState.dialog, false);
  assert.equal(restored.setupState.dirty, false);

  restored.setupState.openEdit(restored.setupState.items[0]);
  restored.setupState.form.name = '已保存类别';
  await restored.setupState.save();
  assert.equal(restored.setupState.dirty, false);
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/admin/training-categories/category-1' && call.body.name === '已保存类别'));
  mounted.unmount();
});

test('administrator creation posts the account and business roles atomically', async () => {
  const mounted = await mountShell('/admin/administrators');
  await waitFor(() => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/administrators'), 'administrator list');
  const open = findHostNode(mounted.rootNode, (node) => node.type === 'el-button' && hostText(node).trim() === '新增管理员');
  assert.ok(open);
  await clickHost(open);
  const administrator = findInstance(mounted.app, 'createForm');
  Object.assign(administrator.setupState.createForm, {
    username: 'new.manager', password: 'Secure123', confirm_password: 'Secure123', real_name: '新管理员',
    phone: '13800000000', role_ids: ['role-1'], status: 0,
  });
  const save = findHostNode(mounted.rootNode, (node) => node.type === 'el-button' && hostText(node).trim() === '创建管理员');
  assert.ok(save);
  await clickHost(save);
  const write = testContext.calls.find((call) => call.method === 'POST' && call.path === '/admin/administrators');
  assert.deepEqual(write.body, {
    username: 'new.manager', password: 'Secure123', real_name: '新管理员',
    phone: '13800000000', role_ids: ['role-1'], status: 0,
  });
  mounted.unmount();
});

test('administrator list queries reset the page and consume server pagination in the shared table', async () => {
  testContext.administrators = Array.from({ length: 12 }, (_, index) => ({ ...testContext.administrators[0], id: `admin-${index + 1}`, username: `manager-${index + 1}` }));
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createDialog');
  const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
  const search = findHostNode(main, (node) => node.props['aria-label'] === '查询条件');
  assert.ok(search, 'administrators use the public labelled query region');
  assert.ok(findHostNode(search, (node) => node.type === 'el-input' && node.props.placeholder.includes('手机号')));
  await waitFor(() => administrator.setupState.rows.length === 10, 'first administrator page');
  assert.equal(administrator.setupState.total, 12);
  administrator.setupState.query.page = 2;
  await administrator.setupState.load();
  assert.equal(administrator.setupState.rows[0].username, 'manager-11');
  administrator.setupState.query.keyword = ' manager-1 ';
  await clickHost(findHostNode(search, (node) => node.type === 'el-button' && hostText(node) === '查询'));
  const read = testContext.calls.filter((call) => call.path === '/admin/administrators').at(-1);
  assert.deepEqual(read.params, { page: 1, page_size: 10, keyword: 'manager-1' });
  assert.equal(administrator.setupState.total, 4);
  assert.equal(findHostNode(main, (node) => node.type === 'el-button' && hostText(node) === '刷新'), null);
  const columns = findHostNodes(main, (node) => node.type === 'el-table-column');
  assert.deepEqual(columns.slice(0, 9).map((node) => node.props.label), ['账号', '姓名', '手机号', '登录次数', '登录IP', '状态', '最后登录时间', '创建时间', '操作']);
  assert.equal(columns[8].props.align, 'center');
  assert.equal(Number(columns[8].props.width), 210);
  const operations = findHostNodes(columns[8], (node) => node.type === 'el-button');
  assert.deepEqual(operations.map(hostText), ['重置密码', '修改', '删除']);
  assert.equal(administrator.setupState.formatTime('2026-10-26T20:34:59.000Z'), '2026-10-27 04:34');
  assert.equal(administrator.setupState.formatTime(null), '—');
  assert.equal(administrator.setupState.formatTime('invalid'), '—');
});

test('administrator queries ignore earlier responses and responses after leaving the cached page', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createDialog');
  await flushUpdates();
  assert.ok(administrator.setupState.query, 'administrator query state is available');
  const earlier = deferred();
  const later = deferred();
  testContext.administratorsGet = ({ keyword }) => keyword === 'earlier' ? earlier.promise : later.promise;
  administrator.setupState.query.keyword = 'earlier';
  const oldRead = administrator.setupState.searchAdministrators();
  administrator.setupState.query.keyword = 'later';
  const newRead = administrator.setupState.searchAdministrators();
  later.resolve({ items: [{ ...testContext.administrators[0], username: 'latest' }], total: 1, page: 1, page_size: 10 });
  await newRead;
  earlier.resolve({ items: [], total: 0, page: 1, page_size: 10 });
  await oldRead;
  assert.equal(administrator.setupState.rows[0].username, 'latest');
  const inactiveRead = deferred();
  testContext.administratorsGet = () => inactiveRead.promise;
  const pending = administrator.setupState.load();
  await mounted.router.push('/other');
  inactiveRead.resolve({ items: [], total: 0, page: 1, page_size: 10 });
  await pending;
  assert.equal(administrator.setupState.rows[0].username, 'latest');
});

for (const pendingAt of ['initial load', 'keyword query']) {
  test('administrator cached page restarts a pending ' + pendingAt + ' when returning', async () => {
    const departed = deferred();
    if (pendingAt === 'initial load') testContext.administratorsGet = () => departed.promise;
    const mounted = await mountShell('/admin/administrators');
    const administrator = findInstance(mounted.app, 'createDialog');
    assert.ok(administrator.setupState.query, 'administrator query state is available');
    let pending;
    if (pendingAt === 'keyword query') {
      administrator.setupState.query.keyword = 'new-filter';
      testContext.administratorsGet = () => departed.promise;
      pending = administrator.setupState.searchAdministrators();
    }
    const beforeReturn = testContext.calls.filter((call) => call.path === '/admin/administrators').length;
    await mounted.router.push('/other');
    const refreshed = deferred();
    testContext.administratorsGet = () => refreshed.promise;
    await mounted.router.push('/admin/administrators');
    await flushUpdates();
    assert.equal(testContext.calls.filter((call) => call.path === '/admin/administrators').length, beforeReturn + 1, 'returning must replace the invalidated request');
    assert.equal(testContext.calls.filter((call) => call.path === '/admin/administrators').at(-1).params.keyword, pendingAt === 'keyword query' ? 'new-filter' : '');
    refreshed.resolve({ items: [{ ...testContext.administrators[0], username: 'fresh-after-return' }], total: 1, page: 1, page_size: 10 });
    await flushUpdates();
    departed.resolve({ items: [], total: 0, page: 1, page_size: 10 });
    await pending;
    await flushUpdates();
    assert.equal(administrator.setupState.rows[0].username, 'fresh-after-return');
    assert.equal(administrator.setupState.loading, false);
  });
}

test('administrator creation rejects mismatched or weak passwords without sending them', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  await administrator.setupState.openCreate();
  Object.assign(administrator.setupState.createForm, { username: 'new.manager', real_name: '新管理员', role_ids: ['role-1'], password: 'Secure123', confirm_password: 'Different123' });
  await administrator.setupState.createAdministrator();
  assert.equal(testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/administrators').length, 0, 'a confirmation mismatch must never reach the API');
  for (const password of ['12345678', 'abcdefgh', 'Abc1234', 'Abc 12345', 'A1'.repeat(65)]) {
    Object.assign(administrator.setupState.createForm, { password, confirm_password: password });
    await administrator.setupState.createAdministrator();
  }
  assert.equal(testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/administrators').length, 0);
  Object.assign(administrator.setupState.createForm, { username: ' optional.manager ', real_name: '', phone: '', password: 'Secure123', confirm_password: 'Secure123', status: 1 });
  await administrator.setupState.createAdministrator();
  assert.deepEqual(testContext.calls.find((call) => call.method === 'POST' && call.path === '/admin/administrators').body, {
    username: 'optional.manager', password: 'Secure123', real_name: '', phone: '', role_ids: ['role-1'], status: 1,
  });
});

test('administrator edit loads the latest detail and preserves an inactive historical role', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  assert.equal(typeof administrator.setupState.openEdit, 'function', 'administrator edit is available');
  testContext.administratorDetailGet = () => ({ ...testContext.administrators[0], real_name: '最新姓名', phone: '13800000002', role_ids: ['role-1', 'inactive-role'] });
  await administrator.setupState.openEdit(testContext.administrators[0]);
  assert.equal(administrator.setupState.createForm.real_name, '最新姓名');
  assert.equal(administrator.setupState.createForm.phone, '13800000002');
  assert.deepEqual([...administrator.setupState.createForm.role_ids], ['role-1', 'inactive-role']);
  const dialog = findHostNode(mounted.rootNode, (node) => node.type === 'el-dialog' && node.props.title === '修改管理员');
  assert.ok(dialog);
  assert.ok(findHostNode(dialog, (node) => node.type === 'el-input' && node.props.readonly === true && node.props.modelValue === 'manager'));
  assert.match(hostText(dialog), /已停用角色/);
  assert.doesNotMatch(hostText(dialog), /role_one|role_two/);
  administrator.setupState.createForm.real_name = ' 保存姓名 ';
  administrator.setupState.createForm.status = 0;
  await administrator.setupState.createAdministrator();
  const write = testContext.calls.find((call) => call.method === 'PUT' && call.path === '/admin/administrators/admin-1');
  assert.deepEqual(write.body, { real_name: '保存姓名', phone: '13800000002', role_ids: ['role-1', 'inactive-role'], status: 0 });
});

test('administrator dialogs discard unsaved create, edit and reset drafts only after confirmation', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  await administrator.setupState.openCreate();
  administrator.setupState.createForm.username = 'unsaved';
  assert.equal(typeof administrator.setupState.closeCreateDialog, 'function', 'create dialog has a guarded exit');
  testContext.confirmDecisions.push(false);
  await administrator.setupState.closeCreateDialog();
  assert.equal(administrator.setupState.createDialog, true);
  testContext.confirmDecisions.push(true);
  await administrator.setupState.closeCreateDialog();
  assert.equal(administrator.setupState.createDialog, false);
  assert.equal(administrator.setupState.createForm.username, '');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  await flushUpdates();
  await administrator.setupState.openEdit(testContext.administrators[0]);
  administrator.setupState.createForm.real_name = '未保存修改';
  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/administrators');
  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  assert.equal(administrator.setupState.createDialog, false);
  assert.equal(administrator.setupState.createForm.real_name, '管理员');
  await mounted.router.push('/admin/administrators');
  await administrator.setupState.openResetPassword(testContext.administrators[0]);
  administrator.setupState.resetForm.password = 'Unsaved123';
  testContext.confirmDecisions.push(false);
  await administrator.setupState.closeResetDialog();
  assert.equal(administrator.setupState.resetDialog, true);
  testContext.confirmDecisions.push(true);
  await administrator.setupState.closeResetDialog();
  assert.equal(administrator.setupState.resetDialog, false);
  assert.equal(administrator.setupState.resetForm.password, '');
});

test('administrator reset validates confirmation and submits only a new password once', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  assert.equal(typeof administrator.setupState.openResetPassword, 'function', 'password reset is available');
  await administrator.setupState.openResetPassword(testContext.administrators[0]);
  const dialog = findHostNode(mounted.rootNode, (node) => node.type === 'el-dialog' && node.props.title === '重置密码');
  assert.match(hostText(dialog), /下次登录.*修改密码/);
  Object.assign(administrator.setupState.resetForm, { password: 'Reset1234', confirm_password: 'Mismatch123' });
  await administrator.setupState.saveResetPassword();
  assert.equal(testContext.calls.some((call) => call.path.endsWith('/reset-password')), false);
  const pending = deferred();
  testContext.administratorPost = () => pending.promise;
  administrator.setupState.resetForm.confirm_password = 'Reset1234';
  const save = administrator.setupState.saveResetPassword();
  await administrator.setupState.saveResetPassword();
  const writes = testContext.calls.filter((call) => call.path === '/admin/administrators/admin-1/reset-password');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { password: 'Reset1234' });
  await administrator.setupState.closeResetDialog();
  assert.equal(administrator.setupState.resetDialog, true, 'a write awaiting a receipt cannot be abandoned');
  pending.resolve({});
  await save;
  assert.equal(administrator.setupState.resetDialog, false);
  assert.equal(administrator.setupState.resetForm.password, '');
});

test('administrator saves prevent duplicate writes and block route exit until the receipt arrives', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  await administrator.setupState.openCreate();
  Object.assign(administrator.setupState.createForm, { username: 'once.manager', real_name: '管理员', role_ids: ['role-1'], password: 'Secure123', confirm_password: 'Secure123' });
  const pending = deferred();
  testContext.administratorPost = () => pending.promise;
  const save = administrator.setupState.createAdministrator();
  await administrator.setupState.createAdministrator();
  assert.equal(testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/administrators').length, 1);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/administrators');
  pending.resolve({});
  await save;
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/other');
});

test('administrator edit details arriving after cancel cannot replace a newer dialog', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  assert.equal(typeof administrator.setupState.openEdit, 'function', 'administrator edit is available');
  const earlier = deferred();
  testContext.administratorDetailGet = (id) => id === 'admin-1' ? earlier.promise : { ...testContext.administrators[0], id: 'admin-2', username: 'second', real_name: '第二个管理员' };
  const first = administrator.setupState.openEdit(testContext.administrators[0]);
  await waitFor(() => testContext.calls.some((call) => call.path === '/admin/administrators/admin-1'), 'first administrator detail');
  await administrator.setupState.closeCreateDialog();
  await administrator.setupState.openEdit({ ...testContext.administrators[0], id: 'admin-2' });
  earlier.resolve({ ...testContext.administrators[0], real_name: '过期资料' });
  await first;
  assert.equal(administrator.setupState.createForm.id, 'admin-2');
  assert.equal(administrator.setupState.createForm.real_name, '第二个管理员');
  administrator.setupState.createForm.real_name = '第二个已保存';
  await administrator.setupState.createAdministrator();
  assert.equal(testContext.calls.filter((call) => call.method === 'PUT').at(-1).path, '/admin/administrators/admin-2');
});

test('administrator read permission exposes no write actions and direct writes stay guarded', async () => {
  for (const permission of [...testContext.permissions]) {
    if (permission.startsWith('administrators:') && permission !== 'administrators:read') testContext.permissions.delete(permission);
  }
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  const main = findHostNode(mounted.rootNode, (node) => node.type === 'el-main');
  const actions = findHostNode(main, (node) => node.props['aria-label'] === '列表操作');
  assert.equal(Boolean(actions), false);
  const table = findHostNode(main, (node) => node.type === 'el-table');
  const operationColumn = findHostNode(table, (node) => node.type === 'el-table-column' && node.props.label === '操作');
  assert.equal(Boolean(operationColumn), false, 'read-only administrator cannot act on rows');
  assert.equal(typeof administrator.setupState.openEdit, 'function');
  await administrator.setupState.openCreate();
  await administrator.setupState.openEdit(testContext.administrators[0]);
  assert.equal(typeof administrator.setupState.openAssignment, 'undefined');
  await administrator.setupState.openResetPassword(testContext.administrators[0]);
  await administrator.setupState.deleteAdministrator(testContext.administrators[0]);
  Object.assign(administrator.setupState.createForm, { username: 'blocked', real_name: '管理员', password: 'Secure123', confirm_password: 'Secure123', role_ids: ['role-1'] });
  await administrator.setupState.createAdministrator();
  assert.equal(testContext.calls.filter((call) => call.method !== 'GET').length, 0);
  assert.equal(testContext.calls.some((call) => call.path === '/admin/administrators/assignable-roles'), false);
});

test('administrator guards protect the current account and super administrators', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  assert.equal(typeof administrator.setupState.canResetAdministrator, 'function');
  const self = { ...testContext.administrators[0], id: '7' };
  const superAdmin = { ...testContext.administrators[0], id: 'super-1', system_role: 'super_admin' };
  assert.equal(administrator.setupState.canResetAdministrator(self), false);
  assert.equal(administrator.setupState.canDeleteAdministrator(self), false);
  assert.equal(administrator.setupState.canDisableAdministrator(self), false);
  assert.equal(administrator.setupState.canEditAdministrator(superAdmin), false);
  assert.equal(administrator.setupState.canResetAdministrator(superAdmin), false);
  assert.equal(administrator.setupState.canDeleteAdministrator(superAdmin), false);
  assert.equal(administrator.setupState.canDisableAdministrator(superAdmin), false);
  testContext.isSuperAdmin = true;
  testContext.administratorDetailGet = () => superAdmin;
  await administrator.setupState.openEdit(superAdmin);
  const dialog = findHostNode(mounted.rootNode, (node) => node.type === 'el-dialog' && node.props.title === '修改管理员');
  assert.equal(findHostNode(dialog, (node) => node.type === 'el-checkbox-group'), null, 'super administrators have no business role picker');
  administrator.setupState.createForm.status = 0;
  await administrator.setupState.createAdministrator();
  assert.equal(testContext.calls.filter((call) => call.method === 'PUT').length, 0);
  administrator.setupState.createForm.status = 1;
  await administrator.setupState.createAdministrator();
  assert.deepEqual(testContext.calls.find((call) => call.method === 'PUT').body, { real_name: '管理员', phone: '13800000001', status: 1 });
});

test('administrator delete requires confirmation, preserves history wording and falls back from an empty page', async () => {
  testContext.administrators = Array.from({ length: 11 }, (_, index) => ({ ...testContext.administrators[0], id: `admin-${index + 1}`, username: `manager-${index + 1}` }));
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createForm');
  assert.equal(typeof administrator.setupState.deleteAdministrator, 'function', 'administrator deletion is available');
  administrator.setupState.query.page = 2;
  await administrator.setupState.load();
  const row = administrator.setupState.rows[0];
  testContext.confirmDecisions.push(false);
  await administrator.setupState.deleteAdministrator(row);
  assert.equal(testContext.calls.filter((call) => call.method === 'DELETE').length, 0);
  assert.match(testContext.confirmCalls[0][0], /历史/);
  assert.match(testContext.confirmCalls[0][0], /禁用/);
  testContext.confirmDecisions.push(true);
  await administrator.setupState.deleteAdministrator(row);
  assert.equal(testContext.calls.filter((call) => call.method === 'DELETE').length, 1);
  assert.equal(administrator.setupState.query.page, 1);
  assert.equal(administrator.setupState.rows.length, 10);
});

test('administrator delete confirmation expires after leaving its owner', async () => {
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createDialog');
  assert.equal(typeof administrator.setupState.deleteAdministrator, 'function');
  const confirmation = deferred();
  testContext.confirmDecisions.push(() => confirmation.promise);
  const deletion = administrator.setupState.deleteAdministrator(testContext.administrators[0]);
  await mounted.router.push('/other');
  confirmation.resolve(true);
  await deletion;
  assert.equal(testContext.calls.some((call) => call.method === 'DELETE'), false, 'expired confirmation cannot delete an account');
  mounted.unmount();
});

test('administrator edit keeps inactive historical roles until explicitly changed', async () => {
  testContext.administrators[0].role_ids.push('inactive-role');
  const mounted = await mountShell('/admin/administrators');
  const administrator = findInstance(mounted.app, 'createDialog');
  await administrator.setupState.openEdit(testContext.administrators[0]);
  assert.deepEqual([...administrator.setupState.createForm.role_ids], ['role-1', 'inactive-role']);
  await administrator.setupState.createAdministrator();
  assert.deepEqual(testContext.calls.find((call) => call.method === 'PUT').body, {
    real_name: '管理员', phone: '13800000001', status: 1, role_ids: ['role-1', 'inactive-role'],
  });
});

test('role edit protects dialog and route exits, restores baseline, and clears dirty after save', async () => {
  const mounted = await mountShell('/admin/roles');
  const first = findInstance(mounted.app, 'permissionTree');
  await waitFor(() => first.setupState.roles.length === 1, 'role list');
  await first.setupState.openEdit(first.setupState.roles[0]);
  first.setupState.form.name = '未保存角色';
  first.setupState.form.remark = '未保存备注';
  await nextTick();
  assert.equal(first.setupState.dirty, true);

  testContext.confirmDecisions.push(false);
  await first.setupState.closeDialog();
  assert.equal(first.setupState.dialog, true);
  assert.equal(first.setupState.form.name, '未保存角色');

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/roles');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/roles');
  const restored = findInstance(mounted.app, 'permissionTree');
  assert.equal(restored.uid, first.uid);
  assert.equal(restored.setupState.form.name, '角色基线');
  assert.equal(restored.setupState.form.remark, '备注基线');
  assert.equal(restored.setupState.dialog, false);
  assert.equal(restored.setupState.dirty, false);

  await restored.setupState.openEdit(restored.setupState.roles[0]);
  restored.setupState.form.name = '已保存角色';
  await restored.setupState.save();
  assert.equal(restored.setupState.dirty, false);
  const saved = testContext.calls.find((call) => call.method === 'PUT' && call.path === '/admin/roles/business-role-1');
  assert.deepEqual(saved.body, { name: '已保存角色', remark: '备注基线', status: 1 });
  mounted.unmount();
});

test('AI config keeps a cancelled inline draft, restores server baseline on discard, and clears dirty after save', async () => {
  const mounted = await mountShell('/admin/ai-config');
  const first = findInstance(mounted.app, 'masked');
  await waitFor(() => first.setupState.form.model === 'model-baseline', 'AI config');
  first.setupState.form.base_url = 'https://draft.example.test/v1';
  first.setupState.form.api_key = 'draft-key';
  await nextTick();
  assert.equal(first.setupState.dirty, true);

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/ai-config');
  assert.equal(first.setupState.form.api_key, 'draft-key');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/ai-config');
  const restored = findInstance(mounted.app, 'masked');
  assert.equal(restored.uid, first.uid);
  assert.equal(restored.setupState.form.base_url, 'https://ai.example.test/v1');
  assert.equal(restored.setupState.form.api_key, '');
  assert.equal(restored.setupState.form.model, 'model-baseline');
  assert.equal(restored.setupState.dirty, false);

  restored.setupState.form.base_url = 'https://saved.example.test/v1';
  restored.setupState.form.api_key = 'saved-key';
  await restored.setupState.onSave();
  assert.equal(restored.setupState.form.api_key, '');
  assert.equal(restored.setupState.dirty, false);
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/ai/config' && call.body.base_url === 'https://saved.example.test/v1' && call.body.api_key === 'saved-key'));
  mounted.unmount();
});

test('AI config locks its real controls until a deferred readable baseline is captured', async () => {
  const pending = deferred();
  testContext.aiConfigGet = () => pending.promise;
  const mounted = await mountShell('/admin/ai-config');
  const aiConfig = findInstance(mounted.app, 'masked');
  const baseUrlInput = findHostNode(
    mounted.rootNode,
    (node) => node.type === 'el-input' && String(node.props.placeholder || '').startsWith('如 https://open.bigmodel.cn'),
  );

  assert.ok(baseUrlInput, 'real AI config base_url input should be mounted');
  assert.equal(baseUrlInput.props.disabled, true, 'readable config must not accept edits before GET establishes its baseline');
  assert.equal(aiConfig.setupState.initializing, true);
  assert.equal(aiConfig.setupState.dirty, false);

  pending.resolve({ base_url: 'https://deferred.example.test/v1', model: 'deferred-model', api_key_masked: '****deferred' });
  await waitFor(() => aiConfig.setupState.initializing === false, 'AI config initialization');
  assert.equal(aiConfig.setupState.form.base_url, 'https://deferred.example.test/v1');
  assert.equal(aiConfig.setupState.form.model, 'deferred-model');
  assert.equal(aiConfig.setupState.form.api_key, '');
  assert.equal(aiConfig.setupState.dirty, false, 'loaded response becomes the discard baseline');
  assert.equal(baseUrlInput.props.disabled, false);

  aiConfig.setupState.form.api_key = 'after-load-key';
  assert.equal(aiConfig.setupState.dirty, true, 'edits made after initialization remain a local draft');
  await flushUpdates();
  assert.equal(aiConfig.setupState.form.api_key, 'after-load-key');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/ai-config');
  const restored = findInstance(mounted.app, 'masked');
  assert.equal(restored.uid, aiConfig.uid);
  assert.equal(restored.setupState.form.base_url, 'https://deferred.example.test/v1');
  assert.equal(restored.setupState.form.model, 'deferred-model');
  assert.equal(restored.setupState.form.api_key, '');
  assert.equal(restored.setupState.dirty, false);
  mounted.unmount();
});

test('AI config exposes a locked error state and can retry its initial readable baseline', async () => {
  let attempt = 0;
  testContext.aiConfigGet = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('fixture read failure');
    return { base_url: 'https://retry.example.test/v1', model: 'retry-model', api_key_masked: '****retry' };
  };
  const mounted = await mountShell('/admin/ai-config');
  const aiConfig = findInstance(mounted.app, 'masked');
  await waitFor(() => !!aiConfig.setupState.loadError, 'AI config load error');
  const baseUrlInput = findHostNode(
    mounted.rootNode,
    (node) => node.type === 'el-input' && String(node.props.placeholder || '').startsWith('如 https://open.bigmodel.cn'),
  );

  assert.equal(aiConfig.setupState.initializing, false);
  assert.equal(baseUrlInput.props.disabled, true, 'failed readable baseline must not expose an unbased draft');
  assert.equal(aiConfig.setupState.dirty, false);

  await aiConfig.setupState.loadConfig();
  assert.equal(testContext.aiConfigReads, 2);
  assert.equal(aiConfig.setupState.loadError, '');
  assert.equal(aiConfig.setupState.form.base_url, 'https://retry.example.test/v1');
  assert.equal(aiConfig.setupState.form.model, 'retry-model');
  assert.equal(aiConfig.setupState.dirty, false);
  assert.equal(baseUrlInput.props.disabled, false);
  mounted.unmount();
});

test('AI config write-only mode skips the readable baseline and remains editable', async () => {
  testContext.permissions = new Set(['ai_config:write']);
  const mounted = await mountShell('/admin/ai-config');
  const aiConfig = findInstance(mounted.app, 'masked');
  const baseUrlInput = findHostNode(
    mounted.rootNode,
    (node) => node.type === 'el-input' && String(node.props.placeholder || '').startsWith('如 https://open.bigmodel.cn'),
  );

  assert.equal(testContext.aiConfigReads, 0);
  assert.equal(aiConfig.setupState.initializing, false);
  assert.equal(aiConfig.setupState.loadError, '');
  assert.equal(baseUrlInput.props.disabled, false);
  aiConfig.setupState.form.base_url = 'https://writer.example.test/v1';
  aiConfig.setupState.form.api_key = 'writer-key';
  aiConfig.setupState.form.model = 'writer-model';
  assert.equal(aiConfig.setupState.dirty, true);

  await aiConfig.setupState.onSave();
  assert.equal(aiConfig.setupState.dirty, false);
  assert.ok(testContext.calls.some((call) => (
    call.method === 'PUT'
    && call.path === '/ai/config'
    && call.body.base_url === 'https://writer.example.test/v1'
    && call.body.api_key === 'writer-key'
  )));
  mounted.unmount();
});

test('legacy one-argument hook confirmation does not silently clear retained editing state', async () => {
  let hookState;
  const OneArgumentPage = defineComponent({
    name: 'OneArgumentPage',
    setup() {
      const dirty = ref(true);
      const unsaved = useUnsavedChanges(dirty);
      hookState = { dirty, unsaved };
      return () => h('one-argument-page');
    },
  });
  const mounted = await mountShell('/one-argument', [
    { path: 'one-argument', component: OneArgumentPage, meta: { title: '兼容页', admin: true, cache: true } },
  ]);
  testContext.confirmDecisions.push(true);
  const confirmed = await hookState.unsaved.confirmDiscard();
  assert.equal(confirmed, true);
  assert.equal(hookState.dirty.value, true);
  mounted.unmount();
});
