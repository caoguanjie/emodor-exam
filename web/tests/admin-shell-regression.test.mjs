import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, defineComponent, h, nextTick, ref } from '@vue/runtime-core';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const clientIds = {
  layout: '\0a5-main-layout-client-test',
  reading: '\0a5-reading-client-test',
  exam: '\0a5-exam-client-test',
  settings: '\0a5-site-settings-client-test',
  menus: '\0a5-menus-client-test',
  dictionaries: '\0a5-dictionaries-client-test',
  departments: '\0a5-departments-client-test',
  users: '\0a5-users-client-test',
  trainingCategories: '\0a5-training-categories-client-test',
  administrators: '\0a5-administrators-client-test',
  roles: '\0a5-roles-client-test',
  aiConfig: '\0a5-ai-config-client-test',
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
  confirmDecisions: [],
  confirmCalls: [],
  messages: [],
  learningStarts: 0,
  learningEnds: 0,
  examStarts: 0,
  settingsReads: 0,
  logoutCalls: 0,
  tabResetCalls: 0,
  permissions: new Set(['system_settings:read', 'system_settings:write']),
  siteConfig: {
    logo_asset_id: 'logo-saved',
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
  'AlarmClock', 'ArrowLeft', 'ArrowRight', 'CollectionTag', 'Cpu', 'DataAnalysis',
  'Document', 'DocumentChecked', 'EditPen', 'Grid', 'Menu', 'Medal', 'Monitor',
  'MoreFilled', 'Notebook', 'OfficeBuilding', 'Picture', 'Reading', 'Setting',
  'SetUp', 'Tickets', 'User', 'UserFilled',
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
    async get(path) {
      context.calls.push({ method: 'GET', path });
      if (path === '/admin/menus/navigation') return [];
      if (path === '/site-config') return clone(context.siteConfig);
      if (path === '/admin/site-settings') {
        context.settingsReads += 1;
        return clone(context.siteConfig);
      }
      if (path === '/me/profile') return clone(context.profile);
      if (path === '/admin/menus') return [];
      if (path === '/admin/dictionaries') return { items: [], total: 0 };
      if (path === '/departments/tree') return { list: clone(context.departments) };
      if (path === '/users') return { list: clone(context.users), total: context.users.length };
      if (path === '/admin/students') return { items: clone(context.students), total: context.students.length };
      if (/^\\/admin\\/students\\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split('/').at(-1));
        return clone(context.students.find((item) => String(item.id) === id));
      }
      if (path === '/admin/training-categories') return { items: clone(context.trainingCategories), total: context.trainingCategories.length };
      if (path === '/admin/administrators') return clone(context.administrators);
      if (path === '/admin/administrators/assignable-roles') return [
        { id: 'role-1', code: 'role_one', name: '角色一', status: 1, is_system: false },
        { id: 'role-2', code: 'role_two', name: '角色二', status: 1, is_system: false },
      ];
      if (path === '/admin/roles') return clone(context.roles);
      if (path === '/ai/config') return { base_url: 'https://ai.example.test/v1', model: 'model-baseline', api_key_masked: '****base' };
      if (path === '/admin/menus/permission-options') {
        return [{ code: 'system_settings:write', name: '系统配置维护' }];
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
        return { exam_record_id: 'exam-record-1', paper: { title: '考试', pass_score: 60 }, attempt_no: 1, questions: [], remaining_seconds: 1800, saved_answers: {} };
      }
      return {};
    },
    async put(path, body) {
      context.calls.push({ method: 'PUT', path, body: copy(body) });
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
    async delete(path) { context.calls.push({ method: 'DELETE', path }); return {}; },
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
    get isAdmin() { return true; },
    get isSuperAdmin() { return false; },
    can(code) { return context.permissions.has(code); },
    async logout() { context.logoutCalls += 1; },
    async fetchProfile() {},
  };
  export function useAuthStore() { return auth; }
`;

const tabsStubCode = `
  const context = globalThis.__a5ShellTest;
  const store = {
    tabs: [],
    visit() {},
    async close() { return { closed: false, nextPath: null }; },
    async closeOthers() { return true; },
    async closeAll() { return true; },
    reset() { context.tabResetCalls += 1; store.tabs = []; },
  };
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
    resolveId(source) {
      if (Object.values(clientIds).includes(source)) return source;
      if (source.includes('/node_modules/.vite/deps/vue-router') || source.includes('/node_modules/vue-router/')) return { id: 'vue-router', external: true };
      if (/\/node_modules\/(?:\.vite\/deps\/vue\.js|vue\/dist\/vue\.runtime\.esm-bundler\.js)/.test(source)) return { id: 'vue', external: true };
      if (source === 'element-plus' || source.includes('/node_modules/.vite/deps/element-plus') || source.includes('/node_modules/element-plus/')) return elementStubId;
      if (source === '@element-plus/icons-vue' || source.includes('/node_modules/.vite/deps/@element-plus_icons-vue') || source.includes('/node_modules/@element-plus/icons-vue/')) return iconsStubId;
      if (source === 'axios') return axiosStubId;
      if (source === '../api/http' || source === '../../api/http' || source === '/src/api/http.ts') return httpStubId;
      if (source === '../stores/auth' || source === '../../stores/auth' || source === '/src/stores/auth.ts') return authStubId;
      if (source === '../stores/tabs' || source === '/src/stores/tabs.ts') return tabsStubId;
      if (source === '../components/MediaUpload.vue' || source === '../../components/MediaUpload.vue' || source === '/src/components/MediaUpload.vue') return mediaStubId;
      if (source === '../../components/ImportPreview.vue' || source === '/src/components/ImportPreview.vue') return importPreviewStubId;
      if (source === '/src/composables/useUnsavedChanges.ts' && clientCode.has(clientIds.unsaved)) return clientIds.unsaved;
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
  'el-header', 'el-icon', 'el-input', 'el-input-number', 'el-main', 'el-menu',
  'el-menu-item', 'el-option', 'el-pagination', 'el-progress', 'el-radio',
  'el-radio-button', 'el-radio-group', 'el-result', 'el-scrollbar', 'el-select',
  'el-switch', 'el-table', 'el-table-column', 'el-tag', 'el-tree', 'el-tree-select', 'el-upload',
];

function registerUi(app) {
  for (const name of elementComponents) app.component(name, passthrough(name));
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

let vite;
let MainLayout;
let Reading;
let ExamRoom;
let SiteSettings;
let Menus;
let Dictionaries;
let Departments;
let Users;
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
    .replace(/from "\/node_modules\/vue\/dist\/vue\.runtime\.esm-bundler\.js"/g, 'from "vue"')
    .replace(/from "\/node_modules\/vue-router\/dist\/vue-router\.mjs"/g, 'from "vue-router"');
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

async function mountShell(initialPath, extraChildren = []) {
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
        { path: 'admin/departments', component: Departments, meta: { title: '部门管理', admin: true, cache: true } },
        { path: 'admin/users', component: Users, meta: { title: '员工管理', admin: true, cache: true } },
        { path: 'admin/students', component: Users, meta: { title: '学员管理', admin: true, cache: true } },
        { path: 'admin/training-categories', component: TrainingCategories, meta: { title: '培训类别', admin: true, cache: true } },
        { path: 'admin/administrators', component: Administrators, meta: { title: '管理员', admin: true, cache: true } },
        { path: 'admin/roles', component: Roles, meta: { title: '角色权限', admin: true, cache: true } },
        { path: 'admin/ai-config', component: AiConfig, meta: { title: 'AI 配置', admin: true, cache: true } },
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
  registerUi(app);
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
    plugins: [testPlugin()],
  });
  ({ useUnsavedChanges } = await loadClientModule('/src/composables/useUnsavedChanges.ts', clientIds.unsaved));
  MainLayout = await loadClientSfc('/src/layouts/MainLayout.vue', clientIds.layout);
  Reading = await loadClientSfc('/src/views/employee/Reading.vue', clientIds.reading);
  ExamRoom = await loadClientSfc('/src/views/employee/ExamRoom.vue', clientIds.exam);
  SiteSettings = await loadClientSfc('/src/views/admin/SiteSettings.vue', clientIds.settings);
  Menus = await loadClientSfc('/src/views/admin/Menus.vue', clientIds.menus);
  Dictionaries = await loadClientSfc('/src/views/admin/Dictionaries.vue', clientIds.dictionaries);
  Departments = await loadClientSfc('/src/views/admin/Departments.vue', clientIds.departments);
  Users = await loadClientSfc('/src/views/admin/Users.vue', clientIds.users);
  TrainingCategories = await loadClientSfc('/src/views/admin/TrainingCategories.vue', clientIds.trainingCategories);
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
  testContext.confirmDecisions = [];
  testContext.confirmCalls = [];
  testContext.messages = [];
  testContext.learningStarts = 0;
  testContext.learningEnds = 0;
  testContext.examStarts = 0;
  testContext.settingsReads = 0;
  testContext.logoutCalls = 0;
  testContext.tabResetCalls = 0;
  testContext.permissions = new Set([
    'system_settings:read', 'system_settings:write', 'departments:write', 'students:write',
    'training_categories:write', 'administrators:write', 'roles:write',
    'ai_config:read', 'ai_config:write',
  ]);
  testContext.departments = [{ id: 'dept-1', parent_id: null, name: '部门基线', sort: 10, status: 1, children: [] }];
  testContext.users = [{ id: 'user-1', username: 'employee', real_name: '员工基线', employee_no: 'E001', department_id: 'dept-1', role: 'employee', phone: '', email: '', status: 1, last_login_at: null }];
  testContext.students = [{ id: 'student-1', username: 'student', real_name: '学员基线', employee_no: '', source: 'institution', category_id: 'category-1', department_id: '', phone: '', email: '', status: 1, avatar_id: 'avatar-old' }];
  testContext.trainingCategories = [{ id: 'category-1', name: '类别基线', description: '类别说明', status: 1 }];
  testContext.administrators = [{ id: 'admin-1', username: 'manager', real_name: '管理员', system_role: 'employee', status: 1, last_login_at: null, role_ids: ['role-1'], permissions: [] }];
  testContext.roles = [{ id: 'business-role-1', code: 'business_role', name: '角色基线', permissions: ['students:read'], status: 1, is_system: false }];
  testContext.siteConfig = { logo_asset_id: 'logo-saved', banners: [{ asset_id: 'banner-saved', sort: 10 }] };
  testContext.profile = { real_name: '原姓名', phone: '13800000000', email: 'old@example.test', avatar_id: 'avatar-saved', source: 'institution', category_id: 'category-1' };
  fakeWindow.activeIntervals.clear();
  fakeWindow.clearedIntervals = [];
  fakeWindow.onbeforeunload = null;
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

test('site settings keeps edits on cancelled leave, then restores the saved baseline on discard and refresh', async () => {
  const mounted = await mountShell('/settings');
  const firstSettings = findInstance(mounted.app, 'saved');
  const firstState = firstSettings.setupState;
  firstState.form.logo_asset_id = 'logo-edited';
  await nextTick();
  assert.equal(firstState.dirty, true);

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/settings');
  assert.equal(firstState.form.logo_asset_id, 'logo-edited');
  assert.equal(firstState.dirty, true);

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/settings');
  await flushUpdates();
  const restoredSettings = findInstance(mounted.app, 'saved');
  assert.equal(restoredSettings.uid, firstSettings.uid, 'cacheable management page should be reused');
  assert.equal(restoredSettings.setupState.form.logo_asset_id, 'logo-saved');
  assert.equal(restoredSettings.setupState.dirty, false);

  const shell = findInstance(mounted.app, 'profileVisible');
  const readsBeforeRefresh = testContext.settingsReads;
  await shell.setupState.onTabCommand('refresh');
  await waitFor(() => testContext.settingsReads > readsBeforeRefresh, 'site settings reload after refresh');
  const refreshedSettings = findInstance(mounted.app, 'saved');
  assert.equal(refreshedSettings.setupState.form.logo_asset_id, 'logo-saved');
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
  settings.setupState.form.logo_asset_id = 'logo-edited';
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
  assert.equal(settings.setupState.form.logo_asset_id, 'logo-edited');
  assert.equal(shell.setupState.profile.real_name, '未保存姓名');
  assert.equal(settings.setupState.dirty, true);
  assert.equal(shell.setupState.profileDirty, true);

  testContext.confirmDecisions.push(true, true);
  await shell.setupState.onLogout();
  assert.equal(testContext.logoutCalls, 1);
  assert.equal(testContext.tabResetCalls, 1);
  assert.equal(mounted.router.currentRoute.value.fullPath, '/login');
  assert.equal(settings.setupState.form.logo_asset_id, 'logo-saved');
  assert.equal(shell.setupState.profile.real_name, '原姓名');
  assert.equal(settings.setupState.dirty, false);
  assert.equal(shell.setupState.profileDirty, false);
  mounted.unmount();
});

test('menu write users load the narrow permission options endpoint without roles read', async () => {
  testContext.permissions = new Set(['system_settings:read', 'system_settings:write']);
  const mounted = await mountShell('/menus');
  await waitFor(
    () => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/menus/permission-options'),
    'menu permission options',
  );
  assert.equal(testContext.calls.some((call) => call.path === '/admin/permissions'), false);
  const menus = findInstance(mounted.app, 'permissionOptions');
  assert.deepEqual(
    [...menus.setupState.permissionOptions],
    [{ code: 'system_settings:write', name: '系统配置维护' }],
  );
  mounted.unmount();
});

test('menu read-only users do not request permission options', async () => {
  testContext.permissions = new Set(['system_settings:read']);
  const mounted = await mountShell('/menus');
  await waitFor(() => testContext.calls.some((call) => call.path === '/admin/menus'), 'menu tree');
  assert.equal(testContext.calls.some((call) => call.path === '/admin/menus/permission-options'), false);
  assert.equal(testContext.calls.some((call) => call.path === '/admin/permissions'), false);
  mounted.unmount();
});

test('menu dialog keeps a cancelled draft and restores its edit baseline after discard', async () => {
  const mounted = await mountShell('/menus');
  const firstMenus = findInstance(mounted.app, 'permissionOptions');
  firstMenus.setupState.openEdit({ id: 'menu-1', parent_id: null, name: '菜单基线', type: 'menu', route_path: '/menus', permission_code: 'system_settings:read', icon: null, sort: 10, status: 1, children: [] });
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

test('department edit protects dialog and route exits, restores baseline, and clears dirty after save', async () => {
  const mounted = await mountShell('/admin/departments');
  const first = findInstance(mounted.app, 'moveTree');
  await waitFor(() => first.setupState.tree.length === 1, 'department tree');
  first.setupState.openEdit(first.setupState.tree[0]);
  first.setupState.form.name = '未保存部门';
  await nextTick();
  assert.equal(first.setupState.dirty, true);

  testContext.confirmDecisions.push(false);
  await first.setupState.closeDialog();
  assert.equal(first.setupState.dialog, true);
  assert.equal(first.setupState.form.name, '未保存部门');

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/departments');
  assert.equal(first.setupState.form.name, '未保存部门');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/departments');
  const restored = findInstance(mounted.app, 'moveTree');
  assert.equal(restored.uid, first.uid);
  assert.equal(restored.setupState.form.name, '部门基线');
  assert.equal(restored.setupState.dialog, false);
  assert.equal(restored.setupState.dirty, false);

  restored.setupState.openEdit(restored.setupState.tree[0]);
  restored.setupState.form.name = '已保存部门';
  await restored.setupState.onSave();
  assert.equal(restored.setupState.dirty, false);
  assert.equal(restored.setupState.dialog, false);
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/departments/dept-1' && call.body.name === '已保存部门'));
  mounted.unmount();
});

test('employee edit protects dialog and route exits, restores baseline, and clears dirty after save', async () => {
  const mounted = await mountShell('/admin/users');
  const first = findInstance(mounted.app, 'studentSaveInFlightKey');
  await waitFor(() => first.setupState.list.length === 1, 'employee list');
  first.setupState.openEdit(first.setupState.list[0]);
  first.setupState.form.real_name = '未保存员工';
  await nextTick();
  assert.equal(first.setupState.employeeDirty, true);

  testContext.confirmDecisions.push(false);
  await first.setupState.closeEmployeeDialog();
  assert.equal(first.setupState.dialog, true);
  assert.equal(first.setupState.form.real_name, '未保存员工');

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/users');
  assert.equal(first.setupState.form.real_name, '未保存员工');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/users');
  const restored = findInstance(mounted.app, 'studentSaveInFlightKey');
  assert.equal(restored.uid, first.uid);
  assert.equal(restored.setupState.form.real_name, '员工基线');
  assert.equal(restored.setupState.dialog, false);
  assert.equal(restored.setupState.employeeDirty, false);

  restored.setupState.openEdit(restored.setupState.list[0]);
  restored.setupState.form.real_name = '已保存员工';
  await restored.setupState.onSave();
  assert.equal(restored.setupState.employeeDirty, false);
  assert.equal(restored.setupState.dialog, false);
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/users/user-1' && call.body.real_name === '已保存员工'));
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

test('administrator role draft protects dialog and route exits, restores baseline, and clears dirty after save', async () => {
  const mounted = await mountShell('/admin/administrators');
  const first = findInstance(mounted.app, 'candidateDialog');
  await waitFor(() => first.setupState.rows.length === 1, 'administrator list');
  await first.setupState.openRoles(first.setupState.rows[0]);
  first.setupState.selectedRoleIds.push('role-2');
  await nextTick();
  assert.equal(first.setupState.dirty, true);

  testContext.confirmDecisions.push(false);
  await first.setupState.closeRoleDialog();
  assert.equal(first.setupState.dialog, true);
  assert.deepEqual([...first.setupState.selectedRoleIds], ['role-1', 'role-2']);

  testContext.confirmDecisions.push(false);
  await mounted.router.push('/other');
  assert.equal(mounted.router.currentRoute.value.fullPath, '/admin/administrators');

  testContext.confirmDecisions.push(true);
  await mounted.router.push('/other');
  await mounted.router.push('/admin/administrators');
  const restored = findInstance(mounted.app, 'candidateDialog');
  assert.equal(restored.uid, first.uid);
  assert.deepEqual([...restored.setupState.selectedRoleIds], ['role-1']);
  assert.equal(restored.setupState.selected.id, 'admin-1');
  assert.equal(restored.setupState.dialog, false);
  assert.equal(restored.setupState.dirty, false);

  await restored.setupState.openRoles(restored.setupState.rows[0]);
  restored.setupState.selectedRoleIds.push('role-2');
  await restored.setupState.saveRoles();
  assert.equal(restored.setupState.dirty, false);
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/admin/administrators/admin-1/roles' && call.body.role_ids.join(',') === 'role-1,role-2'));
  mounted.unmount();
});

test('role edit protects dialog and route exits, restores baseline, and clears dirty after save', async () => {
  const mounted = await mountShell('/admin/roles');
  const first = findInstance(mounted.app, 'catalog');
  await waitFor(() => first.setupState.roles.length === 1, 'role list');
  first.setupState.openEdit(first.setupState.roles[0]);
  first.setupState.form.name = '未保存角色';
  first.setupState.form.permissions.push('roles:read');
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
  const restored = findInstance(mounted.app, 'catalog');
  assert.equal(restored.uid, first.uid);
  assert.equal(restored.setupState.form.name, '角色基线');
  assert.deepEqual([...restored.setupState.form.permissions], ['students:read']);
  assert.equal(restored.setupState.dialog, false);
  assert.equal(restored.setupState.dirty, false);

  restored.setupState.openEdit(restored.setupState.roles[0]);
  restored.setupState.form.name = '已保存角色';
  await restored.setupState.save();
  assert.equal(restored.setupState.dirty, false);
  assert.ok(testContext.calls.some((call) => call.method === 'PUT' && call.path === '/admin/roles/business-role-1' && call.body.name === '已保存角色'));
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
